import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

async function openApp(page) {
  await page.route('**/*', route => /^(file|data|blob|about):/.test(route.request().url()) ? route.continue() : route.abort());
  await page.goto(pathToFileURL(path.resolve('index.html')).href);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.db && Array.isArray(Store.data.tasks));
}

test('invalid backups cannot change records or photos', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    Store.data.tasks = [{ id: 'keep', title: 'Keep me' }];
    await Store.flushAll();
    await Photos.put('keep-photo', new Blob(['keep']));
    const bad = [
      { app: 'life-dashboard', version: 1, data: null },
      { app: 'other', version: 1, data: { tasks: [] } },
      { app: 'life-dashboard', version: 3, data: { tasks: [] } },
      { app: 'life-dashboard', version: 1, data: { tasks: {} } },
      { app: 'life-dashboard', version: 1, data: { nutrition: { '2026-10-12': { entries: 'bad' } } } },
      { app: 'life-dashboard', version: 1, data: { tasks: [{ id: 'x', title: 'x' }, { id: 'x', title: 'duplicate' }] } },
      { app: 'life-dashboard', version: 2, data: { tasks: [] }, assets: { photos: [{ id: 'bad', data: 'data:image/png;base64,!!!' }] } },
      JSON.parse('{"app":"life-dashboard","version":1,"data":{"fkit":{"__proto__":{"polluted":true}}}}')
    ];
    const stopped = bad.map(d => { try { planBackupImport(d, 'replace'); return false; } catch (e) { return true; } });
    return { stopped, tasks: Store.data.tasks, persisted: await Store.read('tasks'), photo: await (await Photos.get('keep-photo')).text(), polluted: {}.polluted === true };
  });
  expect(result.stopped.every(Boolean)).toBe(true);
  expect(result.tasks).toEqual([{ id: 'keep', title: 'Keep me' }]);
  expect(result.persisted).toEqual(result.tasks);
  expect(result.photo).toBe('keep');
  expect(result.polluted).toBe(false);
});

test('restore saves records and photos together and preserves legacy photos and keys', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    S.esvKey = 'device-key'; saveSettings();
    await Photos.put('old-photo', new Blob(['old']));
    const backup = await buildBackupPayload();
    backup.data.tasks = [{ id: 'new-task', title: 'Restored' }];
    backup.assets.photos = [{ id: 'new-photo', data: 'data:text/plain;base64,bmV3' }];
    backup.data.photoMeta = [{ id: 'new-photo' }];
    await commitBackupImport(planBackupImport(backup, 'replace'));
    const restored = { task: (await Store.read('tasks'))[0].title, photo: await (await Photos.get('new-photo')).text(), oldMissing: !(await Photos.get('old-photo')) };
    await commitBackupImport(planBackupImport({ app: 'life-dashboard', version: 1, data: { tasks: [] }, settings: { esvKey: 'untrusted-key' } }, 'replace'));
    return { restored, legacyPhoto: await (await Photos.get('new-photo')).text(), meta: Store.data.photoMeta[0].id, key: S.esvKey };
  });
  expect(result).toEqual({ restored: { task: 'Restored', photo: 'new', oldMissing: true }, legacyPhoto: 'new', meta: 'new-photo', key: 'device-key' });
});

test('storage failure rolls back a restore', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    Store.data.tasks = [{ id: 'keep', title: 'Keep' }]; await Store.flushAll();
    S.name = 'Before'; saveSettings();
    await Photos.put('keep-photo', new Blob(['keep']));
    const backup = await buildBackupPayload(); backup.settings.name = 'After'; backup.data.tasks = [{ id: 'new', title: 'New' }]; backup.assets.photos = [];
    const plan = planBackupImport(backup, 'replace'), original = Store.db.transaction.bind(Store.db);
    Store.db.transaction = function(stores, mode) {
      const tx = original(stores, mode);
      if (Array.isArray(stores) && mode === 'readwrite') {
        const objectStore = tx.objectStore.bind(tx); let puts = 0;
        tx.objectStore = function(name) {
          const store = objectStore(name);
          if (name === 'kv') {
            const put = store.put.bind(store);
            store.put = function(...args) { if (++puts === 2) throw new Error('Simulated storage failure'); return put(...args); };
          }
          return store;
        };
      }
      return tx;
    };
    let failed = false;
    try { await commitBackupImport(plan); } catch (e) { failed = true; }
    Store.db.transaction = original;
    return { failed, task: Store.data.tasks[0].title, persisted: (await Store.read('tasks'))[0].title, photo: await (await Photos.get('keep-photo')).text(), name: S.name, storedName: JSON.parse(localStorage.getItem('ld.settings')).name };
  });
  expect(result).toEqual({ failed: true, task: 'Keep', persisted: 'Keep', photo: 'keep', name: 'Before', storedName: 'Before' });
});

