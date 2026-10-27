/**
 * Browser test for free navigation and progress on the exercise page.
 *
 * It drives the real built app (no component mocks) and checks the behaviour
 * the navigation change is meant to guarantee:
 *
 *   1. any exercise chip opens that exercise directly, and the six chips are
 *      real buttons
 *   2. leaving an exercise mid-way and returning keeps the question and answer
 *   3. Previous returns to an answered question with its answer and feedback
 *   4. Next can skip an unanswered question, which stays visibly incomplete
 *   5. reaching the end with a skipped question does not complete the exercise;
 *      it jumps to the first incomplete question and explains why
 *   6. only after every question is answered does the summary appear, the
 *      completion request run, and that one chip become "Completed"
 *   7. completed work survives further exercise switching, and switching alone
 *      never records a completion
 *
 * The detailed per-question checks run on Chunking because its script has a
 * question, a read step, then a second question — enough room to skip a
 * question without ending the exercise. The other chips are still switched to
 * and back from to cover free movement between exercises.
 *
 * Prerequisites:
 *   - backend running and serving the built app (npm run build, then
 *     `python app.py` in ../backend), by default http://127.0.0.1:5000
 *   - Chrome or Edge installed
 *
 * Run from frontend-react/:
 *   npm run test:exercises:browser
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
const PORT = Number(process.env.CDP_PORT || 9334);
const MAIN_INDEX = 4; // Chunking
const TECHNIQUE_KEYS = [
  'method_of_loci',
  'elaborative_encoding',
  'spaced_retrieval',
  'face_name_association',
  'chunking',
  'active_observation',
];

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
 * Installed before the app's modules run. Records the exercise API calls the
 * page makes, so the test can prove that switching does not complete anything
 * and that a named technique is requested when a new chip is opened.
 */
