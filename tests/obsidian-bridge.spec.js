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
