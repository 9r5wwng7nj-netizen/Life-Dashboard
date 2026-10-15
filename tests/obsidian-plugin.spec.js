// The Obsidian plugin in obsidian/plugin: its rules run in Node with a stand-in for Obsidian's module,
// and its Library pages are drawn in a browser with the theme and plugin styles.
import { test, expect } from '@playwright/test';
import Module, { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const MAIN = path.resolve('obsidian/plugin/main.js');
const fakeObsidian = () => { class Base { } return { Plugin: Base, ItemView: Base, PluginSettingTab: Base, Setting: Base, Modal: Base, SuggestModal: Base, Notice: Base, Platform: {}, TFile: Base, MarkdownView: Base, normalizePath: p => p, debounce: f => f }; };
function loadPlugin() {
  const orig = Module._load, fake = fakeObsidian();
  Module._load = function (request, ...rest) { return request === 'obsidian' ? fake : orig.call(this, request, ...rest); };
  try { delete require.cache[MAIN]; return require(MAIN); } finally { Module._load = orig; }
}
const { core } = loadPlugin();

// A small vault shaped like a PARA vault: a sermon project with its notes, a study series, people, books, Bible text.
const TODAY = '2026-10-24';
const FILES = [
  ['Projects/John 13 - October 28, 2026/John 13 - October 28, 2026.md', { type: 'project', project_kind: 'sermon', status: 'planned', preaching_date: '2026-10-28', scripture: 'John 13' }, 50],
  ['Projects/John 13 - October 28, 2026/Development.md', { type: 'sermon-development', project: '[[John 13 - October 28, 2026]]', scripture: 'John 13' }, 60],
  ['Projects/John 13 - October 28, 2026/Outline.md', { type: 'sermon-outline', project: '[[John 13 - October 28, 2026]]', status: 'done' }, 70],
  ['Projects/John 13 - October 28, 2026/Manuscript.md', { type: 'sermon', status: 'draft', date: '2026-10-28', project: '[[John 13 - October 28, 2026]]' }, 80],
  ['Projects/Connect Group/Connect Group.md', { type: 'project', status: 'active' }, 10],
  ['Projects/Connect Group/1 Cor 1.md', { type: 'study-session', status: 'done', date: '2026-10-01', scripture: '1 Corinthians 1' }, 11],
  ['Projects/Connect Group/1 Cor 2.md', { type: 'study-session', status: 'planned', date: '2026-10-29', scripture: '1 Corinthians 2' }, 12],
  ['People/Sam Rivera.md', { type: 'person' }, 5],
  ['Library/Books/The Practice of Prayer.md', { type: 'book', status: 'unread', author: 'A. Writer' }, 7],
  ['Library/Sermons/Advent 2025.md', { type: 'sermon', status: 'preached', date: '2025-12-07', scripture: 'Isaiah 9' }, 3],
  ['Library/Scripture/WEB/43 John/John 13.md', {}, 90],
  ['Inbox/Loose idea.md', {}, 40]
];
function notesFor(c, files, today) {
  const notes = files.map(([p, fm, mtime]) => { const parts = p.split('/'); return c.noteInfo({ path: p, basename: parts.pop().replace(/\.md$/, ''), folder: parts.join('/'), mtime }, fm, today); });
  const byName = new Map(notes.map(n => [n.path.split('/').pop().replace(/\.md$/, ''), n.path]));
  for (const n of notes) if (n.projectLink) n.projectPath = byName.get(n.projectLink) || null;
  return notes;
}

test('notes are sorted into shelves, projects gather their notes, and teaching due soon is "This week"', () => {
  const notes = notesFor(core, FILES, TODAY);
  const lib = core.buildLibrary(notes, { today: TODAY, ignoreFolders: ['Library/Scripture/WEB'], shelves: ['sermon', 'study', 'series', 'book', 'person'] });
  const shelf = id => (lib.shelves.find(s => s.id === id) || { items: [] }).items.map(n => n.title);
  expect(shelf('sermon')).toEqual(['John 13 - October 28, 2026', 'Advent 2025']); // the hub, not its four notes
  expect(shelf('series')).toEqual(['Connect Group']);
  expect(shelf('study')).toEqual([]); // studies live inside their series
  expect(shelf('book')).toEqual(['The Practice of Prayer']);
  expect(shelf('person')).toEqual(['Sam Rivera']);

  const hub = lib.hubs.get('Projects/John 13 - October 28, 2026/John 13 - October 28, 2026.md');
  expect(hub.members.map(m => m.title)).toEqual(['Manuscript', 'Development', 'Outline']); // dated first
  expect([hub.done, hub.total, hub.note.count]).toEqual([1, 3, 3]);
  expect(lib.working.title).toBe('John 13 - October 28, 2026');
  expect([lib.working.status, lib.working.statusLabel, lib.working.cover, lib.working.kind]).toEqual(['week', 'This week', 'John 13', 'Sermon']);
  expect(lib.byPath.get('Library/Sermons/Advent 2025.md').statusLabel).toBe('Preached');
  expect(lib.byPath.get('Projects/John 13 - October 28, 2026/Outline.md').statusLabel).toBe('Done'); // supporting notes are "Done"
  expect(lib.hubs.get('Projects/Connect Group/Connect Group.md').members.map(m => [m.title, m.statusLabel])).toEqual([['1 Cor 1', 'Taught'], ['1 Cor 2', 'This week']]);
  expect(lib.recent.map(n => n.path)).not.toContain('Library/Scripture/WEB/43 John/John 13.md');
});

test('helpers: links, dates, covers and search', () => {
  expect(core.linkTarget('[[Folder/Note|Alias]]')).toBe('Folder/Note');
  expect(core.linkTarget(['[[A]]', '[[B]]'])).toBe('A');
  expect(core.plain('[[Preaching and Teaching]]')).toBe('Preaching and Teaching');
  expect(core.isoDate('2026-10-28T09:00')).toBe('2026-10-28');
  expect(core.isoDate('next week')).toBe('');
  expect(core.coverText('John 13 - October 28, 2026', '')).toBe('John 13');
  expect(core.coverText('Anything', '[[Luke 15]]')).toBe('Luke 15');
  const notes = notesFor(core, FILES, TODAY);
  expect(core.search(notes, 'corinth', []).map(n => n.title)).toEqual(['1 Cor 2', '1 Cor 1']);
  expect(core.search(notes, 'john', ['Library/Scripture/WEB']).map(n => n.title)).toEqual(['John 13 - October 28, 2026', 'Development']); // title first, then passage
});

test('the bridge only takes well-formed messages from the dashboard’s own address', () => {
  const dash = 'https://example.github.io/Life-Dashboard/';
  const msg = m => `https://example.github.io/Life-Dashboard/index.html${core.BRIDGE_PREFIX}${encodeURIComponent(JSON.stringify(m))}`;
  expect(core.readBridge(msg({ open: 'John 13' }), dash)).toEqual({ open: 'John 13' });
  expect(core.readBridge(msg({ open: 'John 13' }).replace('example.github.io', 'evil.example'), dash)).toBeNull();
  expect(core.readBridge(msg({ create: { folder: 'Inbox', name: 'Romans 8: notes?', content: '# Hi' } }), dash)).toEqual({ create: { folder: 'Inbox', name: 'Romans 8 notes', content: '# Hi' } });
  expect(core.readBridge(msg({ create: { folder: '../outside', name: 'x', content: '' } }), dash)).toBeNull();
  expect(core.readBridge(msg({ create: { folder: '.obsidian', name: 'x', content: '' } }), dash)).toBeNull();
  expect(core.readBridge(`${dash}#ld-obsidian=%7Bbroken`, dash)).toBeNull();
  expect(core.readBridge(`${dash}#somewhere-else`, dash)).toBeNull();
});

test('New sermon makes a hub note and a manuscript that links to it, in the vault’s property names', () => {
  const s = core.sermonNotes({ passage: 'Luke 15:11-32', title: 'The Father Who Runs', date: '2026-11-08', series: 'Parables' }, TODAY);
  expect(s.folder).toBe('Luke 15 11-32 - 2026-11-08');
  expect(s.hub.content).toContain('type: project\nproject_kind: sermon\nstatus: planned');
  expect(s.hub.content).toContain('preaching_date: "2026-11-08"');
  expect(s.hub.content).toContain('scripture: "Luke 15:11-32"');
  expect(s.manuscript.content).toContain('type: sermon\nstatus: draft');
  expect(s.manuscript.content).toContain(`project: "[[${s.hub.name}]]"`);
  const fm = core.noteInfo({ path: 'x.md', basename: 'x' }, { type: 'project', project_kind: 'sermon', preaching_date: '2026-11-08' }, TODAY);
  expect(fm.family).toBe('sermon');
});

test('the Library draws on phone and desktop widths, light and dark, and its buttons open notes', async ({ page }) => {
  const css = fs.readFileSync('obsidian/theme/Life Dashboard/theme.css', 'utf8') + fs.readFileSync('obsidian/plugin/styles.css', 'utf8');
  const code = fs.readFileSync(MAIN, 'utf8');
  const shots = process.env.LDL_SHOTS; // set to a folder to save screenshots for a visual check
  for (const [w, h, theme] of [[390, 844, 'theme-light'], [1200, 900, 'theme-light'], [390, 844, 'theme-dark']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<!doctype html><html><head><style>body{margin:0;--font-interface:var(--font-interface-theme);background:var(--background-secondary);color:var(--text-normal)} ${css}</style></head><body class="${theme}"><div class="ldl-view" style="height:100vh;overflow:auto" id="v"></div></body></html>`);
    await page.evaluate(([code, files, notesForSrc, today]) => {
      const module = { exports: {} }; class Base { }
      const fake = { Plugin: Base, ItemView: Base, PluginSettingTab: Base, Setting: Base, Modal: Base, SuggestModal: Base, Notice: Base, Platform: {}, TFile: Base, MarkdownView: Base, normalizePath: p => p, debounce: f => f };
      new Function('module', 'exports', 'require', code)(module, module.exports, n => (n === 'obsidian' ? fake : null));
      const { core, render } = module.exports, notesFor = new Function('return ' + notesForSrc)();
      const lib = core.buildLibrary(notesFor(core, files, today), { today, ignoreFolders: ['Library/Scripture/WEB'], shelves: ['sermon', 'series', 'book', 'person'] });
      window.opened = []; window.page = '';
      const on = { open: p => window.opened.push(p), hub: p => { window.page = 'hub:' + p; document.getElementById('v').replaceChildren(render.hub(document, lib, p, on)); }, shelf: () => { }, home: () => { window.page = 'home'; document.getElementById('v').replaceChildren(render.home(document, lib, on, '', [])); }, search: () => { }, status: () => { } };
      on.home();
    }, [code, FILES, notesFor.toString(), TODAY]);
    await expect(page.locator('.ldl-working')).toContainText('Working on now');
    await expect(page.locator('.ldl-working')).toContainText('1 of 3 notes done');
    await expect(page.locator('.ldl-card')).toHaveCount(5);
    if (shots) await page.screenshot({ path: `${shots}/library-${w}-${theme}.png` });
    await page.locator('.ldl-card', { hasText: 'The Practice of Prayer' }).click();
    expect(await page.evaluate(() => window.opened)).toEqual(['Library/Books/The Practice of Prayer.md']);
    await page.locator('.ldl-working .ldl-btn').click(); // opens the sermon's project page
    await expect(page.locator('.ldl-band')).toContainText('John 13 - October 28, 2026');
    await expect(page.locator('.ldl-row')).toHaveCount(3);
    if (shots) await page.screenshot({ path: `${shots}/hub-${w}-${theme}.png` });
    await page.locator('.ldl-row', { hasText: 'Manuscript' }).click();
    expect(await page.evaluate(() => window.opened.at(-1))).toBe('Projects/John 13 - October 28, 2026/Manuscript.md');
  }
});
