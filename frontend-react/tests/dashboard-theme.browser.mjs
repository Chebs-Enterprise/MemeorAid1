import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const DEBUG_PORT = 9333;
const profileDir = mkdtempSync(join(tmpdir(), 'memoraid-theme-'));
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

async function waitFor(cdp, expression, attempts = 100) {
  for (let i = 0; i < attempts; i += 1) {
    if (await evaluate(cdp, expression)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

try {
  await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  const page = await fetch(
    `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent('http://127.0.0.1:5173/login')}`,
    { method: 'PUT' },
  ).then((response) => response.json());
  const cdp = new Cdp(page.webSocketDebuggerUrl);

  await cdp.send('Runtime.enable');
  await waitFor(cdp, `location.origin === 'http://127.0.0.1:5173' && document.readyState === 'complete'`);
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
      location.href = '/dashboard';
    })()
  `);
  await waitFor(cdp, `location.pathname === '/dashboard' && Boolean(document.querySelector('.stat-grid'))`);

  const result = await evaluate(cdp, `
    (() => {
      document.body.dataset.highContrast = 'true';
      const style = (selector) => {
        const node = document.querySelector(selector);
        const computed = getComputedStyle(node);
        return {
          backgroundColor: computed.backgroundColor,
          backgroundImage: computed.backgroundImage,
          color: computed.color,
        };
      };
      return {
        body: style('body'),
        greeting: style('.greeting-card'),
        secondaryAction: style('.section-head .btn-secondary'),
        memory: style('.memory-item'),
      };
    })()
  `);

  console.log(JSON.stringify(result, null, 2));

  assert.equal(result.body.backgroundColor, 'rgb(0, 0, 0)', 'dark theme should make the app background black');
  assert.equal(result.greeting.backgroundImage, 'none', 'dark theme must not retain the light greeting gradient');
  assert.equal(result.secondaryAction.backgroundImage, 'none', 'secondary action must not retain the pale light-theme gradient');
  assert.equal(result.secondaryAction.color, 'rgb(125, 227, 212)', 'secondary action text should remain readable in dark mode');
  assert.notEqual(result.memory.backgroundColor, 'rgb(250, 240, 228)', 'memory rows must not retain the light cream surface');

  cdp.close();
} finally {
  chromium.kill('SIGTERM');
  rmSync(profileDir, { recursive: true, force: true });
}
