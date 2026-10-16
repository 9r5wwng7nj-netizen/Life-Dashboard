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
  ['Library/Sermons/A Very Long Sermon Title That Wraps.md', { type: 'sermon', status: 'preached', date: '2025-11-02', scripture: 'Second Thessalonians Chapters One Through Three' }, 4],
  ['Library/Scripture/WEB/43 John/John 13.md', {}, 90],
  ['Library/Historical Theology/Confessions/Confessions.md', { type: 'work-index', author: 'Augustine' }, 2],
  ['Library/Historical Theology/Confessions/Book 1.md', { type: 'historical-text' }, 1],
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
  expect(shelf('sermon')).toEqual(['John 13 - October 28, 2026', 'Advent 2025', 'A Very Long Sermon Title That Wraps']); // the hub, not its four notes
  expect(shelf('series')).toEqual(['Connect Group']);
  expect(shelf('study')).toEqual([]); // studies live inside their series
  expect(shelf('book')).toEqual(['The Practice of Prayer']);
  expect(shelf('person')).toEqual(['Sam Rivera']);
  const all = core.buildLibrary(notes, { today: TODAY, ignoreFolders: [] });
  expect(all.shelves.find(s => s.id === 'classic').items.map(n => n.title)).toEqual(['Confessions']); // the work, not its chapters
  expect(all.shelves.some(s => s.items.some(n => n.title === 'Book 1'))).toBe(false);

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
    await page.setContent(`<!doctype html><html><head><style>body{margin:0;--font-interface:var(--font-interface-theme);background:var(--background-secondary);color:var(--text-normal)} button:not(.clickable-icon){display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;height:30px;padding:4px 12px;cursor:pointer} ${css}</style></head><body class="${theme}"><div class="ldl-view" style="height:100vh;overflow:auto" id="v"></div></body></html>`);
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
    await expect(page.locator('.ldl-card')).toHaveCount(6);
    // Even under Obsidian's button rule: covers in a shelf start level, and long titles stay inside their cover.
    const tops = await page.locator('.ldl-section').first().locator('.ldl-cover').evaluateAll(cs => cs.map(c => Math.round(c.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    expect(await page.locator('.ldl-cover-title').evaluateAll(ts => ts.every(t => t.scrollWidth <= t.parentElement.clientWidth))).toBe(true);
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

test('a meeting’s open action items are found under action and follow-up headings', () => {
  const md = ['---', 'type: meeting-review', 'areas: ["[[Ministry]]"]', '---', '# Leaders meeting', '## Notes', '- [ ] not an action (wrong section)',
    '## Action items', '- [ ] Email the team about Friday #ministry', '- [x] Already done', '* [ ] Book the room ^abc123', '',
    '## Follow-ups and waiting items', '- [ ] Hear back from Sam about the budget', '## Decisions', '- [ ] stray'].join('\n');
  expect(core.actionItems(md)).toEqual([
    { text: 'Email the team about Friday #ministry', section: 'Action items', waiting: false },
    { text: 'Book the room', section: 'Action items', waiting: false },
    { text: 'Hear back from Sam about the budget', section: 'Follow-ups and waiting items', waiting: true }
  ]);
  expect(core.meetingTasksMessage('Leaders meeting', core.actionItems(md).slice(1), ['[[Ministry]]'])).toEqual({ addTasks: { source: 'Leaders meeting', area: 'Ministry', items: [{ title: 'Book the room', waiting: false }, { title: 'Hear back from Sam about the budget', waiting: true }] } });
});

test('plain bullets, Granola’s bold items with details, and review callouts are read the way meeting notes write them', () => {
  const md = ['---', 'type: meeting-source', '---', '### Action Items', '- **Draft the retreat schedule**', '  Due ~2 weeks; check with [[Sam Rivera|Sam]] and (maybe) Jo.', '- **Book the venue**', '  - call twice', '',
    '## Action items', '> [!note] How these were sorted', '> Only mine are listed.', '- Send the budget to [[Finance Team]] by friday', '- [x] Already handled', '',
    '## Follow-ups and waiting items', '- Hear back about the date \\~ soon'].join('\n');
  expect(core.actionItems(md)).toEqual([
    { text: 'Draft the retreat schedule (Due ~2 weeks; check with Sam and maybe Jo.)', section: 'Action Items', waiting: false },
    { text: 'Book the venue (call twice)', section: 'Action Items', waiting: false },
    { text: 'Send the budget to Finance Team by friday', section: 'Action items', waiting: false },
    { text: 'Hear back about the date ~ soon', section: 'Follow-ups and waiting items', waiting: true }
  ]);
});

test('a person’s names and their follow-ups box', async ({ page }) => {
  expect(core.personNames('Sam Rivera', { aliases: ['Sammy'] })).toEqual(['Sam Rivera', 'Sam', 'Sammy']);
  const code = fs.readFileSync(MAIN, 'utf8');
  await page.setContent('<!doctype html><html><body><div id="v"></div></body></html>');
  const out = await page.evaluate(code => {
    const module = { exports: {} }; class Base { }
    const fake = { Plugin: Base, ItemView: Base, PluginSettingTab: Base, Setting: Base, Modal: Base, SuggestModal: Base, Notice: Base, Platform: {}, TFile: Base, MarkdownView: Base, normalizePath: p => p, debounce: f => f };
    new Function('module', 'exports', 'require', code)(module, module.exports, n => (n === 'obsidian' ? fake : null));
    const { render } = module.exports, calls = [], on = { openDashboard: () => calls.push('open'), complete: id => calls.push('done:' + id), addFollowUp: t => calls.push('add:' + t) };
    const v = document.getElementById('v');
    v.append(render.followUps(document, null, on));
    v.querySelector('button').click();
    v.replaceChildren(render.followUps(document, { open: [{ id: 'a', title: 'Coffee', due: '2026-10-14', overdue: true }, { id: 'b', title: 'Budget reply', waiting: true, waitSince: '2026-10-15' }], last: '2026-09-01', today: '2026-10-15' }, on));
    const text = v.textContent;
    v.querySelector('input[type=checkbox]').click();
    const input = v.querySelector('.ldl-fu-add input'); input.value = 'Pray tomorrow'; v.querySelector('.ldl-fu-add').requestSubmit();
    return { calls, text };
  }, code);
  expect(out.calls).toEqual(['open', 'done:a', 'add:Pray tomorrow']);
  expect(out.text).toContain('Last finished');
  expect(out.text).toContain('Overdue');
  expect(out.text).toContain('Waiting since');
});

test('new people: the bridge message and the profile made from the Person template', () => {
  const dash = 'https://example.github.io/Life-Dashboard/', msg = m => `${dash}${core.BRIDGE_PREFIX}${encodeURIComponent(JSON.stringify(m))}`;
  expect(core.readBridge(msg({ people: ['Jo', 'Sam: Rivera', '', 'Jo'] }), dash)).toEqual({ people: ['Jo', 'Sam Rivera'] });
  expect(core.readBridge(msg({ people: [] }), dash)).toBeNull();
  const tpl = '---\ntype: person\ncreated: "{{date:YYYY-MM-DD}}"\nroles: []\n---\n\n# {{title}}\n\n## Follow-up\n';
  expect(core.personNote('Jo Park', tpl, '2026-10-15')).toBe('---\ntype: person\ncreated: "2026-10-15"\nroles: []\n---\n\n# Jo Park\n\n## Follow-up\n');
  expect(core.personNote('Jo Park', '', '2026-10-15')).toContain('type: person');
});

test('a person’s title card: initials on the cover, roles and last contact, no status button', async ({ page }) => {
  const css = fs.readFileSync('obsidian/theme/Life Dashboard/theme.css', 'utf8') + fs.readFileSync('obsidian/plugin/styles.css', 'utf8'), code = fs.readFileSync(MAIN, 'utf8');
  await page.setViewportSize({ width: 700, height: 300 });
  await page.setContent(`<!doctype html><html><head><style>body{margin:0;padding:20px;--font-interface:var(--font-interface-theme);background:var(--background-primary);color:var(--text-normal)} button:not(.clickable-icon){display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;height:30px;padding:4px 12px} ${css}</style></head><body class="theme-dark"><div id="v"></div></body></html>`);
  const out = await page.evaluate(code => {
    const module = { exports: {} }; class Base { }
    const fake = { Plugin: Base, ItemView: Base, PluginSettingTab: Base, Setting: Base, Modal: Base, SuggestModal: Base, Notice: Base, Platform: {}, TFile: Base, MarkdownView: Base, normalizePath: p => p, debounce: f => f };
    new Function('module', 'exports', 'require', code)(module, module.exports, n => (n === 'obsidian' ? fake : null));
    const { core, render } = module.exports;
    const n = core.noteInfo({ path: 'People/Dwayne Conner.md', basename: 'Dwayne Conner' }, { type: 'person', roles: ['Family', 'Mentor'], last_contact: '2026-10-01' }, '2026-10-15');
    const card = render.titleCard(document, n, null, { status: () => { }, hub: () => { } });
    document.getElementById('v').append(card);
    return { cover: card.querySelector('.ldl-cover-title').textContent, meta: card.querySelector('.ldl-titlecard-meta').textContent, chips: card.querySelectorAll('.ldl-chip').length, fits: [...card.querySelectorAll('.ldl-cover-title')].every(t => t.scrollWidth <= t.parentElement.clientWidth) };
  }, code);
  expect(out.cover).toBe('DC');
  expect(out.meta).toMatch(/^Family, Mentor · Last contact Oct 1/);
  expect(out.chips).toBe(0);
  expect(out.fits).toBe(true);
  if (process.env.LDL_SHOTS) await page.screenshot({ path: `${process.env.LDL_SHOTS}/person-card.png` });
});

test('taught record: entries, groups, passages, the record page and “taught before”', async ({ page }) => {
  expect(core.parseTaught(['2026-09-03 — Connect Group', '2026-10-28 - College Night', 'nonsense'])).toEqual([{ date: '2026-10-28', group: 'College Night' }, { date: '2026-09-03', group: 'Connect Group' }]);
  expect(core.parseGroups(['CCLE', 'Freshman Bible Study (inactive)', ''])).toEqual([{ name: 'CCLE', active: true }, { name: 'Freshman Bible Study', active: false }]);
  expect([core.scriptureKey('John 13:1-17'), core.scriptureKey('[[John 13]]'), core.scriptureKey('1 Corinthians 8-10'), core.scriptureKey('1 Cor 8'), core.scriptureKey('')]).toEqual(['joh 13', 'joh 13', '1cor 8', '1cor 8', '']);
  const today = '2026-10-24', mk = (p, fm) => { const parts = p.split('/'); return core.noteInfo({ path: p, basename: parts.pop().replace(/\.md$/, ''), folder: parts.join('/'), mtime: 1 }, fm, today); };
  const notes = [
    mk('Sermons/Servant King.md', { type: 'sermon', status: 'preached', date: '2025-03-02', scripture: 'John 13:1-17', taught: ['2025-03-02 — College Night'] }),
    mk('Studies/Foot washing.md', { type: 'study-session', status: 'taught', date: '2026-09-10', scripture: 'John 13', taught: ['2026-09-10 — Connect Group', '2026-09-24 — Freshman Bible Study'] }),
    mk('Sermons/New one.md', { type: 'sermon', status: 'draft', date: '2026-10-28', scripture: 'John 13' }),
    mk('Sermons/Old sermon.md', { type: 'sermon', status: 'preached', date: '2024-05-05', scripture: 'Romans 8' }),
    mk('Sermons/Outline.md', { type: 'sermon-outline', status: 'done', date: '2024-05-01' }),
    mk('Sermons/Undated sermon.md', { type: 'sermon', status: 'preached' })
  ];
  const rec = core.teachingRecord(notes, ['CCLE', 'Connect Group', 'College Night', 'Freshman Bible Study (inactive)'], []);
  expect(rec.groups.map(g => [g.name, g.active, g.items.map(i => i.note.title)])).toEqual([['CCLE', true, []], ['Connect Group', true, ['Foot washing']], ['College Night', true, ['Servant King']], ['Freshman Bible Study', false, ['Foot washing']]]);
  expect(rec.unrecorded.map(n => n.title)).toEqual(['Old sermon', 'Undated sermon']); // finished but no group (undated last); outlines don't count
  expect(rec.total).toBe(3);
  expect(core.taughtBefore(notes[2], notes).map(t => [t.note.title, t.date, t.group])).toEqual([['Foot washing', '2026-09-24', 'Freshman Bible Study'], ['Foot washing', '2026-09-10', 'Connect Group'], ['Servant King', '2025-03-02', 'College Night']]);

  const code = fs.readFileSync(MAIN, 'utf8');
  await page.setContent('<!doctype html><html><body><div id="v"></div><div id="c"></div></body></html>');
  const out = await page.evaluate(([code, recJson, noteJson, beforeJson]) => {
    const module = { exports: {} }; class Base { }
    const fake = { Plugin: Base, ItemView: Base, PluginSettingTab: Base, Setting: Base, Modal: Base, SuggestModal: Base, Notice: Base, Platform: {}, TFile: Base, MarkdownView: Base, normalizePath: p => p, debounce: f => f };
    new Function('module', 'exports', 'require', code)(module, module.exports, n => (n === 'obsidian' ? fake : null));
    const { render } = module.exports, calls = [], on = { home: () => { }, open: p => calls.push('open:' + p), markTaught: p => calls.push('mark:' + p), status: () => { }, hub: () => { }, taughtBefore: () => beforeJson };
    const v = document.getElementById('v'); v.append(render.taught(document, recJson, '2026-10-24', on));
    const headings = [...v.querySelectorAll('h2')].map(h => h.textContent);
    v.querySelector('.ldl-row-static button').click();
    const card = render.titleCard(document, noteJson, null, on); document.getElementById('c').append(card);
    card.querySelector('.ldl-titlecard-before button').click();
    [...card.querySelectorAll('button')].find(b => b.textContent === 'Mark taught').click();
    return { headings, resting: v.textContent.includes('Not teaching right now'), before: card.querySelector('.ldl-titlecard-before').textContent, calls };
  }, [code, JSON.parse(JSON.stringify(rec)), JSON.parse(JSON.stringify(notes[2])), JSON.parse(JSON.stringify(core.taughtBefore(notes[2], notes)))]);
  expect(out.headings).toEqual(['CCLE', 'Connect Group', 'College Night', 'Freshman Bible Study', 'Taught, group not recorded']);
  expect(out.resting).toBe(true);
  expect(out.before).toContain('You’ve taught John 13 before');
  expect(out.calls).toEqual(['mark:Sermons/Old sermon.md', 'open:Studies/Foot washing.md', 'mark:Sermons/New one.md']);
});

test('the Library leaves out a quick action that has no handler (e.g. Today’s note with daily notes off)', async ({ page }) => {
  const code = fs.readFileSync(MAIN, 'utf8');
  await page.setContent('<!doctype html><html><body><div id="v"></div></body></html>');
  const labels = await page.evaluate(code => {
    const module = { exports: {} }; class Base { }
    const fake = { Plugin: Base, ItemView: Base, PluginSettingTab: Base, Setting: Base, Modal: Base, SuggestModal: Base, Notice: Base, Platform: {}, TFile: Base, MarkdownView: Base, normalizePath: p => p, debounce: f => f };
    new Function('module', 'exports', 'require', code)(module, module.exports, n => (n === 'obsidian' ? fake : null));
    const { core, render } = module.exports, lib = Object.assign(core.buildLibrary([], { today: '2026-10-15' }), { inbox: '01 Inbox' }), noop = () => { };
    const on = { open: noop, hub: noop, shelf: noop, home: noop, search: noop, status: noop, folder: noop, newNote: noop, newSermon: noop, today: undefined };
    document.getElementById('v').append(render.home(document, lib, on, '', []));
    return [...document.querySelectorAll('.ldl-actions button')].map(b => b.textContent);
  }, code);
  expect(labels).toEqual(['New note', 'New sermon']);
});

test('Bible references are found the way people write them, and ordinary words are left alone', () => {
  const refs = t => core.findRefs(t).map(r => r.label);
  expect(refs('Read John 13:1-17 and Rom 8:28, then Ps 23 and 1 Cor 13.')).toEqual(['John 13:1–17', 'Romans 8:28', 'Psalm 23', '1 Corinthians 13']);
  expect(refs('First John 4:8; II Timothy 3:16-17; Song of Songs 2; Jude 3; Gen. 1')).toEqual(['1 John 4:8', '2 Timothy 3:16–17', 'Song of Solomon 2', 'Jude 3', 'Genesis 1']);
  expect(refs('John 13-14 and Phil 4:13')).toEqual(['John 13–14', 'Philippians 4:13']);
  expect(refs('mark 5 boxes; Is 4 enough? The job 3 times; Johnny 3; Acts')).toEqual([]);
  const j = core.findRefs('see John 3:16 now')[0];
  expect([j.book, j.c, j.v1, j.v2, j.start, j.end]).toEqual(['John', 3, 16, 16, 4, 13]);
  expect(core.parseRefText('rom 8:28').label).toBe('Romans 8:28'); // typed into a box, lowercase is fine
});

test('verses come out of a chapter note, and a passage becomes a quote', () => {
  const md = '---\ntype: scripture\n---\n\n# John 13\n\n[[John 12 (WEB)|John 12]]\n\n### 1\nNow before the feast. ^v1\n\n### 2\nDuring supper, ^v2\n\n### 3\nJesus, knowing ^v3\n';
  const verses = core.chapterVerses(md);
  expect(verses).toEqual([[1, 'Now before the feast.'], [2, 'During supper,'], [3, 'Jesus, knowing']]);
  const r = core.findRefs('John 13:2-3')[0];
  expect(core.versesFor(verses, r)).toEqual([[2, 'During supper,'], [3, 'Jesus, knowing']]);
  expect(core.passageCallout(r, core.versesFor(verses, r), 'WEB')).toBe('> [!quote] John 13:2–3 (WEB)\n> **2** During supper,\n> **3** Jesus, knowing\n');
  expect(core.passageNoteText('John', 13, '2026-10-15')).toContain('type: scripture-note\ncreated: 2026-10-15\nscripture: "John 13"\nbook: John\ntestament: New Testament');
});

test('the verse preview card shows the verses and its actions', async ({ page }) => {
  const code = fs.readFileSync(MAIN, 'utf8'), css = fs.readFileSync('obsidian/theme/Life Dashboard/theme.css', 'utf8') + fs.readFileSync('obsidian/plugin/styles.css', 'utf8');
  await page.setContent(`<!doctype html><html><head><style>body{--font-interface:var(--font-interface-theme)} ${css}</style></head><body class="theme-dark"></body></html>`);
  const out = await page.evaluate(code => {
    const module = { exports: {} }; class Base { }
    const fake = { Plugin: Base, ItemView: Base, PluginSettingTab: Base, Setting: Base, Modal: Base, SuggestModal: Base, Notice: Base, Platform: {}, TFile: Base, MarkdownView: Base, normalizePath: p => p, debounce: f => f };
    new Function('module', 'exports', 'require', code)(module, module.exports, n => (n === 'obsidian' ? fake : null));
    const calls = [], pop = module.exports.render.versePreview(document, { label: 'John 13:1–2', translation: 'WEB', verses: [[1, 'Now before the feast.'], [2, 'During supper,']], more: 3 }, { reader: () => calls.push('reader'), note: () => calls.push('note'), chapter: () => calls.push('chapter') });
    document.body.append(pop); pop.style.left = '8px'; pop.style.top = '8px';
    [...pop.querySelectorAll('button')].forEach(b => b.click());
    return { text: pop.textContent, calls, buttons: [...pop.querySelectorAll('button')].map(b => b.textContent) };
  }, code);
  expect(out.text).toContain('1 Now before the feast.');
  expect(out.text).toContain('3 more verses');
  expect(out.buttons).toEqual(['Open in reader', 'Passage note', 'Read the chapter']);
  expect(out.calls).toEqual(['reader', 'note', 'chapter']);
  if (process.env.LDL_SHOTS) await page.screenshot({ path: `${process.env.LDL_SHOTS}/verse-preview.png`, clip: { x: 0, y: 0, width: 440, height: 260 } });
});

test('the weekly review: the week, the filled-in top, and a refresh that keeps your writing', () => {
  expect([core.weekOf('2026-10-15'), core.weekOf('2026-10-12'), core.weekOf('2026-10-18')]).toEqual(['2026-10-12', '2026-10-12', '2026-10-12']);
  const base = { monday: '2026-10-19', today: '2026-10-19', meetings: [{ title: 'Leaders meeting', date: '2026-10-13' }], inboxNotes: ['Idea'], inboxMore: 0,
    teaching: [{ title: 'John 13 - October 28, 2026', scripture: 'John 13', date: '2026-10-21', statusLabel: 'This week' }], people: [{ title: 'Sam Rivera', nextContact: '2026-10-17' }], projects: [{ title: 'Experiencing God', statusLabel: 'Active', count: 6 }], updated: 'Mon 9:00' };
  const stats = { weeks: [{ from: '2026-10-12', to: '2026-10-18', workouts: 4, tasksDone: 23, readingDays: 6, journal: 3, weight: '182.4 lbs', weightChange: '−0.8 lbs' }, { from: '2026-10-05', to: '2026-10-11', workouts: 3, tasksDone: 18, readingDays: 5, journal: 2, weight: '183.2 lbs', weightChange: null }],
    big3: [{ title: 'Outline John 13', done: true }, { title: 'Call Sam', done: false }], nextBig3: [], familyReview: false, overdue: 2, dueThisWeek: 9, inbox: 4 };
  const withStats = core.weeklyAuto({ ...base, stats });
  expect(withStats).toContain('| Workouts | 4 | 3 |');
  expect(withStats).toContain('| Bible reading | 6 of 7 days | 5 of 7 days |');
  expect(withStats).toContain('| Weight trend | 182.4 lbs (−0.8 lbs) | 183.2 lbs |');
  expect(withStats).toContain('**Last week’s Big 3:** ✓ Outline John 13 · ○ Call Sam');
  expect(withStats).toContain('**Right now:** 2 overdue · 9 due this week · 4 in the dashboard Inbox');
  expect(withStats).toContain('- [[John 13 - October 28, 2026]] · John 13 · ');
  expect(withStats).toContain('- [[Sam Rivera]] · overdue since ');
  expect(withStats).not.toContain('- [ ]'); // no checkboxes: the dashboard is the only to-do list
  const note = core.weeklyNote({ ...base, stats: null });
  expect(note).toMatch(/^---\ntype: review\nreview_kind: weekly\nstatus: open\ndate: "2026-10-19"/);
  expect(note).toContain('run **Refresh the weekly review** there');
  const written = note.replace('### What went well?\n', '### What went well?\nA good week of teaching.\n');
  const refreshed = core.replaceAuto(written, withStats);
  expect(refreshed).toContain('A good week of teaching.');
  expect(refreshed).toContain('| Workouts | 4 | 3 |');
  expect(refreshed.split(core.AUTO_START).length).toBe(2); // one top section, not two
});

test('filing: rules, project folders first, and nothing moves that is already in place', () => {
  const rules = core.parseRules(['person: 04 People', 'meeting-review → 05 Meetings/Reviews', 'project: 02 Projects/{title}', 'review: 01 Inbox/Reviews/Weekly/{year}', 'nonsense line']);
  expect(rules.map(r => r.type)).toEqual(['person', 'meeting-review', 'project', 'review']);
  const n = (title, fm, folder = '01 Inbox') => ({ ...core.noteInfo({ path: `${folder}/${title}.md`, basename: title, folder }, fm, '2026-10-15') });
  expect(core.fileTarget(n('Sam Rivera', { type: 'person' }), rules)).toBe('04 People');
  expect(core.fileTarget(n('Sam Rivera', { type: 'person' }, '04 People'), rules)).toBeNull(); // already there
  expect(core.fileTarget(n('Retreat: Fall?', { type: 'project' }), rules)).toBe('02 Projects/Retreat Fall'); // {title}, made safe
  expect(core.fileTarget(n('Week', { type: 'review', date: '2026-10-12' }), rules)).toBe('01 Inbox/Reviews/Weekly/2026');
  expect(core.fileTarget(n('Leaders', { type: 'meeting-review', date: '2026-08-04' }), core.parseRules(['meeting-review: 05 Meetings/Reviews/{year}/{month}']))).toBe('05 Meetings/Reviews/2026/08');
  const outline = { ...n('Outline', { type: 'sermon-outline', project: '[[John 13]]' }), projectPath: '02 Projects/John 13/John 13.md' };
  expect(core.fileTarget(outline, rules, { hubFolder: '02 Projects/John 13' })).toBe('02 Projects/John 13'); // follows its project
  expect(core.fileTarget(n('Loose thought', {}), rules)).toBeNull(); // no type, no move
});

test('a project note’s contents list, added once and refreshed in place', () => {
  const today = '2026-10-15', mk = (title, fm) => core.noteInfo({ path: `P/${title}.md`, basename: title, folder: 'P' }, fm, today);
  const members = [mk('Outline', { type: 'sermon-outline', status: 'done', date: '2026-10-20', scripture: 'John 13' }), mk('Manuscript', { type: 'sermon', status: 'preached', date: '2026-10-28', taught: ['2026-10-28 — College Night'] })];
  const block = core.contentsBlock(members, today);
  expect(block).toContain('1. [[Outline]] · John 13 · Oct 20 · Done');
  expect(block).toContain('2. [[Manuscript]] · Oct 28 · Preached · taught Oct 28 (College Night)');
  const note = '---\ntype: project\n---\n\n# John 13\n\nMy notes.\n';
  const once = core.setContents(note, block), twice = core.setContents(once, core.contentsBlock(members.slice(0, 1), today));
  expect(once).toContain('My notes.\n\n<!-- life-dashboard:contents -->');
  expect(twice.split(core.CONTENTS_START).length).toBe(2);
  expect(twice).not.toContain('[[Manuscript]]');
  expect(twice).toContain('My notes.');
});

// A small library shaped like the vault: a work with parts, an author's own writings, a folder book, and meetings.
function bookFixture() {
  const today = '2026-10-15', mk = (p, fm) => { const parts = p.split('/'); return core.noteInfo({ path: p, basename: parts.pop().replace(/\.md$/, ''), folder: parts.join('/'), mtime: 1 }, fm, today); };
  const notes = [
    mk('HT/Scholastic/Scholastic.md', { type: 'collection' }),
    mk('HT/Scholastic/Aquinas/Aquinas.md', { type: 'author' }),
    mk('HT/Scholastic/Aquinas/Summa/Summa.md', { type: 'work-index', author: 'Thomas Aquinas', part_of: '[[Aquinas]]' }),
    mk('HT/Scholastic/Aquinas/Summa/Prima Pars.md', { type: 'work-index', part_of: '[[Summa]]' }),
    mk('HT/Scholastic/Aquinas/Summa/Prima Pars/Summa - Prima Pars - Question 2.md', { type: 'historical-text', part_of: '[[Prima Pars]]' }),
    mk('HT/Scholastic/Aquinas/Summa/Prima Pars/Summa - Prima Pars - Question 10.md', { type: 'historical-text', part_of: '[[Prima Pars]]' }),
    mk('HT/Scholastic/Aquinas/Summa/Secunda.md', { type: 'work-index', part_of: '[[Summa]]' }),
    mk('HT/Scholastic/Aquinas/Summa/Secunda/Summa - Secunda - Question 1.md', { type: 'historical-text', part_of: '[[Secunda]]' }),
    mk('HT/Reformation/Reformation.md', { type: 'collection' }),
    mk('HT/Reformation/Luther/Luther.md', { type: 'author' }),
    mk('HT/Reformation/Luther/95 Theses.md', { type: 'historical-text', part_of: '[[Luther]]' }),
    mk('Books/Moody/Moody.md', {}), mk('Books/Moody/2 - The Way.md', {}), mk('Books/Moody/1 - The Basin.md', {}), mk('Books/Moody/10 - The End.md', {}),
    mk('Meetings/Source/Staff.md', { granola_id: 'g1', date: '2026-10-12' }),
    mk('Meetings/Reviews/Staff review.md', { type: 'meeting-review', source_meeting: '[[Staff]]', date: '2026-10-12' }),
    mk('Meetings/Source/Leaders.md', { granola_id: 'g2', date: '2026-10-13' })
  ];
  const byBase = new Map(notes.map(n => [n.basename, n.path]));
  notes.forEach(n => { n.partOfPath = byBase.get(n.partOfLink) || null; n.sourceMeetingPath = byBase.get(n.sourceMeetingLink) || null; });
  const order = new Map([['HT/Scholastic/Aquinas/Summa/Summa.md', ['HT/Scholastic/Aquinas/Summa/Prima Pars.md', 'HT/Scholastic/Aquinas/Summa/Secunda.md']]]);
  const coll = new Map(notes.filter(n => n.type === 'collection').map(n => [n.folder, n.title]));
  const groupOf = n => { let f = n.folder; while (f) { if (coll.has(f) && coll.get(f) !== n.title) return coll.get(f); f = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : ''; } return ''; };
  return { notes, books: core.buildBooks(notes, order, groupOf), today };
}

test('books: works with parts, an author’s writings and folder books, in reading order with short names', () => {
  const { books } = bookFixture();
  expect(books.books.map(b => [b.title, b.kind, b.count, b.group])).toEqual([['Summa', 'Classic', 3, 'Scholastic'], ['Luther', 'Writings', 1, 'Reformation'], ['Moody', 'Book', 3, '']]);
  const summa = books.byPath.get('HT/Scholastic/Aquinas/Summa/Summa.md');
  expect(summa.tree.children.map(c => [c.short, c.children.map(x => x.short)])).toEqual([['Prima Pars', ['Question 2', 'Question 10']], ['Secunda', ['Question 1']]]); // numbers sort as numbers
  const place = core.bookPlace(books, summa.leaves[1]);
  expect([place.here.short, place.prev.short, place.next.short, place.trail.map(t => t.short), place.i, place.total]).toEqual(['Question 10', 'Question 2', 'Question 1', ['Summa', 'Prima Pars'], 1, 3]);
  expect(books.byPath.get('Books/Moody/Moody.md').tree.children.map(c => c.short)).toEqual(['1 - The Basin', '2 - The Way', '10 - The End']);
  expect(core.shortTitle('Summa Theologiae - Prima Secundae - Question 9', [{ title: 'Summa Theologiae' }, { title: 'Prima Secundae' }])).toBe('Question 9');
  expect(core.chapterSubject('---\ntype: historical-text\n---\n\n# Q9\n\n> [!info] Edition\n> rights\n\n## Source text\n\nOF THAT WHICH MOVES THE WILL (SIX ARTICLES)\n\nWe must now consider')).toBe('Of that which moves the will (six articles)');
});

test('the Library shelves books instead of their parts, and shows each meeting once', () => {
  const { notes, books, today } = bookFixture();
  const lib = core.buildLibrary(notes.map(n => ({ ...n })), { today, shelves: ['classic', 'book', 'meeting'], books });
  const shelf = id => (lib.shelves.find(s => s.id === id) || { items: [] }).items.map(n => n.title);
  expect(shelf('classic')).toEqual(['Luther', 'Summa']); // grouped by tradition (Reformation, Scholastic); not "Prima Pars", "Secunda" or the collections
  expect(shelf('book')).toEqual(['Moody']); // one cover, not its chapters
  expect(shelf('meeting')).toEqual(['Leaders', 'Staff review']); // Granola notes count as meetings; a reviewed one shows through its review
});

test('a book page lists its contents, and a chapter gets the reading bar', async ({ page }) => {
  const code = fs.readFileSync(MAIN, 'utf8'), { books } = bookFixture();
  const summa = books.byPath.get('HT/Scholastic/Aquinas/Summa/Summa.md'), place = core.bookPlace(books, summa.leaves[1]);
  await page.setContent('<!doctype html><html><body><div id="v"></div><div id="c"></div></body></html>');
  const out = await page.evaluate(([code, summa, place]) => {
    const module = { exports: {} }; class Base { }
    const fake = { Plugin: Base, ItemView: Base, PluginSettingTab: Base, Setting: Base, Modal: Base, SuggestModal: Base, Notice: Base, Platform: {}, TFile: Base, MarkdownView: Base, normalizePath: p => p, debounce: f => f };
    new Function('module', 'exports', 'require', code)(module, module.exports, n => (n === 'obsidian' ? fake : null));
    const { render } = module.exports, calls = [], on = { home: () => { }, open: p => calls.push('open:' + p.split('/').pop()), book: p => calls.push('book') };
    const v = document.getElementById('v'); v.append(render.book(document, summa, { path: summa.leaves[1], short: 'Question 10' }, on));
    const parts = [...v.querySelectorAll('summary')].map(s => s.textContent), openPart = [...v.querySelectorAll('details')].map(d => d.open);
    v.querySelector('.ldl-btn-light').click();
    const c = document.getElementById('c'); c.append(render.readingBar(document, place, on));
    [...c.querySelectorAll('button')].forEach(b => b.click());
    return { parts, openPart, start: v.querySelector('.ldl-btn-light').textContent, reading: v.querySelector('.ldl-here .ldl-row-title').textContent, bar: c.textContent, calls };
  }, [code, JSON.parse(JSON.stringify(summa)), JSON.parse(JSON.stringify(place))]);
  expect(out.parts).toEqual(['Prima Pars2', 'Secunda1']);
  expect(out.openPart).toEqual([true, false]); // the part you're reading is open
  expect(out.start).toBe('Continue: Question 10');
  expect(out.reading).toBe('Question 10');
  expect(out.bar).toContain('2 of 3');
  expect(out.calls).toEqual(['open:Summa - Prima Pars - Question 10.md', 'book', 'book', 'open:Summa - Prima Pars - Question 2.md', 'book', 'open:Summa - Secunda - Question 1.md']);
});

test('Granola attendee handles are linked to the person who owns them', () => {
  const aliases = new Map([['jthigpen', 'Jordan Thigpen'], ['aaron a.lamb', 'Aaron Lamb']]), exists = t => t === 'Sam Rivera';
  expect(core.linkAttendees(['[[Jthigpen]]', '[[Sam Rivera]]', '[[Aaron A.lamb]]', '[[Stranger]]'], aliases, exists)).toEqual(['[[Jordan Thigpen]]', '[[Sam Rivera]]', '[[Aaron Lamb]]', '[[Stranger]]']);
  expect(core.linkAttendees(['[[Sam Rivera]]', '[[Stranger]]'], aliases, exists)).toBeNull(); // nothing to change
  expect(core.linkAttendees('[[Jthigpen]]', aliases, exists)).toEqual(['[[Jordan Thigpen]]']);
  const n = core.noteInfo({ path: 'p/Jordan Thigpen.md', basename: 'Jordan Thigpen' }, { type: 'person', aliases: ['Jthigpen'] }, '2026-10-15');
  expect(n.aliases).toEqual(['Jthigpen']);
});

test('to-dos kept in notes are found, cleaned for the dashboard, and marked once moved', () => {
  const md = ['---', 'type: project', '---', '# Plan', '- [ ] Define the questions', '- [x] Done already', '  - [ ] Prepare the discussion for 1 Corinthians 7–9. 📅 2026-10-06', '```', '- [ ] in a code block', '```', '* [ ] Call [[Dwayne Conner|Dad]] ⏫ 🔁 every week ^abc'].join('\n');
  const todos = core.noteTodos(md);
  expect(todos.map(t => t.text)).toEqual(['Define the questions', 'Prepare the discussion for 1 Corinthians 7–9. due:2026-10-06', 'Call Dad']);
  expect(todos.map(t => t.line)).toEqual([4, 6, 10]);
  expect(core.movedLine('- [ ] Define the questions')).toBe('- Define the questions _(moved to Tasks)_');
  expect(core.movedLine('  - [ ] Nested one')).toBe('  - Nested one _(moved to Tasks)_');
});

test('a capture becomes an inbox note: typed, titled from its first words, with its passage', () => {
  const now = new Date(2026, 9, 15, 9, 5);
  const idea = core.captureNote('The father runs to the son before the son finishes his speech, Luke 15:20', 'sermon-seed', now);
  expect(idea.name).toBe('The father runs to the son before the');
  expect(idea.content).toBe('---\ntype: sermon-seed\ncreated: "2026-10-15"\ncaptured: "2026-10-15 09:05"\nscripture: "Luke 15:20"\n---\n\nThe father runs to the son before the son finishes his speech, Luke 15:20\n');
  expect(core.captureNote('Grace is free\nbut not cheap', 'quote', now).content).toContain('> Grace is free\n> but not cheap');
  expect(core.captureNote('   ', 'idea', now)).toBeNull();
  expect(core.captureNote('Odd: kind?', 'nonsense', now).content).toContain('type: idea');
  expect(core.captureNote('Why? Because: yes', 'idea', now).name).toBe('Why Because yes');
});
