// Device sync: two browser contexts stand in for two devices and share one fake Google Drive.
// No request leaves the machine; Google sign-in and the Drive API are both intercepted.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serveRepo, stopServer } from './serve.js';

const TOKEN = 'test-token';
let server, base;
test.beforeAll(async () => { server = await serveRepo(); base = `http://localhost:${server.address().port}`; });
test.afterAll(() => stopServer(server));

// The hidden app folder: the sync file, with the version number Drive bumps on every save, and the
// dated daily copies (`copies`, newest last), which can be listed, downloaded and deleted.
function fakeDrive() {
  const drive = { file: null, saves: 0, copies: [], made: 0 };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  const json = (route, body, status = 200) => route.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  drive.copy = (name, body = '{}') => { const c = { id: 'copy-' + (++drive.made), name, body, size: String(body.length), createdTime: new Date().toISOString() }; drive.copies.push(c); return c; };
  drive.attach = context => context.route('https://www.googleapis.com/**', route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.headers().authorization !== `Bearer ${TOKEN}`) return json(route, { error: 'unauthorized' }, 401);
    const save = text => { drive.saves++; drive.file = { id: 'file-1', version: String(+(drive.file?.version || 0) + 1), body: text }; return json(route, { id: drive.file.id, version: drive.file.version }); };
    if (url.pathname === '/drive/v3/files') {
      const sync = drive.file ? [{ id: drive.file.id, name: 'life-dashboard-sync.json', version: drive.file.version }] : [];
      return json(route, { files: (url.searchParams.get('q') || '').includes("name='") ? sync : [...sync, ...drive.copies.map(({ id, name, size, createdTime }) => ({ id, name, size, createdTime }))] });
    }
    if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const parts = req.postData().split('\r\n\r\n'), meta = JSON.parse(parts[1].split('\r\n--')[0]), body = parts[2].split('\r\n--')[0];
      if (meta.name !== 'life-dashboard-sync.json') { const c = drive.copy(meta.name, body); return json(route, { id: c.id, version: '1' }); }
      return save(body);
    }
    const copy = drive.copies.find(c => url.pathname === '/drive/v3/files/' + c.id);
    if (copy && method === 'DELETE') { drive.copies = drive.copies.filter(c => c !== copy); return route.fulfill({ status: 204, headers: cors }); }
    if (copy) return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: copy.body });
    if (url.pathname === '/upload/drive/v3/files/file-1' && method === 'PATCH') return save(req.postData());
    if (url.pathname === '/drive/v3/files/file-1') return url.searchParams.get('alt') === 'media' ? route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: drive.file.body }) : json(route, { version: drive.file.version });
    return json(route, { error: 'not found' }, 404);
  });
  return drive;
}

// A tab of the app. `answer` decides each confirm dialog; by default every one is accepted.
async function tab(context, { connected = true, answer = () => true } = {}) {
  const page = await context.newPage(), errors = [], asked = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('dialog', d => { asked.push(d.message()); return answer(d.message()) ? d.accept() : d.dismiss(); });
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  await page.evaluate(([token, on]) => { DRIVE.clientId = 'test-client'; if (on) localStorage.setItem('ld.sync', JSON.stringify({ on: true, token, exp: Date.now() + 3600e3, ...JSON.parse(localStorage.getItem('ld.sync') || '{}') })); }, [TOKEN, connected]);
  return { page, errors, asked, context };
}
async function device(browser, drive, options) {
  const context = await browser.newContext();
  await drive.attach(context);
  return tab(context, options);
}
// A tab that loads already connected starts its own sync; let that finish before asking for another.
const sync = async page => {
  await page.waitForFunction(() => !Sync.busy);
  return page.evaluate(async () => { await Store.flushDirty(); await Sync.run({ announce: true }); return syncMeta(); });
};
const titles = page => page.evaluate(() => Store.get('tasks').map(t => t.title).sort());

