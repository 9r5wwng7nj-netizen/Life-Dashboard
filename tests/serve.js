// Serves the repo from a throwaway local port for tests that need an http origin
// (service workers and sync never run from file://).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

export function serveRepo() {
  const root = path.resolve('.');
  const server = http.createServer(async (req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

export function stopServer(server) {
  server.closeAllConnections();
  return new Promise(resolve => server.close(resolve));
}
