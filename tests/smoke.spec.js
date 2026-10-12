// Smoke tests: open index.html from disk, visit every view and tab, and make sure nothing throws.
// Runtime dependencies are local. Network is blocked so tests stay deterministic.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const APP = pathToFileURL(path.resolve('index.html')).href;

async function prepare(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('dialog', d => d.accept());
  await page.route('**/*', route => {
    const u = route.request().url();
    if (/^(file|data|blob):/.test(u)) return route.continue();
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

test('version 2 backup includes and restores personal photos', async ({ page }) => {
  const errors = await prepare(page);
  const got = await page.evaluate(async () => {
    const id = 'test-photo', blob = new Blob(['photo bytes'], { type: 'text/plain' });
    await Photos.put(id, blob);
    Store.get('photoMeta').push({ id, date: '2026-10-12', pose: 'front' });
    const backup = await buildBackupPayload();
    await idbClear('photos');
    await restoreBackupPhotos(backup.assets.photos, 'replace');
    const restored = await Photos.get(id);
    return { version: backup.version, photos: backup.assets.photos.length, meta: backup.data.photoMeta.some(x => x.id === id), text: await restored.text() };
  });
  expect(got).toEqual({ version: 2, photos: 1, meta: true, text: 'photo bytes' });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('full reset clears personal stores, libraries, settings and API keys', async ({ page }) => {
  const errors = await prepare(page);
  const got = await page.evaluate(async () => {
    await Photos.put('secret-photo', new Blob(['x']));
    await BibleDb.put('test-library', { private: true });
    localStorage.setItem('ld.test-secret', 'present');
    S.esvKey = 'secret'; saveSettings();
    await resetAllData();
    return {
      photoMissing: !(await Photos.get('secret-photo')),
      libraryMissing: !(await BibleDb.get('test-library')),
      secret: localStorage.getItem('ld.test-secret'),
      key: S.esvKey
    };
  });
  expect(got).toEqual({ photoMissing: true, libraryMissing: true, secret: null, key: '' });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('runtime libraries are local and work with the network blocked', async ({ page }) => {
  const externalCode = [];
  page.on('request', req => {
    if (/^https?:/.test(req.url()) && ['script', 'stylesheet'].includes(req.resourceType())) externalCode.push(req.url());
  });
  const errors = await prepare(page);
  const got = await page.evaluate(async () => {
    const sheets = await readSpreadsheet(new TextEncoder().encode('name,value\nTest,42'));
    return {
      icon: typeof lucide?.createIcons === 'function',
      xlsx: XLSX.version,
      row: sheets.Sheet1[1]
    };
  });
  expect(got).toEqual({ icon: true, xlsx: '0.20.3', row: ['Test', 42] });
  expect(externalCode).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});
