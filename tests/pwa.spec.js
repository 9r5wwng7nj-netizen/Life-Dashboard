// Hosted-copy checks: the app installs from a web address and reopens with no connection.
// Served from a throwaway local server, since service workers never run from file://.
import { test, expect } from '@playwright/test';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serveRepo() {
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

test('hosted copy is installable and reopens offline', async ({ page }) => {
  const server = await serveRepo();
  const base = `http://localhost:${server.address().port}`;
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  try {
    await page.goto(`${base}/index.html?pwa`);
    await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));

    const manifest = await (await page.request.get(`${base}/manifest.webmanifest`)).json();
    expect(manifest.display).toBe('standalone');
    const icons = [...manifest.icons.map(i => i.src), await page.getAttribute('link[rel="apple-touch-icon"]', 'href')];
    for (const src of icons) expect((await page.request.get(new URL(src, `${base}/`).href)).ok(), src).toBe(true);

    // Every file the worker promises to keep must exist, or it never finishes installing.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller);

    await page.evaluate(() => { addTask('Saved before going offline'); Store.flushDirty(); });
    await page.waitForTimeout(300);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }

  await page.reload();
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  await expect(page.locator('#view-title')).toHaveText('Dashboard');
  expect(await page.evaluate(() => Store.get('tasks').some(t => t.title === 'Saved before going offline'))).toBe(true);
  expect(await page.evaluate(() => fetch(XLSX_SCRIPT).then(r => r.ok))).toBe(true); // spreadsheet import still loads
  expect(errors, errors.join('\n')).toEqual([]);
});

test('file copy never registers a service worker', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve('index.html')).href);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  expect(await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations?.().catch(() => []) || []).length)).toBe(0);
});
