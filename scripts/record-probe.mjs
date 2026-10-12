// Synthetic record editing, photos, references and storage-recovery checks.
import { spawnSync } from 'node:child_process';
const cli = process.env.PLAYWRIGHT_CLI || 'npx';
const prefix = process.env.PLAYWRIGHT_CLI ? [] : ['--no-install', 'playwright-cli'];
const appURL = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';
if (!['localhost', '127.0.0.1'].includes(new URL(appURL).hostname)) throw new Error('Only use a localhost test app.');
function run(args) {
  const r = spawnSync(cli, [...prefix, '-s=life-dashboard-record-probe', ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (r.status !== 0 || r.stdout.includes('### Error')) throw new Error(r.error?.message || r.stderr || r.stdout);
  return r.stdout.split('### Ran Playwright code')[0].trim();
}

async function seed() {
  await resetAllData();
  Store.set('workouts', [{ id: 'record-workout', name: 'Synthetic workout', start: ymd() + 'T12:00:00Z', end: ymd() + 'T13:00:00Z', notes: 'Keep workout notes', source: 'hevy', exercises: [{ name: 'Bench Press (Barbell)', notes: 'Keep exercise notes', sets: [{ type: 'normal', weight: 50, reps: 8, rpe: 8 }] }, { name: 'Plank', notes: '', sets: [{ type: 'normal', duration: 60 }] }] }]);
  Store.set('journal', [{ id: 'record-journal', type: 'journal', date: ymd(), title: 'Synthetic photo entry', body: 'Synthetic content', tags: [], photos: [], created: new Date().toISOString() }]);
  await Store.flushAll(); ui.fitTab = 'history'; go('fitness');
  const canvas = document.createElement('canvas'); canvas.width = 2600; canvas.height = 1300;
  canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png').split(',')[1];
}

async function storageRecovery() {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const originalWrite = Store.write, db = Store.db, originalTransaction = db.transaction.bind(db);
  await Store.flushAll(); const persistedBefore = await Store.read('tasks');
  Store.data.tasks.push({ id: 'record-unsaved', title: 'Synthetic pending change', status: 'todo', tags: [] }); Store.dirty.add('tasks');
  Store.write = () => { throw new Error('Synthetic quota failure'); };
  let rejected = false; try { await Store.flushDirty(); } catch { rejected = true; } finally { Store.write = originalWrite; }
  assert(rejected && Store.dirty.has('tasks') && Store.saveFailed && !$('#save-warning').classList.contains('hidden'), 'Failed changes were not retained/announced');
  assert((await Store.read('tasks')).length === persistedBefore.length, 'Failed write changed persisted records');
  assert((await buildBackupPayload()).data.tasks.some(t => t.id === 'record-unsaved'), 'Backup omitted unsaved in-memory changes');
  await Store.flushDirty(); assert(!Store.dirty.size && !Store.saveFailed && $('#save-warning').classList.contains('hidden'), 'Retry did not clear pending warning');
  assert((await Store.read('tasks')).some(t => t.id === 'record-unsaved'), 'Retry did not persist records');
  const first = Store.get('tasks').find(t => t.id === 'record-unsaved'); let release, writes = [];
  Store.write = async (key, value) => { const snapshot = structuredClone(value); writes.push(snapshot.find(t => t.id === 'record-unsaved')?.title); if (writes.length === 1) await new Promise(r => { release = r; }); return originalWrite.call(Store, key, snapshot); };
  first.title = 'First synthetic edit'; Store.dirty.add('tasks'); const earlier = Store.flushDirty();
  while (!release) await new Promise(r => setTimeout(r, 0));
  first.title = 'Latest synthetic edit'; Store.dirty.add('tasks'); const later = Store.flushDirty(); release();
  try { await Promise.all([earlier, later]); } finally { Store.write = originalWrite; }
  assert(writes.join('|') === 'First synthetic edit|Latest synthetic edit' && (await Store.read('tasks')).find(t => t.id === first.id).title === 'Latest synthetic edit', 'Queued writes lost the latest edit');
  const photoId = Store.get('journal')[0].photos[0]; assert(photoId, 'Photo fixture is missing');
  db.transaction = (...args) => { const tx = originalTransaction(...args); queueMicrotask(() => tx.abort()); return tx; };
  let aborted;
  try { aborted = await Promise.race([Promise.allSettled([Store.write('tasks', []), Photos.put('aborted-photo', new Blob(['x'])), Photos.get(photoId), Photos.del(photoId), BibleDb.put('aborted-reference', {}), BibleDb.get('aborted-reference'), BibleDb.del('aborted-reference'), idbClear('photos')]), new Promise((_, reject) => setTimeout(() => reject(new Error('Aborted storage operation hung')), 2000))]); }
  finally { db.transaction = originalTransaction; }
  assert(aborted.every(r => r.status === 'rejected') && await Photos.get(photoId), 'Aborted transaction resolved as success or lost photo');
  Store.db = null; const fallbackKey = 'ld.data.record-probe-corrupt'; localStorage.setItem(fallbackKey, '{invalid');
  try { let stopped = false; try { await Store.read('record-probe-corrupt'); } catch { stopped = true; } assert(stopped && localStorage.getItem(fallbackKey) === '{invalid', 'Corrupt fallback data was silently replaced'); }
  finally { localStorage.removeItem(fallbackKey); Store.db = db; }
  const setItem = Storage.prototype.setItem; Store.db = null; Store.dirty.add('tasks');
  Storage.prototype.setItem = function(key, value) { if (key.startsWith('ld.data.')) throw new Error('Synthetic fallback quota failure'); return setItem.call(this, key, value); };
  try { let stopped = false; try { await Store.flushDirty(); } catch { stopped = true; } assert(stopped && Store.dirty.has('tasks'), 'Fallback write failure lost pending changes'); }
  finally { Storage.prototype.setItem = setItem; Store.db = db; }
  await Store.flushDirty();
  return { failedChangesRetained: true, backupIncludesPendingChanges: true, retryPersists: true, queuedEditsPreserved: true, abortedOperations: aborted.length, corruptFallbackPreserved: true };
}
async function resetRecovery() {
  const write = Store.write; let release;
  Store.get('tasks')[0].title = 'Synthetic delayed pre-reset edit'; Store.dirty.add('tasks');
  Store.write = async (key, value) => { const snapshot = structuredClone(value); if (!release) await new Promise(resolve => { release = resolve; }); return write.call(Store, key, snapshot); };
  const saving = Store.flushDirty(); while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  const resetting = resetAllData(); release();
  try { await Promise.all([saving, resetting]); } finally { Store.write = write; }
  if ((await Store.read('tasks')).some(t => t.id === 'record-unsaved') || (await idbEntries('photos')).length) throw new Error('Pending writes resurrected reset records');
  return { resetWaitsForPendingWrites: true, recordsNotResurrected: true };
}

async function references() {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const originalFetch = window.fetch;
  const fixture = { books: BOOKS.map(([name, chapters]) => ({ name, chapters: Array.from({ length: chapters }, () => ({ verses: [{ verse: 1, text: 'Synthetic test text, not Scripture' }] })) })) };
  window.fetch = async () => new Response(JSON.stringify(fixture), { status: 200 });
  try { await downloadBible('kjv'); } finally { window.fetch = originalFetch; }
  assert(BibleMem.kjv.length === 66 && (await getChapter('kjv', 42, 3))[0].t === 'Synthetic test text, not Scripture', 'Synthetic Bible import/read failed');
  const old = await BibleDb.get('kjv'); window.fetch = async () => new Response(JSON.stringify({ books: [] }), { status: 200 });
  try { let stopped = false; try { await downloadBible('kjv'); } catch { stopped = true; } assert(stopped && (await BibleDb.get('kjv')).length === old.length, 'Malformed Bible replaced the existing library'); }
  finally { window.fetch = originalFetch; }
  const lexiconFixture = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => ['G' + (i + 1), { lemma: 'Synthetic lemma', xlit: 'synthetic', strongs_def: 'Synthetic definition, not a source' }]));
  const lexicon = parseLexiconFile('var fixture = ' + JSON.stringify(lexiconFixture) + ';', 'G');
  assert(Object.keys(lexicon).length === 1001 && lexicon[100001][0] === 'Synthetic lemma', 'Synthetic lexicon parse failed');
  let lexStopped = false; try { parseLexiconFile('var fixture = {"G1":{"lemma":"incomplete"}};', 'G'); } catch { lexStopped = true; } assert(lexStopped, 'Incomplete lexicon was accepted');
  const rows = Array.from({ length: 1001 }, (_, i) => [[null, 'Nav', 'Synthetic topic ' + i], [null, null, null, null, 'Matthew 5:21, 22']]).flat();
  const topics = parseBereanTopics(rows); assert(topics.length === 1001 && topics[0][2] === 'Matthew 5:21–22', 'Topic reference expansion failed');
  const header = Array.from({ length: 22 }, (_, i) => i === 7 ? 'translit' : 'column' + i).join('\t');
  const row = i => { const c = Array(22).fill(''); c[1] = String(i + 1); c[3] = String(i % 1000 + 1); c[4] = 'Greek'; c[5] = 'α'; c[7] = 'synthetic'; c[8] = 'fixture'; c[11] = '1'; c[12] = 'John 1:1'; c[18] = 'Synthetic gloss'; return c.join('\t'); };
  const text = header + '\n' + Array.from({ length: 100000 }, (_, i) => row(i)).join('\n');
  const tables = await parseBereanTables(new Blob([text])); assert(tables.vr.length === 100000 && tables.st[0] === 100001, 'Streaming table import failed');
  await BibleDb.put('berean.tables', tables); const stored = await BibleDb.get('berean.tables'); assert(stored.vr instanceof Int32Array && stored.vr.length === tables.vr.length, 'Typed reference arrays did not persist');
  let tableStopped = false; try { await parseBereanTables(new Blob(['wrong header\n'])); } catch { tableStopped = true; } assert(tableStopped, 'Malformed table was accepted');
  return { syntheticBibleBooks: 66, malformedBiblePreservesLibrary: true, lexiconEntries: 1001, topicEntries: 1001, tableRows: 100000, typedArraysPersist: true, incompleteReferencesRejected: true };
}

