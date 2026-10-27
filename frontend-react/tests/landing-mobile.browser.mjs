import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const DEBUG_PORT = 9335;
const APP_URL = 'http://127.0.0.1:5173/';
const profileDir = mkdtempSync(join(tmpdir(), 'memoraid-landing-mobile-'));
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

async function setViewport(cdp, width, height = 844) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: true,
  });
}

async function reloadWithTheme(cdp, enabled) {
  await evaluate(cdp, `
    (() => {
      localStorage.setItem('memoraid_high_contrast', '${enabled}');
      location.reload();
    })()
  `);
  await waitFor(cdp, `document.readyState === 'complete' && Boolean(document.querySelector('.lp-root'))`);
  await delay(150);
}

async function inspect(cdp) {
  return evaluate(cdp, `
    (() => {
      const selectors = [
        '.lp-root', '.lp-nav', '.lp-logo', '.lp-nav-cta', '.lp-hero',
        '.lp-hero-h1', '.lp-hero-sub', '.lp-btn-lg', '.lp-step-card',
        '.lp-family-card', '.lp-footer'
      ];
      const style = (selector) => {
        const node = document.querySelector(selector);
        const computed = getComputedStyle(node);
        return {
          color: computed.color,
          backgroundColor: computed.backgroundColor,
          backgroundImage: computed.backgroundImage,
          borderColor: computed.borderColor,
        };
      };
      const viewportWidth = document.documentElement.clientWidth;
      const overflow = Array.from(document.querySelectorAll('.lp-root *'))
        .filter((node) => {
          if (node.closest('.lp-testimonial-carousel')) return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && (rect.left < -1 || rect.right > viewportWidth + 1);
        })
        .map((node) => ({
          selector: node.className || node.tagName.toLowerCase(),
          left: Math.round(node.getBoundingClientRect().left),
          right: Math.round(node.getBoundingClientRect().right),
        }))
        .slice(0, 12);
      const logo = document.querySelector('.lp-logo').getBoundingClientRect();
      const actions = document.querySelector('.lp-nav-actions').getBoundingClientRect();
      const headerCta = document.querySelector('.lp-nav-cta');
      const mobileActions = document.querySelector('.lp-nav-mobile-actions');
      const firstSlide = document.querySelector('.lp-testimonial-slide').getBoundingClientRect();
      const carousel = document.querySelector('.lp-testimonial-carousel').getBoundingClientRect();
      return {
        viewportWidth,
        documentWidth: document.documentElement.scrollWidth,
        navGap: Math.round(actions.left - logo.right),
        logoRect: { left: Math.round(logo.left), right: Math.round(logo.right) },
        firstSlideWidth: Math.round(firstSlide.width),
        carouselWidth: Math.round(carousel.width),
        headerCtaVisible: getComputedStyle(headerCta).display !== 'none',
        mobileActionsVisible: getComputedStyle(mobileActions).display !== 'none',
        overflow,
        styles: Object.fromEntries(selectors.map((selector) => [selector, style(selector)])),
      };
    })()
  `);
}

try {
  await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  const page = await fetch(
    `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(APP_URL)}`,
    { method: 'PUT' },
  ).then((response) => response.json());
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await waitFor(cdp, `location.origin === 'http://127.0.0.1:5173' && document.readyState === 'complete'`);

  const layouts = [];
  for (const width of [390, 320]) {
    await setViewport(cdp, width);
    await reloadWithTheme(cdp, false);
    await evaluate(cdp, `document.querySelector('.lp-nav-toggle').click()`);
    await delay(100);
    const light = await inspect(cdp);
    await reloadWithTheme(cdp, true);
    await evaluate(cdp, `document.querySelector('.lp-nav-toggle').click()`);
    await delay(100);
    const savedDark = await inspect(cdp);
    layouts.push({ width, light, savedDark });
  }

  const failures = layouts.map(({ width, light, savedDark }) => ({
    width,
    horizontalOverflow: light.overflow,
    navOverlap: light.navGap < 8 ? light.navGap : null,
    clippedLogo: light.logoRect.left < -1 || light.logoRect.right > light.viewportWidth + 1
      ? light.logoRect
      : null,
    oversizedCarouselSlide: light.firstSlideWidth > light.carouselWidth + 1
      ? { slide: light.firstSlideWidth, carousel: light.carouselWidth }
      : null,
    headerCtaVisible: light.headerCtaVisible,
    mobileActionsMissing: !light.mobileActionsVisible,
    themeDifferences: Object.fromEntries(Object.entries(light.styles).filter(
      ([selector, style]) => JSON.stringify(style) !== JSON.stringify(savedDark.styles[selector]),
    )),
  }));

  console.log(JSON.stringify(failures, null, 2));
  for (const failure of failures) {
    assert.deepEqual(failure.horizontalOverflow, [], `landing page must not overflow at ${failure.width}px`);
    assert.equal(failure.navOverlap, null, `landing navigation must not overlap at ${failure.width}px`);
    assert.equal(failure.clippedLogo, null, `landing logo must remain visible at ${failure.width}px`);
    assert.equal(failure.oversizedCarouselSlide, null, `testimonial slides must fit at ${failure.width}px`);
    assert.equal(failure.headerCtaVisible, false, `narrow landing header must not crowd in a CTA at ${failure.width}px`);
    assert.equal(failure.mobileActionsMissing, false, `opened mobile navigation needs login and signup actions at ${failure.width}px`);
    assert.deepEqual(failure.themeDifferences, {}, 'saved dark mode must not alter the public landing page');
  }

  cdp.close();
} finally {
  if (chromium.exitCode === null) {
    chromium.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => chromium.once('exit', resolve)),
      delay(1000),
    ]);
  }
  rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