const INSTRUMENTATION = `
(() => {
  window.__exerciseFetch = [];
  const original = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('/api/exercises/')) {
        window.__exerciseFetch.push({
          url,
          method: String((init && init.method) || 'GET').toUpperCase(),
          body: init && init.body ? String(init.body) : null,
        });
      }
    } catch {
      /* never break the request because of logging */
    }
    return original(input, init);
  };
})();
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const profile = await mkdtemp(join(tmpdir(), 'memoraid-exercises-'));
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
      await sleep(100);
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

  async function waitFor(expression, label, timeout = 60000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await sleep(50);
    }
    let context = '';
    try {
      const url = await evaluate('location.href');
      const body = await evaluate("document.body?.innerText?.slice(0, 500) || ''");
      context = ` URL: ${url} | page: ${JSON.stringify(body)}`;
    } catch {
      context = ' (page context unavailable)';
    }
    if (pageErrors.length) context += ` | page errors: ${pageErrors.join(' | ')}`;
    throw new Error(`Timed out waiting for ${label}.${context}`);
  }

  /** Everything the test needs to know about the current exercise board. */
  const info = () =>
    evaluate(`
      (() => {
        const shell = document.querySelector('.recall-shell');
        const summary = document.querySelector('.session-summary');
        const counter = shell
          ? [...shell.querySelectorAll('p')].find((p) => /^Step \\d+ of \\d+/.test(p.textContent.trim()))
          : null;
        const match = counter ? counter.textContent.match(/Step (\\d+) of (\\d+)/) : null;
        const textarea = document.querySelector('#exercise-answer');
        const primary = document.querySelector('.tutor-actions .btn-primary');
        const previous = [...document.querySelectorAll('.tutor-actions button')]
          .find((b) => b.textContent.trim() === 'Previous');
        const next = [...document.querySelectorAll('.tutor-actions button')]
          .find((b) => b.textContent.trim() === 'Next');
        const messages = [...document.querySelectorAll('.question-card .form-message')].map((el) => ({
          cls: el.className,
          role: el.getAttribute('role'),
          text: el.textContent.replace(/\\s+/g, ' ').trim(),
        }));
        return {
          summary: Boolean(summary),
          summaryText: summary ? summary.textContent.replace(/\\s+/g, ' ').trim() : null,
          step: match ? Number(match[1]) : null,
          total: match ? Number(match[2]) : null,
          prompt: document.querySelector('.question-card .question-text')?.textContent.trim() || null,
          hasAnswer: Boolean(textarea),
          answer: textarea ? textarea.value : null,
          answerDisabled: textarea ? textarea.disabled : null,
          primary: primary ? primary.textContent.replace(/\\s+/g, ' ').trim() : null,
          previousDisabled: previous ? previous.disabled : null,
          canSkip: Boolean(next),
          messages,
          dots: [...document.querySelectorAll('.recall-progress .dot')].map((d) => d.className),
        };
      })()
    `);

  async function waitInfo(predicate, label, timeout = 60000) {
    const deadline = Date.now() + timeout;
    let last = null;
    while (Date.now() < deadline) {
      last = await info();
      if (predicate(last)) return last;
      await sleep(50);
    }
    throw new Error(`Timed out waiting for ${label}. Last state: ${JSON.stringify(last)}`);
  }

  const chips = () =>
    evaluate(`
      [...document.querySelectorAll('.technique-chip')].map((button, index) => ({
        index,
        label: button.childNodes[0].textContent.trim(),
        current: button.getAttribute('aria-pressed') === 'true',
        status: button.querySelector('small')?.textContent.trim() || null,
        disabled: button.disabled,
      }))
    `);

  const exerciseCalls = (path) =>
    evaluate(
      `window.__exerciseFetch.filter((call) => call.url.includes(${JSON.stringify(path)}))`,
    );

  const completionCalls = () => exerciseCalls('/api/exercises/complete');

  const cardHeading = () =>
    evaluate("document.querySelector('.card h2')?.textContent.trim() || null");

  async function waitChipsReady() {
    await waitFor(
      "![...document.querySelectorAll('.technique-chip')].some((b) => b.disabled)",
      'exercise chips enabled',
    );
  }

  async function clickByText(text) {
    const clicked = await evaluate(`
      (() => {
        const button = [...document.querySelectorAll('button')]
          .find((b) => b.textContent.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)});
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()
    `);
    assert.ok(clicked, `could not click "${text}"`);
  }

  async function clickChip(index) {
    await waitChipsReady();
    await evaluate(`document.querySelectorAll('.technique-chip')[${index}].click()`);
  }

  async function clickPrimary() {
    const clicked = await evaluate(`
      (() => {
        const button = document.querySelector('.tutor-actions .btn-primary');
        if (!button || button.disabled) return null;
        const label = button.textContent.replace(/\\s+/g, ' ').trim();
        button.click();
        return label;
      })()
    `);
    assert.ok(clicked, 'no enabled primary action');
    return clicked;
  }

  async function typeAnswer(value) {
    const typed = await evaluate(`
      (() => {
        const textarea = document.querySelector('#exercise-answer');
        if (!textarea || textarea.disabled) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value',
        ).set;
        setter.call(textarea, ${JSON.stringify(value)});
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()
    `);
    assert.ok(typed, 'answer box was not writable');
    await sleep(100); // let React commit the controlled value
  }

  async function checkAnswer(value) {
    await typeAnswer(value);
    await clickByText('Check my answer');
    return waitInfo(
      (state) => state.answerDisabled === true,
      'feedback after checking an answer',
    );
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENTATION });

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
  await send('Page.navigate', { url: `${APP}/exercises` });
  await waitFor(
    "document.querySelectorAll('.technique-chip').length === 6",
    'the six technique chips',
  );

  const startingChips = await chips();
  assert.equal(startingChips.length, 6, 'expected all six techniques');
  assert.ok(
    startingChips.every((chip) => !chip.disabled),
    'technique chips should be usable as soon as the page loads',
  );
  const adaptiveIndex = startingChips.find((chip) => chip.current)?.index;
  assert.ok(adaptiveIndex != null, 'no technique was marked as current');

  // The two other exercises used for free switching: both unvisited, so each
  // chip click must ask the backend for that named technique.
  const others = [0, 1, 2, 3, 5].filter(
    (index) => index !== adaptiveIndex && index !== MAIN_INDEX,
  );
  const indexB = others[0];
  const indexC = others[1];

  // --- Open Chunking directly and answer its first question. -----------------
  await clickChip(MAIN_INDEX);
  await waitInfo(
    (state) => state.step === null && !state.summary && !state.hasAnswer,
    'Chunking intro card',
  );
  await waitChipsReady();
  let chipState = await chips();
  assert.equal(chipState[MAIN_INDEX].status, "Today's exercise");
  assert.equal(await cardHeading(), 'Chunking', 'the chunking chip opened another exercise');
  const directLoadForMain = await exerciseCalls('/api/exercises/next?technique=chunking');
  if (adaptiveIndex !== MAIN_INDEX) {
    assert.ok(directLoadForMain.length >= 1, 'the chunking chip did not load it directly');
  }
  assert.equal((await completionCalls()).length, 0, 'opening an exercise completed one');

  await clickByText('Start exercise');
  await waitFor("Boolean(document.querySelector('.question-card'))", 'exercise started');

  let state = await info();
  let guard = 0;
  while (!state.hasAnswer) {
    assert.ok(!state.summary, 'exercise finished before its first question');
    const before = state.step;
    assert.equal(await clickPrimary(), 'Continue', 'read steps should advance with Continue');
    state = await waitInfo((next) => next.step !== before || next.hasAnswer, 'next step');
    guard += 1;
    assert.ok(guard < 30, 'could not find an answerable question');
  }

  const firstAskStep = state.step;
  const firstAskPrompt = state.prompt;
  const firstAnswer = 'milk and bread / apples and tea / stamps and soap';
  await checkAnswer(firstAnswer);
  const afterChecking = await info();
  assert.ok(
    afterChecking.messages.some((message) => /is-(success|info)/.test(message.cls)),
    'checking an answer did not show feedback',
  );
  assert.ok(
    afterChecking.dots[firstAskStep - 1].includes('is-done'),
    'the answered question was not marked done',
  );

  const leaveLabel = await clickPrimary(); // Continue to the following read step
  assert.equal(leaveLabel, 'Continue');
  const afterFirstAsk = await waitInfo(
    (next) => next.step > firstAskStep,
    'step after the first answer',
  );
  const leftAtStep = afterFirstAsk.step;

  // --- Switch to B and back: direct load, no completion, no loss of A. ------
  await clickChip(indexB);
  await waitInfo(
    (next) => next.step === null && !next.summary && !next.hasAnswer,
    'B intro card',
  );
  await waitChipsReady();
  chipState = await chips();
  assert.equal(
    chipState[indexB].status,
    "Today's exercise",
    'the chip that was clicked did not become current',
  );
  assert.equal(
    await cardHeading(),
    startingChips[indexB].label,
    'the clicked chip showed a different exercise',
  );
  const directLoadsAfterB = await exerciseCalls('/api/exercises/next?technique=');
  assert.ok(
    directLoadsAfterB.some((call) =>
      call.url.includes(`technique=${TECHNIQUE_KEYS[indexB]}`),
    ),
    'clicking a chip did not request that named technique',
  );
  assert.equal((await completionCalls()).length, 0, 'switching exercises completed one');

  // Returning to Chunking must restore the exact question and its answer.
  await clickChip(MAIN_INDEX);
  const backOnMain = await waitInfo(
    (next) => next.step === leftAtStep && !next.summary,
    'Chunking restored at the same step',
  );
  assert.equal(backOnMain.total, afterFirstAsk.total, 'question count changed after switching');

  await clickByText('Previous');
  const answeredAgain = await waitInfo(
    (next) => next.step === firstAskStep,
    'Previous returned to the answered question',
  );
  assert.equal(answeredAgain.prompt, firstAskPrompt, 'Previous landed on a different question');
  assert.equal(answeredAgain.answer, firstAnswer, 'answer was erased');
  assert.equal(answeredAgain.answerDisabled, true, 'feedback was erased');
  assert.ok(
    answeredAgain.messages.some((message) => /is-(success|info)/.test(message.cls)),
    'feedback was not preserved with the answer',
  );
  assert.ok(
    answeredAgain.dots[firstAskStep - 1].includes('is-done'),
    'answered question is no longer marked done',
  );

  // --- Move to the next question, skip it, then return to it. ----------------
  assert.equal(await clickPrimary(), 'Continue'); // answered question -> following read step
  state = await waitInfo(
    (next) => next.step === leftAtStep,
    'read step after the answered question',
  );
  assert.equal(await clickPrimary(), 'Continue'); // read step -> next question
  state = await waitInfo(
    (next) => next.hasAnswer && next.step > leftAtStep,
    'the next unanswered question',
  );

  const skippedStep = state.step;
  const skippedPrompt = state.prompt;
  assert.equal(state.answer, '', 'the question chosen for skipping was already answered');
  assert.equal(state.answerDisabled, false, 'the question chosen for skipping has feedback');
  assert.ok(
    state.canSkip,
    'an unanswered question has no Next button to skip it temporarily',
  );
  assert.ok(
    !state.dots[skippedStep - 1].includes('is-done'),
    'an unanswered question was already marked done',
  );

  // A draft typed but not checked must survive the same round trip while
  // remaining incomplete.
  const skippedDraft = 'a draft I have not checked yet';
  await typeAnswer(skippedDraft);
  const withDraft = await info();
  assert.equal(withDraft.answer, skippedDraft, 'the draft was not entered');
  assert.equal(withDraft.answerDisabled, false, 'an unchecked draft looks submitted');
  assert.ok(
    !withDraft.dots[skippedStep - 1].includes('is-done'),
    'a draft was marked done without being checked',
  );

  await clickByText('Next');
  const afterSkip = await waitInfo(
    (next) => next.step === skippedStep + 1,
    'Next skipped the unanswered question',
  );
  assert.ok(
    !afterSkip.dots[skippedStep - 1].includes('is-done'),
    'skipping marked the unanswered question as done',
  );

  await clickByText('Previous');
  const skippedAgain = await waitInfo(
    (next) => next.step === skippedStep,
    'Previous returned to the skipped question',
  );
  assert.equal(skippedAgain.prompt, skippedPrompt, 'did not return to the skipped question');
  assert.equal(skippedAgain.answer, skippedDraft, 'the unchecked draft was erased');
  assert.equal(skippedAgain.answerDisabled, false, 'the skipped question has feedback');
  assert.ok(
    !skippedAgain.messages.some((message) => /is-(success|info)/.test(message.cls)),
    'the skipped question looks answered',
  );
  assert.ok(
    !skippedAgain.dots[skippedStep - 1].includes('is-done'),
    'the skipped question is marked done',
  );

  // --- Reach the end leaving that question unanswered. ----------------------
  await clickByText('Next'); // move on to the final question
  const finalStep = await waitInfo(
    (next) => next.step === skippedStep + 1 && next.step === next.total,
    'final question',
  );
  assert.equal(finalStep.hasAnswer, true);
  await checkAnswer('my final answer');

  const beforeGate = await info();
  assert.match(
    beforeGate.primary || '',
    /Review incomplete questions/,
    'the last step did not warn about the skipped question',
  );
  assert.equal((await completionCalls()).length, 0, 'finishing early recorded a completion');

  await clickPrimary();
  const gated = await waitInfo(
    (next) =>
      next.summary ||
      (next.step === skippedStep &&
        next.messages.some((message) => message.cls.includes('is-error'))),
    'completion gate',
  );
  assert.equal(gated.summary, false, 'the exercise was marked complete with a skipped question');
  assert.equal(gated.step, skippedStep, 'the gate did not jump to the first unanswered question');
  assert.ok(
    gated.messages.some(
      (message) => message.cls.includes('is-error') && /still needs an answer/.test(message.text),
    ),
    'the gate did not explain why completion was blocked',
  );
  assert.equal((await completionCalls()).length, 0, 'a blocked exercise was still saved');

  // --- Answer the last question and finish. ---------------------------------
  await checkAnswer('the skipped answer');
  const afterSkippedAnswer = await info();
  assert.equal(afterSkippedAnswer.primary, 'Continue');
  await clickPrimary();
  const backAtEnd = await waitInfo(
    (next) => next.step === finalStep.step,
    'back at the final question',
  );
  assert.match(
    backAtEnd.primary || '',
    /Finish and see my results/,
    'all questions answered but finishing was still blocked',
  );
  await clickPrimary();
  await waitFor(
    "document.querySelector('.session-summary')?.textContent.includes('Exercise complete')",
    'summary heading',
  );
  await waitFor(
    "document.querySelector('.session-summary')?.textContent.includes('Saved.')",
    'completion saved',
  );

  const completions = await completionCalls();
  assert.equal(completions.length, 1, 'the completed exercise was saved more than once');
  const completionBody = JSON.parse(completions[0].body);
  assert.equal(
    completionBody.technique,
    TECHNIQUE_KEYS[MAIN_INDEX],
    'the wrong exercise was recorded complete',
  );

  // --- Completed work survives more switching; other chips stay incomplete. --
  await clickChip(indexB);
  await waitFor(
    "document.querySelector('.card h2') && !document.querySelector('.session-summary')",
    'B intro after Chunking completed',
  );
  await waitFor(
    `document.querySelector('.card h2')?.textContent.includes(${JSON.stringify(startingChips[indexB].label.split(' ')[0])})`,
    'B intro heading',
  );
  await waitChipsReady();
  chipState = await chips();
  assert.equal(chipState[MAIN_INDEX].status, 'Completed', 'Chunking was not marked completed');
  assert.notEqual(chipState[indexB].status, 'Completed', 'B was marked completed by Chunking');
  assert.equal((await completionCalls()).length, 1, 'switching completed an exercise');

  await clickChip(indexC);
  await waitFor(
    "document.querySelector('.card h2') && !document.querySelector('.session-summary')",
    'C intro card',
  );
  await waitFor(
    `document.querySelector('.card h2')?.textContent.includes(${JSON.stringify(startingChips[indexC].label.split(' ')[0])})`,
    'C intro heading',
  );
  await waitChipsReady();
  const directLoads = await exerciseCalls('/api/exercises/next?technique=');
  assert.ok(directLoads.length >= 2, 'later chip clicks did not load their techniques directly');
  chipState = await chips();
  assert.equal(chipState[indexC].status, "Today's exercise");
  assert.notEqual(chipState[indexB].status, 'Completed', 'an untouched exercise was completed');

  await clickChip(MAIN_INDEX);
  const completedAgain = await waitInfo((next) => next.summary, 'completed Chunking restored');
  assert.match(completedAgain.summaryText, /Exercise complete/);
  await waitChipsReady();
  chipState = await chips();
  assert.equal(chipState[MAIN_INDEX].status, "Today's exercise");
  assert.equal((await completionCalls()).length, 1, 'returning to Chunking recorded it twice');

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);
  console.log('PASS: exercise navigation, preserved progress and completion gate verified');
  console.log(
    '      completion calls:',
    JSON.stringify(await completionCalls()),
  );
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  browser.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