try {
  run(['open', appURL, '--config', 'scripts/probe-browser.json']);
  run(['run-code', 'async page => { const origin = new URL(page.url()).origin; await page.route("**/*", r => /^(data|blob):/.test(r.request().url()) || new URL(r.request().url()).origin === origin ? r.continue() : r.abort()); await page.reload(); await page.waitForFunction(() => typeof Store !== "undefined" && Array.isArray(Store.data.tasks)); }']);
  const png = JSON.parse(run(['eval', seed.toString()]).replace(/^### Result\s*/, ''));
  run(['snapshot']);
  run(['run-code', `async page => {
    await page.locator('summary').first().click();
    await page.locator('[data-action="workoutEdit"][data-id="record-workout"]').click();
    await page.locator('[data-wctx="edit"] [data-input="awField"][data-f="name"]').fill('Synthetic edited workout');
    await page.locator('[data-wctx="edit"] [data-input="awSet"][data-f="weight"]').first().fill('120');
    await page.locator('[data-wctx="edit"] [data-input="awSet"][data-f="reps"]').first().fill('10');
    await page.locator('[data-action="editSave"]').click();
    await page.evaluate(() => { const w = W().find(w => w.id === 'record-workout'); if (w.name !== 'Synthetic edited workout' || Math.abs(w.exercises[0].sets[0].weight - 120 * LB) > 0.01 || w.exercises[0].sets[0].reps !== 10 || w.exercises[1].sets[0].duration !== 60 || w.notes !== 'Keep workout notes' || w.source !== 'hevy') throw new Error('Workout editing lost fields/units'); ui.jId = 'record-journal'; go('journal'); });
    const upload = { name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from('${png}', 'base64') };
    await page.locator('input[data-change="jPhotoAdd"]').setInputFiles(upload);
    await page.waitForFunction(() => Store.get('journal')[0].photos.length === 1);
    await page.evaluate(async () => { const id = Store.get('journal')[0].photos[0], blob = await Photos.get(id), bmp = await createImageBitmap(blob); if (blob.type !== 'image/jpeg' || bmp.width !== 1600 || bmp.height !== 800) throw new Error('Photo resize failed'); bmp.close(); });
    await page.locator('input[data-change="jPhotoAdd"]').setInputFiles([upload, {name:'invalid.png',mimeType:'image/png',buffer:Buffer.from('not an image')}]);
    await page.waitForFunction(() => Store.get('journal')[0].photos.length === 2);
    await page.evaluate(async () => { await Store.flushAll(); });
    await page.reload(); await page.waitForFunction(() => typeof Store !== 'undefined' && Array.isArray(Store.data.tasks));
    await page.evaluate(async () => { const w = W().find(w => w.id === 'record-workout'), j = Store.get('journal')[0]; if (w.name !== 'Synthetic edited workout' || j.photos.length !== 2 || !(await Photos.get(j.photos[0])) || !(await Photos.get(j.photos[1]))) throw new Error('Workout/photo reload persistence failed'); });
  }`]);
  console.log('Workout/photo editing: passed (resize, partial batch, reload).');
  console.log('Storage', run(['eval', storageRecovery.toString()]));
  run(['snapshot']);
  run(['run-code', `async page => {
    await page.addScriptTag({path:'node_modules/axe-core/axe.min.js'});
    for (const theme of ['light','dark']) for (const width of [1200,390]) {
      await page.setViewportSize({width,height:953});
      await page.evaluate(theme => {S.theme=theme;applyTheme();},theme); await page.waitForTimeout(300);
      await page.evaluate(async () => { const write=Store.write; Store.get('tasks')[0].title='Synthetic warning test'; Store.dirty.add('tasks'); Store.write=()=>Promise.reject(new Error('Synthetic quota failure')); try {await Store.flushDirty();} catch {} finally {Store.write=write;} });
      await page.evaluate(async () => { const banner=$('#save-warning'), box=banner.getBoundingClientRect(); const result=await axe.run(banner,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}); if(result.violations.length || box.left<0 || box.right>innerWidth) throw new Error('Save warning accessibility/layout failed'); });
      await page.getByRole('button',{name:'Retry saving',exact:true}).click();
      await page.waitForFunction(()=>$('#save-warning').classList.contains('hidden') && !Store.dirty.size);
      await page.evaluate(async()=>{if((await Store.read('tasks'))[0].title!=='Synthetic warning test') throw new Error('Retry button did not save');});
    }
  }`]);
  console.log('Save warning: light/dark desktop/phone layout, accessible controls and retry button passed.');
  console.log('References', run(['eval', references.toString()]));
  console.log('Reset recovery', run(['eval', resetRecovery.toString()]));
} finally { run(['close']); }
