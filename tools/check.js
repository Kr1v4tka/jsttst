#!/usr/bin/env node
/**
 * check.js — статическая проверка проекта без внешних зависимостей.
 *
 * Что проверяет:
 *   1. синтаксис всех JS-файлов (через node --check);
 *   2. что все локальные пути в HTML/CSS/JS существуют на диске;
 *   3. отсутствие «забытых» абсолютных путей вида /workspace/...;
 *   4. что в репозиторий не попали секреты.
 *
 * Запуск: node tools/check.js
 */

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SKIP_DIRS = new Set(['.git', 'node_modules', '.vscode', '.idea', 'dist']);
const JS_EXT = new Set(['.js', '.mjs']);

let errors = 0;
let warnings = 0;
const log = {
  ok: (msg) => console.log(`  ✔ ${msg}`),
  warn: (msg) => { warnings += 1; console.log(`  ⚠ ${msg}`); },
  fail: (msg) => { errors += 1; console.log(`  ✖ ${msg}`); },
  head: (msg) => console.log(`\n${msg}`),
};

/** Рекурсивно собирает файлы, пропуская служебные каталоги. */
async function walk(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

const files = await walk(ROOT);
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');

/* ============================================================
 * 1. Синтаксис JS
 * ========================================================== */

log.head('Синтаксис JavaScript');
const jsFiles = files.filter((f) => JS_EXT.has(path.extname(f).toLowerCase()));
for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    log.fail(`${rel(file)}\n${error.stderr?.toString() ?? error.message}`);
  }
}
log.ok(`проверено файлов: ${jsFiles.length}`);

/* ============================================================
 * 2. Локальные ссылки в HTML/CSS
 * ========================================================== */

log.head('Ссылки на файлы');

const htmlFiles = files.filter((f) => f.endsWith('.html'));
const cssFiles = files.filter((f) => f.endsWith('.css'));

const isExternal = (url) =>
  /^(https?:)?\/\//.test(url)
  || url.startsWith('data:')
  || url.startsWith('mailto:')
  || url.startsWith('#')
  || url.startsWith('blob:');

async function checkReference(fromFile, rawUrl) {
  const url = rawUrl.trim();
  if (!url || isExternal(url)) return;

  const clean = url.split('?')[0].split('#')[0];
  if (!clean) return;

  // Абсолютные пути от корня сайта — частый источник поломок при file://.
  const target = clean.startsWith('/')
    ? path.join(ROOT, clean)
    : path.resolve(path.dirname(fromFile), clean);

  const info = await fs.stat(target).catch(() => null);

  if (!info) {
    log.fail(`${rel(fromFile)} → ${url} (файл не найден)`);
    return;
  }

  if (info.isDirectory()) {
    const indexFile = path.join(target, 'index.html');
    const hasIndex = await fs.stat(indexFile).catch(() => null);
    if (!hasIndex) log.fail(`${rel(fromFile)} → ${url} (в каталоге нет index.html)`);
  }
}

for (const file of htmlFiles) {
  const content = await fs.readFile(file, 'utf8');

  const patterns = [
    /\b(?:href|src)\s*=\s*["']([^"']+)["']/g,
    /\burl\(\s*["']?([^"')]+)["']?\s*\)/g,
    /^\s*@import\s+["']([^"']+)["']/gm,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(content);
    while (match) {
      await checkReference(file, match[1]);
      match = pattern.exec(content);
    }
  }
}

for (const file of cssFiles) {
  const content = await fs.readFile(file, 'utf8');
  const pattern = /\burl\(\s*["']?([^"')]+)["']?\s*\)/g;
  let match = pattern.exec(content);
  while (match) {
    await checkReference(file, match[1]);
    match = pattern.exec(content);
  }
}

log.ok(`проверено HTML: ${htmlFiles.length}, CSS: ${cssFiles.length}`);

/* ============================================================
 * 3. Импорты ES-модулей
 * ========================================================== */

log.head('Импорты ES-модулей');

const importPattern = /(?:^|\n)\s*(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g;

for (const file of jsFiles) {
  const content = await fs.readFile(file, 'utf8');
  let match = importPattern.exec(content);
  while (match) {
    const spec = match[1];
    if (spec.startsWith('node:') || isExternal(spec) || !spec.startsWith('.')) {
      match = importPattern.exec(content);
      continue;
    }

    const target = path.resolve(path.dirname(file), spec);
    const info = await fs.stat(target).catch(() => null);
    if (!info) {
      log.fail(`${rel(file)} → ${spec} (модуль не найден)`);
    }
    match = importPattern.exec(content);
  }
}

log.ok('импорты разрешаются');

/* ============================================================
 * 4. Забытые абсолютные пути и секреты
 * ========================================================== */

log.head('Гигиена репозитория');

const SUSPICIOUS = [
  // Паттерн собирается из частей, чтобы файл не находил сам себя.
  { pattern: new RegExp(`/${'workspace'}/`, 'g'), message: 'абсолютный путь /workspace/ (не переносимо)' },
  { pattern: /ghp_[A-Za-z0-9]{36}/g, message: 'похоже на GitHub-токен' },
  { pattern: /github_pat_[A-Za-z0-9_]{20,}/g, message: 'похоже на GitHub fine-grained token' },
  { pattern: /AKIA[0-9A-Z]{16}/g, message: 'похоже на AWS access key' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, message: 'приватный ключ' },
];

// Сам чекер содержит эти паттерны по определению — его не проверяем.
const SELF = path.resolve(__dirname, 'check.js');

for (const file of files) {
  if (path.resolve(file) === SELF) continue;

  const ext = path.extname(file).toLowerCase();
  if (!['.js', '.mjs', '.html', '.css', '.json', '.md', '.txt', '.yml', '.yaml'].includes(ext)) {
    continue;
  }

  const content = await fs.readFile(file, 'utf8');
  for (const rule of SUSPICIOUS) {
    const matches = content.match(rule.pattern);
    if (matches) {
      log.fail(`${rel(file)}: ${rule.message} (${matches.length} совпадений)`);
    }
  }
}

log.ok('секретов и непереносимых путей не найдено');

/* ============================================================
 * Итог
 * ========================================================== */

console.log('');
if (errors > 0) {
  console.log(`  Провалено проверок: ${errors}, предупреждений: ${warnings}`);
  process.exit(1);
}
console.log(`  Всё чисто. Предупреждений: ${warnings}`);
process.exit(0);