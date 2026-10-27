import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const DEBUG_PORT = 9334;
const APP_ORIGIN = 'http://127.0.0.1:5173';
const ROUTES = [
  '/notifications',
  '/log-memory',
  '/recall',
  '/exercises',
  '/chat',
  '/analytics',
  '/profile',
];
const profileDir = mkdtempSync(join(tmpdir(), 'memoraid-dark-pages-'));
const chromium = spawn('/usr/bin/chromium', [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: 'ignore' });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, attempts = 80) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Chromium is still starting.
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class Cdp {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId;
    this.nextId += 1;
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed');
  }
  return result.result.value;
}

async function waitFor(cdp, expression, attempts = 120) {
  for (let i = 0; i < attempts; i += 1) {
    if (await evaluate(cdp, expression)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

try {
  await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  const page = await fetch(
    `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(`${APP_ORIGIN}/login`)}`,
    { method: 'PUT' },
  ).then((response) => response.json());
  const cdp = new Cdp(page.webSocketDebuggerUrl);

  await cdp.send('Runtime.enable');
  await waitFor(cdp, `location.origin === '${APP_ORIGIN}' && document.readyState === 'complete'`);
  await evaluate(cdp, `
    (async () => {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'eleanor@demo.memoraid.app',
          password: 'demo1234'
        })
      });
      const data = await response.json();
      localStorage.setItem('memoraid_token', data.token);
      localStorage.setItem('memoraid_user', JSON.stringify(data.user));
      localStorage.setItem('memoraid_high_contrast', 'true');
    })()
  `);

  const reports = [];
  for (const route of ROUTES) {
    await evaluate(cdp, `location.href = '${APP_ORIGIN}${route}'`);
    await waitFor(cdp, `location.pathname === '${route}' && document.body.dataset.highContrast === 'true' && Boolean(document.querySelector('main'))`);
    await delay(250);

    const report = await evaluate(cdp, `
      (() => {
        const selectors = [
          '.card', '.question-card', '.empty-state', '.steps-list li',
          '.chat-mode-toggle:not(.is-on)', '.chat-row.is-ai .chat-bubble',
          '.chat-input-row', '.memory-item'
        ];
        const visible = (node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const styleFor = (node) => {
          const style = getComputedStyle(node);
          return {
            selector: node.className || node.tagName.toLowerCase(),
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            color: style.color,
          };
        };
        const surfaces = selectors.flatMap((selector) =>
          Array.from(document.querySelectorAll(selector)).filter(visible).map(styleFor)
        );
        const primaryActions = Array.from(document.querySelectorAll('.btn-primary'))
          .filter(visible)
          .map(styleFor);
        const questionText = document.querySelector('.question-text');
        return {
          route: location.pathname,
          surfaces,
          primaryActions,
          questionText: questionText && visible(questionText) ? styleFor(questionText) : null,
        };
      })()
    `);
    reports.push(report);
  }

  const whiteGradientSurfaces = reports.flatMap((report) => report.surfaces
    .filter((surface) => /rgb\(255, 255, 255\)|rgb\(253, 252, 250\)/.test(surface.backgroundImage))
    .map((surface) => ({ route: report.route, ...surface })));
  const gradientPrimaryActions = reports.flatMap((report) => report.primaryActions
    .filter((action) => action.backgroundImage !== 'none')
    .map((action) => ({ route: report.route, ...action })));
  const darkQuestionText = reports
    .filter((report) => report.questionText?.color === 'rgb(0, 107, 98)')
    .map((report) => ({ route: report.route, ...report.questionText }));

  console.log(JSON.stringify({ whiteGradientSurfaces, gradientPrimaryActions, darkQuestionText }, null, 2));
  assert.deepEqual(whiteGradientSurfaces, [], 'dark mode must not retain white card gradients');
  assert.deepEqual(gradientPrimaryActions, [], 'dark mode primary actions need a solid high-contrast surface');
  assert.deepEqual(darkQuestionText, [], 'dark mode question text must not use dark teal on a dark card');

  cdp.close();
} finally {
  chromium.kill('SIGTERM');
  rmSync(profileDir, { recursive: true, force: true });
}
