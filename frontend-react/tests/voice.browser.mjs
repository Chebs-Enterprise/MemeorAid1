/**
 * Browser lifecycle test for the voice-input hook (no microphone required).
 *
 * Injects a fake `SpeechRecognition` into headless Chrome/Edge before the app
 * loads and drives the real Chat page, replaying the cumulative result events
 * a browser produces. It checks:
 *
 *   1. cumulative final results are not replayed as duplicate transcripts
 *   2. Stop responds immediately while transcription is still pending, and a
 *      final result that arrives afterwards is still kept
 *   3. pressing Speak while the previous session is still ending queues a new
 *      session instead of failing silently
 *   4. long speech with pauses is never ended by the app: the microphone stays
 *      on until the user presses Stop or sends explicitly
 *   5. rapid start/stop does not throw or leave the recorder stuck
 *   6. an error followed by `end` leaves the recorder recoverable and is not
 *      restarted automatically
 *   7. a clean browser-side `end` continues the same recording, appending new
 *      words without duplicating earlier ones
 *   8. a session that keeps ending immediately without speech gives up instead
 *      of looping, and an explicit Stop never restarts
 *   9. late results after Stop do not look like a new session or send a turn
 *  10. leaving the page aborts the recognition session
 *
 * Prerequisites:
 *   - backend running and serving the built app (npm run build, then
 *     `python app.py` in ../backend), by default http://127.0.0.1:5000
 *   - Chrome or Edge installed
 *
 * Run from frontend-react/:
 *   npm run test:voice:browser
 *
 * Override with APP_URL / BROWSER environment variables if needed.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = process.env.APP_URL || 'http://127.0.0.1:5000';
const PORT = Number(process.env.CDP_PORT || 9333);

const CANDIDATES = [
  process.env.BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const BROWSER = CANDIDATES.find((path) => existsSync(path));
if (!BROWSER) {
  console.error('No Chrome/Edge found. Set BROWSER to the executable path.');
  process.exit(1);
}

try {
  const health = await fetch(`${APP}/api/health`);
  if (!health.ok) throw new Error(`HTTP ${health.status}`);
} catch (err) {
  console.error(`Backend not reachable at ${APP} (${err.message}).`);
  console.error('Start it first: cd backend && .\\.venv\\Scripts\\python.exe app.py');
  process.exit(1);
}

/**
 * Installed before the app's modules run. The class mirrors the parts of the
 * Web Speech API the hook uses; events are triggered from the test via
 * `__emitResults`, `__emitError` and `__emitEnd`.
 */
const FAKE_SOURCE = `
(() => {
  window.__voiceCalls = { start: 0, stop: 0, abort: 0 };
  class FakeSpeechRecognition {
    constructor() {
      this.continuous = false;
      this.interimResults = false;
      this.lang = '';
      this.onstart = null;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this.started = false;
      window.__fakeRec = this;
    }
    start() {
      if (this.started) throw new DOMException('already started', 'InvalidStateError');
      this.started = true;
      window.__voiceCalls.start += 1;
      setTimeout(() => { if (this.onstart) this.onstart(); }, 0);
    }
    stop() {
      if (!this.started) throw new DOMException('recognition has not started', 'InvalidStateError');
      this.started = false;
      window.__voiceCalls.stop += 1;
      // Simulate a slow speech service still returning final results.
      setTimeout(() => { if (this.onend) this.onend(); }, 400);
    }
    abort() {
      this.started = false;
      window.__voiceCalls.abort += 1;
      setTimeout(() => { if (this.onend) this.onend(); }, 0);
    }
  }
  window.SpeechRecognition = FakeSpeechRecognition;
  window.webkitSpeechRecognition = FakeSpeechRecognition;
  window.__emitResults = (items) => {
    const results = items.map(({ t, f }) => {
      const result = [{ transcript: t }];
      result.isFinal = Boolean(f);
      return result;
    });
    window.__fakeRec.onresult({ results, resultIndex: 0 });
  };
  window.__emitError = (code) => { window.__fakeRec.onerror({ error: code }); };
  window.__emitEnd = () => {
    window.__fakeRec.started = false;
    window.__fakeRec.onend({});
  };
})();
`;

