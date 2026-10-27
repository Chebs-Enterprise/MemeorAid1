/**
 * Browser test for the per-message actions in the companion chat.
 *
 * It drives the real built app against a real backend and checks:
 *
 *   1. the three actions stay invisible until the message is hovered
 *   2. Copy writes the message text to the clipboard and confirms it
 *   3. Share sends the text through navigator.share when it exists
 *   4. Share falls back to copying (with an honest message) when it does not
 *   5. Delete asks first, removes only that turn, and keeps the reply
 *   6. the deleted turn stays gone after a reload
 *   7. a separately saved memory is untouched by the chat deletion
 *   8. on a touch-sized screen the actions are visible without hover and the
 *      page does not scroll sideways
 *
 * The native share sheet itself cannot be opened in headless Chrome, so the
 * share test stubs navigator.share and asserts the exact payload the app passes
 * to it. Everything else is the real UI, API and database.
 *
 * Prerequisites:
 *   - backend running and serving the built app, by default
 *     http://127.0.0.1:5000
 *   - Chrome or Edge installed
 *
 * Run from frontend-react/:
 *   npm run test:chat:browser
 *
 * Override with APP_URL / BROWSER / CDP_PORT environment variables if needed.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = process.env.APP_URL || 'http://127.0.0.1:5000';
const PORT = Number(process.env.CDP_PORT || 9341);

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const profile = await mkdtemp(join(tmpdir(), 'memoraid-chat-actions-'));
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
let token;
const pageErrors = [];
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
      const body = await evaluate("document.body?.innerText?.slice(0, 700) || ''");
      context = ` URL: ${url} | page: ${JSON.stringify(body)}`;
    } catch {
      context = ' (page context unavailable)';
    }
    if (pageErrors.length) context += ` | page errors: ${pageErrors.join(' | ')}`;
    throw new Error(`Timed out waiting for ${label}.${context}`);
  }

  const api = async (path, options = {}) => {
    const res = await fetch(`${APP}/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  };

  /** The visible text of the role's bubble, without the "You"/"Aria" label. */
  const messageText = (which) =>
    evaluate(`
      (() => {
        const row = document.querySelector('.chat-row.${which === 'user' ? 'is-user' : 'is-ai'}');
        if (!row) return null;
        const bubble = row.querySelector('.chat-bubble');
        return [...bubble.childNodes]
          .filter((node) => !(node.nodeType === 1 && node.classList.contains('chat-sender')))
          .map((node) => node.textContent)
          .join('')
          .trim();
      })()
    `);

  const actionState = (which) =>
    evaluate(`
      (() => {
        const row = document.querySelector('.chat-row.${which === 'user' ? 'is-user' : 'is-ai'}');
        const actions = row?.querySelector('.chat-message-actions');
        return {
          opacity: actions ? getComputedStyle(actions).opacity : null,
          buttons: actions
            ? [...actions.querySelectorAll('button')].map((button) => ({
                label: button.getAttribute('aria-label'),
                text: button.textContent.replace(/\\s+/g, ' ').trim(),
                rect: (() => {
                  const r = button.getBoundingClientRect();
                  return { x: r.x, y: r.y, width: r.width, height: r.height };
                })(),
              }))
            : [],
        };
      })()
    `);

  const bubbleRect = (which) =>
    evaluate(`
      (() => {
        const row = document.querySelector('.chat-row.${which === 'user' ? 'is-user' : 'is-ai'}');
        const bubble = row?.querySelector('.chat-bubble');
        if (!bubble) return null;
        const r = bubble.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()
    `);

  async function clickAt(x, y) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
  }

  async function hover(which) {
    const rect = await bubbleRect(which);
    assert.ok(rect, `no ${which} bubble to hover`);
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      button: 'none',
    });
    await sleep(300); // let the opacity transition finish
  }

  async function clickAction(which, label) {
    await hover(which);
    const state = await actionState(which);
    const button = state.buttons.find((item) => item.label === label);
    assert.ok(button, `no "${label}" action on the ${which} message`);
    await clickAt(button.rect.x + button.rect.width / 2, button.rect.y + button.rect.height / 2);
  }

  async function clickConfirmDelete() {
    const button = await evaluate(`
      (() => {
        const button = [...document.querySelectorAll('.chat-delete-confirm button')]
          .find((item) => item.textContent.trim() === 'Delete');
        if (!button) return null;
        const r = button.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()
    `);
    assert.ok(button, 'the delete confirmation did not appear');
    await clickAt(button.x + button.width / 2, button.y + button.height / 2);
  }

  const toastText = () =>
    evaluate("document.querySelector('.toast.is-visible')?.textContent || ''");

  async function waitToast(text) {
    await waitFor(
      `(document.querySelector('.toast.is-visible')?.textContent || '').includes(${JSON.stringify(text)})`,
      `toast "${text}"`,
      8000,
    );
  }

  async function clickSend() {
    await evaluate(`
      (() => {
        const button = document.querySelector('.chat-input-row button[type="submit"]');
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()
    `);
  }

  async function typeDraft(text) {
    const typed = await evaluate(`
      (() => {
        const textarea = document.querySelector('#chat-input');
        if (!textarea) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value',
        ).set;
        setter.call(textarea, ${JSON.stringify(text)});
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()
    `);
    assert.ok(typed, 'chat input was not available');
    await sleep(100);
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.bringToFront');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  try {
    await send('Browser.grantPermissions', {
      origin: APP,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    });
  } catch (err) {
    console.warn(`Could not grant clipboard permissions: ${err.message}`);
  }

  // A fresh account keeps the test isolated from the demo conversation.
  const stamp = Date.now();
  const email = `chat-actions-${stamp}@example.com`;
  const unique = `The test keepsake is a blue teapot ${stamp}.`;
  const memoryText = `A separately saved memory ${stamp}.`;

  const registered = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      fullname: 'Chat Actions Test',
      email,
      password: 'password123',
      agegroup: 'above-65',
    }),
  });
  assert.equal(registered.res.status, 201, 'could not register the test account');
  token = registered.data.token;

  const categories = await api('/categories');
  const categoriesList = categories.data.categories || [];
  assert.ok(categoriesList.length, 'no memory categories available');
  const saved = await api('/memories', {
    method: 'POST',
    body: JSON.stringify({
      categoryid: categoriesList[0].categoryid,
      content: memoryText,
      contextnote: 'Created before the chat action test.',
    }),
  });
  assert.equal(saved.res.status, 201, 'could not create the saved memory');

  await send('Page.navigate', { url: `${APP}/login` });
  await waitFor('document.readyState === "complete"', 'login page');
  await evaluate(`
    localStorage.setItem('memoraid_token', ${JSON.stringify(token)});
    localStorage.setItem('memoraid_user', ${JSON.stringify(JSON.stringify(registered.data.user))});
  `);
  await send('Page.navigate', { url: `${APP}/chat` });
  await waitFor(
    "Boolean(document.querySelector('.chat-thread')) && Boolean(document.querySelector('#chat-input'))",
    'the chat page',
  );

  // --- Send one real exchange through the UI. --------------------------------
  await typeDraft(unique);
  await clickSend();
  await waitFor(
    "document.querySelectorAll('.chat-row').length === 2",
    'the optimistic user and assistant rows',
  );
  await waitFor(
    "(document.querySelector('.chat-input-row button[type=\"submit\"]')?.textContent || '').trim() === 'Send'",
    'the reply to finish',
  );
  const userText = await messageText('user');
  const replyText = await messageText('ai');
  assert.equal(userText, unique, 'the sent message was not rendered intact');
  assert.ok(replyText && replyText.length > 5, 'the companion reply did not arrive');

  // --- The actions are subtle until the message is hovered. ------------------
  const idleState = await actionState('ai');
  assert.equal(idleState.opacity, '0', 'the actions are visible without hovering');
  assert.deepEqual(
    idleState.buttons.map((button) => button.label),
    ['Copy message', 'Share message', 'Delete message'],
    'the action set is incomplete',
  );

  await hover('ai');
  const hoveredState = await actionState('ai');
  assert.equal(hoveredState.opacity, '1', 'hovering the reply did not reveal its actions');
  const desktopOverflow = await evaluate(
    'document.documentElement.scrollWidth - window.innerWidth',
  );
  assert.ok(desktopOverflow <= 1, `the chat page scrolls sideways by ${desktopOverflow}px`);

  // The pointer must be able to cross the visual gap from the bubble to the
  // icons without the icons disappearing on the way (no dead strip).
  const aiBubble = await bubbleRect('ai');
  const copyButton = hoveredState.buttons.find((button) => button.label === 'Copy message');
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: aiBubble.x + aiBubble.width + 4,
    y: copyButton.rect.y + copyButton.rect.height / 2,
    button: 'none',
  });
  await sleep(300);
  const bridgedState = await actionState('ai');
  assert.equal(
    bridgedState.opacity,
    '1',
    'the actions vanished while the pointer crossed from the bubble to them',
  );

  // --- Copy ------------------------------------------------------------------
  await clickAction('ai', 'Copy message');
  await waitToast('Message copied.');
  const copied = await evaluate('navigator.clipboard.readText()');
  assert.equal(copied, replyText, 'the clipboard did not receive the reply text');

  // --- Share through the native share API (stubbed in headless Chrome). ------
  await evaluate(`
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (payload) => { window.__sharedPayload = payload; },
    });
    true;
  `);
  await clickAction('ai', 'Share message');
  await waitToast('Message shared.');
  const shared = await evaluate('window.__sharedPayload || null');
  assert.ok(shared, 'navigator.share was not called');
  assert.equal(shared.text, replyText, 'the shared text was not the message');

  // --- Share with no native support must copy instead. -----------------------
  await evaluate(`
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    true;
  `);
  await clickAction('user', 'Share message');
  await waitToast('Sharing is not available here');
  const fallbackClipboard = await evaluate('navigator.clipboard.readText()');
  assert.equal(fallbackClipboard, userText, 'the share fallback did not copy the message');

  // --- A failed delete must keep the message and say so. ---------------------
  await evaluate(`
    window.__realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = String(typeof input === 'string' ? input : input?.url || '');
      const method = String(init?.method || 'GET').toUpperCase();
      if (url.includes('/api/chat/messages/') && method === 'DELETE') {
        return Promise.reject(new TypeError('simulated network failure'));
      }
      return window.__realFetch(input, init);
    };
    true;
  `);
  await clickAction('ai', 'Delete message');
  await clickConfirmDelete();
  await waitToast('could not reach MemorAid');
  assert.equal(
    await messageText('ai'),
    replyText,
    'a failed delete removed the message from the thread',
  );
  assert.ok(
    !(await toastText()).includes('Message deleted'),
    'a failed delete claimed the message was permanently deleted',
  );
  await evaluate(`
    window.fetch = window.__realFetch;
    delete window.__realFetch;
    const cancel = document.querySelector('.chat-delete-confirm button[aria-label="Keep this message"]');
    if (cancel) cancel.click();
    true;
  `);

  // --- Delete only the user turn, after confirming. --------------------------
  await clickAction('user', 'Delete message');
  assert.equal(await messageText('user'), unique, 'the message vanished before confirmation');
  assert.equal(
    await evaluate('document.activeElement?.getAttribute("aria-label")'),
    'Keep this message',
    'the confirmation did not put focus on the safe choice',
  );
  await clickConfirmDelete();
  await waitToast('Message deleted.');
  await waitFor(
    "!document.querySelector('.chat-row.is-user')",
    'the deleted user message to disappear',
  );
  assert.equal(await messageText('ai'), replyText, 'deleting the user turn removed the reply');

  // The separately saved memory is not part of the chat and must survive.
  const memoriesAfterDelete = await api('/memories');
  assert.ok(
    (memoriesAfterDelete.data.memories || []).some((memory) => memory.content === memoryText),
    'deleting a chat message removed a saved memory',
  );

  // --- The deletion is persisted: reload and check again. --------------------
  await send('Page.reload');
  await waitFor(
    "Boolean(document.querySelector('.chat-row.is-ai')) && !document.querySelector('.chat-row.is-user')",
    'the reloaded conversation',
    20000,
  );
  assert.equal(await messageText('ai'), replyText, 'the reply did not survive the reload');
  assert.equal(await messageText('user'), null, 'the deleted message came back after reload');
  const memoriesAfterReload = await api('/memories');
  assert.ok(
    (memoriesAfterReload.data.memories || []).some((memory) => memory.content === memoryText),
    'the saved memory disappeared after the reload',
  );

  // --- A mid-width screen with the largest text preset must still fit. ------
  await send('Emulation.setDeviceMetricsOverride', {
    width: 700,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(300);
  await evaluate("document.body.dataset.fontSize = 'xlarge'; true");
  await clickAction('ai', 'Delete message');
  const midOverflow = await evaluate(
    'document.documentElement.scrollWidth - window.innerWidth',
  );
  assert.ok(
    midOverflow <= 1,
    `the delete confirmation overflows by ${midOverflow}px at 700px with large text`,
  );
  await evaluate(`
    document.querySelector('.chat-delete-confirm button[aria-label="Keep this message"]')?.click();
    true;
  `);

  // --- Touch-sized screens get the actions without hover. --------------------
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.reload');
  await waitFor(
    "Boolean(document.querySelector('.chat-row.is-ai .chat-message-actions'))",
    'the touch-sized conversation',
    20000,
  );
  const touchState = await actionState('ai');
  assert.equal(touchState.opacity, '1', 'the actions are hidden on a touch screen');
  const overflow = await evaluate(
    'document.documentElement.scrollWidth - window.innerWidth',
  );
  assert.ok(overflow <= 1, `the chat page scrolls sideways by ${overflow}px on a phone`);

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);
  console.log('PASS: per-message copy, share, delete, persistence and touch access verified');
  console.log(`      reply: ${JSON.stringify(replyText.slice(0, 80))}`);
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  browser.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
