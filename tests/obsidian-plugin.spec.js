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
