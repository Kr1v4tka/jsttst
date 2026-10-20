/**
 * browser-check.mjs — реальная проверка страниц в headless Chrome через CDP.
 *
 * Запускает браузер, открывает каждую страницу, собирает ошибки консоли и
 * исключения, затем проверяет, что приложение действительно заработало
 * (тела созданы, карта глубины посчитана и т.п.).
 *
 * Использование: node tools/browser-check.mjs [baseUrl]
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8099';
const DEBUG_PORT = 9333;

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('Не найден Chrome/Edge.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================
 * Минимальный CDP-клиент поверх встроенного WebSocket
 * ========================================================== */

class CDP {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(new Error(String(e.message ?? e))));
      this.ws.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(JSON.stringify(msg.error)));
          else res(msg.result);
          return;
        }
        const handler = this.handlers.get(msg.method);
        if (handler) handler(msg.params);
      });
    });
  }

  on(method, handler) {
    this.handlers.set(method, handler);
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws?.close();
  }
}

/* ============================================================
 * Запуск браузера
 * ========================================================== */

const userDataDir = `${process.env.TEMP ?? '/tmp'}\\cdp-profile-${Date.now()}`;

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--mute-audio',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${userDataDir}`,
  'about:blank',
], { stdio: 'ignore' });

async function waitForDebugger() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      /* ещё не поднялся */
    }
    await sleep(250);
  }
  throw new Error('DevTools не отвечает');
}

/* ============================================================
 * Проверка одной страницы
 * ========================================================== */

async function inspectPage(name, path, probeExpression, options = {}) {
  const { waitMs = 3500, expectProbe = true } = options;

  const targetRes = await fetch(
    `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent('about:blank')}`,
    { method: 'PUT' },
  );
  const target = await targetRes.json();

  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();

  const consoleErrors = [];
  const exceptions = [];

  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error') {
      consoleErrors.push(params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
  });

  cdp.on('Runtime.exceptionThrown', (params) => {
    const d = params.exceptionDetails;
    exceptions.push(d.exception?.description ?? d.text ?? 'unknown exception');
  });

  cdp.on('Log.entryAdded', (params) => {
    if (params.entry.level === 'error') consoleErrors.push(params.entry.text);
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');

  const url = `${BASE}${path}`;
  await cdp.send('Page.navigate', { url });
  await sleep(waitMs);

  let probeResult = null;
  let probeError = null;
  if (probeExpression) {
    try {
      const result = await cdp.send('Runtime.evaluate', {
        expression: probeExpression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        probeError = result.exceptionDetails.exception?.description ?? 'probe failed';
      } else {
        probeResult = result.result.value;
      }
    } catch (error) {
      probeError = error.message;
    }
  }

  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${target.id}`).catch(() => {});
  cdp.close();

  const ok = exceptions.length === 0
    && consoleErrors.length === 0
    && (!expectProbe || probeError === null);

  return { name, path, ok, exceptions, consoleErrors, probeResult, probeError };
}

/* ============================================================
 * Сценарии
 * ========================================================== */

const results = [];

try {
  await waitForDebugger();
  await sleep(500);

  // 1. Лендинг
  results.push(await inspectPage(
    'Лендинг',
    '/',
    `(() => ({
      hasCanvas: !!document.getElementById('heroCanvas'),
      cards: document.querySelectorAll('.card').length,
      links: [...document.querySelectorAll('.card__link')].map(a => a.getAttribute('href')),
    }))()`,
  ));

  // 2. Песочница
  results.push(await inspectPage(
    'Песочница',
    '/simulations/sandbox/',
    `(async () => {
      await new Promise(r => setTimeout(r, 1500));
      const s = window.__sandbox;
      if (!s) return { error: 'window.__sandbox отсутствует' };
      return {
        bodies: s.world.bodies.length,
        steps: s.world.steps,
        fps: document.getElementById('statFps').textContent,
        stepMs: document.getElementById('statStep').textContent,
        canvasW: s.renderer.canvas.width,
        canvasH: s.renderer.canvas.height,
        allFinite: s.world.bodies.every(b => Number.isFinite(b.position.x) && Number.isFinite(b.position.y)),
      };
    })()`,
    { waitMs: 5000 },
  ));

  // 3. Стерео-демо
  results.push(await inspectPage(
    'Стерео-демо',
    '/demo/',
    `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      // Ждём автогенерации демо-пары.
      for (let i = 0; i < 40; i++) {
        if (window.__stereo?.state?.leftImg) break;
        await sleep(200);
      }
      const s = window.__stereo;
      if (!s) return { error: 'window.__stereo отсутствует' };
      const hadImages = !!s.state.leftImg && !!s.state.rightImg;

      document.getElementById('btnCompute').click();
      for (let i = 0; i < 120; i++) {
        if (s.state.disparity) break;
        await sleep(250);
      }
      return {
        hadImages,
        disparityComputed: !!s.state.disparity,
        dispSize: s.state.dispWidth + 'x' + s.state.dispHeight,
        coverage: s.state.stats ? +(s.state.stats.coverage * 100).toFixed(1) : null,
        range: s.state.stats ? [s.state.stats.min.toFixed(1), s.state.stats.max.toFixed(1)] : null,
        status: document.getElementById('computeStatus').textContent,
        exportsEnabled: !document.getElementById('btnPly').disabled,
      };
    })()`,
    { waitMs: 7000 },
  ));
} finally {
  chrome.kill();
  await sleep(300);
}

/* ============================================================
 * Отчёт
 * ========================================================== */

console.log('\n═══ Браузерная проверка ═══\n');

let failed = 0;
for (const r of results) {
  const mark = r.ok ? '✔' : '✖';
  if (!r.ok) failed += 1;
  console.log(`${mark} ${r.name}  (${r.path})`);

  if (r.probeResult !== null && r.probeResult !== undefined) {
    console.log(`   данные: ${JSON.stringify(r.probeResult)}`);
  }
  if (r.probeError) console.log(`   probe error: ${r.probeError}`);
  for (const e of r.exceptions.slice(0, 6)) console.log(`   исключение: ${e.split('\n')[0]}`);
  for (const e of r.consoleErrors.slice(0, 6)) console.log(`   console.error: ${e.split('\n')[0]}`);
}

console.log('');
if (failed > 0) {
  console.log(`Провалено страниц: ${failed}`);
  process.exit(1);
}
console.log('Все страницы работают без ошибок.');
process.exit(0);