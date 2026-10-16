/* Life Dashboard Library — an Obsidian plugin (plain JavaScript, no build step).
 *
 * Three layers, in this order:
 *   1. core    — pure functions: what kind of note this is, its status, shelves, series, the bridge rules.
 *   2. render  — builds the Library pages as DOM from core's data (no Obsidian calls, so tests run it in a browser).
 *   3. plugin  — the Obsidian glue: views, commands, settings, title cards, the docked dashboard.
 *
 * It reads the properties notes already have (type, status, scripture, date, project, series) and never
 * rewrites a note unless a command asks it to (Set status, New sermon).
 */
'use strict';
const obsidian = require('obsidian');

/* =============================== 1. core =============================== */
const core = (() => {
  // Note families: what a note is, by its `type` property. A project with project_kind "sermon" is a sermon's hub.
  const FAMILIES = {
    sermon: { label: 'Sermons', kind: 'Sermon', icon: 'mic', types: ['sermon', 'sermon-development', 'sermon-outline', 'sermon-manuscript'] },
    study: { label: 'Studies & lessons', kind: 'Study', icon: 'book-open', types: ['study-session', 'session-preparation', 'study', 'lesson', 'bible-study', 'handout', 'class', 'teaching'] },
    series: { label: 'Series & projects', kind: 'Series', icon: 'library', types: ['project', 'series'] },
    meeting: { label: 'Meetings', kind: 'Meeting', icon: 'users', types: ['meeting', 'meeting-review', 'meeting-note', 'meeting-source'] },
    person: { label: 'People', kind: 'Person', icon: 'user', types: ['person'] },
    book: { label: 'Books', kind: 'Book', icon: 'book', types: ['book', 'book-note'] },
    // A classic work or collection is one cover; its chapters (historical-text) stay out of the shelves but in search.
    classic: { label: 'Historical theology', kind: 'Classic', icon: 'scroll', types: ['work-index', 'collection'] },
    article: { label: 'Articles & media', kind: 'Source', icon: 'newspaper', types: ['article', 'podcast', 'video', 'source'] },
    area: { label: 'Areas', kind: 'Area', icon: 'compass', types: ['area'] }
  };
  const TYPE_FAMILY = Object.fromEntries(Object.entries(FAMILIES).flatMap(([f, d]) => d.types.map(t => [t, f])));
  const TEACHING = ['sermon', 'study'];
  // Deep cover colours with white text (all at least 7:1), picked per title so shelves look varied but stable.
  const PALETTE = ['#134e4a', '#1e3a5f', '#5b2a4a', '#2f4a2a', '#7c4a12', '#3b3355', '#7f1d1d', '#1f4e5f'];

  // Status words people use, folded into a few that read the same everywhere.
  const STATUS_WORDS = {
    idea: ['idea', 'planned', 'proposed', 'someday', 'backlog', 'unprocessed', 'new', 'not started'],
    draft: ['draft', 'active', 'in-progress', 'in progress', 'writing', 'outlining', 'started', 'processing', 'drafting', 'review'],
    ready: ['ready', 'final', 'scheduled', 'prepared'],
    done: ['done', 'taught', 'preached', 'complete', 'completed', 'delivered', 'processed', 'archived', 'finished'],
    toread: ['unread', 'saved', 'to-read', 'to read', 'queued'],
    read: ['read']
  };
  const STATUS_OF = Object.fromEntries(Object.entries(STATUS_WORDS).flatMap(([k, ws]) => ws.map(w => [w, k])));
  const STATUS_LABEL = { idea: 'Idea', draft: 'Draft', week: 'This week', ready: 'Ready', done: 'Done', toread: 'To read', read: 'Read' };
  const DONE_LABEL = { sermon: 'Preached', study: 'Taught' };
  const SERIES_LABEL = { idea: 'Planned', draft: 'Active' }; // a series or project is under way, not drafted
  // The order Set status offers, and the word it writes into the note.
  const STATUS_CHOICES = [['idea', 'Idea', 'idea'], ['draft', 'Draft', 'draft'], ['ready', 'Ready', 'ready'], ['done', 'Done', 'done']];

  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };
  const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };

  // "[[Folder/Note|Alias]]" → "Folder/Note"; plain text stays as it is; lists use their first entry.
  function linkTarget(v) {
    if (Array.isArray(v)) v = v[0];
    if (v == null || v === '') return null;
    const s = String(v).trim(), m = s.match(/^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/);
    return (m ? m[1] : s).trim() || null;
  }
  const plain = v => { if (Array.isArray(v)) v = v.filter(Boolean).map(plain).join(', '); if (v == null) return ''; const s = String(v).trim(); const m = s.match(/^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/); return m ? (m[2] || m[1].split('/').pop()) : s; };
  // Dates arrive as "2026-10-28", "2026-10-28T09:00" or a Date; anything else is ignored.
  function isoDate(v) {
    if (v instanceof Date && !isNaN(v)) return ymd(v);
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  }
  const fmtDate = (s, today) => {
    if (!s) return '';
    const [y, m, d] = s.split('-').map(Number), dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(String(y) !== today.slice(0, 4) ? { year: 'numeric' } : {}) });
  };
  // A cover shows the passage when there is one ("John 13"), else the title without a trailing date.
  function coverText(title, scripture) {
    const s = plain(scripture);
    if (s) return s.length > 22 ? s.slice(0, 21) + '…' : s;
    return String(title).replace(/\s*[-–—]\s*(\w+ \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2})$/, '').trim() || title;
  }
  function familyOf(fm) {
    const type = String(fm.type || '').trim().toLowerCase();
    if (type === 'project' && String(fm.project_kind || '').toLowerCase() === 'sermon') return 'sermon';
    return TYPE_FAMILY[type] || null;
  }
  function statusOf(fm, family, date, today) {
    const raw = String(fm.status || '').trim().toLowerCase(), type = String(fm.type || '').toLowerCase();
    let key = STATUS_OF[raw] || (raw ? 'draft' : '');
    // Teaching that is not finished and falls in the next 7 days is "This week".
    if (TEACHING.includes(family) && key !== 'done' && date && date >= today && date <= addDays(today, 6)) key = 'week';
    // "Preached" / "Taught" belong to the sermon or lesson itself; an outline or development note is just "Done".
    const delivered = (family === 'sermon' && ['sermon', 'project'].includes(type)) || family === 'study';
    const label = key === 'done' && delivered ? DONE_LABEL[family] : family === 'series' && SERIES_LABEL[key] ? SERIES_LABEL[key] : (STATUS_LABEL[key] || '');
    return { key, label };
  }

  // One note → the facts the Library shows. `file`: { path, basename, folder, mtime }.
  function noteInfo(file, fm, today) {
    fm = fm || {};
    const family = familyOf(fm);
    const date = isoDate(fm.preaching_date || fm.date || fm.due || fm.published);
    const status = statusOf(fm, family, date, today);
    const title = String(fm.title || file.basename);
    return {
      path: file.path, folder: file.folder || '', title, family, type: String(fm.type || ''), date,
      mtime: file.mtime || 0, scripture: plain(fm.scripture || fm.passage), series: plain(fm.series),
      roles: plain(fm.roles), lastContact: isoDate(fm.last_contact), taught: parseTaught(fm.taught), scriptureKey: scriptureKey(fm.scripture || fm.passage),
      projectLink: linkTarget(fm.project), projectPath: null, status: status.key, statusLabel: status.label,
      kind: family ? FAMILIES[family].kind : '', cover: coverText(title, fm.scripture || fm.passage),
      color: PALETTE[hash(title) % PALETTE.length], hub: family === 'series' || String(fm.type || '').toLowerCase() === 'project'
    };
  }
  const inFolder = (path, folders) => folders.some(f => f && (path === f || path.startsWith(f.replace(/\/+$/, '') + '/')));

  // Everything the Library home needs, from the notes (already resolved: projectPath set where the link resolved).
  function buildLibrary(notes, opts) {
    const today = opts.today, ignore = opts.ignoreFolders || [], order = opts.shelves || Object.keys(FAMILIES);
    const seen = notes.filter(n => !inFolder(n.path, ignore));
    const byPath = new Map(seen.map(n => [n.path, n]));
    // A hub (project note) gathers the notes that link to it with `project`, or sit in its folder.
    const hubs = new Map();
    for (const n of seen) if (n.hub) hubs.set(n.path, { note: n, members: [] });
    for (const n of seen) {
      if (n.hub) continue;
      let hub = n.projectPath && hubs.get(n.projectPath);
      if (!hub) for (const h of hubs.values()) if (h.note.folder && h.note.folder === n.folder) { hub = h; break; }
      if (hub) { hub.members.push(n); n.hubPath = hub.note.path; }
    }
    for (const h of hubs.values()) {
      h.members.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.title.localeCompare(b.title));
      const fam = h.members.filter(m => m.family);
      h.done = fam.filter(m => m.status === 'done').length; h.total = fam.length;
      h.note.count = h.members.length;
    }
    const onShelf = n => n.family && !n.hubPath;
    const newest = (a, b) => (b.date || '').localeCompare(a.date || '') || b.mtime - a.mtime;
    const shelves = order.filter(f => FAMILIES[f]).map(f => ({ id: f, label: FAMILIES[f].label, items: seen.filter(n => onShelf(n) && n.family === f).sort(newest) })).filter(s => s.items.length);
    // Working on now: the next unfinished sermon or study with a date from today on, else the latest one touched.
    const open = seen.filter(n => TEACHING.includes(n.family) && !n.hubPath && n.status !== 'done' && n.status !== 'idea');
    const upcoming = open.filter(n => n.date && n.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const working = upcoming[0] || open.filter(n => !n.date || n.date >= today).sort((a, b) => b.mtime - a.mtime)[0] || null;
    const recent = seen.filter(n => n.family || n.mtime).sort((a, b) => b.mtime - a.mtime).slice(0, 6);
    return { today, shelves, working, workingHub: working && hubs.get(working.path) || null, recent, hubs, byPath };
  }
  // Search: titles, passages and series; best matches first (title start, then title, then the rest).
  function search(notes, q, ignore) {
    const s = String(q || '').trim().toLowerCase(); if (!s) return [];
    const rank = n => { const t = n.title.toLowerCase(); return t.startsWith(s) ? 0 : t.includes(s) ? 1 : (n.scripture || '').toLowerCase().includes(s) ? 2 : (n.series || '').toLowerCase().includes(s) ? 3 : 9; };
    return notes.filter(n => !inFolder(n.path, ignore || [])).map(n => [rank(n), n]).filter(([r]) => r < 9).sort((a, b) => a[0] - b[0] || b[1].mtime - a[1].mtime).slice(0, 40).map(([, n]) => n);
  }
  const metaLine = (n, today) => [n.kind, n.scripture && n.scripture !== n.cover ? n.scripture : '', n.date ? fmtDate(n.date, today) : '', n.series].filter(Boolean).join(' · ');

  // --- The bridge: messages from the docked dashboard arrive as "#ld-obsidian=<json>" in its address.
  const BRIDGE_PREFIX = '#ld-obsidian=';
  function originOf(u) { try { return new URL(u).origin; } catch (e) { return ''; } }
  // Returns { open } or { create: { folder, name, content } }, or null for anything not from the dashboard or malformed.
  function readBridge(url, dashboardUrl) {
    const origin = originOf(url); if (!origin || origin !== originOf(dashboardUrl)) return null;
    const i = String(url).indexOf(BRIDGE_PREFIX); if (i < 0) return null;
    let msg; try { msg = JSON.parse(decodeURIComponent(String(url).slice(i + BRIDGE_PREFIX.length))); } catch (e) { return null; }
    if (!msg || typeof msg !== 'object') return null;
    if (typeof msg.open === 'string' && msg.open.trim() && msg.open.length < 500) return { open: msg.open.trim() };
    if (Array.isArray(msg.people)) { const people = [...new Set(msg.people.slice(0, 20).map(n => safeName(n)).filter(Boolean))]; return people.length ? { people } : null; }
    const c = msg.create;
    if (c && typeof c === 'object' && typeof c.name === 'string' && typeof (c.content ?? '') === 'string' && String(c.content || '').length <= 200000) {
      const folder = safeFolder(c.folder || ''), name = safeName(c.name);
      if (folder !== null && name) return { create: { folder, name, content: String(c.content || '') } };
    }
    return null;
  }
  // A vault folder path with no "..", no leading "/" or "." folders and no characters notes cannot use.
  function safeFolder(f) {
    const parts = String(f).replace(/\\/g, '/').split('/').map(p => p.trim()).filter(Boolean);
    if (parts.some(p => p === '..' || p.startsWith('.') || /[*"<>:|?]/.test(p))) return null;
    return parts.join('/');
  }
  const safeName = n => String(n).replace(/[\\/*"<>:|?#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

  // --- New sermon: a hub note (like a Sermon Project Dashboard) plus a manuscript that links to it.
  // Plain lower-case words (type and status values) stay bare; everything else is quoted, which is always valid YAML.
  function yamlValue(v) { const s = String(v ?? ''); return s === '' ? '' : /^[a-z][a-z-]*$/.test(s) ? s : JSON.stringify(s); }
  function sermonNotes({ passage, title, date, series }, today) {
    const name = safeName(`${passage || title || 'Sermon'}${date ? ' - ' + date : ''}`);
    const hubName = name, msName = safeName(`${passage || title || 'Sermon'} - Manuscript`);
    const fm = obj => '---\n' + Object.entries(obj).map(([k, v]) => `${k}: ${v === '' ? '' : yamlValue(v)}`.trimEnd()).join('\n') + '\n---\n';
    return {
      folder: name,
      hub: { name: hubName, content: fm({ type: 'project', project_kind: 'sermon', status: 'planned', created: today, domain: 'ministry', preaching_date: date || '', scripture: passage || '', series: series || '', title: title || '' }) + `\n# ${title || passage || 'Sermon'}\n\n## Big idea\n\n## Prep\n- [ ] Read and pray through ${passage || 'the passage'}\n- [ ] Outline\n- [ ] Illustrations\n- [ ] Manuscript\n` },
      manuscript: { name: msName, content: fm({ type: 'sermon', status: 'draft', created: today, date: date || '', project: `[[${hubName}]]`, scripture: passage || '', series: series || '' }) + `\n# ${title || passage || 'Sermon'}\n\n` }
    };
  }

  // --- Taught record. A note's `taught` property lists "2026-10-28 — Group" entries, newest kept first.
  function parseTaught(v) {
    return [].concat(v || []).map(x => String(x).trim()).map(x => { const m = x.match(/^(\d{4}-\d{2}-\d{2})\s*(?:[—–-]+\s*)?(.*)$/); return m ? { date: m[1], group: m[2].trim() } : null; })
      .filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
  }
  const taughtEntry = (date, group) => `${date} — ${group}`;
  // Groups from settings: one per line; "(inactive)" after a name means not teaching it right now.
  const parseGroups = lines => [].concat(lines || []).map(String).map(l => l.trim()).filter(Boolean).map(l => ({ name: l.replace(/\s*\(inactive\)\s*$/i, '').trim(), active: !/\(inactive\)\s*$/i.test(l) }));
  // "John 13:1-17" and "John 13" match; so do "1 Cor 8" and "1 Corinthians 8-10" (book's first letters + chapter).
  function scriptureKey(ref) {
    const m = plain(ref).toLowerCase().match(/^([1-3])?\s*([a-z]+)\.?\s*(\d+)/);
    return m ? `${m[1] || ''}${m[2].slice(0, 3)} ${+m[3]}` : '';
  }
  const TEACH_TYPES = ['sermon', 'project', 'study-session', 'session-preparation', 'study', 'lesson', 'bible-study', 'handout', 'class', 'teaching'];
  const teachable = n => TEACHING.includes(n.family) && TEACH_TYPES.includes(String(n.type).toLowerCase()) && !n.hubPath;
  // The record: each group's entries (newest first), entries for groups no longer listed, and teaching marked done
  // with a date but no group recorded yet (to fill in).
  function teachingRecord(notes, groups, ignore) {
    const seen = notes.filter(n => !inFolder(n.path, ignore || [])), gs = parseGroups(groups);
    const by = new Map(gs.map(g => [g.name.toLowerCase(), { ...g, items: [] }])), other = { name: 'Other', active: true, items: [] };
    for (const n of seen) for (const t of n.taught || []) (by.get(t.group.toLowerCase()) || other).items.push({ note: n, date: t.date, group: t.group });
    const out = [...by.values(), ...(other.items.length ? [other] : [])];
    out.forEach(g => g.items.sort((a, b) => b.date.localeCompare(a.date)));
    const unrecorded = seen.filter(n => teachable(n) && n.status === 'done' && !(n.taught || []).length).sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));
    return { groups: out, unrecorded, total: out.reduce((a, g) => a + g.items.length, 0) };
  }
  // Other notes on the same passage that have been taught.
  const taughtBefore = (n, notes) => !n.scriptureKey ? [] : notes.filter(x => x.path !== n.path && x.scriptureKey === n.scriptureKey && (x.taught || []).length)
    .flatMap(x => x.taught.map(t => ({ note: x, ...t }))).sort((a, b) => b.date.localeCompare(a.date));

  // --- Bible references. Book names as the vault's Bible chapters are named ("John 13 (WEB)"), with common short forms.
  const BIBLE = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
    'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation'];
  const SINGLE_CHAPTER = new Set(['Obadiah', 'Philemon', '2 John', '3 John', 'Jude']);
  // Short forms. Two-letter forms that are also ordinary words (is, am, ex) are left out on purpose.
  const SHORT = { Genesis: ['gen', 'gn'], Exodus: ['exod', 'exo'], Leviticus: ['lev'], Numbers: ['num'], Deuteronomy: ['deut', 'dt'], Joshua: ['josh'], Judges: ['judg', 'jdg'], Ruth: ['rth'], Samuel: ['sam'], Kings: ['kgs', 'kin'], Chronicles: ['chr', 'chron'], Ezra: ['ezr'], Nehemiah: ['neh'], Esther: ['esth', 'est'], Psalms: ['psalm', 'ps', 'psa', 'pss'], Proverbs: ['prov', 'prv'], Ecclesiastes: ['eccl', 'eccles', 'ecc', 'qoh'], 'Song of Solomon': ['song of songs', 'song', 'sos'], Isaiah: ['isa'], Jeremiah: ['jer'], Lamentations: ['lam'], Ezekiel: ['ezek', 'ezk'], Daniel: ['dan'], Hosea: ['hos'], Obadiah: ['obad'], Jonah: ['jnh'], Micah: ['mic'], Nahum: ['nah'], Habakkuk: ['hab'], Zephaniah: ['zeph', 'zep'], Haggai: ['hag'], Zechariah: ['zech', 'zec'], Malachi: ['mal'],
    Matthew: ['matt', 'mt'], Mark: ['mk', 'mrk'], Luke: ['lk', 'luk'], John: ['jn', 'jhn'], Romans: ['rom', 'rm'], Corinthians: ['cor'], Galatians: ['gal'], Ephesians: ['eph'], Philippians: ['phil', 'php'], Colossians: ['col'], Thessalonians: ['thess', 'thes'], Timothy: ['tim'], Titus: ['tit'], Philemon: ['philem', 'phlm', 'phm'], Hebrews: ['heb'], James: ['jas'], Peter: ['pet', 'pt'], Jude: ['jud'], Revelation: ['rev', 'revelations'] };
  const BOOK_OF = (() => {
    const map = new Map(), num = { 1: ['1 ', '1', 'i ', 'first '], 2: ['2 ', '2', 'ii ', 'second '], 3: ['3 ', '3', 'iii ', 'third '] };
    for (const name of BIBLE) {
      const m = name.match(/^([123]) (.+)$/), base = m ? m[2] : name, forms = [base.toLowerCase(), ...(SHORT[base] || SHORT[name] || [])];
      if (m) num[m[1]].forEach(pre => forms.forEach(f => map.set(pre + f, name)));
      else forms.forEach(f => map.set(f, name));
    }
    return map;
  })();
  const REF_RE = new RegExp(`(?<![\\w])(${[...BOOK_OF.keys()].sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|')})\\.?\\s*(\\d{1,3})(?:\\s*:\\s*(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?)?(?:\\s*[-–]\\s*(\\d{1,3}))?(?![\\w])`, 'gi');
  const refLabel = r => {
    const name = r.book === 'Psalms' && !r.c2 ? 'Psalm' : r.book;
    if (SINGLE_CHAPTER.has(r.book)) return r.v1 ? `${name} ${r.v1}${r.v2 && r.v2 !== r.v1 ? `–${r.v2}` : ''}` : name;
    return `${name} ${r.c}${r.c2 ? `–${r.c2}` : ''}${r.v1 ? `:${r.v1}${r.v2 && r.v2 !== r.v1 ? `–${r.v2}` : ''}` : ''}`;
  };
  // Every Bible reference in a piece of text, with where it sits. A lowercase book name ("mark 5") is ordinary text.
  function findRefs(text) {
    const out = []; REF_RE.lastIndex = 0; let m;
    while ((m = REF_RE.exec(String(text)))) {
      if (/^[a-z]/.test(m[1])) continue;
      const book = BOOK_OF.get(m[1].toLowerCase().replace(/\s+/g, ' ')); if (!book) continue;
      let c = +m[2], v1 = m[3] ? +m[3] : null, v2 = m[4] ? +m[4] : null, c2 = m[5] ? +m[5] : null;
      if (SINGLE_CHAPTER.has(book) && !v1) { v1 = c; v2 = c2; c = 1; c2 = null; }
      if (!c || (v1 && v2 && v2 < v1) || (c2 && c2 <= c)) continue;
      const r = { book, c, v1, v2: v1 ? (v2 || v1) : null, c2: v1 ? null : c2 };
      out.push({ ...r, start: m.index, end: m.index + m[0].length, text: m[0], label: refLabel(r) });
    }
    return out;
  }
  const parseRefText = t => findRefs(String(t || '').trim().replace(/^./, x => x.toUpperCase()))[0] || null;
  // A chapter note's verses: "### 16" headings, each verse's text below it (block ids like ^v16 removed).
  function chapterVerses(md) {
    const out = []; const re = /^###\s+(\d+)\s*$\n([\s\S]*?)(?=^###\s+\d+\s*$|(?![\s\S]))/gm; let m;
    while ((m = re.exec(String(md)))) out.push([+m[1], m[2].replace(/\s*\^v\d+\s*$/gm, '').replace(/\s+/g, ' ').trim()]);
    return out;
  }
  const versesFor = (verses, r) => r.v1 ? verses.filter(([n]) => n >= r.v1 && n <= r.v2) : verses;
  // The passage as a quote callout for inserting into a note.
  const passageCallout = (r, verses, translation) => `> [!quote] ${r.label}${translation ? ` (${translation})` : ''}\n${verses.map(([n, t]) => `> **${n}** ${t}`).join('\n')}\n`;
  const passageNoteText = (book, c, today) => `---\ntype: scripture-note\ncreated: ${today}\nscripture: "${book} ${c}"\nbook: ${book}\ntestament: ${BIBLE.indexOf(book) >= 39 ? 'New Testament' : 'Old Testament'}\n---\n\n# ${book} ${c}\n\n## Notes\n\n## Canonical connections\n\n## Related notes\n\n`;

  // A meeting note's open to-dos: the top-level bullets under a heading about actions, follow-ups, next steps or
  // to-dos. Plain bullets and unticked "- [ ]" both count; ticked items and callouts (> lines) do not. A bullet's
  // indented lines (Granola puts details under a **bold** item) go into the task's notes, in parentheses.
  // Items under a follow-up or waiting heading are things you are waiting on.
  const mdPlain = t => String(t).replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/!?\[\[([^\]]+)\]\]/g, (m, x) => x.split('/').pop())
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/(^|\s)[*_](\S[^*_]*)[*_]/g, '$1$2').replace(/\\([~*_[\]#|])/g, '$1').replace(/\s+\^[\w-]+$/, '').replace(/\s+/g, ' ').trim();
  function actionItems(md) {
    const out = []; let section = '', take = false, inFm = false, cur = null;
    const close = () => { if (cur && cur.text) { const extra = cur.extra.join('; ').replace(/[()]/g, '').slice(0, 300); out.push({ text: cur.text + (extra ? ` (${extra})` : ''), section: cur.section, waiting: cur.waiting }); } cur = null; };
    String(md || '').split('\n').forEach((line, i) => {
      if (i === 0 && line.trim() === '---') { inFm = true; return; }
      if (inFm) { if (line.trim() === '---') inFm = false; return; }
      const h = line.match(/^#{1,6}\s+(.*)$/);
      if (h) { close(); section = h[1].trim(); take = /action|follow|next step|to.?do|tasks?\b/i.test(section); return; }
      if (!take) return;
      if (!line.trim() || /^\s*>/.test(line)) { close(); return; }
      const top = line.match(/^[-*+]\s+(?:\[(.)\]\s+)?(.+)$/);
      if (top) { close(); if (top[1] && top[1] !== ' ') return; cur = { text: mdPlain(top[2]), extra: [], section, waiting: /follow|waiting/i.test(section) }; return; }
      if (cur && /^\s+\S/.test(line)) { const t = mdPlain(line.replace(/^\s*(?:[-*+]\s+(?:\[.\]\s+)?)?/, '')); if (t) cur.extra.push(t); return; }
      close();
    });
    close();
    return out;
  }
  // The names a person note answers to in the dashboard: the title, the first name, and any aliases.
  function personNames(title, fm) {
    const t = String(title || '').trim(), out = [t, t.split(/\s+/)[0], ...[].concat((fm && fm.aliases) || []).map(String)];
    return [...new Set(out.map(x => x.trim()).filter(Boolean))];
  }
  function personNote(name, template, today) {
    const fill = t => String(t).replace(/\{\{\s*title\s*\}\}/gi, name).replace(/\{\{\s*date(?::[^}]*)?\s*\}\}/gi, today);
    return template ? fill(template) : `---\ntype: person\ncreated: "${today}"\n---\n\n# ${name}\n`;
  }
  const meetingTasksMessage = (source, items, area) => ({ addTasks: { source, area: plain(area) || '', items: items.map(it => ({ title: it.text, waiting: !!it.waiting })) } });

  // What New sermon tells the dashboard, so it can add the prep tasks (see sermonPrep in the app).
  function sermonPrepMessage(v, s) { return { sermonPrep: { passage: v.passage || '', title: v.title || '', date: isoDate(v.date) || '', hub: s.hub.name, manuscript: s.manuscript.name } }; }

  return { BIBLE, findRefs, parseRefText, chapterVerses, versesFor, passageCallout, passageNoteText, parseTaught, taughtEntry, parseGroups, scriptureKey, teachable, teachingRecord, taughtBefore, personNote, personNames, actionItems, meetingTasksMessage, sermonPrepMessage, FAMILIES, PALETTE, STATUS_CHOICES, linkTarget, plain, isoDate, fmtDate, coverText, familyOf, statusOf, noteInfo, buildLibrary, search, metaLine, inFolder, readBridge, safeFolder, safeName, sermonNotes, addDays, ymd, BRIDGE_PREFIX };
})();

/* =============================== 2. render =============================== */
// Builds DOM with the given document. `on` holds callbacks: open(path), hub(path), shelf(id), home(), search(q), status(path).
const render = (() => {
  function el(doc, tag, cls, text) { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function cover(doc, n, big) {
    const c = el(doc, 'div', 'ldl-cover' + (big ? ' ldl-cover-big' : ''));
    c.style.background = n.color;
    // A person's cover shows their initials; everything else its passage or short title.
    const initials = n.family === 'person' ? String(n.title).split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).map(w => w[0].toUpperCase()).slice(0, 2).join('') : '';
    c.append(el(doc, 'span', 'ldl-cover-kind', n.kind || 'Note'), el(doc, 'span', 'ldl-cover-title' + (initials ? ' ldl-cover-initials' : ''), initials || n.cover || n.title));
    return c;
  }
  function chip(doc, n) { const c = el(doc, 'span', 'ldl-chip ldl-st-' + (n.status || 'none'), n.statusLabel); return n.statusLabel ? c : null; }
  function card(doc, n, on, today) {
    const b = el(doc, 'button', 'ldl-card'); b.type = 'button';
    b.setAttribute('aria-label', [n.title, n.kind, n.statusLabel].filter(Boolean).join(', '));
    b.append(cover(doc, n), el(doc, 'span', 'ldl-card-title', n.title));
    const meta = n.count ? `${n.count} note${n.count === 1 ? '' : 's'}` : core.metaLine({ ...n, kind: '' }, today);
    if (meta) b.append(el(doc, 'span', 'ldl-card-meta', meta));
    b.addEventListener('click', () => (n.hub && n.count ? on.hub(n.path) : on.open(n.path)));
    return b;
  }
  function row(doc, n, on, today, num) {
    const b = el(doc, 'button', 'ldl-row'); b.type = 'button';
    if (num != null) b.append(el(doc, 'span', 'ldl-row-num', String(num)));
    const mid = el(doc, 'span', 'ldl-row-text');
    mid.append(el(doc, 'span', 'ldl-row-title', n.title));
    const meta = core.metaLine(n, today); if (meta) mid.append(el(doc, 'span', 'ldl-row-meta', meta));
    b.append(mid); const c = chip(doc, n); if (c) b.append(c);
    b.addEventListener('click', () => on.open(n.path));
    return b;
  }
  function head(doc, kicker, title, q, on) {
    const h = el(doc, 'header', 'ldl-head');
    const t = el(doc, 'div', 'ldl-head-text'); t.append(el(doc, 'div', 'ldl-kicker', kicker), el(doc, 'h1', 'ldl-h1', title));
    const s = el(doc, 'input', 'ldl-search'); s.type = 'search'; s.placeholder = 'Search titles, passages, series…'; s.setAttribute('aria-label', 'Search the library'); s.value = q || '';
    s.addEventListener('input', () => on.search(s.value));
    h.append(t, s); return h;
  }
  function progress(doc, done, total) { const p = el(doc, 'div', 'ldl-progress'); const f = el(doc, 'div', 'ldl-progress-fill'); f.style.width = `${total ? Math.round(done / total * 100) : 0}%`; p.append(f); return p; }

  function home(doc, lib, on, q, results) {
    const root = el(doc, 'div', 'ldl-root');
    root.append(head(doc, new Date().toLocaleDateString(undefined, { weekday: 'long' }), 'Library', q, on));
    // Quick actions, then a bar of every section: the Library stands in for the folder sidebar.
    const acts = el(doc, 'div', 'ldl-actions');
    [['New note', on.newNote, true], ['New sermon', on.newSermon], ['Today’s note', on.today]].forEach(([label, fn, primary]) => {
      if (!fn) return; const b = el(doc, 'button', 'ldl-btn' + (primary ? ' ldl-btn-primary' : ' ldl-btn-soft'), label); b.type = 'button'; b.addEventListener('click', () => fn()); acts.append(b);
    });
    if (acts.childElementCount) root.append(acts);
    const nav = el(doc, 'nav', 'ldl-nav'); nav.setAttribute('aria-label', 'Library sections');
    const navBtn = (label, count, fn) => { const b = el(doc, 'button', 'ldl-navchip'); b.type = 'button'; b.append(el(doc, 'span', '', label)); if (count != null) b.append(el(doc, 'span', 'ldl-navcount', String(count))); b.addEventListener('click', fn); nav.append(b); };
    lib.shelves.forEach(sh => navBtn(sh.label, sh.items.length, () => on.shelf(sh.id)));
    if (on.taught && lib.teaching) navBtn('Teaching record', lib.teaching, () => on.taught());
    if (lib.inbox && on.folder) navBtn('Inbox', null, () => on.folder(lib.inbox));
    if (on.folder) navBtn('All folders', null, () => on.folder(''));
    root.append(nav);
    if (q) {
      const box = el(doc, 'section', 'ldl-section');
      box.append(el(doc, 'h2', 'ldl-h2', results.length ? `Results for “${q}”` : `Nothing matches “${q}”`));
      const list = el(doc, 'div', 'ldl-list'); results.forEach(n => list.append(row(doc, n, on, lib.today))); box.append(list);
      root.append(box); return root;
    }
    const w = lib.working;
    if (w) {
      const wc = el(doc, 'section', 'ldl-working'); wc.setAttribute('aria-label', 'Working on now');
      const txt = el(doc, 'div', 'ldl-working-text');
      txt.append(el(doc, 'div', 'ldl-kicker ldl-accent', 'Working on now'), el(doc, 'div', 'ldl-working-title', w.title));
      const meta = core.metaLine(w, lib.today); if (meta) txt.append(el(doc, 'div', 'ldl-muted', meta));
      const h = lib.workingHub; if (h && h.total) { txt.append(progress(doc, h.done, h.total), el(doc, 'div', 'ldl-muted ldl-small', `${h.done} of ${h.total} notes done`)); }
      const go = el(doc, 'button', 'ldl-btn ldl-btn-primary', h && h.members.length ? 'Open the project' : 'Keep writing'); go.type = 'button';
      go.addEventListener('click', () => (h && h.members.length ? on.hub(w.path) : on.open(w.path)));
      txt.append(go); wc.append(cover(doc, w, true), txt); root.append(wc);
    }
    for (const s of lib.shelves) {
      const sec = el(doc, 'section', 'ldl-section');
      const top = el(doc, 'div', 'ldl-section-head'); top.append(el(doc, 'h2', 'ldl-h2', s.label));
      if (s.items.length > 6) { const all = el(doc, 'button', 'ldl-link', `See all ${s.items.length}`); all.type = 'button'; all.addEventListener('click', () => on.shelf(s.id)); top.append(all); }
      const shelf = el(doc, 'div', 'ldl-shelf'); s.items.slice(0, 12).forEach(n => shelf.append(card(doc, n, on, lib.today)));
      sec.append(top, shelf); root.append(sec);
    }
    if (lib.recent.length) {
      const sec = el(doc, 'section', 'ldl-section'); sec.append(el(doc, 'h2', 'ldl-h2', 'Recently opened'));
      const list = el(doc, 'div', 'ldl-list'); lib.recent.forEach(n => list.append(row(doc, n, on, lib.today))); sec.append(list); root.append(sec);
    }
    if (!w && !lib.shelves.length) root.append(el(doc, 'p', 'ldl-muted', 'Notes with a type property (sermon, study-session, project, person, book, meeting…) appear here as shelves.'));
    return root;
  }
  function hub(doc, lib, path, on) {
    const h = lib.hubs.get(path), n = h ? h.note : lib.byPath.get(path), root = el(doc, 'div', 'ldl-root ldl-hubpage');
    const band = el(doc, 'header', 'ldl-band'); band.style.background = n ? n.color : '#1e3a5f';
    const back = el(doc, 'button', 'ldl-back', '‹ Library'); back.type = 'button'; back.addEventListener('click', () => on.home());
    band.append(back, el(doc, 'div', 'ldl-kicker', n ? n.kind || 'Project' : 'Project'), el(doc, 'h1', 'ldl-h1', n ? n.title : 'Not found'));
    if (h) {
      const chips = el(doc, 'div', 'ldl-band-chips');
      chips.append(el(doc, 'span', 'ldl-band-chip', `${h.members.length} note${h.members.length === 1 ? '' : 's'}`));
      if (h.total) chips.append(el(doc, 'span', 'ldl-band-chip', `${h.done} done`));
      if (n.scripture) chips.append(el(doc, 'span', 'ldl-band-chip', n.scripture));
      band.append(chips); if (h.total) band.append(progress(doc, h.done, h.total));
    }
    root.append(band);
    const body = el(doc, 'section', 'ldl-section');
    const top = el(doc, 'div', 'ldl-section-head'); top.append(el(doc, 'h2', 'ldl-h2', 'In this project'));
    if (n) { const openHub = el(doc, 'button', 'ldl-link', 'Open the project note'); openHub.type = 'button'; openHub.addEventListener('click', () => on.open(n.path)); top.append(openHub); }
    const list = el(doc, 'div', 'ldl-list'); (h ? h.members : []).forEach((m, i) => list.append(row(doc, m, on, lib.today, i + 1)));
    body.append(top, list); root.append(body); return root;
  }
  function shelf(doc, lib, id, on) {
    const s = lib.shelves.find(x => x.id === id), root = el(doc, 'div', 'ldl-root');
    const back = el(doc, 'button', 'ldl-back ldl-back-plain', '‹ Library'); back.type = 'button'; back.addEventListener('click', () => on.home());
    root.append(back, el(doc, 'h1', 'ldl-h1', s ? s.label : 'Shelf'));
    const grid = el(doc, 'div', 'ldl-grid'); (s ? s.items : []).forEach(n => grid.append(card(doc, n, on, lib.today))); root.append(grid);
    return root;
  }
  // A folder: its sub-folders as tiles and its notes as rows, with a path you can click back through.
  // data: { path, name, crumbs: [{ name, path }], folders: [{ path, name, count }], notes: [noteInfo], more }
  function folder(doc, data, today, on) {
    const root = el(doc, 'div', 'ldl-root');
    const top = el(doc, 'div', 'ldl-crumbs');
    const back = el(doc, 'button', 'ldl-back ldl-back-plain', '‹ Library'); back.type = 'button'; back.addEventListener('click', () => on.home()); top.append(back);
    (data ? data.crumbs : []).forEach((c, i, all) => {
      top.append(el(doc, 'span', 'ldl-muted', '/'));
      if (i === all.length - 1) top.append(el(doc, 'span', 'ldl-crumb-here', c.name));
      else { const b = el(doc, 'button', 'ldl-link', c.name); b.type = 'button'; b.addEventListener('click', () => on.folder(c.path)); top.append(b); }
    });
    root.append(top, el(doc, 'h1', 'ldl-h1', data ? data.name : 'Folder not found'));
    if (!data) return root;
    if (data.folders.length) {
      const grid = el(doc, 'div', 'ldl-folders');
      data.folders.forEach(f => {
        const b = el(doc, 'button', 'ldl-foldertile'); b.type = 'button';
        const mark = el(doc, 'span', 'ldl-foldermark'); mark.style.background = core.PALETTE[[...f.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0) >>> 0 & 7];
        b.append(mark, el(doc, 'span', 'ldl-foldername', f.name.replace(/^\d+\s+/, '')), el(doc, 'span', 'ldl-muted ldl-small', `${f.count} note${f.count === 1 ? '' : 's'}`));
        b.addEventListener('click', () => on.folder(f.path)); grid.append(b);
      });
      root.append(grid);
    }
    if (data.notes.length) {
      const sec = el(doc, 'section', 'ldl-section'); sec.append(el(doc, 'h2', 'ldl-h2', 'Notes'));
      const list = el(doc, 'div', 'ldl-list'); data.notes.forEach(n => list.append(row(doc, n, on, today)));
      if (data.more) list.append(el(doc, 'p', 'ldl-muted ldl-small', `and ${data.more} more; search to find them`));
      sec.append(list); root.append(sec);
    }
    if (!data.folders.length && !data.notes.length) root.append(el(doc, 'p', 'ldl-muted', 'This folder is empty.'));
    return root;
  }
  // The card at the top of a note in reading view.
  function titleCard(doc, n, hubNote, on) {
    const c = el(doc, 'div', 'ldl-titlecard');
    const txt = el(doc, 'div', 'ldl-titlecard-text');
    const today = core.ymd(new Date());
    const meta = (n.family === 'person' ? [n.roles, n.lastContact ? `Last contact ${core.fmtDate(n.lastContact, today)}` : ''] : [n.scripture, n.date ? core.fmtDate(n.date, today) : '', n.series]).filter(Boolean).join(' · ');
    txt.append(el(doc, 'div', 'ldl-titlecard-meta' + (meta ? '' : ' ldl-muted'), meta || (n.family === 'person' ? 'Person' : n.kind || 'Note')));
    const actions = el(doc, 'div', 'ldl-titlecard-actions');
    if (!['person', 'area', 'classic'].includes(n.family) && (n.statusLabel || on.status)) { const st = el(doc, 'button', 'ldl-chip ldl-st-' + (n.status || 'none'), n.statusLabel || 'Set status'); st.type = 'button'; st.title = 'Change status'; st.addEventListener('click', () => on.status(n.path)); actions.append(st); }
    if (hubNote) { const p = el(doc, 'button', 'ldl-link', `Part of ${hubNote.title}`); p.type = 'button'; p.addEventListener('click', () => on.hub(hubNote.path)); actions.append(p); }
    if (n.hub && n.count) { const p = el(doc, 'button', 'ldl-link', `${n.count} notes in this project`); p.type = 'button'; p.addEventListener('click', () => on.hub(n.path)); actions.append(p); }
    if (on.markTaught && core.teachable(n)) { const b = el(doc, 'button', 'ldl-link', 'Mark taught'); b.type = 'button'; b.addEventListener('click', () => on.markTaught(n.path)); actions.append(b); }
    if (n.family === 'meeting' && on.meetingTasks) { const b = el(doc, 'button', 'ldl-link', 'Send action items to Tasks'); b.type = 'button'; b.addEventListener('click', () => on.meetingTasks(n.path)); actions.append(b); }
    txt.append(actions);
    // Taught here, and the same passage taught from other notes.
    const short = d => core.fmtDate(d, today);
    if ((n.taught || []).length) txt.append(el(doc, 'div', 'ldl-titlecard-taught', `Taught: ${n.taught.slice(0, 4).map(t => `${short(t.date)}${t.group ? ` · ${t.group}` : ''}`).join('  ·  ')}${n.taught.length > 4 ? ` +${n.taught.length - 4}` : ''}`));
    const before = on.taughtBefore ? on.taughtBefore(n) : [];
    if (before.length) {
      const line = el(doc, 'div', 'ldl-titlecard-before');
      line.append(el(doc, 'span', '', `You’ve taught ${n.scripture} before: `));
      before.slice(0, 3).forEach((t, i) => { if (i) line.append(el(doc, 'span', '', ' · ')); const b = el(doc, 'button', 'ldl-link', `${short(t.date)}${t.group ? `, ${t.group}` : ''}`); b.type = 'button'; b.title = t.note.title; b.addEventListener('click', () => on.open(t.note.path)); line.append(b); });
      txt.append(line);
    }
    c.append(cover(doc, n), txt);
    return c;
  }
  // Follow-ups with a person, from the dashboard. data: { open: [...], last, today } or null when the dashboard isn't open.
  function followUps(doc, data, on) {
    const box = el(doc, 'section', 'ldl-followups'); box.setAttribute('aria-label', 'Follow-ups');
    const head = el(doc, 'div', 'ldl-section-head'); head.append(el(doc, 'div', 'ldl-kicker', 'Follow-ups from the Life Dashboard'));
    if (data && data.last) head.append(el(doc, 'span', 'ldl-muted ldl-small', `Last finished ${core.fmtDate(data.last, data.today)}`));
    box.append(head);
    if (!data) {
      const b = el(doc, 'button', 'ldl-link', 'Open the dashboard to see follow-ups'); b.type = 'button'; b.addEventListener('click', () => on.openDashboard()); box.append(b); return box;
    }
    const list = el(doc, 'div', 'ldl-fu-list');
    if (!data.open.length) list.append(el(doc, 'p', 'ldl-muted ldl-small', 'Nothing open with them.'));
    for (const t of data.open) {
      const row = el(doc, 'label', 'ldl-fu-row');
      const box2 = el(doc, 'input'); box2.type = 'checkbox'; box2.setAttribute('aria-label', `Done: ${t.title}`); box2.addEventListener('change', () => on.complete(t.id));
      const txt = el(doc, 'span', 'ldl-fu-text'); txt.append(el(doc, 'span', '', t.title));
      const bits = [t.waiting ? `Waiting${t.waitSince ? ` since ${core.fmtDate(t.waitSince, data.today)}` : ''}` : '', t.due ? (t.overdue ? `Overdue · ${core.fmtDate(t.due, data.today)}` : core.fmtDate(t.due, data.today)) : ''].filter(Boolean).join(' · ');
      if (bits) txt.append(el(doc, 'span', 'ldl-muted ldl-small' + (t.overdue ? ' ldl-overdue' : ''), bits));
      row.append(box2, txt); list.append(row);
    }
    const form = el(doc, 'form', 'ldl-fu-add'); const input = el(doc, 'input'); input.type = 'text'; input.placeholder = 'Add a follow-up… (dates work: fri, next week)'; input.setAttribute('aria-label', 'Add a follow-up');
    const add = el(doc, 'button', 'ldl-btn ldl-btn-primary', 'Add'); add.type = 'submit';
    form.addEventListener('submit', e => { e.preventDefault(); const v = input.value.trim(); if (v) { input.value = ''; on.addFollowUp(v); } });
    form.append(input, add); box.append(list, form);
    return box;
  }
  // The teaching record: each group's history, then groups not taught right now, then teaching to fill in.
  function taught(doc, rec, today, on) {
    const root = el(doc, 'div', 'ldl-root');
    const back = el(doc, 'button', 'ldl-back ldl-back-plain', '‹ Library'); back.type = 'button'; back.addEventListener('click', () => on.home());
    root.append(back, el(doc, 'h1', 'ldl-h1', 'Teaching record'));
    if (!rec.groups.length) root.append(el(doc, 'p', 'ldl-muted', 'List the groups you teach in the plugin’s settings (Teaching groups), then use Mark taught on a sermon or lesson.'));
    const section = (title, items, note) => {
      const sec = el(doc, 'section', 'ldl-section'), top = el(doc, 'div', 'ldl-section-head');
      top.append(el(doc, 'h2', 'ldl-h2', title)); if (note) top.append(el(doc, 'span', 'ldl-muted ldl-small', note)); sec.append(top);
      const list = el(doc, 'div', 'ldl-list'); sec.append(list); root.append(sec); return list;
    };
    const entry = (it, list) => {
      const b = el(doc, 'button', 'ldl-row'); b.type = 'button';
      b.append(el(doc, 'span', 'ldl-row-date', core.fmtDate(it.date, today)));
      const mid = el(doc, 'span', 'ldl-row-text'); mid.append(el(doc, 'span', 'ldl-row-title', it.note.title));
      const meta = [it.note.scripture, it.note.series].filter(Boolean).join(' · '); if (meta) mid.append(el(doc, 'span', 'ldl-row-meta', meta));
      b.append(mid); b.addEventListener('click', () => on.open(it.note.path)); list.append(b);
    };
    const active = rec.groups.filter(g => g.active), resting = rec.groups.filter(g => !g.active);
    active.forEach(g => { const list = section(g.name, g.items, `${g.items.length} taught`); if (!g.items.length) list.append(el(doc, 'p', 'ldl-muted ldl-small', 'Nothing recorded yet.')); g.items.forEach(it => entry(it, list)); });
    if (resting.length) {
      root.append(el(doc, 'div', 'ldl-kicker ldl-gap', 'Not teaching right now'));
      resting.forEach(g => { const list = section(g.name, g.items, `${g.items.length} taught`); g.items.forEach(it => entry(it, list)); });
    }
    if (rec.unrecorded.length) {
      const list = section('Taught, group not recorded', null, 'Choose the group once and it’s recorded');
      rec.unrecorded.slice(0, 40).forEach(n => {
        const r = el(doc, 'div', 'ldl-row ldl-row-static');
        r.append(el(doc, 'span', 'ldl-row-date', n.date ? core.fmtDate(n.date, today) : '—'));
        const mid = el(doc, 'span', 'ldl-row-text'); mid.append(el(doc, 'span', 'ldl-row-title', n.title)); if (n.scripture) mid.append(el(doc, 'span', 'ldl-row-meta', n.scripture));
        const b = el(doc, 'button', 'ldl-btn ldl-btn-soft', 'Record'); b.type = 'button'; b.addEventListener('click', () => on.markTaught(n.path));
        r.append(mid, b); list.append(r);
      });
    }
    return root;
  }
  // A passage preview. data: { label, translation, verses: [[n, text]], more, missing }
  function versePreview(doc, data, on) {
    const box = el(doc, 'div', 'ldl-verses'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', data.label);
    const head = el(doc, 'div', 'ldl-verses-head'); head.append(el(doc, 'span', 'ldl-verses-title', data.label)); if (data.translation) head.append(el(doc, 'span', 'ldl-muted ldl-small', data.translation));
    box.append(head);
    const body = el(doc, 'div', 'ldl-verses-body');
    if (data.missing) body.append(el(doc, 'p', 'ldl-muted', data.missing));
    data.verses.forEach(([n, t]) => { const p = el(doc, 'p', 'ldl-verse'); p.append(el(doc, 'sup', '', String(n)), doc.createTextNode(' ' + t)); body.append(p); });
    if (data.more) body.append(el(doc, 'p', 'ldl-muted ldl-small', `${data.more} more verse${data.more === 1 ? '' : 's'}`));
    box.append(body);
    const acts = el(doc, 'div', 'ldl-verses-actions');
    [['Open in reader', on.reader], ['Passage note', on.note], ['Read the chapter', on.chapter]].forEach(([label, fn]) => { if (!fn) return; const b = el(doc, 'button', 'ldl-link', label); b.type = 'button'; b.addEventListener('click', () => fn()); acts.append(b); });
    box.append(acts);
    return box;
  }
  return { home, hub, shelf, folder, taught, titleCard, followUps, versePreview };
})();

/* =============================== 3. plugin =============================== */
const { Plugin, ItemView, PluginSettingTab, Setting, Modal, SuggestModal, Notice, Platform, TFile, MarkdownView, normalizePath, debounce } = obsidian;
const VIEW_LIBRARY = 'life-dashboard-library', VIEW_DASH = 'life-dashboard-panel';
const DEFAULTS = {
  dashboardUrl: 'https://9r5wwng7nj-netizen.github.io/Life-Dashboard/',
  ignoreFolders: [], // reference text (Bible chapters, imported books) kept out of shelves, search and Recent
  shelves: ['sermon', 'study', 'series', 'meeting', 'book', 'classic', 'article', 'person'],
  sermonFolder: '',
  versePreviews: true, // Bible references in notes show their verses
  bibleSuffix: 'WEB', // chapter notes are named "John 13 (WEB)"
  passageFolder: '', // where passage notes live, one folder per book like the Bible's
  passageArchive: '', // archived passage notes, brought back when you open one
  groups: [], // teaching groups, one per line; "(inactive)" after a name for one not taught right now
  peopleFolder: '', // where profiles made from @Name in the dashboard go
  personTemplate: '', // a note whose text new profiles start from

  titleCards: true,
  hideProperties: true,
  openOnStartup: false,
  foldSidebar: false // fold the left sidebar away when the Library opens
};

class LibraryView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.page = { name: 'home' }; this.q = ''; this.navigation = true; }
  getViewType() { return VIEW_LIBRARY; }
  // Each Library page is part of the tab's history, so Obsidian's back and forward arrows step through it.
  getState() { return { page: this.page }; }
  async setState(state, result) { if (state && state.page) this.page = state.page; this.q = ''; this.draw(); this.contentEl.scrollTop = 0; return super.setState(state, result); }
  getDisplayText() { return 'Library'; }
  getIcon() { return 'library'; }
  async onOpen() { this.contentEl.addClass('ldl-view'); this.draw(); }
  show(page) { this.leaf.setViewState({ type: VIEW_LIBRARY, state: { page }, active: true }); }
  draw() {
    const lib = this.plugin.library(), doc = this.contentEl.ownerDocument, on = this.plugin.handlers(this);
    let node;
    if (this.page.name === 'hub') node = render.hub(doc, lib, this.page.path, on);
    else if (this.page.name === 'shelf') node = render.shelf(doc, lib, this.page.id, on);
    else if (this.page.name === 'taught') node = render.taught(doc, this.plugin.teaching(), lib.today, on);
    else if (this.page.name === 'folder') node = render.folder(doc, this.plugin.folderData(this.page.path || ''), lib.today, on);
    else node = render.home(doc, lib, on, this.q, this.q ? core.search(this.plugin.notes(), this.q, this.plugin.ignored()) : []);
    const focused = doc.activeElement && doc.activeElement.classList.contains('ldl-search');
    this.contentEl.empty(); this.contentEl.append(node);
    if (focused) { const s = this.contentEl.querySelector('.ldl-search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
  }
}

// The Life Dashboard in a panel. On the Mac it is a built-in browser that shares storage with Obsidian's Web viewer.
class DashboardView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW_DASH; }
  getDisplayText() { return 'Life Dashboard'; }
  getIcon() { return 'layout-dashboard'; }
  async onOpen() {
    const url = this.plugin.settings.dashboardUrl, c = this.contentEl; c.empty(); c.addClass('ldl-dash');
    if (!Platform.isDesktopApp) {
      c.createEl('p', { text: 'On the phone, use the Life Dashboard home-screen app. This panel works in Obsidian on the Mac.', cls: 'ldl-muted' });
      return;
    }
    const app = this.app, partition = (typeof app.getWebviewPartition === 'function' && app.getWebviewPartition()) || 'persist:life-dashboard';
    // Ask Obsidian to set this browser session up the way its Web viewer does (ordinary browser identity), so Google sign-in works.
    try { require('electron').ipcRenderer.send('create-browser-session', partition, false); } catch (e) { console.warn('Life Dashboard: browser session', e); }
    const wv = c.ownerDocument.createElement('webview');
    wv.setAttribute('partition', partition); wv.setAttribute('allowpopups', ''); wv.className = 'ldl-webview'; wv.setAttribute('src', url);
    wv.addEventListener('did-navigate-in-page', e => { if (e.isMainFrame !== false) this.plugin.onBridge(e.url, wv); });
    wv.addEventListener('dom-ready', () => this.plugin.greetDashboard(wv));
    c.append(wv); this.webview = wv;
  }
  async onClose() { this.webview = null; }
}

class TextModal extends Modal {
  constructor(app, title, fields, onSubmit, submitLabel) { super(app); this.title = title; this.fields = fields; this.onSubmit = onSubmit; this.submitLabel = submitLabel || 'Create'; }
  onOpen() {
    const { contentEl } = this; this.setTitle ? this.setTitle(this.title) : contentEl.createEl('h2', { text: this.title });
    const form = contentEl.createEl('form', { cls: 'ldl-form' }), values = {};
    for (const f of this.fields) {
      const lab = form.createEl('label', { cls: 'ldl-field' }); lab.createEl('span', { text: f.label });
      if (f.type === 'select') { const sel = lab.createEl('select', { cls: 'dropdown' }); f.options.forEach(o => sel.createEl('option', { text: o, value: o })); if (f.value) sel.value = f.value; values[f.key] = sel; continue; }
      const input = lab.createEl('input', { type: f.type || 'text', attr: { placeholder: f.placeholder || '' } });
      if (f.type === 'checkbox') { input.checked = !!f.value; lab.addClass('ldl-field-check'); lab.prepend(input); } else input.value = f.value || '';
      values[f.key] = input;
    }
    form.createEl('button', { text: this.submitLabel, cls: 'mod-cta', type: 'submit' });
    form.addEventListener('submit', e => { e.preventDefault(); const out = Object.fromEntries(Object.entries(values).map(([k, i]) => [k, i.type === 'checkbox' ? i.checked : i.value.trim()])); this.close(); this.onSubmit(out); });
    setTimeout(() => form.querySelector('input')?.focus(), 0);
  }
  onClose() { this.contentEl.empty(); }
}
// A list of items to tick; items already sent are shown greyed out.
class PickModal extends Modal {
  constructor(app, title, items, onSubmit) { super(app); this.title = title; this.items = items; this.onSubmit = onSubmit; }
  onOpen() {
    const { contentEl } = this; this.setTitle ? this.setTitle(this.title) : contentEl.createEl('h2', { text: this.title });
    contentEl.createEl('p', { text: 'Tick the ones that are yours. Follow-ups become “waiting on” tasks.', cls: 'ldl-muted' });
    const form = contentEl.createEl('form', { cls: 'ldl-form' }), boxes = [];
    let last = null;
    this.items.forEach(it => {
      if (it.section !== last) { form.createEl('div', { text: it.section, cls: 'ldl-kicker' }); last = it.section; }
      const lab = form.createEl('label', { cls: 'ldl-field ldl-field-check' + (it.done ? ' ldl-done' : '') });
      const box = lab.createEl('input', { type: 'checkbox' }); box.disabled = !!it.done;
      lab.createEl('span', { text: it.done ? `${it.text} (already sent)` : it.text });
      boxes.push([box, it]);
    });
    form.createEl('button', { text: 'Send to Tasks', cls: 'mod-cta', type: 'submit' });
    form.addEventListener('submit', e => { e.preventDefault(); const picked = boxes.filter(([b]) => b.checked && !b.disabled).map(([, it]) => it); this.close(); this.onSubmit(picked); });
  }
  onClose() { this.contentEl.empty(); }
}
class StatusModal extends SuggestModal {
  constructor(app, onPick) { super(app); this.onPick = onPick; this.setPlaceholder('Set status'); }
  getSuggestions(q) { return core.STATUS_CHOICES.filter(([, l]) => l.toLowerCase().includes(q.toLowerCase())); }
  renderSuggestion([, label], el) { el.setText(label); }
  onChooseSuggestion([, , word]) { this.onPick(word); }
}

class LifeDashboardPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.registerView(VIEW_LIBRARY, leaf => new LibraryView(leaf, this));
    this.registerView(VIEW_DASH, leaf => new DashboardView(leaf, this));
    this.addRibbonIcon('library', 'Open the Library', () => this.openLibrary());
    this.addCommand({ id: 'open-library', name: 'Open the Library', callback: () => this.openLibrary() });
    this.addCommand({ id: 'open-dashboard', name: 'Open Life Dashboard in the sidebar', callback: () => this.openDashboard() });
    this.addCommand({ id: 'new-sermon', name: 'New sermon', callback: () => this.newSermon() });
    this.addCommand({ id: 'meeting-tasks', name: 'Send this meeting’s action items to Tasks', checkCallback: checking => { const f = this.app.workspace.getActiveFile(); if (!f) return false; if (!checking) this.pickActions(f.path); return true; } });
    this.addCommand({ id: 'insert-passage', name: 'Insert a Bible passage', editorCallback: editor => this.insertPassage(editor) });
    this.addCommand({ id: 'passage-note', name: 'Open or start a passage note', callback: () => this.askPassageNote() });
    this.registerMarkdownPostProcessor((el, ctx) => this.markRefs(el, ctx.sourcePath));
    this.registerDomEvent(document, 'mouseover', e => this.refHover(e));
    this.registerDomEvent(document, 'click', e => this.refClick(e), true);
    this.registerDomEvent(document, 'keydown', e => { if (e.key === 'Escape') this.hideVerses(); });
    this.addCommand({ id: 'set-status', name: 'Set status of this note', checkCallback: checking => { const f = this.app.workspace.getActiveFile(); if (!f) return false; if (!checking) this.pickStatus(f.path); return true; } });
    this.addSettingTab(new LibrarySettings(this.app, this));
    const refresh = debounce(() => { this._notes = null; this.redraw(); }, 400, true);
    this.registerEvent(this.app.metadataCache.on('changed', refresh));
    this.registerEvent(this.app.vault.on('delete', refresh));
    this.registerEvent(this.app.vault.on('rename', refresh));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.decorateAll()));
    this.registerEvent(this.app.workspace.on('file-open', () => setTimeout(() => this.decorateAll(), 50)));
    this.app.workspace.onLayoutReady(() => { this._notes = null; this.decorateAll(); if (this.settings.openOnStartup) this.openLibrary(); });
  }
  onunload() { document.querySelectorAll('.ldl-titlecard').forEach(e => e.remove()); document.querySelectorAll('.ldl-carded').forEach(e => e.classList.remove('ldl-carded')); }
  async saveSettings() { await this.saveData(this.settings); this._notes = null; this.redraw(); this.decorateAll(); }

  // Every Markdown note as core.noteInfo, with `project` links resolved to paths. Cached until the vault changes.
  notes() {
    if (this._notes) return this._notes;
    const today = core.ymd(new Date()), mc = this.app.metadataCache;
    this._notes = this.app.vault.getMarkdownFiles().map(f => {
      const fm = mc.getFileCache(f)?.frontmatter;
      const n = core.noteInfo({ path: f.path, basename: f.basename, folder: f.parent ? f.parent.path : '', mtime: f.stat.mtime }, fm, today);
      if (n.projectLink) n.projectPath = mc.getFirstLinkpathDest(n.projectLink, f.path)?.path || null;
      return n;
    });
    return this._notes;
  }
  // Folders left out of the Library: the person's list plus the template folders (core Templates and Templater).
  ignored() {
    const out = [...(this.settings.ignoreFolders || [])], add = f => { f = String(f || '').trim().replace(/^\/+|\/+$/g, ''); if (f && !out.includes(f)) out.push(f); };
    try { add(this.app.internalPlugins?.plugins?.templates?.instance?.options?.folder); } catch (e) { }
    try { add(this.app.plugins?.plugins?.['templater-obsidian']?.settings?.templates_folder); } catch (e) { }
    return out;
  }
  inboxFolder() { try { return (this.app.vault.getConfig('newFileLocation') === 'folder' && this.app.vault.getConfig('newFileFolderPath')) || ''; } catch (e) { return ''; } }
  // One folder's contents for the Library's folder page (hidden folders left out; at most 300 notes listed).
  folderData(path) {
    const f = path ? this.app.vault.getAbstractFileByPath(path) : this.app.vault.getRoot();
    if (!f || !f.children) return null;
    const byPath = new Map(this.notes().map(n => [n.path, n])), today = core.ymd(new Date());
    const count = x => x.children ? x.children.reduce((a, c) => a + count(c), 0) : (x.extension === 'md' ? 1 : 0);
    const folders = f.children.filter(c => c.children && !c.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map(c => ({ path: c.path, name: c.name, count: count(c) }));
    const notes = f.children.filter(c => c.extension === 'md').map(c => byPath.get(c.path) || core.noteInfo({ path: c.path, basename: c.basename, folder: f.path, mtime: c.stat.mtime }, {}, today)).sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    const parts = path ? path.split('/') : [];
    return { path, name: parts.length ? parts[parts.length - 1] : 'All folders', crumbs: parts.map((p, i) => ({ name: p, path: parts.slice(0, i + 1).join('/') })), folders, notes: notes.slice(0, 300), more: Math.max(0, notes.length - 300) };
  }
  runCommand(id, missing) { const ok = this.app.commands?.executeCommandById?.(id); if (ok === false) new Notice(missing); }
  async newNote() {
    if (this.app.commands?.executeCommandById?.('file-explorer:new-file')) return;
    const folder = this.inboxFolder(), f = await this.createUnique(folder, 'Untitled', ''); await this.app.workspace.getLeaf(false).openFile(f);
  }
  teaching() { return core.teachingRecord(this.notes(), this.settings.groups, this.ignored()); }
  library() { const t = this.teaching(); return Object.assign(this.libraryData(), { inbox: this.inboxFolder(), teaching: this.settings.groups.length || t.total ? t.total : 0 }); }
  // Record that a sermon or lesson was taught: which group, when; and mark it Preached or Taught.
  markTaught(path) {
    const f = this.app.vault.getAbstractFileByPath(path); if (!(f instanceof TFile)) return;
    const groups = core.parseGroups(this.settings.groups), n = this.notes().find(x => x.path === path) || {};
    if (!groups.length) return new Notice('Add your teaching groups in Settings → Life Dashboard Library first.');
    const names = [...groups.filter(g => g.active), ...groups.filter(g => !g.active)].map(g => g.name);
    new TextModal(this.app, `Mark taught · ${f.basename}`, [
      { key: 'group', label: 'Group', type: 'select', options: names, value: (n.taught && n.taught[0] && n.taught[0].group) || names[0] },
      { key: 'date', label: 'Date', type: 'date', value: n.date && n.date <= core.ymd(new Date()) ? n.date : core.ymd(new Date()) },
      { key: 'done', label: n.family === 'sermon' ? 'Mark it Preached' : 'Mark it Taught', type: 'checkbox', value: true }
    ], async v => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date || '') || !v.group) return new Notice('Choose a group and a date');
      await this.app.fileManager.processFrontMatter(f, fm => {
        const list = [...new Set([...[].concat(fm.taught || []).map(String), core.taughtEntry(v.date, v.group)])];
        fm.taught = core.parseTaught(list).map(t => core.taughtEntry(t.date, t.group));
        if (v.done) fm.status = n.family === 'sermon' ? 'preached' : 'taught';
      });
      new Notice(`Recorded: ${v.group}, ${v.date}`);
    }, 'Save').open();
  }
  libraryData() { return core.buildLibrary(this.notes().map(n => ({ ...n })), { today: core.ymd(new Date()), ignoreFolders: this.ignored(), shelves: this.settings.shelves }); }
  handlers(view) {
    return {
      open: path => this.openNote(path),
      hub: path => view ? view.show({ name: 'hub', path }) : this.openLibrary({ name: 'hub', path }),
      shelf: id => view.show({ name: 'shelf', id }),
      home: () => view.show({ name: 'home' }),
      folder: path => view ? view.show({ name: 'folder', path }) : this.openLibrary({ name: 'folder', path }),
      newNote: () => this.newNote(),
      taught: () => view ? view.show({ name: 'taught' }) : this.openLibrary({ name: 'taught' }),
      markTaught: path => this.markTaught(path),
      taughtBefore: n => core.taughtBefore(n, this.notes().filter(x => !core.inFolder(x.path, this.ignored()))),
      newSermon: () => this.newSermon(),
      // Today's note only when the Daily notes core plugin is on (a person may let the Life Dashboard own the day).
      today: this.app.internalPlugins?.plugins?.['daily-notes']?.enabled ? () => this.runCommand('daily-notes', 'Turn on Daily notes in Settings → Core plugins to use Today’s note.') : undefined,
      search: q => { view.q = q; view.draw(); },
      status: path => this.pickStatus(path),
      meetingTasks: path => this.pickActions(path)
    };
  }
  redraw() { for (const leaf of this.app.workspace.getLeavesOfType(VIEW_LIBRARY)) leaf.view.draw?.(); }
  async openNote(path) { const f = this.app.vault.getAbstractFileByPath(path); if (f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f); }
  async openLibrary(page) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_LIBRARY)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW_LIBRARY, active: true }); }
    this.app.workspace.revealLeaf(leaf);
    if (page) leaf.view.show?.(page);
    if (this.settings.foldSidebar) this.app.workspace.leftSplit?.collapse?.();
  }
  async openDashboard() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_DASH)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false); await leaf.setViewState({ type: VIEW_DASH, active: true }); }
    this.app.workspace.revealLeaf(leaf);
  }
  pickStatus(path) {
    const f = this.app.vault.getAbstractFileByPath(path); if (!(f instanceof TFile)) return;
    new StatusModal(this.app, async word => { await this.app.fileManager.processFrontMatter(f, fm => { fm.status = word; }); new Notice(`Status set to ${word}`); }).open();
  }
  // Tick the action items that are yours; they go to the dashboard as tasks linked back to this meeting.
  async pickActions(path) {
    const f = this.app.vault.getAbstractFileByPath(path); if (!(f instanceof TFile)) return;
    if (!Platform.isDesktopApp) return new Notice('Send action items from Obsidian on the Mac, where the dashboard is docked.');
    const items = core.actionItems(await this.app.vault.cachedRead(f));
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter || {}, sent = new Set([].concat(fm.tasks_sent || []).map(String));
    if (!items.length) return new Notice('No open action items found under an Action items or Follow-ups heading.');
    new PickModal(this.app, `Action items · ${f.basename}`, items.map(it => ({ ...it, done: sent.has(it.text) })), async picked => {
      if (!picked.length) return;
      await this.sendToDashboard(core.meetingTasksMessage(f.basename, picked, fm.areas || fm.area));
      await this.app.fileManager.processFrontMatter(f, fm => { fm.tasks_sent = [...new Set([...[].concat(fm.tasks_sent || []), ...picked.map(it => it.text)])]; });
      new Notice(`Sent ${picked.length} to Tasks`);
    }).open();
  }
  newSermon() {
    const today = core.ymd(new Date());
    new TextModal(this.app, 'New sermon', [
      { key: 'passage', label: 'Passage', placeholder: 'e.g. Luke 15:11-32' },
      { key: 'title', label: 'Title (optional)' },
      { key: 'date', label: 'Preaching date', type: 'date' },
      { key: 'series', label: 'Series (optional)' },
      ...(Platform.isDesktopApp ? [{ key: 'tasks', label: 'Add the prep tasks to the Life Dashboard', type: 'checkbox', value: true }] : [])
    ], async v => {
      if (!v.passage && !v.title) return new Notice('Add a passage or a title');
      const s = core.sermonNotes(v, today), base = core.safeFolder(this.settings.sermonFolder || '') || '';
      const folder = normalizePath([base, s.folder].filter(Boolean).join('/'));
      try {
        if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
        const hub = await this.createUnique(folder, s.hub.name, s.hub.content);
        await this.createUnique(folder, s.manuscript.name, s.manuscript.content);
        await this.app.workspace.getLeaf(false).openFile(hub);
        new Notice('Sermon created');
        if (v.tasks) this.sendToDashboard(core.sermonPrepMessage(v, s));
      } catch (e) { console.error(e); new Notice('Could not create the sermon: ' + e.message); }
    }).open();
  }
  async createUnique(folder, name, content) {
    let path = normalizePath(`${folder ? folder + '/' : ''}${name}.md`), i = 2;
    while (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${folder ? folder + '/' : ''}${name} ${i++}.md`);
    return this.app.vault.create(path, content);
  }

  // Title cards: added to the top of notes in reading view.
  decorateAll() { this.app.workspace.getLeavesOfType('markdown').forEach(l => this.decorate(l.view)); }
  decorate(view) {
    if (!(view instanceof MarkdownView)) return;
    const root = view.containerEl, header = root.querySelector('.markdown-reading-view .mod-header');
    root.querySelectorAll('.ldl-titlecard').forEach(e => e.remove()); root.classList.remove('ldl-carded');
    if (!this.settings.titleCards || !header || !view.file) return;
    const n = this.notes().find(x => x.path === view.file.path); if (!n || !n.family) return;
    const lib = this.library(), hubNote = n.projectPath ? lib.byPath.get(n.projectPath) : null, self = lib.byPath.get(n.path) || n;
    const card = render.titleCard(root.ownerDocument, self, hubNote, this.handlers(null));
    const title = header.querySelector('.inline-title'); title ? title.after(card) : header.prepend(card);
    if (this.settings.hideProperties) root.classList.add('ldl-carded');
    if (n.family === 'person' && Platform.isDesktopApp) this.fillFollowUps(card, view.file);
  }

  // People: open follow-ups from the dashboard under the person's title card (Mac only, with the dashboard docked).
  async fillFollowUps(card, file) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {}, names = core.personNames(file.basename, fm);
    const data = await this.queryDashboard({ personTasks: { names, note: file.basename } });
    if (!card.isConnected) return;
    card.parentElement?.querySelectorAll('.ldl-followups').forEach(e => e.remove());
    const refresh = () => setTimeout(() => { if (card.isConnected) this.fillFollowUps(card, file); }, 600);
    card.after(render.followUps(card.ownerDocument, data, {
      openDashboard: async () => { await this.openDashboard(); setTimeout(() => this.fillFollowUps(card, file), 2500); },
      complete: async id => { await this.sendToDashboard({ completeTask: id }); refresh(); },
      addFollowUp: async text => { await this.sendToDashboard({ addTasks: { source: file.basename, items: [{ title: text, person: file.basename }] } }); refresh(); }
    }));
  }
  // Ask the docked dashboard a question; null when it isn't open or hasn't loaded yet.
  async queryDashboard(q) {
    const view = this.app.workspace.getLeavesOfType(VIEW_DASH)[0]?.view, wv = view?.webview;
    if (!wv || wv.isLoading?.()) return null;
    try { return await wv.executeJavaScript(`window.LD_QUERY ? window.LD_QUERY(${JSON.stringify(q)}) : null`); } catch (e) { return null; }
  }
  // --- Verse previews
  // The chapter note for a reference ("John 13 (WEB)"), found by name wherever the Bible lives.
  chapterFile(book, c) { const f = this.app.metadataCache.getFirstLinkpathDest(`${book} ${c} (${this.settings.bibleSuffix || 'WEB'})`, ''); return f instanceof TFile ? f : null; }
  markRefs(el, sourcePath) {
    if (!this.settings.versePreviews) return;
    const bible = this.chapterFile('John', 1); if (!bible || (sourcePath && sourcePath.startsWith(bible.parent?.parent?.path + '/'))) return; // no Bible here, or a Bible chapter itself
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement && n.parentElement.closest('code, pre, a, .ldl-ref, .ldl-titlecard, .frontmatter, .metadata-container') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const refs = core.findRefs(node.nodeValue).filter(r => this.chapterFile(r.book, r.c)); if (!refs.length) continue;
      const frag = el.ownerDocument.createDocumentFragment(); let at = 0;
      for (const r of refs) {
        frag.append(node.nodeValue.slice(at, r.start));
        const span = el.ownerDocument.createElement('span'); span.className = 'ldl-ref'; span.textContent = r.text; span.tabIndex = 0; span.setAttribute('role', 'button');
        span.dataset.ref = JSON.stringify({ book: r.book, c: r.c, v1: r.v1, v2: r.v2, c2: r.c2, label: r.label }); frag.append(span); at = r.end;
      }
      frag.append(node.nodeValue.slice(at)); node.replaceWith(frag);
    }
  }
  refHover(e) {
    const t = e.target instanceof Element && e.target.closest('.ldl-ref');
    if (t && !Platform.isMobile) { clearTimeout(this._vt); this._vt = setTimeout(() => this.showVerses(t), 250); return; }
    if (this._pop && !(e.target instanceof Element && e.target.closest('.ldl-verses'))) { clearTimeout(this._vt); this._vt = setTimeout(() => this.hideVerses(), 400); }
  }
  refClick(e) {
    const t = e.target instanceof Element && e.target.closest('.ldl-ref');
    if (t) { e.preventDefault(); e.stopPropagation(); this.showVerses(t); return; }
    if (this._pop && !(e.target instanceof Element && e.target.closest('.ldl-verses'))) this.hideVerses();
  }
  hideVerses() { clearTimeout(this._vt); this._pop?.remove(); this._pop = null; this._popFor = null; }
  async showVerses(anchor) {
    if (this._popFor === anchor && this._pop) return;
    let r; try { r = JSON.parse(anchor.dataset.ref); } catch (e) { return; }
    const f = this.chapterFile(r.book, r.c); if (!f) return;
    const all = core.chapterVerses(await this.app.vault.cachedRead(f)), picked = core.versesFor(all, r), shown = picked.slice(0, 12);
    const data = { label: r.label, translation: this.settings.bibleSuffix || '', verses: shown, more: picked.length - shown.length, missing: picked.length ? '' : 'Those verses aren’t in this chapter.' };
    this.hideVerses();
    const pop = render.versePreview(anchor.ownerDocument, data, {
      reader: Platform.isDesktopApp ? () => { this.hideVerses(); this.sendToDashboard({ openPassage: r.label }); } : null,
      note: () => { this.hideVerses(); this.openPassageNote(r.book, r.c); },
      chapter: () => { this.hideVerses(); this.app.workspace.openLinkText(`${f.basename}${r.v1 ? `#^v${r.v1}` : ''}`, '', false); }
    });
    pop.addEventListener('mouseleave', () => { clearTimeout(this._vt); this._vt = setTimeout(() => this.hideVerses(), 400); });
    pop.addEventListener('mouseenter', () => clearTimeout(this._vt));
    anchor.ownerDocument.body.append(pop); this._pop = pop; this._popFor = anchor;
    if (Platform.isMobile) { pop.classList.add('ldl-verses-sheet'); return; }
    const rect = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, win = anchor.ownerDocument.defaultView;
    pop.style.left = `${Math.max(8, Math.min(rect.left, win.innerWidth - w - 8))}px`;
    pop.style.top = `${rect.bottom + h + 12 < win.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - h - 6)}px`;
  }
  // A chapter's passage note: open it, bring it back from the archive, or start one (named like "John 13").
  async openPassageNote(book, c) {
    const name = `${book} ${c}`, base = core.safeFolder(this.settings.passageFolder || '') || '', arc = core.safeFolder(this.settings.passageArchive || '') || '';
    const files = this.app.vault.getMarkdownFiles().filter(f => f.basename === name);
    const live = files.find(f => base && f.path.startsWith(base + '/')), archived = files.find(f => arc && f.path.startsWith(arc + '/'));
    if (live) return this.app.workspace.getLeaf(false).openFile(live);
    const bookFolder = this.chapterFile(book, c)?.parent?.name || book, folder = normalizePath([base, bookFolder].filter(Boolean).join('/'));
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    if (archived) { await this.app.fileManager.renameFile(archived, normalizePath(`${folder}/${name}.md`)); new Notice(`${name}: brought back from the archive`); return this.app.workspace.getLeaf(false).openFile(archived); }
    const created = await this.createUnique(folder, name, core.passageNoteText(book, c, core.ymd(new Date())) + `- [[${book} ${c} (${this.settings.bibleSuffix || 'WEB'})|${book} ${c} — ${this.settings.bibleSuffix || 'WEB'} text]]\n`);
    return this.app.workspace.getLeaf(false).openFile(created);
  }
  askPassageNote() {
    new TextModal(this.app, 'Passage note', [{ key: 'ref', label: 'Chapter', placeholder: 'e.g. John 13' }], v => {
      const r = core.parseRefText(v.ref); if (!r || !this.chapterFile(r.book, r.c)) return new Notice('That chapter isn’t in your Bible folder');
      this.openPassageNote(r.book, r.c);
    }, 'Open').open();
  }
  // Insert a passage as a quote at the cursor; a selected reference is used as the starting text.
  insertPassage(editor) {
    new TextModal(this.app, 'Insert a Bible passage', [{ key: 'ref', label: 'Passage', placeholder: 'e.g. John 13:1-5', value: editor.getSelection() }], async v => {
      const r = core.parseRefText(v.ref), f = r && this.chapterFile(r.book, r.c);
      if (!f) return new Notice('That passage isn’t in your Bible folder');
      const verses = core.versesFor(core.chapterVerses(await this.app.vault.cachedRead(f)), r);
      if (!verses.length) return new Notice('Those verses aren’t in this chapter');
      editor.replaceSelection(core.passageCallout(r, verses, this.settings.bibleSuffix));
    }, 'Insert').open();
  }
  // --- Bridge with the docked dashboard
  async onBridge(url, wv) {
    const msg = core.readBridge(url, this.settings.dashboardUrl); if (!msg) return;
    try { await wv.executeJavaScript("history.replaceState(null, '', location.pathname + location.search)"); } catch (e) { /* page went away */ }
    if (msg.open) {
      const f = this.app.metadataCache.getFirstLinkpathDest(msg.open, '') || this.app.vault.getAbstractFileByPath(msg.open);
      if (f instanceof TFile) return this.app.workspace.getLeaf(false).openFile(f);
      return new Notice(`No note called “${msg.open}”`);
    }
    if (msg.people) {
      const have = new Set(this.notes().filter(n => n.family === 'person').map(n => n.title.toLowerCase()));
      const folder = core.safeFolder(this.settings.peopleFolder || '') || '', today = core.ymd(new Date());
      const tf = this.settings.personTemplate && this.app.vault.getAbstractFileByPath(normalizePath(this.settings.personTemplate.replace(/(\.md)?$/, '.md')));
      const template = tf instanceof TFile ? await this.app.vault.cachedRead(tf) : '';
      const made = [];
      for (const name of msg.people) {
        if (have.has(name.toLowerCase()) || this.app.metadataCache.getFirstLinkpathDest(name, '')) continue;
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
        await this.createUnique(folder, name, core.personNote(name, template, today)); made.push(name);
      }
      if (made.length) { new Notice(`New profile${made.length === 1 ? '' : 's'}: ${made.join(', ')}`); this._notes = null; setTimeout(() => this.greetDashboard(wv), 800); }
      return;
    }
    if (msg.create) {
      const { folder, name, content } = msg.create;
      if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      const f = await this.createUnique(folder, name, content);
      new Notice(`Saved to ${f.path}`); return this.app.workspace.getLeaf(false).openFile(f);
    }
  }
  // Tell the dashboard it is inside Obsidian, with the note names it can link a task to; then deliver waiting messages.
  greetDashboard(wv) {
    const names = this.notes().filter(n => n.family && !core.inFolder(n.path, this.ignored())).map(n => n.title).slice(0, 5000);
    const people = this.notes().filter(n => n.family === 'person').map(n => n.title);
    const info = { vault: this.app.vault.getName(), notes: names, people, prefix: core.BRIDGE_PREFIX };
    wv.executeJavaScript(`window.LD_OBSIDIAN = ${JSON.stringify(info)}; window.dispatchEvent(new Event('ld-obsidian'));`).catch(() => { });
    const waiting = this.pending || []; this.pending = [];
    waiting.forEach(msg => this.deliver(wv, msg));
  }
  // The dashboard queues messages until its saved data has loaded, so a message can go as soon as the page is ready.
  async deliver(wv, msg) {
    try { return !!(await wv.executeJavaScript(`window.LD_FROM_OBSIDIAN ? window.LD_FROM_OBSIDIAN(${JSON.stringify(msg)}) : false`)); }
    catch (e) { return false; }
  }
  async sendToDashboard(msg) {
    if (!Platform.isDesktopApp) return;
    const view = this.app.workspace.getLeavesOfType(VIEW_DASH)[0]?.view;
    if (view?.webview && !view.webview.isLoading?.() && await this.deliver(view.webview, msg)) return;
    (this.pending = this.pending || []).push(msg);
    await this.openDashboard(); // its dom-ready delivers the waiting message
  }
}

class LibrarySettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this, s = this.plugin.settings, save = () => this.plugin.saveSettings();
    containerEl.empty();
    new Setting(containerEl).setName('Life Dashboard address').setDesc('Opened in the docked panel on the Mac.')
      .addText(t => t.setValue(s.dashboardUrl).onChange(v => { s.dashboardUrl = v.trim(); save(); }));
    new Setting(containerEl).setName('Folders to leave out').setDesc('One per line. Reference text such as imported Bible chapters stays in the vault but out of shelves, search and Recent.')
      .addTextArea(t => t.setValue(s.ignoreFolders.join('\n')).onChange(v => { s.ignoreFolders = v.split('\n').map(x => x.trim()).filter(Boolean); save(); }));
    new Setting(containerEl).setName('Shelves').setDesc(`In order, separated by commas. Choices: ${Object.keys(core.FAMILIES).join(', ')}.`)
      .addText(t => t.setValue(s.shelves.join(', ')).onChange(v => { s.shelves = v.split(',').map(x => x.trim()).filter(x => core.FAMILIES[x]); save(); }));
    new Setting(containerEl).setName('Folder for new sermons').setDesc('Each new sermon gets its own folder inside this one.')
      .addText(t => t.setValue(s.sermonFolder).setPlaceholder('e.g. 02 Projects').onChange(v => { s.sermonFolder = v.trim(); save(); }));
    new Setting(containerEl).setName('Teaching groups').setDesc('One per line. Add (inactive) after a group you aren’t teaching right now; its history stays.')
      .addTextArea(t => t.setValue(s.groups.join('\n')).setPlaceholder('Connect Group\nCollege Night\nYouth (inactive)').onChange(v => { s.groups = v.split('\n').map(x => x.trim()).filter(Boolean); save(); }));
    new Setting(containerEl).setName('Folder for new people').setDesc('Where a profile goes when you type @Name in a dashboard task and they have none.')
      .addText(t => t.setValue(s.peopleFolder).setPlaceholder('e.g. 04 People').onChange(v => { s.peopleFolder = v.trim(); save(); }));
    new Setting(containerEl).setName('Template for new people').setDesc('A note new profiles start from. {{title}} and {{date}} are filled in.')
      .addText(t => t.setValue(s.personTemplate).setPlaceholder('e.g. Templates/Person').onChange(v => { s.personTemplate = v.trim(); save(); }));
    new Setting(containerEl).setName('Verse previews').setDesc('Bible references in notes show their verses when you point at or tap them.')
      .addToggle(t => t.setValue(s.versePreviews).onChange(v => { s.versePreviews = v; save(); }));
    new Setting(containerEl).setName('Bible translation in chapter names').setDesc('Chapter notes are named like “John 13 (WEB)”; this is the part in brackets.')
      .addText(t => t.setValue(s.bibleSuffix).onChange(v => { s.bibleSuffix = v.trim() || 'WEB'; save(); }));
    new Setting(containerEl).setName('Passage notes folder').setDesc('New passage notes go here, in a folder per book like your Bible’s.')
      .addText(t => t.setValue(s.passageFolder).setPlaceholder('e.g. Scripture/Passage Notes').onChange(v => { s.passageFolder = v.trim(); save(); }));
    new Setting(containerEl).setName('Archived passage notes').setDesc('A passage note found here is moved back when you open it.')
      .addText(t => t.setValue(s.passageArchive).setPlaceholder('e.g. Archive/Passage Notes').onChange(v => { s.passageArchive = v.trim(); save(); }));
    new Setting(containerEl).setName('Title cards').setDesc('Show a card with the passage, date and status at the top of notes in reading view.')
      .addToggle(t => t.setValue(s.titleCards).onChange(v => { s.titleCards = v; save(); }));
    new Setting(containerEl).setName('Hide the properties box under title cards')
      .addToggle(t => t.setValue(s.hideProperties).onChange(v => { s.hideProperties = v; save(); }));
    new Setting(containerEl).setName('Fold the left sidebar away when the Library opens').setDesc('The Library has every section and folder; the sidebar button at the top left still opens it.')
      .addToggle(t => t.setValue(s.foldSidebar).onChange(v => { s.foldSidebar = v; save(); }));
    new Setting(containerEl).setName('Open the Library when Obsidian starts')
      .addToggle(t => t.setValue(s.openOnStartup).onChange(v => { s.openOnStartup = v; save(); }));
  }
}

module.exports = LifeDashboardPlugin;
module.exports.default = LifeDashboardPlugin;
module.exports.core = core;
module.exports.render = render;
