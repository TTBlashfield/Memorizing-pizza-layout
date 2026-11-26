// Static server for local testing. Serves docs/ under a sub-path, like GitHub Pages does.
//   node scripts/serve.mjs [port] [basePath]     e.g. node scripts/serve.mjs 8080 /Dominos/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
};

/**
 * Start a server. `transform(path, text)` can rewrite text files (the e2e test uses it to
 * fake a new app version). Returns { server, url, close }.
 */
export function serve({ port = 0, base = '/makeline/', root = DOCS, transform = null } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith(base)) {
      res.writeHead(url.pathname === base.slice(0, -1) ? 301 : 404, { Location: base });
      res.end();
      return;
    }
    let rel = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(root, rel));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    try {
      let body = await readFile(file);
      const type = TYPES[extname(file)] || 'application/octet-stream';
      if (transform && /^(text|application\/(json|manifest))/.test(type)) body = Buffer.from(transform(rel, body.toString('utf8')));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'max-age=600' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}${base}`;
      resolve({ server, url, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 8080);
  const base = process.argv[3] || '/makeline/';
  const { url } = await serve({ port, base });
  console.log(`Makeline Trainer at ${url}`);
}