test('unsafe URLs and iframe attribute injection are blocked', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => {
    const box = document.createElement('div');
    box.innerHTML = mediaEmbed({ url: 'https://podcasts.apple.com/us/podcast/id123?x="%20onload="alert(1)' });
    const frame = box.querySelector('iframe');
    return {
      rejected: ['javascript:alert(1)', 'data:text/html,test', 'https://user:password@example.com', 'java\nscript:alert(1)'].map(webUrl),
      valid: webUrl('https://example.com/article'),
      spoof: mediaEmbed({ url: 'https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ' }),
      youtube: ytId('https://youtu.be/dQw4w9WgXcQ'),
      onload: frame?.getAttribute('onload') || null,
      frameCount: box.querySelectorAll('iframe').length,
      link: linkList([['Unsafe', 'javascript:alert(1)', 'Imported']])
    };
  });
  expect(result.rejected).toEqual(['', '', '', '']);
  expect(result.valid).toBe('https://example.com/article');
  expect(result.spoof).toBe('');
  expect(result.youtube).toBe('dQw4w9WgXcQ');
  expect(result.onload).toBeNull();
  expect(result.frameCount).toBe(1);
  expect(result.link).not.toContain('javascript:');
});

test('podcast script cannot access parent storage', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    // Inject a simulated hostile response into the actual sandbox document.
    const create = document.createElement.bind(document), descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
    document.createElement = function(name, ...args) {
      const el = create(name, ...args);
      if (name === 'iframe') Object.defineProperty(el, 'srcdoc', { set(html) {
        const attack = '<script>var denied=false; try { parent.localStorage.setItem("ld.attack","yes"); } catch(e) { denied=true; } window.__ldPodcast({results:[{denied:denied}]});</script>';
        descriptor.set.call(el, html + attack);
      } });
      return el;
    };
    const response = await isolatedPodcastRequest('https://itunes.apple.com/search?term=test');
    document.createElement = create;
    return { denied: response.results[0].denied, leaked: localStorage.getItem('ld.attack'), frames: document.querySelectorAll('iframe[sandbox="allow-scripts"]').length };
  });
  expect(result).toEqual({ denied: true, leaked: null, frames: 0 });
});

test('article and recipe clips reject malformed structured data', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => ({
    article: parseClip('{"ldClip":1,"title":{},"md":"text"}'),
    recipe: parseRecipeClip('{"ldRecipe":1,"ingredients":"not a list"}'),
    validArticle: !!parseClip('{"ldClip":1,"title":"Title","md":"Body"}'),
    validRecipe: !!parseRecipeClip('{"ldRecipe":1,"ingredients":["1 cup flour"],"steps":["Mix"]}')
  }));
  expect(result).toEqual({ article: null, recipe: null, validArticle: true, validRecipe: true });
});

test('podcast timeout cleans up and unexpected service hosts are rejected', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    let timeout = false, blocked = false;
    try { await isolatedPodcastRequest('https://itunes.apple.com/search?term=test', 1); } catch (e) { timeout = true; }
    try { await isolatedPodcastRequest('https://itunes.apple.com.evil.example/search'); } catch (e) { blocked = true; }
    return { timeout, blocked, frames: document.querySelectorAll('iframe[sandbox="allow-scripts"]').length };
  });
  expect(result).toEqual({ timeout: true, blocked: true, frames: 0 });
});