test('three-way merge keeps edits, additions and deletions from both sides', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve('index.html')).href);
  await page.waitForFunction(() => typeof syncMerge === 'function');
  const r = await page.evaluate(() => {
    const baseList = [{ id: 'a', t: 'A' }, { id: 'b', t: 'B' }, { id: 'c', t: 'C', n: 1 }];
    return {
      onlyTheirs: syncMerge({ x: 1 }, { x: 1 }, { x: 2 }, true),
      onlyMine: syncMerge({ x: 1 }, { x: 3 }, { x: 1 }, false),
      // mine: deleted a, edited c.t · theirs: edited b, edited c.n, added d at the front
      list: syncMerge(baseList, [{ id: 'b', t: 'B' }, { id: 'c', t: 'C!', n: 1 }], [{ id: 'd', t: 'D' }, { id: 'a', t: 'A' }, { id: 'b', t: 'B2' }, { id: 'c', t: 'C', n: 2 }], true),
      editBeatsDelete: syncMerge(baseList, [{ id: 'a', t: 'A edited' }, { id: 'b', t: 'B' }, { id: 'c', t: 'C', n: 1 }], [{ id: 'b', t: 'B' }, { id: 'c', t: 'C', n: 1 }], false),
      clashMine: syncMerge({ id: 'a', t: 'A' }, { id: 'a', t: 'mine' }, { id: 'a', t: 'theirs' }, true).t,
      clashTheirs: syncMerge({ id: 'a', t: 'A' }, { id: 'a', t: 'mine' }, { id: 'a', t: 'theirs' }, false).t,
      names: syncMerge(['Squat', 'Row'], ['Squat', 'Row', 'Curl'], ['Squat', 'Press'], true),
      days: syncMerge({ '2026-10-01': { weight: 80, entries: [] } }, { '2026-10-01': { weight: 80, entries: [] }, '2026-10-02': { weight: 81, entries: [] } }, { '2026-10-01': { weight: 80, entries: [{ id: 'e1' }] } }, true),
      noBase: syncMerge(undefined, [{ id: 'a', t: 'A' }], [{ id: 'a', t: 'A' }, { id: 'z', t: 'Z' }], true),
    };
  });
  expect(r.onlyTheirs).toEqual({ x: 2 });
  expect(r.onlyMine).toEqual({ x: 3 });
  expect(r.list).toEqual([{ id: 'd', t: 'D' }, { id: 'b', t: 'B2' }, { id: 'c', t: 'C!', n: 2 }]);
  expect(r.editBeatsDelete.map(x => x.t)).toEqual(['A edited', 'B', 'C']);
  expect([r.clashMine, r.clashTheirs]).toEqual(['mine', 'theirs']);
  expect(r.names).toEqual(['Squat', 'Press', 'Curl']); // Row was removed on their side
  expect(r.days).toEqual({ '2026-10-01': { weight: 80, entries: [{ id: 'e1' }] }, '2026-10-02': { weight: 81, entries: [] } });
  expect(r.noBase.map(x => x.id)).toEqual(['a', 'z']);
});

