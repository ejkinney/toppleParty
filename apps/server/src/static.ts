import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/**
 * Serves one built SPA. `mount` is stripped from the path first, and anything
 * that is not a real file falls back to index.html so deep links work.
 */
export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  mount: string,
  urlPath: string,
): Promise<boolean> {
  let relative = urlPath.slice(mount.length);
  if (relative.startsWith('/')) relative = relative.slice(1);
  if (relative === '') relative = 'index.html';

  // Reject traversal before it ever reaches the filesystem.
  const safe = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '');
  if (safe.split(sep).includes('..')) return false;

  let file = join(root, safe);
  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = join(file, 'index.html');
    info = await stat(file).catch(() => null);
  }
  if (!info?.isFile()) {
    // Only navigations fall back to the shell. A missing .js or .wasm must 404
    // loudly - answering it with index.html turns a broken build into an
    // inscrutable "expected a module, got text/html" in the browser console.
    if (extname(safe) !== '') return false;
    file = join(root, 'index.html');
    info = await stat(file).catch(() => null);
    if (!info?.isFile()) return false;
  }

  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const immutable = file.includes(sep + 'assets' + sep);
  res.writeHead(200, {
    'content-type': type,
    'content-length': info.size,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}
