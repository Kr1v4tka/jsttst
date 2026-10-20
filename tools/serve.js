#!/usr/bin/env node
/**
 * serve.js — минимальный статический сервер для локальной разработки.
 *
 * Нужен потому, что ES-модули не работают по протоколу file:// из-за CORS.
 * Без зависимостей: только стандартная библиотека Node.js.
 *
 * Использование:
 *   node tools/serve.js            # порт 8080
 *   node tools/serve.js 3000       # свой порт
 *   PORT=3000 node tools/serve.js
 */

import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const portArg = process.argv[2] ?? process.env.PORT;
const PORT = Number.parseInt(portArg ?? '8080', 10);
const HOST = process.env.HOST ?? '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Не даём выйти за пределы корня репозитория. */
function resolveSafe(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const absolute = path.join(ROOT, normalized);
  if (!absolute.startsWith(ROOT)) return null;
  return absolute;
}

async function statOrNull(target) {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    let target = resolveSafe(req.url ?? '/');
    if (!target) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }

    let info = await statOrNull(target);

    // Каталог → index.html внутри него.
    if (info?.isDirectory()) {
      target = path.join(target, 'index.html');
      info = await statOrNull(target);
    }

    if (!info?.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><meta charset="utf-8"><title>404</title>'
        + '<body style="font-family:system-ui;padding:40px;background:#0b1020;color:#e6edf7">'
        + '<h1>404 — не найдено</h1><p><a style="color:#818cf8" href="/">На главную</a></p>',
      );
      return;
    }

    const ext = path.extname(target).toLowerCase();
    const type = MIME[ext] ?? 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });

    createReadStream(target).pipe(res);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`500 Internal Server Error\n${error.message}`);
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\nПорт ${PORT} уже занят. Попробуйте другой:\n  node tools/serve.js ${PORT + 1}\n`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  JS Simulations — локальный сервер');
  console.log('  ──────────────────────────────────────');
  console.log(`  Главная:    http://${HOST}:${PORT}/`);
  console.log(`  Песочница:  http://${HOST}:${PORT}/simulations/sandbox/`);
  console.log(`  Стерео:     http://${HOST}:${PORT}/demo/`);
  console.log('');
  console.log('  Ctrl+C — остановить');
  console.log('');
});