test('two devices converge, including deletions, and private items stay on the device', async ({ browser }) => {
  const drive = fakeDrive(), laptop = await device(browser, drive), phone = await device(browser, drive);

  await laptop.page.evaluate(() => { addTask('Buy milk'); addTask('Call Sam'); S.esvKey = 'secret-esv-key'; S.targets.cal = 2150; saveSettings(); });
  expect((await sync(laptop.page)).error).toBe('');
  expect(drive.file.body).toContain('Buy milk');
  expect(drive.file.body).not.toContain('secret-esv-key');
  expect(JSON.parse(drive.file.body).data.photoMeta).toBeUndefined();

  // A device with no shared history asks before touching anything.
  await sync(phone.page);
  expect(await titles(phone.page)).toEqual([]);
  await phone.page.click('[data-action="syncFirst"][data-mode="theirs"]');
  await phone.page.waitForFunction(() => !Sync.busy && syncMeta().last);
  expect(await titles(phone.page)).toEqual(['Buy milk', 'Call Sam']);
  expect(await phone.page.evaluate(() => [S.targets.cal, S.esvKey])).toEqual([2150, '']);

  await laptop.page.evaluate(() => { const t = Store.get('tasks'); t.splice(t.findIndex(x => x.title === 'Buy milk'), 1); Store.save('tasks'); addTask('From laptop'); });
  await phone.page.evaluate(() => { Store.get('tasks').find(x => x.title === 'Call Sam').title = 'Call Sam today'; Store.save('tasks'); addTask('From phone'); });
  await sync(laptop.page); await sync(phone.page); await sync(laptop.page);
  const expected = ['Call Sam today', 'From laptop', 'From phone'];
  expect(await titles(laptop.page)).toEqual(expected);
  expect(await titles(phone.page)).toEqual(expected);

  // Nothing new anywhere: no download of the whole copy is needed and nothing is saved again.
  const saves = drive.saves;
  await sync(phone.page); await sync(laptop.page);
  expect(drive.saves).toBe(saves);

  // The synced records are still there after a reload.
  await phone.page.reload();
  await phone.page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  expect(await titles(phone.page)).toEqual(expected);
  expect([...laptop.errors, ...phone.errors]).toEqual([]);
  await laptop.context.close(); await phone.context.close();
});

test('a second tab that loaded before the data arrived cannot sync its old view over it', async ({ browser }) => {
  const drive = fakeDrive(), stale = await device(browser, drive), current = await tab(stale.context);
  await current.page.evaluate(() => { for (let i = 1; i <= 15; i++) addTask('Task ' + i); });
  await sync(current.page);
  expect(JSON.parse(drive.file.body).data.tasks).toHaveLength(15);

  // The first tab still holds the empty list it loaded with.
  expect(await titles(stale.page)).toEqual([]);
  expect((await sync(stale.page)).error).toBe('');
  expect(await titles(stale.page)).toHaveLength(15);
  expect(JSON.parse(drive.file.body).data.tasks).toHaveLength(15);
  expect(stale.asked).toEqual([]);
  await stale.context.close();
});

test('a sync that would remove many records pauses until it is confirmed', async ({ browser }) => {
  let allow = false;
  const drive = fakeDrive(), d = await device(browser, drive, { answer: () => allow });
  await d.page.evaluate(() => { for (let i = 1; i <= 12; i++) addTask('Task ' + i); for (let i = 1; i <= 30; i++) Store.get('grocery').push({ id: 'g' + i, name: 'Item ' + i }); Store.save('grocery'); });
  await sync(d.page);
  expect(JSON.parse(drive.file.body).data.tasks).toHaveLength(12);

  // Clearing a list that is routinely cleared goes through without a question.
  await d.page.evaluate(() => { Store.set('grocery', []); });
  expect((await sync(d.page)).error).toBe('');
  expect(JSON.parse(drive.file.body).data.grocery).toHaveLength(0);
  expect(d.asked).toEqual([]);

  await d.page.evaluate(() => { Store.set('tasks', []); });
  // In the background it only records why it stopped.
  const paused = await d.page.evaluate(async () => { await Store.flushDirty(); await Sync.run(); return syncMeta().error; });
  expect(paused).toContain('remove 12 records from Google Drive and your other devices (12 from tasks)');
  expect(d.asked).toEqual([]);
  // Asked directly and declined: Drive keeps everything.
  await sync(d.page);
  expect(d.asked).toHaveLength(1);
  expect(JSON.parse(drive.file.body).data.tasks).toHaveLength(12);
  // Confirmed: the removal goes through, and the permission does not linger.
  allow = true;
  expect((await sync(d.page)).error).toBe('');
  expect(JSON.parse(drive.file.body).data.tasks).toHaveLength(0);
  expect(await d.page.evaluate(() => Sync.allowLoss)).toBe(false);
  expect(d.errors).toEqual([]);
  await d.context.close();
});

