// Synthetic-only integration checks in a separate Playwright CLI profile.
import { spawnSync } from 'node:child_process';
const cli = process.env.PLAYWRIGHT_CLI || 'npx';
const prefix = process.env.PLAYWRIGHT_CLI ? [] : ['--no-install', 'playwright-cli'];
const appURL = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';
if (!['localhost', '127.0.0.1'].includes(new URL(appURL).hostname)) throw new Error('Use a localhost test app, never a hosted personal-data origin.');
function run(args) {
  const r = spawnSync(cli, [...prefix, '-s=life-dashboard-populated', ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.error?.message || r.stderr || r.stdout);
  if (r.stdout.includes('### Error')) throw new Error(r.stdout);
  return r.stdout.split('### Ran Playwright code')[0].trim();
}

async function seed() {
  await resetAllData(); // Only this dedicated test profile; never the regular Chrome profile.
  const today = ymd(), date = i => addDays(today, -i), stamp = i => date(i) + 'T12:00:00Z';
  const make = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
  Store.set('projects', make(12, i => ({ id: 'fixture-project-' + i, name: 'Synthetic project ' + i, area: AREAS[i % 4][0], status: 'active' })));
  Store.set('tasks', make(1200, i => ({ id: 'fixture-task-' + i, title: 'Synthetic task ' + i, notes: 'Fixture notes', status: i < 100 ? 'todo' : 'done', priority: ['high', 'med', 'low'][i % 3], due: i < 100 ? addDays(today, i % 15 - 7) : date(i), tags: ['fixture'], area: AREAS[i % 4][0], project: 'fixture-project-' + (i % 12), person: 'Synthetic person ' + (i % 20), created: stamp(i), completedAt: i < 100 ? null : stamp(i), subtasks: [{ id: 'step-' + i, text: 'Synthetic checklist step', done: false }] })));
  Store.set('workouts', make(260, i => ({ id: 'fixture-workout-' + i, name: 'Synthetic workout ' + i, start: stamp(i * 4), end: date(i * 4) + 'T13:00:00Z', notes: 'Synthetic workout notes', exercises: ['Bench Press', 'Squat'].map(name => ({ name, notes: '', sets: make(3, j => ({ type: 'normal', weight: 60 + j * 5, reps: 8, rpe: 8, pr: [] })) })) })));
  Store.set('nutrition', Object.fromEntries(make(1095, i => [date(i), { weight: 75 + Math.sin(i / 20), entries: [{ id: 'fixture-entry-' + i, name: 'Synthetic daily meal', cal: 2200, p: 150, c: 240, f: 70, meal: 'dinner', time: '18:00' }] }])));
  Store.set('foods', make(40, i => ({ id: 'fixture-food-' + i, name: 'Synthetic food ' + i, brand: '', basis: '100g', base: { cal: 300, p: 15, c: 40, f: 8 }, extra: [], uses: 3, lastUsed: stamp(i) })));
  Store.set('meals', [{ id: 'fixture-meal', name: 'Synthetic saved meal', items: [{ name: 'Synthetic food', cal: 400, p: 20, c: 50, f: 12 }] }]);
  Store.set('nutPlan', { goal: 'maintain', mode: 'manual', startDate: date(1000), startWeight: 75, priorKcal: 2400, diet: 'balanced', proteinPerLb: 0.9, profile: { sex: 'male', age: 35, heightCm: 180, activity: 1.5 }, targets: { ...S.targets }, history: make(12, i => ({ id: 'fixture-checkin-' + i, date: date(i * 7), logged: 7, avgIntake: 2200, trendChange: 0.1, expenditure: 2400, applied: false, old: { ...S.targets }, final: { ...S.targets } })) });
  Store.set('measurements', make(20, i => ({ id: 'fixture-measure-' + i, date: date(i * 30), vals: { waist: 90, arm: 35 } })));
  Store.set('journal', make(730, i => ({ id: 'fixture-journal-' + i, type: 'journal', date: date(i), title: 'Synthetic journal ' + i, body: 'Synthetic reflection, not a source quotation. John 3:16 reference. UniqueJournalToken' + i, mood: i % 5 + 1, energy: i % 5 + 1, tags: ['fixture'], created: stamp(i), updated: stamp(i), prayers: i % 5 === 0 ? ['fixture-prayer-0'] : [], photos: [] })));
  Store.set('scripture', make(100, i => ({ id: 'fixture-note-' + i, title: 'Synthetic study note ' + i, ref: 'John 3:16', kind: i % 2 ? 'soap' : 'teaching', series: 'Synthetic series', date: date(i * 7), body: 'Synthetic study content, not Scripture. UniqueStudyToken' + i, tags: ['fixture'], created: stamp(i * 7) })));
  Store.set('prayers', make(30, i => ({ id: 'fixture-prayer-' + i, title: 'Synthetic prayer ' + i, cat: PRAY_CATS[i % PRAY_CATS.length], created: stamp(i * 30), count: i, answered: i % 3 === 0 ? { date: date(i), note: 'Synthetic answer' } : null })));
  Store.set('memory', make(15, i => ({ id: 'fixture-memory-' + i, ref: 'John 3:16', text: 'Synthetic memory text, not Scripture', tr: 'WEB', due: date(i), box: i % 5 + 1 })));
  Store.set('highlights', make(10, i => ({ id: 'fixture-highlight-' + i, b: 43, c: 3, v: i + 1, tr: 'web', text: 'Synthetic highlight text, not Scripture', color: 'yellow', bookmark: true, note: 'Synthetic note' })));
  Store.set('media', make(120, i => ({ id: 'fixture-media-' + i, title: 'Synthetic resource ' + i, kind: ['article', 'book', 'sermon'][i % 3], status: ['queue', 'active', 'done'][i % 3], author: 'Synthetic author', ministry: 'dg', date: date(i * 8), created: stamp(i * 8), updated: stamp(i * 8), body: 'UniqueMediaToken' + i, tags: ['fixture'], refs: 'John 3:16', rating: i % 5 + 1, highlights: [], article: i % 3 === 0 ? { md: 'Synthetic article content ' + i, desc: 'Synthetic article' } : null, book: i % 3 === 1 ? { pages: 200, current: 50 } : null })));
  Store.set('quotes', make(20, i => ({ id: 'fixture-quote-' + i, kind: 'quote', text: 'Synthetic quotation fixture, not an attributed quotation ' + i, author: 'Synthetic author', date: date(i), tags: ['fixture'], source: 'fixture-media-0' })));
  Store.set('fpeople', make(4, i => ({ id: 'fixture-person-' + i, name: 'Synthetic family member ' + i, role: i ? 'child' : 'spouse', birthday: '2000-01-01', loveLang: [], growth: [], quotes: [], prayed: [] })));
  Store.set('checkins', make(80, i => ({ id: 'fixture-family-checkin-' + i, date: date(i * 7), rating: 4, notes: 'Synthetic conversation', prompt: 'Synthetic prompt', action: 'Synthetic next step' })));
  Store.set('memories', make(60, i => ({ id: 'fixture-family-memory-' + i, date: date(i * 15), text: 'Synthetic family memory ' + i, people: ['fixture-person-0'], photos: [] })));
  Store.set('dateLog', make(30, i => ({ id: 'fixture-date-' + i, date: date(i * 30), title: 'Synthetic date', notes: '', photos: [] })));
  Store.set('milestones', make(10, i => ({ id: 'fixture-milestone-' + i, title: 'Synthetic milestone ' + i, date: date(i * 10), cat: MS_CATS[0], done: i % 2 === 0 })));
  Store.set('recipes', make(60, i => ({ ...structuredClone(SAMPLE_RECIPES()[0]), id: 'fixture-recipe-' + i, title: 'Synthetic recipe ' + i, created: stamp(i * 12), updated: stamp(i * 12), tags: ['fixture'], servings: 4, cal: 450, p: 30, c: 45, f: 15, made: [date(i)], fav: i % 2 === 0, rating: 4, ingredients: '2 cups rice\n1 lb chicken', steps: 'Cook rice.\nCook chicken.', notes: 'Synthetic recipe notes' })));
  Store.set('mealPlan', { [today]: [{ id: 'fixture-plan', recipeId: 'fixture-recipe-0', slot: 'dinner', portions: 4 }] });
  Store.set('grocery', [{ id: 'fixture-grocery', name: 'rice', qty: 2, unit: 'cups', checked: false, section: 'pantry' }]);
  Store.set('pantry', [{ id: 'fixture-pantry', name: 'rice', added: today, low: false }]);
  Store.set('freezer', [{ id: 'fixture-freezer', name: 'Synthetic meal', recipeId: 'fixture-recipe-0', portions: 4, date: today }]);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
  const photo = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  await Photos.put('jp_fixture_photo', photo); Store.get('journal')[0].photos.push('jp_fixture_photo'); Store.save('journal');
  await Store.flushAll(); sortWorkouts();
  window.__popErrors = []; const error = console.error.bind(console); console.error = (...args) => { window.__popErrors.push(args.map(String).join(' ')); error(...args); };
  return { workouts: W().length, nutritionDays: Object.keys(Store.get('nutrition')).length, journal: Store.get('journal').length, scripture: Store.get('scripture').length, media: Store.get('media').length, recipes: Store.get('recipes').length, tasks: TK().length };
}

async function walk() {
  const failures = [], timings = [];
  const check = label => {
    if ($('#view').textContent.includes('Something went wrong rendering')) failures.push(label + ': render error');
    if ($('#view').scrollWidth > $('#view').clientWidth + 1) failures.push(label + ': horizontal overflow');
    for (const el of $$('[data-action], [data-change], [data-input], [data-submit]', $('#view'))) for (const key of ['action', 'change', 'input', 'submit']) if (el.dataset[key] && typeof A[el.dataset[key]] !== 'function') failures.push(label + ': unbound ' + key + ' ' + el.dataset[key]);
  };
  const draw = async (label, fn) => { const start = performance.now(); fn(); timings.push({ label, ms: Math.round(performance.now() - start) }); await new Promise(requestAnimationFrame); check(label); };
  for (const view of VIEWS.filter(v => v.id)) {
    await draw(view.id, () => go(view.id));
    const sections = [...new Map($$('[data-action="setTab"]').map(el => [el.dataset.key + '=' + el.dataset.val, [el.dataset.key, el.dataset.val]])).values()];
    for (const [key, val] of sections) await draw(view.id + '/' + val, () => { ui[key] = val; render(); });
    if (view.id === 'journal') for (const mode of ['list', 'cal', 'insights']) await draw('journal/' + mode, () => { ui.jView = mode; render(); });
  }
  return { width: innerWidth, screens: timings.length, failures: [...new Set(failures)], slowestSynchronousRenders: timings.sort((a, b) => b.ms - a.ms).slice(0, 5), consoleErrors: window.__popErrors };
}

async function imports() {
  const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
  assert(validRecordId('mf:rice|serving') && validRecordId('mf:|') && !validRecordId('other|identifier') && !validRecordId('mf:food|serving" onclick="x'), 'Identifier validation widened unsafely');
  const exported = toHevyCSV(), parsed = parseHevyCSV(exported);
  assert(parsed.workouts.length === W().length && parsed.bad === 0, 'Hevy roundtrip count changed');
  assert(parsed.workouts.every(w => w.exercises.length === 2 && w.exercises.every(e => e.sets.length === 3)), 'Hevy roundtrip sets changed');
  assert(parsed.workouts.every(w => w.exercises.every(e => e.sets.every((s, i) => Math.abs(s.weight - (60 + i * 5)) < 0.02 && s.reps === 8))), 'Hevy unit conversion changed');
  const dayKey = ymd(), manualId = 'fixture-entry-0';
  const res = parseMacroFactor({ 'Quick Export': [['Date', 'Weight (kg)', 'Calories (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Expenditure'], [dayKey, 80, 2000, 120, 200, 70, 2400]], 'Food Log': [['Date', 'Time', 'Food Name', 'Serving Size', 'Serving Qty', 'Calories (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)'], [dayKey, '12:00', 'Synthetic imported food', 'serving', 1, 400, 20, 40, 10]] });
  const weight = day(dayKey).weight;
  applyMacroFactor(res, { overwriteWeights: false, useTargets: false }); applyMacroFactor(res, { overwriteWeights: false, useTargets: false });
  assert(day(dayKey).weight === weight && day(dayKey).entries.some(e => e.id === manualId), 'MacroFactor overwrote manual records');
  assert(day(dayKey).entries.filter(e => e.id.startsWith('mf:')).length === 1, 'MacroFactor reimport duplicated entries');
  const backup = await buildBackupPayload(), counts = Object.fromEntries(Object.entries(Store.data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]));
  validateBackup(backup); await commitBackupImport(planBackupImport(backup, 'merge')); await commitBackupImport(planBackupImport(backup, 'merge'));
  assert(Object.entries(counts).every(([k, n]) => Store.get(k).length === n), 'Backup merge duplicated records');
  assert(await Photos.get('jp_fixture_photo'), 'Backup merge lost photo');
  await commitBackupImport(planBackupImport(backup, 'replace'));
  assert(Object.entries(counts).every(([k, n]) => Store.get(k).length === n), 'Backup replace changed counts');
  assert(await Photos.get('jp_fixture_photo'), 'Backup replace lost photo');
  const repeat = addTask('Synthetic recurring task today every week'); const before = TK().length;
  setTaskStatus(repeat, 'done'); setTaskStatus(repeat, 'done');
  assert(TK().length === before + 1, 'Recurring completion created duplicates'); Store.save('tasks'); await Store.flushDirty();
  return { hevyWorkouts: parsed.workouts.length, macroFactorReimport: true, manualNutritionPreserved: true, backupMergeReplace: true, recurringTask: true };
}
async function detailAccessibility() {
  const previousTheme = S.theme, failures = []; let screens = 0;
  const scan = async (label, show) => {
    Modal.close(); ui.jFocus = null; show(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
    screens++; for (const violation of result.violations) failures.push({ label, rule: violation.id, nodes: violation.nodes.map(n => n.html).slice(0, 4) });
  };
  for (const theme of ['light', 'dark']) {
    S.theme = theme; applyTheme();
    await scan(theme + '/task-board', () => { ui.taskTab = 'all'; ui.taskView = 'board'; go('tasks'); });
    if (!$('button[data-action="taskEdit"][data-id="fixture-task-0"]')) throw new Error('Task board has no keyboard-edit control');
    await scan(theme + '/journal-editor', () => { ui.jId = 'fixture-journal-0'; go('journal'); });
    await scan(theme + '/journal-focus', () => { ui.jFocus = 'fixture-journal-0'; render(); });
    if (!$('#j-workspace').inert || !$('#sidebar').inert) throw new Error('Journal Focus background is not inert');
    ui.jFocus = null; render();
    await scan(theme + '/family-detail', () => { ui.fpId = 'fixture-person-1'; ui.famTab = 'people'; go('family'); });
    await scan(theme + '/family-rating', () => { ui.fpId = null; ui.famTab = 'checkin'; go('family'); $$('input[name="rating"]')[3].checked = true; });
    await scan(theme + '/book-detail', () => { ui.medOpen = 'fixture-media-1'; go('media'); });
    await scan(theme + '/study-editor', () => { A.scrNoteOpen({ dataset: { id: 'fixture-note-0' } }); });
  }
  Modal.close(); ui.medOpen = null; S.theme = previousTheme; applyTheme();
  if (failures.length) throw new Error('Detail accessibility failures: ' + JSON.stringify(failures));
  return { lightDarkDetailScreens: screens, keyboardTaskEdit: true, journalFocusBackground: true };
}
async function serviceRecovery() {
  const original = window.fetch, checks = [];
  const expectError = async (name, action, text) => { let message = ''; try { await action(); } catch (e) { message = e.message; } if (!message.includes(text)) throw new Error(name + ' recovery failed: ' + message); checks.push(name); };
  try {
    window.fetch = (_url, opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    await expectError('timeout', () => fetchServiceJSON('https://example.invalid', {}, 20), 'too long');
    window.fetch = async (_url, opts) => ({ ok: true, json: () => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) });
    await expectError('body-timeout', () => fetchServiceJSON('https://example.invalid', {}, 20), 'too long');
    window.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await expectError('unreachable', () => searchOFF('synthetic query'), 'could not be reached');
    window.fetch = async () => new Response('not JSON', { status: 200 });
    await expectError('invalid-response', () => fetchServiceJSON('https://example.invalid'), 'unreadable');
    window.fetch = async () => new Response('', { status: 429 });
    await expectError('USDA-limit', () => searchUSDA('synthetic query'), 'limit reached');
    window.fetch = async () => new Response('', { status: 503 });
    await expectError('OFF-server-error', () => searchOFF('synthetic query'), '503');
    return { recoveryChecks: checks };
  } finally { window.fetch = original; }
}

try {
  run(['open', appURL, '--config', 'scripts/probe-browser.json']);
  run(['run-code', 'async page => { const origin = new URL(page.url()).origin; await page.route("**/*", r => /^(data|blob):/.test(r.request().url()) || new URL(r.request().url()).origin === origin ? r.continue() : r.abort()); await page.reload(); await page.waitForFunction(() => typeof Store !== "undefined" && Array.isArray(Store.data.tasks)); }']);
  console.log('Fixture', run(['eval', seed.toString()]));
  for (const width of [1200, 390]) {
    run(['resize', String(width), '953']); const output = run(['eval', walk.toString()]); console.log('Views', output);
    const result = JSON.parse(output.replace(/^### Result\s*/, ''));
    if (result.failures.length || result.consoleErrors.length) throw new Error('Populated views failed: ' + JSON.stringify(result));
  }
  run(['resize', '1200', '953']);
  run(['run-code', 'async page => { await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" }); }']);
  console.log('Detail accessibility', run(['eval', detailAccessibility.toString()]));
  console.log('Service recovery', run(['eval', serviceRecovery.toString()]));
  run(['run-code', 'async page => { await page.context().setOffline(true); const message = await page.evaluate(async () => { try { await searchOFF("synthetic query"); return ""; } catch (e) { return e.message; } }); await page.context().setOffline(false); if (!message.includes("offline")) throw new Error("Offline recovery failed"); }']);
  console.log('Imports', run(['eval', imports.toString()]));
  run(['snapshot']);
  console.log('Edits', run(['run-code', `async page => {
    await page.setViewportSize({ width: 1200, height: 953 });
    await page.evaluate(() => { ui.taskTab = 'all'; ui.taskView = 'list'; ui.taskArea = null; go('tasks'); });
    await page.locator('button[data-action="taskEdit"][data-id="fixture-task-0"]').click();
    await page.locator('#modal input[name=title]').fill('Synthetic task edited');
    await page.locator('#modal form').evaluate(f => f.requestSubmit());
    await page.evaluate(() => { if (tFind('fixture-task-0').title !== 'Synthetic task edited' || tFind('fixture-task-0').subtasks.length !== 1) throw new Error('Task edit lost fields'); ui.jView = 'list'; ui.jSearch = ''; go('journal'); });
    await page.locator('#j-search').fill('UniqueJournalToken0');
    await page.waitForFunction(() => $$('#view [data-jlist]').length === 1);
    await page.locator('[data-action="journalOpen"][data-id="fixture-journal-0"]').click();
    await page.locator('#j-body').fill('Synthetic autosaved journal edit');
    await page.locator('[data-action="jFocus"]').click();
    await page.waitForFunction(() => !!$('#j-focus') && document.activeElement.id === 'jf-body');
    await page.evaluate(() => focusableElements($('#j-focus'))[0].focus());
    await page.keyboard.press('Shift+Tab');
    await page.evaluate(() => { const list = focusableElements($('#j-focus')); if (document.activeElement !== list[list.length - 1]) throw new Error('Journal Focus does not wrap Shift+Tab'); if (getComputedStyle($('#jf-body')).outlineStyle === 'none') throw new Error('Journal Focus lacks a visible keyboard focus indicator'); });
    await page.keyboard.press('Tab');
    await page.evaluate(() => { if (document.activeElement !== focusableElements($('#j-focus'))[0]) throw new Error('Journal Focus does not wrap Tab'); });
    await page.keyboard.press('Escape');
    await page.evaluate(() => { if ($('#j-focus') || $('#j-workspace').inert || $('#app-shell header').inert || document.activeElement.dataset.action !== 'jFocus') throw new Error('Journal Focus did not restore background/focus'); });
    await page.evaluate(() => { if (Store.get('journal')[0].body !== 'Synthetic autosaved journal edit') throw new Error('Journal autosave failed'); ui.recTab = 'box'; go('recipes'); });
    await page.locator('[data-action="recView"][data-id="fixture-recipe-0"]').click();
    await page.locator('[data-action="recEdit"][data-id="fixture-recipe-0"]').click();
    await page.locator('#modal input[name=title]').fill('Synthetic recipe edited');
    await page.locator('#modal form').evaluate(f => f.requestSubmit());
    await page.waitForFunction(() => !Modal.isOpen());
    await page.evaluate(async () => { if (recFind('fixture-recipe-0').title !== 'Synthetic recipe edited' || recFind('fixture-recipe-0').rating !== 4) throw new Error('Recipe edit lost fields'); ui.medTab = 'library'; go('media'); });
    await page.locator('#med-search').fill('UniqueMediaToken0');
    await page.waitForFunction(() => $$('#view [data-action="mediaOpen"]').length === 1 && $('#view [data-action="mediaOpen"][data-id="fixture-media-0"]'));
    await page.evaluate(() => { ui.scrTab = 'notes'; go('scripture'); });
    await page.locator('#nf-q').fill('UniqueStudyToken0');
    await page.waitForFunction(() => $$('#view [data-action="scrNoteOpen"]').length === 1 && $('#view [data-action="scrNoteOpen"][data-id="fixture-note-0"]'));
    await page.evaluate(() => { ui.nutTab = 'today'; ui.nutDate = ymd(); go('nutrition'); });
    await page.locator('[data-action="entryEdit"][data-id="fixture-entry-0"]').click();
    await page.locator('#modal input[name=cal]').fill('2100');
    await page.locator('#modal form').evaluate(f => f.requestSubmit());
    await page.evaluate(() => { if (day(ymd()).entries.find(e => e.id === 'fixture-entry-0').cal !== 2100 || day(ymd()).entries.filter(e => e.id.startsWith('mf:')).length !== 1) throw new Error('Nutrition edit lost records'); });
    await page.evaluate(async () => { await Store.flushAll(); });
    await page.reload(); await page.waitForFunction(() => typeof Store !== 'undefined' && Array.isArray(Store.data.tasks));
    await page.evaluate(async () => { if (tFind('fixture-task-0').title !== 'Synthetic task edited' || Store.get('journal').find(j => j.id === 'fixture-journal-0').body !== 'Synthetic autosaved journal edit' || recFind('fixture-recipe-0').title !== 'Synthetic recipe edited' || day(ymd()).entries.find(e => e.id === 'fixture-entry-0').cal !== 2100 || !(await Photos.get('jp_fixture_photo'))) throw new Error('Reload persistence failed'); window.__popEdits = { taskEdit: true, journalSearchAutosave: true, recipeEdit: true, mediaSearch: true, scriptureNoteSearch: true, nutritionEdit: true, reloadPersistence: true }; });
  }`]));
  console.log('Verified edits', run(['eval', '() => window.__popEdits']));
} finally { run(['close']); }