const profile = await mkdtemp(join(tmpdir(), 'memoraid-voice-'));
const browser = spawn(
  BROWSER,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let ws;
try {
  let ready = false;
  for (let i = 0; i < 100 && !ready; i += 1) {
    try {
      ready = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(ready, 'DevTools endpoint did not start');

  const target = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
  ).json();

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let nextId = 0;
  const pending = new Map();
  const pageErrors = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      pageErrors.push(details.exception?.description || details.text);
    }
  };

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description || result.exceptionDetails.text,
      );
    }
    return result.result.value;
  }

  async function waitFor(expression, label, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  const clickMic = () => evaluate("document.querySelector('.chat-mic').click()");
  const micText = () => evaluate("document.querySelector('.chat-mic').textContent.trim()");
  const hintText = () =>
    evaluate("document.querySelector('.chat-voice-hint').textContent.trim()");
  const callCount = (name) => evaluate(`window.__voiceCalls.${name}`);
  const isSpeaking = () =>
    waitFor(
      "document.querySelector('.chat-mic').textContent.trim() === 'Stop'",
      'recording start',
    );
  const isStopped = (label) =>
    waitFor(
      "document.querySelector('.chat-mic').textContent.trim() === 'Speak'",
      label || 'recording stop',
    );
  const draftIs = (value, label) =>
    waitFor(
      `document.querySelector('#chat-input').value === ${JSON.stringify(value)}`,
      label,
    );

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_SOURCE });

  // Sign in through the real API, then seed the app's storage.
  const login = await fetch(`${APP}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'eleanor@demo.memoraid.app', password: 'demo1234' }),
  });
  assert.equal(login.status, 200, 'demo login failed');
  const session = await login.json();

  await send('Page.navigate', { url: `${APP}/login` });
  await waitFor('document.readyState === "complete"', 'login page');
  await evaluate(`
    localStorage.setItem('memoraid_token', ${JSON.stringify(session.token)});
    localStorage.setItem('memoraid_user', ${JSON.stringify(JSON.stringify(session.user))});
  `);
  await send('Page.navigate', { url: `${APP}/chat` });
  await waitFor("Boolean(document.querySelector('.chat-mic'))", 'chat page');

  // 1. Cumulative results (the real browser's event shape) must not duplicate.
  await clickMic();
  await isSpeaking();
  await evaluate(`__emitResults([{ t: 'I took my pills', f: false }])`);
  await evaluate(`__emitResults([{ t: 'I took my pills', f: true }])`);
  await evaluate(`__emitResults([{ t: 'I took my pills', f: true }, { t: 'at', f: false }])`);
  await evaluate(`__emitResults([{ t: 'I took my pills', f: true }, { t: 'at eight', f: true }])`);
  await evaluate(
    `__emitResults([{ t: 'I took my pills', f: true }, { t: 'at eight', f: true }, { t: 'please', f: false }])`,
  );
  await evaluate(
    `__emitResults([{ t: 'I took my pills', f: true }, { t: 'at eight', f: true }, { t: 'at eight please', f: true }])`,
  );
  await evaluate(
    `__emitResults([{ t: 'I took my pills', f: true }, { t: 'at eight', f: true }, { t: 'at eight please', f: true }, { t: 'I took my pills at eight please', f: true }])`,
  );
  await draftIs(
    'I took my pills at eight please',
    'first draft without duplicate transcripts',
  );

  // 2. Stop responds immediately even while transcription is pending, and a
  //    final result that arrives afterwards is still kept.
  await clickMic();
  await isStopped('Stop responds immediately');
  await new Promise((resolve) => setTimeout(resolve, 100));
  await evaluate(
    `__emitResults([{ t: 'I took my pills', f: true }, { t: 'at eight', f: true }, { t: 'at eight please', f: true }, { t: 'I took my pills at eight please', f: true }, { t: 'tomorrow', f: true }])`,
  );
  await draftIs(
    'I took my pills at eight please tomorrow',
    'final result after Stop kept',
  );

  // 3. Starting again while the old session is still winding down must queue,
  //    not silently fail, and the new session must append cleanly.
  await clickMic();
  await waitFor('window.__voiceCalls.start === 2', 'queued restart', 3000);
  await isSpeaking();
  await evaluate(`__emitResults([{ t: 'and', f: false }])`);
  await evaluate(`__emitResults([{ t: 'and Friday', f: true }])`);
  await draftIs(
    'I took my pills at eight please tomorrow and Friday',
    'restarted session without duplicates',
  );

  // 4. A gap between speech-service events is not silence. Long speech whose
  //    final results are more than 1.8 s apart must keep the microphone on:
  //    recording only ends when the user presses Stop.
  await clickMic();
  await isStopped('ended previous session');
  await new Promise((resolve) => setTimeout(resolve, 500)); // let 'end' arrive
  await clickMic();
  await isSpeaking();
  const stopsBeforeSpeech = await callCount('stop');
  await evaluate(`__emitResults([{ t: 'My appointment', f: true }])`);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await evaluate(
    `__emitResults([{ t: 'My appointment', f: true }, { t: 'with Doctor', f: false }])`,
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await evaluate(
    `__emitResults([{ t: 'My appointment', f: true }, { t: 'with Doctor Patel', f: false }])`,
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(
    await micText(),
    'Stop',
    'recording stopped while the user was still speaking (final results were >1.8s apart)',
  );
  assert.equal(
    await callCount('stop'),
    stopsBeforeSpeech,
    'the app stopped the microphone while the user was still speaking',
  );
  await clickMic();
  await isStopped('stopped deliberately');
  await new Promise((resolve) => setTimeout(resolve, 500)); // let 'end' arrive

  // 5. Rapid start/stop must not throw or leave the recorder stuck.
  const errorsBefore = pageErrors.length;
  for (let i = 0; i < 5; i += 1) {
    await clickMic();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await clickMic();
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  await new Promise((resolve) => setTimeout(resolve, 700));
  if ((await micText()) !== 'Speak') {
    await clickMic();
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  assert.equal(await micText(), 'Speak', 'rapid toggles left the recorder stuck');
  assert.equal(pageErrors.length, errorsBefore, 'rapid toggling raised errors');

  // 6. Error + end must leave a recoverable UI; a fresh session must start.
  await clickMic();
  await isSpeaking();
  await evaluate("__emitError('network')");
  await evaluate('__emitEnd()');
  await isStopped('recovered after error');
  await clickMic();
  await isSpeaking();
  await clickMic();
  await isStopped('stopped after recovery');

  // 7. The browser may end a continuous recognition session on its own (idle
  //    timeout, long session). Because the user has not pressed Stop, the
  //    recording must continue and new words must append to the text already
  //    captured rather than replaying or replacing it.
  await clickMic();
  await isSpeaking();
  await evaluate(`__emitResults([{ t: 'and Margaret', f: true }])`);
  const draftBeforeContinue = await evaluate("document.querySelector('#chat-input').value");
  const startsBeforeEnd = await callCount('start');
  await evaluate('__emitEnd()');
  await waitFor(
    `window.__voiceCalls.start === ${startsBeforeEnd + 1}`,
    'recording continued after a clean browser end',
    3000,
  );
  await isSpeaking();
  await evaluate(`__emitResults([{ t: 'at ten', f: true }])`);
  await draftIs(
    `${draftBeforeContinue} at ten`,
    'continued session appended to earlier speech without duplicates',
  );

  // 7b. Only an explicit Stop may end the recording: the continuation session
  //     must not be restarted when it ends after Stop.
  await clickMic();
  await isStopped('stopped after continuation');
  const startsAfterStop = await callCount('start');
  await new Promise((resolve) => setTimeout(resolve, 700)); // let Stop's 'end' arrive
  assert.equal(
    await callCount('start'),
    startsAfterStop,
    'the microphone restarted after the user pressed Stop',
  );
  assert.equal(await micText(), 'Speak', 'explicit Stop left the mic stuck');

  // 8. A session that ends immediately without producing anything must not
  //    cause a restart loop. After three rapid failures the recorder gives up
  //    and waits for the user instead of hammering the speech service.
  await clickMic();
  await isSpeaking();
  for (let i = 0; i < 3; i += 1) {
    const startsBeforeRapidEnd = await callCount('start');
    await evaluate('__emitEnd()');
    if (i < 2) {
      await waitFor(
        `window.__voiceCalls.start === ${startsBeforeRapidEnd + 1}`,
        `rapid-end continuation ${i + 1}`,
        3000,
      );
      await isSpeaking();
    }
  }
  await isStopped('gave up after repeated immediate endings');
  const startsAfterGiveUp = await callCount('start');
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(
    await callCount('start'),
    startsAfterGiveUp,
    'immediate session endings caused a restart loop',
  );

  // 9. Results that arrive after Stop belong to the stopped session. Final
  //    words are kept (the browser finalises asynchronously), but they must not
  //    make the UI look like it is listening again or auto-send a second turn.
  await clickMic();
  await isSpeaking();
  await evaluate(`__emitResults([{ t: 'quiet', f: true }])`);
  await clickMic();
  await isStopped('stopped before the late result');
  const draftBeforeLate = await evaluate("document.querySelector('#chat-input').value");
  await evaluate(`__emitResults([{ t: 'quiet', f: true }, { t: 'half', f: false }])`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(
    await evaluate("document.querySelector('#chat-input').value"),
    draftBeforeLate,
    'an interim result repainted the box after Stop',
  );
  assert.ok(
    !(await hintText()).startsWith('Listening'),
    'a stopped session looked like it was listening again',
  );
  await evaluate(`__emitResults([{ t: 'quiet', f: true }, { t: 'at noon', f: true }])`);
  await new Promise((resolve) => setTimeout(resolve, 2200));
  assert.ok(
    (await evaluate("document.querySelector('#chat-input').value")).endsWith('at noon'),
    'final speech after Stop was discarded',
  );
  assert.equal(await micText(), 'Speak', 'late results restarted the microphone or auto-sent');
  assert.ok(
    !(await hintText()).startsWith('Listening'),
    'late results made the stopped session look live',
  );

  // 10. Navigating away must abort the recognition session (cleanup).
  await clickMic();
  await isSpeaking();
  const abortsBefore = await evaluate('window.__voiceCalls.abort');
  await evaluate(
    `history.pushState({}, '', '/dashboard'); window.dispatchEvent(new PopStateEvent('popstate'))`,
  );
  await waitFor("!document.querySelector('.chat-mic')", 'chat unmounted');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(
    (await evaluate('window.__voiceCalls.abort')) > abortsBefore,
    'recognition was not aborted on unmount',
  );

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);
  console.log('PASS: voice lifecycle verified in headless browser (no microphone needed)');
  console.log('      recognition calls:', JSON.stringify(await evaluate('window.__voiceCalls')));
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  browser.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