test('an unreadable Drive copy changes nothing on the device', async ({ browser }) => {
  const drive = fakeDrive(), d = await device(browser, drive);
  drive.file = { id: 'file-1', version: '7', body: JSON.stringify({ app: 'life-dashboard', version: 1, data: { tasks: [{ id: 't1' }, { id: 't1' }] } }) };
  await d.page.evaluate(() => { addTask('Keep me'); Sync.first = 'merge'; });
  const meta = await sync(d.page);
  expect(meta.error).toContain('could not be read');
  expect(await titles(d.page)).toEqual(['Keep me']);
  expect(drive.file.version).toBe('7');
  await d.context.close();
});

test('Google sign-in round trip stores the token and rejects an unexpected reply', async ({ browser }) => {
  const drive = fakeDrive(), d = await device(browser, drive, { connected: false });
  let asked;
  await d.context.route('https://accounts.google.com/**', route => {
    asked = new URL(route.request().url()).searchParams;
    const back = `${asked.get('redirect_uri')}#access_token=${TOKEN}&token_type=Bearer&expires_in=3599&state=${asked.get('state')}`;
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(back)})</script>` });
  });
  await d.page.evaluate(() => openSettings());
  await d.page.click('[data-action="syncConnect"]');
  await d.page.waitForFunction(() => typeof syncMeta === 'function' && !!syncMeta().token && !location.hash);
  expect(asked.get('client_id')).toBe('test-client');
  expect(asked.get('response_type')).toBe('token');
  expect(asked.get('scope')).toBe('https://www.googleapis.com/auth/drive.appdata');
  expect(asked.get('redirect_uri')).toBe(`${base}/index.html`);
  expect(await d.page.evaluate(() => syncMeta().token)).toBe(TOKEN);

  await d.page.evaluate(() => localStorage.setItem('ld.sync', JSON.stringify({ on: true, state: 'expected' })));
  await d.page.goto('about:blank'); // a fresh load, as when arriving from a link
  await d.page.goto(`${base}/index.html#access_token=forged&expires_in=3599&state=other`);
  await d.page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  expect(await d.page.evaluate(() => [syncMeta().token || '', location.hash])).toEqual(['', '']);
  await d.context.close();
});

test('file copy offers no sync and makes no sync requests', async ({ page }) => {
  const requests = [];
  page.on('request', r => { if (/google/.test(r.url())) requests.push(r.url()); });
  await page.goto(pathToFileURL(path.resolve('index.html')).href);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  await page.evaluate(() => { DRIVE.clientId = 'test-client'; addTask('Local only'); return Store.flushDirty(); });
  await page.evaluate(() => openSettings());
  await expect(page.locator('#sync-box')).toContainText('not in a copy opened as a file');
  await expect(page.locator('#sync-btn')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('ld.sync'))).toBeNull();
  expect(requests).toEqual([]);
});

test('daily copies: one per day for a week, then one a week, and nothing older', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve('index.html')).href);
  await page.waitForFunction(() => typeof copiesToDrop === 'function');
  const dropped = await page.evaluate(() => copiesToDrop([
    { id: 'g', date: '2026-08-14' }, { id: 'a', date: '2026-10-16' }, { id: 'b2', date: '2026-10-15', created: '2026-10-15T09:00:00Z' },
    { id: 'b', date: '2026-10-15', created: '2026-10-15T10:00:00Z' }, { id: 'c', date: '2026-10-10' }, { id: 'd', date: '2026-10-09' },
    { id: 'e', date: '2026-10-06' }, { id: 'f', date: '2026-09-01' }
  ], '2026-10-16').map(c => c.id));
  // b2 is a second copy of the same day, e shares d's week, and g is more than 8 weeks before the daily ones.
  expect(dropped).toEqual(['b2', 'e', 'g']);
  expect(await page.evaluate(() => [copyDate('life-dashboard-copy-2026-10-16.json'), copyDate('life-dashboard-sync.json'), copyDate('life-dashboard-copy-2026-10-16.json.bak')])).toEqual(['2026-10-16', '', '']);
});

