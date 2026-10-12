// Smoke tests: open index.html from disk, visit every view and tab, and make sure nothing throws.
// Network is locked down so tests are deterministic: only the Tailwind and Lucide CDNs are allowed.
// No internet? Set CDN_SHIM_DIR to a folder containing tailwind.js and lucide.min.js to serve them locally.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const APP = pathToFileURL(path.resolve('index.html')).href;
const ALLOW = [/cdn\.tailwindcss\.com/, /unpkg\.com\/lucide/];

async function prepare(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('dialog', d => d.accept());
  const shim = process.env.CDN_SHIM_DIR;
  await page.route('**/*', route => {
    const u = route.request().url();
    if (/^(file|data|blob):/.test(u)) return route.continue();
    if (shim && /cdn\.tailwindcss\.com/.test(u)) return route.fulfill({ path: path.join(shim, 'tailwind.js'), contentType: 'application/javascript' });
    if (shim && /lucide/.test(u)) return route.fulfill({ path: path.join(shim, 'lucide.min.js'), contentType: 'application/javascript' });
    if (ALLOW.some(r => r.test(u))) return route.continue();
    return route.abort(); // Bible downloads, APIs, embeds: not needed for a smoke test
  });
  await page.goto(APP);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  return errors;
}

async function visitEverything(page, perTab) {
  const views = await page.evaluate(() => VIEWS.filter(v => v.id).map(v => v.id));
  for (const id of views) {
    await page.evaluate(v => go(v), id);
    if (perTab) await perTab(`${id}`);
    const tabs = await page.$$eval('#view [data-action="setTab"]', els => [...new Map(els.map(e => [`${e.dataset.key}=${e.dataset.val}`, [e.dataset.key, e.dataset.val]])).values()]);
    for (const [key, val] of tabs) {
      await page.evaluate(([k, v]) => { ui[k] = v; render(); }, [key, val]);
      if (perTab) await perTab(`${id} › ${key}=${val}`);
    }
  }
  return views;
}

test('every view and tab renders without errors', async ({ page }) => {
  const errors = await prepare(page);
  const views = await visitEverything(page, async () => { await expect(page.locator('#view')).not.toBeEmpty(); });
  expect(views).toEqual(expect.arrayContaining(['dashboard', 'fitness', 'nutrition', 'scripture', 'journal', 'media', 'family', 'recipes', 'tasks']));
  expect(errors, errors.join('\n')).toEqual([]);
});

test('data is saved and survives a reload', async ({ page }) => {
  const errors = await prepare(page);
  await page.evaluate(() => { addTask('Smoke test task tomorrow at 3pm #home'); Store.flushDirty(); });
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  const t = await page.evaluate(() => Store.get('tasks').find(x => x.title === 'Smoke test task'));
  expect(t).toBeTruthy();
  expect(t.time).toBe('15:00');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('phone width: no view scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await prepare(page);
  const wide = [];
  await visitEverything(page, async where => {
    const [sw, cw] = await page.evaluate(() => [$('#view').scrollWidth, $('#view').clientWidth]);
    if (sw > cw + 1) wide.push(`${where} (${sw}px > ${cw}px)`);
  });
  expect(wide, wide.join('\n')).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});
