// The app's side of the Obsidian bridge: tasks linked to notes, Send to Obsidian, and the sermon prep
// message from the Life Dashboard Library plugin. Obsidian itself is stood in for by window.LD_OBSIDIAN.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const APP = pathToFileURL(path.resolve('index.html')).href;
const PREFIX = '#ld-obsidian=';
async function open(page, { obsidian = false } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('dialog', d => d.accept());
  await page.goto(APP);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  await page.evaluate(([on, prefix]) => {
    A.helpDismiss({ dataset: { what: 'tour' } });
    window.went = []; OBS.go = url => window.went.push(url); // obsidian:// links are recorded, not followed
    if (on) { window.LD_OBSIDIAN = { vault: 'Test Vault', notes: ['Luke 15 - Manuscript', 'Leaders meeting'], prefix }; window.dispatchEvent(new Event('ld-obsidian')); }
  }, [obsidian, PREFIX]);
  return errors;
}
const lastMessage = page => page.evaluate(prefix => { const h = location.hash; return h.startsWith(prefix) ? JSON.parse(decodeURIComponent(h.slice(prefix.length))) : null; }, PREFIX);

test('[[Note]] in a task links it to an Obsidian note that opens through the plugin', async ({ page }) => {
  const errors = await open(page, { obsidian: true });
  await page.evaluate(() => go('tasks'));
  await page.fill('#nl-in', 'Write illustrations [[Luke 15 - Manuscript]] today | Practise it +1');
  await expect(page.locator('#nl-prev')).toContainText('📓 Luke 15 - Manuscript');
  await page.press('#nl-in', 'Enter');
  expect(await page.evaluate(() => TK().map(t => [t.title, t.note]))).toEqual([['Write illustrations', 'Luke 15 - Manuscript'], ['Practise it', 'Luke 15 - Manuscript']]);

  await page.locator('#view [data-action="obsOpen"]').first().click();
  expect(await lastMessage(page)).toEqual({ open: 'Luke 15 - Manuscript' });

  // The task editor shows the link, suggests note names, and clearing it removes the link.
  await page.locator('#view [data-action="taskEdit"]').first().click();
  await expect(page.locator('#task-note')).toHaveValue('Luke 15 - Manuscript');
  await expect(page.locator('#obs-notes option')).toHaveCount(2);
  await page.fill('#task-note', '');
  await page.click('#modal button:has-text("Save")');
  expect(await page.evaluate(() => 'note' in TK()[0])).toBe(false);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('outside Obsidian, notes open with an obsidian:// link once the vault name is set', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => { addTask('Read [[Romans 8]] today'); go('tasks'); });
  await page.locator('#view [data-action="obsOpen"]').first().click();
  await expect(page.locator('#toasts')).toContainText('Add your vault name');
  expect(await page.evaluate(() => window.went)).toEqual([]);

  await page.evaluate(() => { S.vaultName = 'My Vault'; saveSettings(); });
  await page.locator('#view [data-action="obsOpen"]').first().click();
  expect(await page.evaluate(() => window.went)).toEqual(['obsidian://open?vault=My%20Vault&file=Romans%208']);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Send to Obsidian creates the note: through the plugin, by obsidian:// link, or by copying', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = await open(page, { obsidian: true });
  await page.evaluate(() => { S.obsFolder = 'Inbox'; saveSettings(); });
  await page.evaluate(() => sendToObsidian('Romans 8: notes?', '# Romans 8\n\nNo condemnation.'));
  expect(await lastMessage(page)).toEqual({ create: { folder: 'Inbox', name: 'Romans 8 notes', content: '# Romans 8\n\nNo condemnation.' } });

  await page.evaluate(() => { delete window.LD_OBSIDIAN; history.replaceState(null, '', location.pathname); S.vaultName = 'My Vault'; saveSettings(); });
  await page.evaluate(() => sendToObsidian('Short note', 'Hello'));
  expect(await page.evaluate(() => window.went.at(-1))).toBe('obsidian://new?vault=My%20Vault&file=Inbox%2FShort%20note&content=Hello');
  await page.evaluate(() => sendToObsidian('Long note', 'x'.repeat(7000)));
  expect(await page.evaluate(() => window.went.at(-1))).toBe('obsidian://new?vault=My%20Vault&file=Inbox%2FLong%20note&clipboard=true');
  expect((await page.evaluate(() => navigator.clipboard.readText())).length).toBe(7000);

  await page.evaluate(() => { S.vaultName = ''; saveSettings(); window.went = []; });
  await page.evaluate(() => sendToObsidian('Copied', 'Just copy me'));
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Just copy me');
  expect(await page.evaluate(() => window.went)).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('New sermon in Obsidian adds a project and daily prep tasks, once', async ({ page }) => {
  const errors = await open(page, { obsidian: true });
  const result = await page.evaluate(() => {
    const date = addDays(ymd(), 5), msg = { sermonPrep: { passage: 'Luke 15:11-32', title: 'The Father Who Runs', date, hub: 'Luke 15 11-32 - ' + date, manuscript: 'Luke 15 11-32 - Manuscript' } };
    LD_FROM_OBSIDIAN(msg); LD_FROM_OBSIDIAN(msg); // the second is a repeat and is ignored
    const p = Store.get('projects').find(x => x.name === 'Sermon · Luke 15:11-32');
    return { date, project: p && [p.area, p.note, p.due], tasks: TK().filter(t => t.project === p.id).map(t => [t.title, t.due, t.note]) };
  });
  expect(result.project).toEqual(['ministry', `Luke 15 11-32 - ${result.date}`, result.date]);
  expect(result.tasks).toHaveLength(6); // today through the day before, then the preaching
  expect(result.tasks[0][0]).toBe('Sermon: think, pray, write');
  expect(result.tasks[0][2]).toBe('Luke 15 11-32 - Manuscript');
  expect(result.tasks.at(-1)).toEqual(['Preach: The Father Who Runs', result.date, `Luke 15 11-32 - ${result.date}`]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a message sent while the app is still loading waits for saved data', async ({ page }) => {
  await page.addInitScript(() => {
    // The plugin can call in as soon as the page is ready, before saved data has loaded.
    document.addEventListener('DOMContentLoaded', () => window.LD_FROM_OBSIDIAN({ sermonPrep: { passage: 'Psalm 23', date: '', hub: 'Psalm 23', manuscript: 'Psalm 23 - Manuscript' } }));
  });
  await open(page);
  expect(await page.evaluate(() => [Store.get('projects').some(p => p.name === 'Sermon · Psalm 23'), TK().filter(t => t.note === 'Psalm 23 - Manuscript').length])).toEqual([true, 1]);
});

test('the Library plugin builds the sermon prep message from New sermon', async () => {
  const { createRequire } = await import('node:module'), Module = (await import('node:module')).default, require = createRequire(import.meta.url);
  const MAIN = path.resolve('obsidian/plugin/main.js'), orig = Module._load; class Base { }
  Module._load = function (r, ...rest) { return r === 'obsidian' ? { Plugin: Base, ItemView: Base, PluginSettingTab: Base, Setting: Base, Modal: Base, SuggestModal: Base, Notice: Base, Platform: {}, TFile: Base, MarkdownView: Base, normalizePath: p => p, debounce: f => f } : orig.call(this, r, ...rest); };
  let core; try { delete require.cache[MAIN]; core = require(MAIN).core; } finally { Module._load = orig; }
  const v = { passage: 'Luke 15:11-32', title: 'The Father Who Runs', date: '2026-11-08' }, s = core.sermonNotes(v, '2026-10-24');
  expect(core.sermonPrepMessage(v, s)).toEqual({ sermonPrep: { passage: 'Luke 15:11-32', title: 'The Father Who Runs', date: '2026-11-08', hub: s.hub.name, manuscript: s.manuscript.name } });
});

test('action items picked in a meeting note become tasks linked to it, once', async ({ page }) => {
  const errors = await open(page, { obsidian: true });
  const tasks = await page.evaluate(() => {
    const msg = { addTasks: { source: 'Leaders meeting', area: 'Ministry', items: [{ title: 'Email the team about the retreat tomorrow', waiting: false }, { title: 'Hear back from Sam about the budget', waiting: true }] } };
    LD_FROM_OBSIDIAN(msg); LD_FROM_OBSIDIAN(msg); // sending again adds nothing
    return TK().map(t => [t.title, t.note, t.area, t.due === addDays(ymd(), 1), !!t.waiting]);
  });
  expect(tasks).toEqual([['Email the team about the retreat', 'Leaders meeting', 'ministry', true, false], ['Hear back from Sam about the budget', 'Leaders meeting', 'ministry', false, true]]);
  await expect(page.locator('#toasts')).toContainText('Those are already in Tasks');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the plugin can ask for a person’s follow-ups, add one, and complete one', async ({ page }) => {
  const errors = await open(page, { obsidian: true });
  const r = await page.evaluate(() => {
    const t = (title, extra) => ({ id: title, title, notes: '', status: 'todo', priority: 'med', tags: [], created: new Date().toISOString(), ...extra });
    Store.set('tasks', [t('Coffee', { person: 'Sam', due: addDays(ymd(), -1) }), t('Budget reply', { person: 'sam rivera', waiting: true, waitSince: ymd() }), t('From the note', { note: 'Sam Rivera' }),
      t('Old chat', { person: 'Sam', status: 'done', completedAt: new Date(2026, 8, 1).toISOString() }), t('Someone else', { person: 'Jo' })]);
    const ask = () => LD_QUERY({ personTasks: { names: ['Sam Rivera', 'Sam'], note: 'Sam Rivera' } });
    const before = ask();
    LD_FROM_OBSIDIAN({ addTasks: { source: 'Sam Rivera', items: [{ title: 'Pray with him tomorrow', person: 'Sam Rivera' }] } });
    LD_FROM_OBSIDIAN({ completeTask: 'Coffee' });
    return { before, after: ask(), added: TK().find(x => x.title === 'Pray with him')?.person };
  });
  expect(r.before.open.map(t => [t.title, t.overdue, t.waiting])).toEqual([['Coffee', true, false], ['Budget reply', false, true], ['From the note', false, false]]);
  expect(r.before.last).toBe('2026-09-01');
  expect(r.after.open.map(t => t.title)).toEqual(['Pray with him', 'Budget reply', 'From the note']); // dated first
  expect(r.added).toBe('Sam Rivera');
  expect(await page.evaluate(() => { obsInbox.ready = false; const a = LD_QUERY({ personTasks: { names: ['Sam'] } }); obsInbox.ready = true; return a; })).toBeNull();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('@Name links a task to a person; day words after @ stay dates', async ({ page }) => {
  const errors = await open(page);
  const r = await page.evaluate(() => {
    const p = s => { const x = parseTaskInput(s); return [x.title, x.person, x.atPerson, x.due]; };
    const fri = parseTaskInput('call @fri').due, tmr = addDays(ymd(), 1);
    return { tmr, fri, a: p('Coffee with @Sam tomorrow'), b: p('call @fri'), c: p('Lunch @Sam Rivera'), d: p('Text @sam Tomorrow'), e: p('Visit @Sunny'), h: p('Call @dwayne conner tomorrow'), f: p('email me@example.com'), g: p('Ask @sam about the budget') };
  });
  expect(r.a).toEqual(['Coffee with Sam', 'Sam', true, r.tmr]); // the name stays in the title
  expect(r.b).toEqual(['call', null, false, r.fri]);
  expect(r.c).toEqual(['Lunch Sam Rivera', 'Sam Rivera', true, null]);
  expect(r.d).toEqual(['Text Sam', 'Sam', true, r.tmr]); // a day after the name is still the date
  expect(r.e).toEqual(['Visit Sunny', 'Sunny', true, null]); // a name that starts like "sun" is a name
  expect(r.f[1]).toBeNull();
  expect([r.h[0], r.h[1]]).toEqual(['Call Dwayne conner', 'Dwayne']); // with no profile yet, a lowercase second word stays a plain word
  expect(r.g).toEqual(['Ask Sam about the budget', 'Sam', true, null]); // a lowercase word after the name is not a surname
  expect(errors, errors.join('\n')).toEqual([]);
});

test('@Name finds the existing profile, and asks Obsidian to create missing ones (also for tasks added elsewhere)', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => addTask('Pray for @Jo today')); // added outside Obsidian (e.g. on the phone)
  expect(await page.evaluate(() => TK()[0].personAt)).toBe(true);
  await page.evaluate(prefix => { window.LD_OBSIDIAN = { notes: [], people: ['Sam Rivera', 'Ana Lee', 'Ana Cruz'], prefix }; window.dispatchEvent(new Event('ld-obsidian')); }, PREFIX);
  await expect.poll(() => lastMessage(page)).toEqual({ people: ['Jo'] });
  expect(await page.evaluate(() => 'personAt' in TK()[0])).toBe(false);
  const known = await page.evaluate(() => { LD_OBSIDIAN.people.push('Dwayne Conner'); const x = parseTaskInput('Call @dwayne conner tomorrow'); return [x.title, x.person]; });
  expect(known).toEqual(['Call Dwayne Conner', 'Dwayne Conner']); // a profile that exists: full name, kept in the title
  const names = await page.evaluate(() => ['@sam', '@Ana', '@ana cruz'].map(x => parseTaskInput('Hi ' + x).person));
  expect(names).toEqual(['Sam Rivera', 'Ana', 'Ana Cruz']); // a unique first name finds the profile; two Anas stay as typed
  await page.evaluate(() => { history.replaceState(null, '', location.pathname); addTask('Thank @Sam today'); });
  await page.waitForTimeout(500);
  expect(await lastMessage(page)).toBeNull(); // Sam Rivera already has a profile
  expect(await page.evaluate(() => TK().find(t => t.title === 'Thank Sam').person)).toBe('Sam Rivera'); // shown as typed, linked to the full profile
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Open in reader from Obsidian opens the Bible reader at that passage', async ({ page }) => {
  const errors = await open(page, { obsidian: true });
  const r = await page.evaluate(() => { LD_FROM_OBSIDIAN({ openPassage: 'John 13:1–17' }); return { view: S.view, tab: ui.scrTab, book: BOOKS[ui.rd.b][0], c: ui.rd.c, focus: ui.rd.focus }; });
  expect(r).toEqual({ view: 'scripture', tab: 'read', book: 'John', c: 13, focus: [1, 17] });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the plugin can ask for the week’s numbers for the weekly review', async ({ page }) => {
  const errors = await open(page, { obsidian: true });
  const r = await page.evaluate(() => {
    const mon = startOfWeek(), last = addDays(mon, -7), at = (d, h) => new Date(`${d}T${h}:00`).toISOString();
    const t = (id, extra) => ({ id, title: id, notes: '', status: 'todo', priority: 'med', tags: [], created: at(last, '08'), ...extra });
    Store.set('workouts', [{ id: 'w1', name: 'Push', start: at(addDays(last, 1), '07'), exercises: [] }, { id: 'w2', name: 'Pull', start: at(addDays(last, 3), '07'), exercises: [] }, { id: 'w3', name: 'Old', start: at(addDays(last, -3), '07'), exercises: [] }]);
    Store.set('tasks', [t('Done A', { status: 'done', completedAt: at(addDays(last, 2), '10') }), t('Done B', { status: 'done', completedAt: at(addDays(last, 5), '10') }), t('Late', { due: addDays(ymd(), -2) }), t('Loose')]);
    Store.set('readingPlans', [{ id: 'rp', name: 'Plan', start: last, done: { 0: last, 1: addDays(last, 1), 2: addDays(last, 4), 3: addDays(last, -1) } }]);
    Store.set('journal', [{ id: 'j1', date: addDays(last, 2), body: 'x' }]);
    const k = tkit(); k.weeks[last] = { big3: ['Done A', 'Late'] }; Store.save('tkit');
    return LD_QUERY({ weekStats: { monday: mon } });
  });
  expect(r.weeks[0]).toMatchObject({ workouts: 2, tasksDone: 2, readingDays: 3, journal: 1 });
  expect(r.weeks[1]).toMatchObject({ workouts: 1, readingDays: 1 });
  expect(r.big3).toEqual([{ title: 'Done A', done: true }, { title: 'Late', done: false }]);
  expect([r.overdue, r.familyReview]).toEqual([1, false]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('items sent from the phone: a task dated from the day it was said, a weight, a prayer, each taken in once', async ({ page }) => {
  const errors = await open(page, { obsidian: true });
  const r = await page.evaluate(() => {
    S.unit = 'lbs';
    const yesterday = addDays(ymd(), -1), send = m => LD_FROM_OBSIDIAN({ phone: m });
    const ok = [
      send({ id: '1 task', what: 'task', text: 'Call the plumber tomorrow at 3', date: yesterday }),
      send({ id: '1 task', what: 'task', text: 'Call the plumber tomorrow at 3', date: yesterday }), // delivered twice
      send({ id: '2 weight', what: 'weight', text: '182.4', date: ymd() }),
      send({ id: '3 weight', what: 'weight', text: '80 kg', date: yesterday }),
      send({ id: '4 prayer', what: 'prayer', text: 'Sam’s surgery on Friday', date: ymd() }),
      send({ id: '5 odd', what: 'nonsense', text: 'x', date: ymd() })
    ];
    const N = Store.get('nutrition');
    return { ok, tasks: TK().map(t => [t.title, t.due, t.time]), today: round(toUnit(N[ymd()].weight), 1), yesterdayKg: round(N[yesterday].weight, 1),
      prayers: Store.get('prayers').map(p => p.title), seen: JSON.parse(localStorage.getItem('ld.phoneSeen')), dateIsReal: new Date().getDate() === new (window.Date)().getDate() };
  });
  expect(r.ok).toEqual([true, true, true, true, true, true]);
  // Said yesterday: "tomorrow" is today, not tomorrow.
  expect(r.tasks).toEqual([['Call the plumber', await page.evaluate(() => ymd()), '15:00']]);
  expect([r.today, r.yesterdayKg]).toEqual([182.4, 80]);
  expect(r.prayers).toEqual(['Sam’s surgery on Friday']);
  expect(r.seen).toEqual(['1 task', '2 weight', '3 weight', '4 prayer']);
  expect(await page.evaluate(() => Date.name)).toBe('Date'); // the real clock is back

  // Before saved data has loaded, a phone item is refused so the plugin keeps its note.
  expect(await page.evaluate(() => { obsInbox.ready = false; const a = LD_FROM_OBSIDIAN({ phone: { id: '6', what: 'task', text: 'Later' } }); obsInbox.ready = true; return a; })).toBe(false);
  expect(errors, errors.join('\n')).toEqual([]);
});