test('adding back what is missing restores deleted records and leaves newer edits alone', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve('index.html')).href);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  const r = await page.evaluate(() => {
    Store.data.tasks = [{ id: 't1', title: 'Edited since' }, { id: 't3', title: 'Added since' }];
    Store.data.nutrition = { '2026-10-01': { entries: [{ id: 'e1', name: 'Oats' }] } };
    S.vaultName = 'My Vault'; S.unit = 'lbs';
    const copy = { app: 'life-dashboard', version: 1, sync: 1, exportedAt: '2026-10-10T12:00:00Z', settings: { unit: 'kg' }, data: {
      tasks: [{ id: 't1', title: 'Before the edit' }, { id: 't2', title: 'Deleted by mistake' }],
      nutrition: { '2026-10-01': { weight: 80, entries: [{ id: 'e1', name: 'Old oats' }, { id: 'e2', name: 'Eggs' }] }, '2026-09-30': { entries: [{ id: 'e0', name: 'Toast' }] } } } };
    const add = planBackupImport(copy, 'missing'), replace = planBackupImport(copy, 'replace');
    return { tasks: add.data.tasks.map(t => t.title), day: add.data.nutrition['2026-10-01'], older: !!add.data.nutrition['2026-09-30'], added: add.added, unit: add.settings.unit,
      replaced: replace.data.tasks.map(t => t.title), replaceKeeps: [replace.settings.vaultName, replace.settings.unit] };
  });
  expect(r.tasks).toEqual(['Edited since', 'Added since', 'Deleted by mistake']);
  expect(r.day).toEqual({ weight: 80, entries: [{ id: 'e1', name: 'Oats' }, { id: 'e2', name: 'Eggs' }] });
  expect([r.older, r.added, r.unit]).toEqual([true, 4, 'lbs']);
  // Replacing from a sync copy changes the synced settings only; the vault name was never in the copy.
  expect(r.replaced).toEqual(['Before the edit', 'Deleted by mistake']);
  expect(r.replaceKeeps).toEqual(['My Vault', 'kg']);
});

test('the first sync of the day keeps a dated copy, and a deleted task can be added back from it', async ({ browser }) => {
  const drive = fakeDrive(), d = await device(browser, drive);
  const day = n => { const x = new Date(); x.setDate(x.getDate() - n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  drive.copy(`life-dashboard-copy-${day(100)}.json`); drive.copy(`life-dashboard-copy-${day(1)}.json`);
  await d.page.evaluate(() => { addTask('Keep me'); addTask('Delete me by mistake'); });
  expect((await sync(d.page)).error).toBe('');
  expect(drive.copies.map(c => c.name).sort()).toEqual([`life-dashboard-copy-${day(1)}.json`, `life-dashboard-copy-${day(0)}.json`]);
  const today = drive.copies.find(c => c.name.includes(day(0)));
  expect(JSON.parse(today.body).data.tasks.map(t => t.title).sort()).toEqual(['Delete me by mistake', 'Keep me']);

  // Later the same day: the task is deleted and synced; no second copy is made.
  await d.page.evaluate(() => { Store.set('tasks', Store.get('tasks').filter(t => t.title !== 'Delete me by mistake')); });
  expect((await sync(d.page)).error).toBe('');
  expect(drive.copies).toHaveLength(2);
  expect(JSON.parse(drive.file.body).data.tasks.map(t => t.title)).toEqual(['Keep me']);

  // Settings & Sync → Restore from a copy → today → Add back what's missing.
  await d.page.evaluate(() => openSettings());
  await d.page.click('[data-action="syncCopies"]');
  await d.page.click(`[data-action="syncCopyOpen"][data-date="${day(0)}"]`);
  await expect(d.page.locator('#modal')).toContainText('Add back what’s missing');
  await d.page.click('[data-action="doImport"][data-mode="missing"]');
  await d.page.waitForFunction(() => Store.get('tasks').length === 2);
  expect(await titles(d.page)).toEqual(['Delete me by mistake', 'Keep me']);
  expect((await sync(d.page)).error).toBe('');
  expect(JSON.parse(drive.file.body).data.tasks.map(t => t.title).sort()).toEqual(['Delete me by mistake', 'Keep me']);
  expect(d.errors).toEqual([]);
  await d.context.close();
});
