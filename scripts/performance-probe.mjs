// Run in an isolated Playwright CLI profile; never reads the user's Chrome profile.
// Requires the CLI (or its npx wrapper). Existing app code stays in index.html.
import { spawnSync } from 'node:child_process';

const cli = process.env.PLAYWRIGHT_CLI || 'npx';
const prefix = process.env.PLAYWRIGHT_CLI ? [] : ['--yes', '--package', '@playwright/cli', 'playwright-cli'];
const session = '-s=life-dashboard-performance';
const appURL = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';
if (!['localhost', '127.0.0.1'].includes(new URL(appURL).hostname)) throw new Error('The probe must use an isolated localhost app.');
function run(args) {
  const r = spawnSync(cli, [...prefix, session, ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.error?.message || r.stderr || r.stdout);
  return r.stdout;
}

async function probe() {
  const savedTasks = Store.data.tasks, savedProjects = Store.data.projects;
  const savedUI = { taskArea: ui.taskArea, projOpen: ui.projOpen, taskTab: ui.taskTab };
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const measure = fn => {
    fn(); const times = [];
    for (let i = 0; i < 5; i++) { const start = performance.now(); fn(); times.push(performance.now() - start); }
    return Math.round(times.sort((a, b) => a - b)[2] * 10) / 10;
  };
  const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const result = { tasks: 12500, projects: 250, people: 500 };
  try {
    assert(typeof groupBy === 'function' && Store.readMany && Photos.prune, 'Expected performance helpers are missing');
    ui.taskArea = null; ui.projOpen = null;
    Store.data.projects = Array.from({ length: 250 }, (_, i) => ({ id: 'bench-p' + i, name: 'Benchmark project ' + i, area: 'home', status: 'active' }));
    Store.data.tasks = Array.from({ length: 12500 }, (_, i) => ({ id: 'bench-t' + i, title: 'Benchmark task ' + i, status: i % 3 ? 'done' : 'todo', project: 'bench-p' + (i % 250), person: 'Person ' + (i % 500), area: 'home', priority: 'med', created: '2024-01-01', completedAt: i % 3 ? '2025-01-01T12:00:00Z' : null, tags: [] }));
    result.projectHtmlMs = measure(tasksProjects);
    result.peopleHtmlMs = measure(tasksPeople);
    result.projectHtmlHash = await digest(tasksProjects());
    result.peopleHtmlHash = await digest(tasksPeople());
    assert((tasksProjects().match(/data-action="projOpen"/g) || []).length === 250, 'Project cards missing');
    assert((tasksPeople().match(/Last touch /g) || []).length === 500, 'People groups missing');
    ui.taskTab = 'projects'; go('tasks');
    assert($('#view').scrollWidth <= $('#view').clientWidth + 1, 'Section tabs overflow the medium-width view');
    result.mediumWidthLayoutVerified = true;
    if (typeof groupBy === 'function') {
      const items = [{ key: 'a' }, { key: 'b' }, { key: 'a' }], groups = groupBy(items, x => x.key);
      assert(groups.get('a')[0] === items[0] && groups.get('a')[1] === items[2], 'Grouping changes item order or identity');
      assert([...groups.keys()].join(',') === 'a,b', 'Grouping changes key order');
      result.groupingVerified = true;
    }
    if (Store.readMany) {
      const db = Store.db, original = db.transaction.bind(db); let transactions = 0;
      db.transaction = (...args) => { transactions++; return original(...args); };
      try {
        const keys = Object.keys(COLLECTIONS), values = await Store.readMany(keys);
        assert(transactions === 1 && values.length === keys.length, 'Startup did not use one transaction');
        assert((await Store.readMany(['__missing_probe_key__']))[0] === undefined, 'Missing collection default changed');
        result.startupReadTransactions = 1; result.collections = keys.length;
      } finally { db.transaction = original; }
      Store.db = { transaction: (...args) => { const tx = original(...args); queueMicrotask(() => tx.abort()); return tx; } };
      try {
        let rejected = false; try { await Store.readMany(['tasks']); } catch { rejected = true; }
        assert(rejected, 'Aborted startup read was silently accepted'); result.abortedReadVerified = true;
      } finally { Store.db = db; }
      Store.db = null;
      try { assert((await Store.readMany(['__missing_probe_key__']))[0] === undefined, 'localStorage fallback changed'); result.fallbackVerified = true; }
      finally { Store.db = db; }
    }
    if (Photos.prune) {
      const id = '__performance_probe_photo__';
      await Photos.put(id, new Blob(['probe'], { type: 'text/plain' }));
      const get = Photos.get.bind(Photos); let reads = 0;
      Photos.get = key => { reads++; return get(key); };
      try {
        const urls = await Promise.all([Photos.url(id), Photos.url(id)]);
        assert(reads === 1 && urls[0] === urls[1], 'Concurrent photo loads are not deduplicated');
        const img = document.createElement('img'); img.dataset.photo = id; document.body.append(img);
        Photos.prune(); assert(Photos.urls.has(id), 'Visible photo released too soon');
        img.remove(); Photos.prune(); assert(!Photos.urls.has(id), 'Invisible photo URL was retained');
        assert(await Photos.get(id), 'URL cleanup deleted the saved photo');
        const holder = document.createElement('div'); holder.innerHTML = `<img data-photo="${id}"><img data-photo="${id}">`; document.body.append(holder);
        await hydratePhotos();
        assert(holder.firstChild.src.startsWith('blob:') && holder.firstChild.src === holder.lastChild.src, 'Shared photo hydration failed');
        Modal.open(modalShell('Photo probe', `<img data-photo="${id}">`)); await hydratePhotos(); Modal.close();
        assert(Photos.urls.has(id), 'Closing a dialog released a photo still used by the page');
        holder.remove(); Photos.prune();
        let finish; Photos.get = () => new Promise(resolve => { finish = resolve; });
        const pending = Photos.url(id); Photos.clearURLs(); finish(new Blob(['late']));
        assert(await pending === null && !Photos.urls.has(id) && !Photos.pending.size, 'An obsolete photo load repopulated the cache');
        result.photoLifecycleVerified = true;
      } finally { Photos.get = get; await Photos.del(id); }
    }
    return result;
  } finally { Store.data.tasks = savedTasks; Store.data.projects = savedProjects; Object.assign(ui, savedUI); }
}

try {
  run(['open', appURL]);
  run(['resize', '1200', '953']);
  run(['run-code', 'async page => { const origin = new URL(page.url()).origin; await page.route("**/*", r => /^(data|blob):/.test(r.request().url()) || new URL(r.request().url()).origin === origin ? r.continue() : r.abort()); await page.reload(); await page.waitForFunction(() => typeof Store !== "undefined" && Array.isArray(Store.data.tasks)); }']);
  console.log(run(['eval', probe.toString()]).split('### Ran Playwright code')[0].trim());
} finally { run(['close']); }
