// The Claude connector on the reader Worker (reader/connector.js), run in Node with Google, Drive and Open Food
// Facts faked: the sign-in Claude goes through, rotating tokens, each tool against a copy the dashboard would
// write, the drop box for additions, and disconnecting.
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import worker from '../reader/worker.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ORIGIN = 'https://reader.example', CLAUDE = 'https://claude.ai/api/mcp/auth_callback', SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const iso = d => d.toISOString().slice(0, 10), TODAY = iso(new Date());
const plus = n => { const t = new Date(TODAY + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return iso(t); };
const MONDAY = plus(-((new Date(TODAY + 'T12:00:00Z').getUTCDay() + 6) % 7)), YEAR = TODAY.slice(0, 4), LAST_YEAR = String(+YEAR - 1);
const reply = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

const NOW = {
  v: 1, made: new Date().toISOString(), today: TODAY, tz: 'UTC', name: 'Sam', unit: 'lbs', targets: { cal: 2200, p: 180, c: 200, f: 70 },
  tasks: [
    { id: 't1', title: 'Call the plumber', due: TODAY, time: '15:00', area: 'home', big3: true },
    { id: 't2', title: 'Finish lesson outline', due: plus(-2), area: 'ministry', project: 'Fall study' },
    { id: 't3', title: 'Repaint the shed', due: plus(-5), someday: true },
    { id: 't4', title: 'Book dentist', due: plus(3), area: 'personal', person: 'Pat' },
    { id: 't5', title: 'Sort photos', inbox: true },
    { id: 't6', title: 'Learn the guitar', someday: true }
  ],
  done: [{ id: 'd1', title: 'Pay the water bill', done: plus(-1), area: 'home' }],
  projects: [{ id: 'p1', name: 'Fall study', area: 'ministry', status: 'active', open: 1 }],
  week: { monday: MONDAY, big3: [{ id: 't1', title: 'Call the plumber', done: false }] },
  blocks: { [TODAY]: [{ start: '09:00', mins: 60, title: 'Study' }] },
  food: [{ d: TODAY, cal: 640, p: 42, c: 60, f: 24, tc: 2200, tp: 180, e: [['breakfast', 'Oatmeal', '1 cup', 300, 10, 54, 6], ['lunch', 'Turkey sandwich', '', 340, 32, 6, 18]] }],
  weight: { unit: 'lbs', trend: 182.4, change7: '−0.8 lbs', last: [{ d: plus(-1), w: 182.0 }] },
  workouts: { next: 'Push B', recent: [{ d: plus(-2), name: 'Push A', min: 58, sets: 12, vol: 9000, ex: [['Bench Press', '185 lbs × 5, 185 lbs × 5', '185 lbs × 5']] }] },
  reading: { plan: 'Bible in a year', days: { [TODAY]: 'Isaiah 40–42' }, streak: 12 },
  prayers: [{ id: 'pr1', title: 'Pat’s new job', cat: 'Friends', since: plus(-20), count: 3 }],
  family: { people: [{ name: 'Pat', role: 'Friend', birthday: plus(10).slice(5) }], dates: [{ d: plus(10), what: 'Pat’s birthday' }, { d: plus(90), what: 'Too far off' }] },
  meals: { plan: { [TODAY]: [{ slot: 'dinner', title: 'Chili' }] }, grocery: [{ name: 'Milk', qty: 1, unit: 'gal' }], recipes: [{ id: 'r1', title: 'Chili', servings: 6, cal: 420, p: 30, c: 35, f: 15 }] },
  foods: [{ id: 'f1', name: 'Protein shake', brand: 'Acme', per: '1 scoop (32 g)', cal: 120, p: 24, c: 3, f: 1.5 }],
  media: { active: [{ title: 'Knowing God', kind: 'book' }] },
  weeks: [{ from: MONDAY, workouts: 2, tasksDone: 5 }, { from: plus(-7), workouts: 3, tasksDone: 9 }]
};
const jsonl = rows => rows.map(r => JSON.stringify(r)).join('\n');
const DAYS = jsonl([
  { d: plus(-2), cal: 2100, p: 170, c: 210, f: 70, tc: 2200, tp: 180, w: 182.6, e: [['dinner', 'Steak', '8 oz', 600, 60, 0, 40]] },
  { d: plus(-1), cal: 1900, p: 160, c: 190, f: 60, tc: 2200, tp: 180, e: [] },
  { d: TODAY, cal: 640, p: 42, c: 60, f: 24, tc: 2200, tp: 180, e: [['breakfast', 'Oatmeal', '1 cup', 300, 10, 54, 6]] }
]);
const WORKOUTS = jsonl([
  { d: plus(-9), id: 'w0', name: 'Push A', min: 60, sets: 12, vol: 8800, ex: [['Bench Press', '180 lbs × 5, 180 lbs × 5', '180 lbs × 5']] },
  { d: plus(-2), id: 'w1', name: 'Push A', min: 58, sets: 12, vol: 9000, ex: [['Bench Press', '185 lbs × 5, 185 lbs × 5', '185 lbs × 5'], ['Dips', '12 reps', '12 reps']] }
]);
const NOTES = jsonl([
  { d: plus(-3), s: 'journal', id: 'j1', t: 'Slow morning', x: 'Learning patience with the kids. A full day of journal writing.' },
  { d: plus(-1), s: 'journal', id: 'j2', t: 'Walk', x: 'A long walk and a good talk.' },
  { d: plus(-1), s: 'prayer', id: 'pr1', t: 'Pat’s new job', x: 'First week went well', cat: 'Friends' }
]);
const OLD_NOTES = jsonl([{ d: LAST_YEAR + '-03-01', s: 'scripture', id: 's1', t: 'James 1', x: 'Patience has its perfect work.', ref: 'James 1:2-4' }]);

function setup() {
  const kv = new Map(), drive = new Map(), google = [], revoked = []; let n = 0, refreshRefused = false, driveRefuses = false;
  const put = (name, body) => { const id = 'f' + ++n; drive.set(id, { id, name, body, modifiedTime: new Date(Date.now() + n).toISOString() }); return id; };
  const env = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'shh', CONNECTOR_KEY: 'test-key', CONNECTOR_KV: { get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); } } };
  const stored = new Map(), later = [], ctx = { waitUntil: p => later.push(p) };
  globalThis.caches = { default: { match: async req => stored.get(req.url)?.clone() || null, put: async (req, res) => { stored.set(req.url, res); } } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, opts = {}) => {
    const url = new URL(String(input)), method = (opts.method || 'GET').toUpperCase();
    if (url.href === 'https://oauth2.googleapis.com/token') {
      const form = Object.fromEntries(new URLSearchParams(String(opts.body))); google.push(form);
      if (form.grant_type === 'refresh_token' && refreshRefused) return reply({ error: 'invalid_grant' }, 400);
      return reply(form.grant_type === 'authorization_code' ? { access_token: 'gat1', expires_in: 3599, refresh_token: 'grt', scope: SCOPE } : { access_token: 'gat2', expires_in: 3599, scope: SCOPE });
    }
    if (url.href === 'https://oauth2.googleapis.com/revoke') { revoked.push(String(new URLSearchParams(String(opts.body)).get('token'))); return new Response('', { status: 200 }); }
    if (url.origin === 'https://www.googleapis.com') {
      if (driveRefuses || !/^Bearer gat[12]$/.test(opts.headers?.Authorization || '')) return reply({}, 401);
      if (method === 'GET' && url.pathname === '/drive/v3/files') return reply({ files: [...drive.values()].filter(f => f.name.includes('claude')).map(({ id, name, modifiedTime }) => ({ id, name, modifiedTime })) });
      const m = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
      if (m && method === 'GET') { const f = drive.get(decodeURIComponent(m[1])); return f ? new Response(f.body) : new Response('', { status: 404 }); }
      if (m && method === 'DELETE') { drive.delete(decodeURIComponent(m[1])); return new Response(null, { status: 204 }); }
      if (method === 'POST' && url.pathname === '/upload/drive/v3/files') { const parts = String(opts.body).split('\r\n\r\n'); return reply({ id: put(JSON.parse(parts[1].split('\r\n')[0]).name, parts[2].split('\r\n--')[0]) }); }
    }
    if (url.hostname === 'search.openfoodfacts.org') return reply({ hits: [{ code: '1', product_name: 'Energy bites', brands: ['Trail Co'], serving_size: '2 bites (30 g)', serving_quantity: 30, nutriments: { 'energy-kcal_100g': 420, proteins_100g: 9, carbohydrates_100g: 50, fat_100g: 20 } }] });
    throw new Error('Unexpected request ' + url);
  };
  const call = (path, init = {}) => worker.fetch(new Request(ORIGIN + path, init), env, ctx);
  const restore = () => { globalThis.fetch = realFetch; delete globalThis.caches; };
  const file = name => [...drive.values()].find(f => f.name === name);
  const inbox = () => [...drive.values()].filter(f => f.name.startsWith('claude-inbox-')).sort((a, b) => a.name.localeCompare(b.name)).map(f => JSON.parse(f.body));
  return { env, kv, drive, google, revoked, put, call, restore, file, inbox, later, refuseRefresh: v => { refreshRefused = v; }, refuseDrive: v => { driveRefuses = v; } };
}
const form = body => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
async function connect(s, verifier = 'v'.repeat(50)) {
  const reg = await (await s.call('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: [CLAUDE], client_name: 'Claude', token_endpoint_auth_method: 'none' }) })).json();
  const asked = { response_type: 'code', client_id: reg.client_id, redirect_uri: CLAUDE, state: 'st1', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' };
  const consent = await s.call('/oauth/authorize?' + new URLSearchParams(asked)), html = await consent.text();
  const googleUrl = new URL(html.match(/href="(https:\/\/accounts\.google\.com[^"]+)"/)[1].replace(/&amp;/g, '&'));
  const back = await s.call('/oauth/google?' + new URLSearchParams({ code: 'gcode', state: googleUrl.searchParams.get('state') }));
  const to = new URL(back.headers.get('Location'));
  const tok = await s.call('/oauth/token', form({ grant_type: 'authorization_code', code: to.searchParams.get('code'), code_verifier: verifier, client_id: reg.client_id, redirect_uri: CLAUDE }));
  return { reg, asked, consent, html, googleUrl, back, to, tok: await tok.json() };
}
let rid = 0;
const rpc = (s, token, method, params) => s.call('/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
async function tool(s, token, name, args = {}) {
  const r = await rpc(s, token, 'tools/call', { name, arguments: args }), b = await r.json(), text = b.result.content[0].text;
  let data = null; try { data = JSON.parse(text); } catch (e) { }
  return { error: !!b.result.isError, text, data };
}
function withCopy(s) {
  s.put('claude-now.json', JSON.stringify(NOW)); s.put(`claude-days-${YEAR}.jsonl`, DAYS); s.put(`claude-workouts-${YEAR}.jsonl`, WORKOUTS);
  s.put(`claude-notes-${YEAR}.jsonl`, NOTES); s.put(`claude-notes-${LAST_YEAR}.jsonl`, OLD_NOTES);
}

test('Claude signs in through the connector: discovery, registration, consent, Google and tokens', async () => {
  const s = setup();
  try {
    const bare = await s.call('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(bare.status).toBe(401);
    expect(bare.headers.get('WWW-Authenticate')).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`);
    expect(await (await s.call('/.well-known/oauth-protected-resource/mcp')).json()).toMatchObject({ resource: ORIGIN + '/mcp', authorization_servers: [ORIGIN] });
    const meta = await (await s.call('/.well-known/oauth-authorization-server')).json();
    expect(meta).toMatchObject({ issuer: ORIGIN, authorization_endpoint: ORIGIN + '/oauth/authorize', token_endpoint: ORIGIN + '/oauth/token', registration_endpoint: ORIGIN + '/oauth/register', code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
    // Only Claude's own return addresses can register; Claude Code's loopback address matches on any port.
    const evil = await s.call('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'] }) });
    expect([evil.status, (await evil.json()).error]).toEqual([400, 'invalid_redirect_uri']);

    const c = await connect(s);
    expect(c.consent.status).toBe(200);
    expect(c.html).toContain('Claude (claude.ai)');
    expect(c.html).toContain('move a task to Someday or to a new date');
    expect(c.html).toContain('It can’t delete anything or change anything else');
    expect(c.consent.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(Object.fromEntries(c.googleUrl.searchParams)).toMatchObject({ client_id: 'cid', redirect_uri: ORIGIN + '/oauth/google', scope: SCOPE, access_type: 'offline', response_type: 'code', code_challenge_method: 'S256' });
    expect([c.to.origin + c.to.pathname, c.to.searchParams.get('state')]).toEqual([CLAUDE, 'st1']);
    expect(s.google[0]).toMatchObject({ grant_type: 'authorization_code', code: 'gcode', client_secret: 'shh', redirect_uri: ORIGIN + '/oauth/google' });
    expect(s.google[0].code_verifier).toBeTruthy();
    expect(s.file('claude-connected.json')).toBeTruthy(); // the dashboard starts keeping Claude's copy
    expect(c.tok).toMatchObject({ token_type: 'Bearer', scope: 'dashboard' });
    expect(c.tok.expires_in).toBeLessThanOrEqual(3600);
    expect(c.tok.access_token).not.toContain('gat1'); // Google's token travels sealed
    expect([...s.kv.values()].join('')).not.toContain('grt');

    // A return address that wasn't registered, or a wrong PKCE verifier, gets nothing.
    const other = await s.call('/oauth/authorize?' + new URLSearchParams({ ...c.asked, redirect_uri: 'https://evil.example/cb' }));
    expect(other.status).toBe(400);
    expect((await connect(s, 'w'.repeat(50))).tok.access_token).toBeTruthy(); // a second connection works too
    const again = await s.call('/oauth/authorize?' + new URLSearchParams(c.asked));
    const state = new URL((await again.text()).match(/href="(https:\/\/accounts\.google\.com[^"]+)"/)[1].replace(/&amp;/g, '&')).searchParams.get('state');
    const code = new URL((await s.call('/oauth/google?' + new URLSearchParams({ code: 'gcode', state }))).headers.get('Location')).searchParams.get('code');
    const wrong = await s.call('/oauth/token', form({ grant_type: 'authorization_code', code, code_verifier: 'x'.repeat(50), client_id: c.reg.client_id, redirect_uri: CLAUDE }));
    expect([wrong.status, (await wrong.json()).error]).toEqual([400, 'invalid_grant']);

    // The MCP handshake.
    const init = await (await rpc(s, c.tok.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })).json();
    expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'life-dashboard' }, capabilities: { tools: {} } });
    expect(init.result.instructions).toContain('dashboard_today');
    const note = await s.call('/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + c.tok.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    expect(note.status).toBe(202);
    const tools = (await (await rpc(s, c.tok.access_token, 'tools/list')).json()).result.tools;
    expect(tools.map(t => t.name)).toEqual(['dashboard_today', 'list_tasks', 'get_food_log', 'get_workouts', 'search_records', 'get_record', 'get_section', 'search_foods', 'add_task', 'complete_task', 'park_task', 'reschedule_task', 'log_food', 'log_weight', 'add_prayer_request', 'add_journal_entry', 'add_grocery_items']);
    expect(tools.every(t => t.inputSchema && t.description && !('run' in t))).toBe(true);
    expect(tools.find(t => t.name === 'dashboard_today').annotations.readOnlyHint).toBe(true);
    expect((await (await rpc(s, c.tok.access_token, 'resources/list')).json()).error.code).toBe(-32601);
    expect((await rpc(s, 'not-a-token', 'tools/list')).headers.get('WWW-Authenticate')).toContain('error="invalid_token"');
  } finally { s.restore(); }
});

test('refresh tokens rotate, the one just replaced works briefly, and a removed Google sign-in ends the connection', async () => {
  const s = setup();
  try {
    const { tok } = await connect(s), refresh = t => s.call('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: t }));
    const r1 = await (await refresh(tok.refresh_token)).json();
    expect(r1.access_token && r1.refresh_token && r1.refresh_token !== tok.refresh_token).toBeTruthy();
    expect(s.google.at(-1)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'grt', client_secret: 'shh' });
    expect((await refresh(tok.refresh_token)).status).toBe(200); // a retry right after rotating still works
    const r2 = await (await refresh(r1.refresh_token)).json();
    expect(r2.refresh_token).toBeTruthy();
    const old = await refresh(tok.refresh_token);
    expect([old.status, (await old.json()).error]).toEqual([400, 'invalid_grant']);
    s.refuseRefresh(true);
    const gone = await refresh(r2.refresh_token);
    expect([gone.status, (await gone.json()).error]).toEqual([400, 'invalid_grant']);
    expect(s.kv.size).toBe(0);
    expect((await refresh('junk')).status).toBe(400);
    expect((await (await s.call('/oauth/token', form({ grant_type: 'password' }))).json()).error).toBe('unsupported_grant_type');
  } finally { s.restore(); }
});

test('Claude reads today, tasks, food, workouts, records, sections and foods from the dashboard’s copy', async () => {
  const s = setup();
  try {
    const { tok } = await connect(s), at = tok.access_token; withCopy(s);
    const t = (await tool(s, at, 'dashboard_today')).data;
    expect(t).toMatchObject({ today: TODAY, name: 'Sam', unit: 'lbs', targets: { calories: 2200, protein: 180 }, bible_reading: { plan: 'Bible in a year', today: 'Isaiah 40–42', streak_days: 12 }, meals_today: [{ slot: 'dinner', title: 'Chili' }], prayer_list: { open_requests: 1 } });
    expect(t.due_today.map(x => x.id)).toEqual(['t1']);
    expect(t.overdue.map(x => x.id)).toEqual(['t2']); // the someday task isn't overdue
    expect(t.big3).toEqual([{ id: 't1', title: 'Call the plumber', done: false }]);
    expect(t.food_today).toMatchObject({ calories: 640, items: [{ meal: 'breakfast', name: 'Oatmeal', amount: '1 cup', calories: 300 }, { meal: 'lunch', name: 'Turkey sandwich', calories: 340 }] });
    expect(t.upcoming_dates).toEqual([{ d: plus(10), what: 'Pat’s birthday' }]);
    expect(t.workout).toEqual({ next: 'Push B' });

    expect((await tool(s, at, 'list_tasks', { view: 'upcoming' })).data.tasks.map(x => x.id)).toEqual(['t4']);
    expect((await tool(s, at, 'list_tasks', { area: 'ministry' })).data.tasks.map(x => x.id)).toEqual(['t2']);
    expect((await tool(s, at, 'list_tasks', { view: 'inbox' })).data.tasks.map(x => x.id)).toEqual(['t5']);
    expect((await tool(s, at, 'list_tasks', { view: 'done' })).data.tasks.map(x => x.id)).toEqual(['d1']);
    expect((await tool(s, at, 'list_tasks', { query: 'lesson fall' })).data.count).toBe(1);
    expect((await tool(s, at, 'list_tasks', { view: 'nonsense' })).error).toBe(true);

    const food = (await tool(s, at, 'get_food_log', { from: plus(-2), to: TODAY })).data;
    expect(food.days.map(d => d.date)).toEqual([plus(-2), plus(-1), TODAY]);
    expect(food.days[0]).toMatchObject({ calories: 2100, weight: 182.6, items: [{ name: 'Steak', amount: '8 oz', protein: 60 }] });
    expect(food.average_per_logged_day.calories).toBe(1547);
    expect((await tool(s, at, 'get_food_log', { from: plus(-40), to: TODAY, items: true })).error).toBe(true);
    expect((await tool(s, at, 'get_food_log', { from: plus(-40), to: TODAY })).data.days[0].items).toBeUndefined();

    const bench = (await tool(s, at, 'get_workouts', { exercise: 'bench' })).data;
    expect(bench.history.map(h => [h.date, h.best])).toEqual([[plus(-9), '180 lbs × 5'], [plus(-2), '185 lbs × 5']]);
    expect((await tool(s, at, 'get_workouts')).data.workouts.map(w => w.date)).toEqual([plus(-9), plus(-2)]);

    const found = (await tool(s, at, 'search_records', { query: 'patience' })).data.results;
    expect(found.map(r => [r.section, r.id])).toEqual([['journal', 'j1'], ['scripture', 's1']]); // newest first, across years
    expect(found[1]).toMatchObject({ ref: 'James 1:2-4', title: 'James 1' });
    expect((await tool(s, at, 'search_records', { query: 'journal' })).data.results.map(r => r.id)).toEqual(['j1']); // words in the text, not field names
    expect((await tool(s, at, 'search_records', { sections: ['prayer'] })).data.results.map(r => r.id)).toEqual(['pr1']);
    expect((await tool(s, at, 'search_records', { query: 'walk', from: TODAY })).data.count).toBe(0);
    expect((await tool(s, at, 'get_record', { id: 'j2' })).data).toMatchObject({ section: 'journal', text: 'A long walk and a good talk.' });
    expect((await tool(s, at, 'get_record', { id: 't4' })).data).toMatchObject({ section: 'task', title: 'Book dentist' });
    expect((await tool(s, at, 'get_record', { id: 'nope' })).error).toBe(true);

    expect((await tool(s, at, 'get_section', { section: 'family' })).data.family.people[0].name).toBe('Pat');
    expect((await tool(s, at, 'get_section', { section: 'recipes' })).data.recipes[0]).toMatchObject({ id: 'r1', cal: 420 });
    const foods = (await tool(s, at, 'search_foods', { query: 'protein shake' })).data;
    expect(foods.your_saved_foods.map(f => f.id)).toEqual(['f1']);
    expect(foods.open_food_facts[0]).toEqual({ name: 'Energy bites', brand: 'Trail Co', per_100g: { calories: 420, protein: 9, carbs: 50, fat: 20 }, serving: '2 bites (30 g)', serving_grams: 30 });
  } finally { s.restore(); }
});

test('additions go into the drop box, checked first, and show as waiting until the dashboard takes them in', async () => {
  const s = setup();
  try {
    const { tok } = await connect(s), at = tok.access_token; withCopy(s);
    const added = await tool(s, at, 'add_task', { title: '  Email  the elders ', due: plus(1), time: '9:30', area: 'ministry', project: 'Fall study', notes: 'Line one\nLine two' });
    expect(added.text).toMatch(/^Added “Email the elders”, due .+ at 09:30 \(id c-[A-Za-z0-9]+\)\. It will appear in the dashboard/);
    expect((await tool(s, at, 'add_task', { title: 'x', area: 'work' })).error).toBe(true);
    expect((await tool(s, at, 'add_task', { title: 'x', due: '2026-02-31' })).error).toBe(true); // not a day on the calendar
    expect((await tool(s, at, 'complete_task', { task_id: 'missing' })).error).toBe(true);
    await tool(s, at, 'complete_task', { task_id: 't1' });
    // The two task edits: found by id among open tasks, validated, and sent as plain requests. Nothing is edited here.
    expect((await tool(s, at, 'park_task', { task_id: 'missing' })).error).toBe(true);
    expect((await tool(s, at, 'park_task', { task_id: 'd1' })).error).toBe(true); // finished tasks aren't open
    expect((await tool(s, at, 'park_task', { task_id: 't6' })).text).toBe('“Learn the guitar” is already in Someday.'); // no date left to keep, nothing sent
    expect((await tool(s, at, 'park_task', { task_id: 't3' })).text).toContain('keeping “Was due ' + plus(-5) + '” in its notes'); // in Someday but still carrying a date
    const parked = await tool(s, at, 'park_task', { task_id: 't4' });
    expect(parked.text).toMatch(/^Moved “Book dentist” to Someday, keeping “Was due .+” in its notes\. It will appear in the dashboard/);
    expect((await tool(s, at, 'reschedule_task', { task_id: 'missing', due: plus(4) })).error).toBe(true);
    expect((await tool(s, at, 'reschedule_task', { task_id: 't2' })).error).toBe(true); // a date is needed
    expect((await tool(s, at, 'reschedule_task', { task_id: 't2', due: '2026-02-31' })).error).toBe(true);
    expect((await tool(s, at, 'reschedule_task', { task_id: 't2', due: 'next week' })).error).toBe(true);
    expect((await tool(s, at, 'reschedule_task', { task_id: 't2', due: plus(4), time: '25:00' })).error).toBe(true);
    expect((await tool(s, at, 'reschedule_task', { task_id: 't2', due: plus(4), time: 'noon' })).error).toBe(true);
    expect((await tool(s, at, 'reschedule_task', { task_id: 't2', due: plus(4), time: '9:05' })).text).toMatch(new RegExp(`^Moved “Finish lesson outline” to ${plus(4)} at 09:05\\. It will appear`));
    await tool(s, at, 'reschedule_task', { task_id: 't6', due: plus(6) }); // a Someday task comes back; no time given
    expect((await tool(s, at, 'log_food', { meal: 'brunch', items: [{ name: 'x', calories: 1 }] })).error).toBe(true);
    expect((await tool(s, at, 'log_food', { meal: 'lunch', items: [{ name: 'Soup', calories: 99999 }] })).text).toContain('calories should be a number');
    await tool(s, at, 'log_food', { meal: 'lunch', items: [{ name: 'Chili', amount: '1 bowl', calories: 420, protein: 30, carbs: 35, fat: 15, recipe_id: 'r1', servings: 1 }, { name: 'Protein shake', calories: 120, food_id: 'f1', grams: 32 }] });
    await tool(s, at, 'log_weight', { weight: 180 });
    expect((await tool(s, at, 'log_weight', { weight: 180, date: plus(5) })).error).toBe(true);
    await tool(s, at, 'add_prayer_request', { request: 'Safe travel', category: 'Family' });
    await tool(s, at, 'add_journal_entry', { body: 'Grateful today.', title: 'Evening' });
    await tool(s, at, 'add_grocery_items', { items: ['2 lb chicken breast', '', 'Eggs'] });
    const box = s.inbox();
    expect(box.map(x => x.what)).toEqual(['task', 'done', 'someday', 'someday', 'reschedule', 'reschedule', 'food', 'weight', 'prayer', 'journal', 'grocery']);
    const sent = (what, rest) => ({ v: 1, id: expect.any(String), at: expect.any(String), what, ...rest }); // exactly these fields, nothing else
    expect(box[2]).toEqual(sent('someday', { task: 't3' }));
    expect(box[3]).toEqual(sent('someday', { task: 't4' }));
    expect(box[4]).toEqual(sent('reschedule', { task: 't2', due: plus(4), time: '09:05' }));
    expect(box[5]).toEqual(sent('reschedule', { task: 't6', due: plus(6) }));
    expect(box[0]).toMatchObject({ v: 1, title: 'Email the elders', due: plus(1), time: '09:30', area: 'ministry', project: 'Fall study', notes: 'Line one\nLine two' });
    expect(box[1]).toMatchObject({ task: 't1' });
    expect(box[6]).toMatchObject({ date: TODAY, meal: 'lunch', items: [{ name: 'Chili', amount: '1 bowl', cal: 420, p: 30, c: 35, f: 15, recipe: 'r1', servings: 1 }, { name: 'Protein shake', cal: 120, food: 'f1', grams: 32 }] });
    expect(box[7]).toMatchObject({ date: TODAY, kg: 81.65 });
    expect(box[8]).toMatchObject({ request: 'Safe travel', cat: 'Family' });
    expect(box[9]).toMatchObject({ date: TODAY, title: 'Evening', body: 'Grateful today.' });
    expect(box[10].items).toEqual(['2 lb chicken breast', 'Eggs']);
    expect(box.every(x => x.id && x.at)).toBe(true);
    const waiting = (await tool(s, at, 'dashboard_today')).data.waiting_to_sync;
    expect(waiting.map(x => x.what)).toEqual(['task', 'done', 'someday', 'someday', 'reschedule', 'reschedule', 'food', 'weight', 'prayer', 'journal', 'grocery']);
    expect(waiting[0]).toMatchObject({ title: 'Email the elders', id: 'c-' + box[0].id });
    expect(waiting[4]).toMatchObject({ task: 't2', due: plus(4) });
    expect((await tool(s, at, 'list_tasks')).data.waiting_to_sync.map(x => x.title)).toEqual(['Email the elders']);
  } finally { s.restore(); }
});

test('without a copy Claude is told to open the dashboard; a lost Google sign-in asks Claude to sign in again; disconnecting cleans up', async () => {
  const s = setup();
  try {
    const { tok } = await connect(s), at = tok.access_token;
    s.drive.clear();
    const none = await tool(s, at, 'dashboard_today');
    expect([none.error, none.text]).toEqual([true, expect.stringContaining('hasn’t shared its copy')]);
    expect(s.file('claude-connected.json')).toBeTruthy(); // asked for again, so the dashboard shares on its next sync
    withCopy(s); await tool(s, at, 'add_task', { title: 'Keep me' });
    s.refuseDrive(true);
    const lost = await rpc(s, at, 'tools/call', { name: 'dashboard_today', arguments: {} });
    expect([lost.status, lost.headers.get('WWW-Authenticate')]).toEqual([401, expect.stringContaining('error="invalid_token"')]);
    s.refuseDrive(false);
    expect((await s.call('/oauth/revoke', form({ token: tok.refresh_token }))).status).toBe(200);
    expect([...s.drive.values()].map(f => f.name)).toEqual([expect.stringMatching(/^claude-inbox-/)]); // the waiting task still arrives
    expect(s.revoked).toEqual(['grt']);
    expect(s.kv.size).toBe(0);
    expect((await s.call('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }))).status).toBe(400);
  } finally { s.restore(); }
});

test('without its secrets the connector says it isn’t set up, and the reader keeps its address rule', async () => {
  const pageRes = await worker.fetch(new Request(ORIGIN + '/oauth/authorize?client_id=x'), {}, {});
  expect([pageRes.status, await pageRes.text()]).toEqual([503, expect.stringContaining('isn’t set up')]);
  expect((await worker.fetch(new Request(ORIGIN + '/mcp', { method: 'POST' }), {}, {})).status).toBe(503);
  expect((await worker.fetch(new Request(ORIGIN + '/.well-known/oauth-authorization-server'), {}, {})).status).toBe(200);
  expect((await worker.fetch(new Request(ORIGIN + '/?url=https://blog.example/'), {}, {})).status).toBe(403);
});

// What the app writes is what the connector reads, and what the connector drops is what the app takes in.
test('end to end: the app’s own copy answers Claude, and Claude’s additions arrive as proper records', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  await page.goto(pathToFileURL(path.resolve('index.html')).href);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  const files = await page.evaluate(() => {
    A.helpDismiss({ dataset: { what: 'tour' } }); S.name = 'Sam'; S.unit = 'lbs';
    const t = ymd(), at = (d, h) => { const x = parseYmd(d); x.setHours(h); return x.toISOString(); };
    Store.set('projects', [{ id: 'p1', name: 'Fall study', area: 'ministry', status: 'active', notes: '', created: at(t, 8) }]);
    Store.set('tasks', [
      { id: 't1', title: 'Call the plumber', notes: '', status: 'todo', priority: 'high', due: t, time: '15:00', tags: ['home'], created: at(t, 8), completedAt: null },
      { id: 't2', title: 'Finish lesson outline', notes: 'Chapter 3', status: 'todo', priority: 'med', due: addDays(t, -2), tags: [], project: 'p1', created: at(t, 8), completedAt: null },
      { id: 't3', title: 'Pay the water bill', notes: '', status: 'done', priority: 'med', due: addDays(t, -1), tags: ['home'], created: at(t, 8), completedAt: at(addDays(t, -1), 10) },
      { id: 't4', title: 'Prep the slides', notes: 'Draft one', status: 'todo', priority: 'med', due: addDays(t, 3), time: '10:30', repeat: { freq: 'week', n: 1 }, tags: [], created: at(t, 8), completedAt: null },
      { id: 't5', title: 'Tidy the garage', notes: '', status: 'todo', priority: 'med', due: null, someday: true, tags: [], created: at(t, 8), completedAt: null }
    ]);
    Store.set('foods', [{ id: 'f1', name: 'Protein shake', brand: 'Acme', basis: '100g', base: { cal: 375, p: 75, c: 9.4, f: 4.7, fiber: null, sugar: null, sodium: null, satfat: null }, servingLabel: '1 scoop', servingG: 32, extra: [], uses: 3, lastUsed: at(t, 7) }]);
    Store.set('recipes', [{ id: 'r1', title: 'Chili', servings: 6, cal: 420, p: 30, c: 35, f: 15, ingredients: 'beans' }]);
    Store.set('nutrition', { [addDays(t, -1)]: { weight: 82.6, entries: [{ id: 'e0', name: 'Steak', qty: 8, unit: 'oz', cal: 600, p: 60, c: 0, f: 40, meal: 'dinner', time: '6:00 PM' }] }, [t]: { weight: null, entries: [{ id: 'e1', name: 'Oatmeal', qty: 1, unit: 'cup', cal: 300, p: 10, c: 54, f: 6, meal: 'breakfast', time: '7:30 AM' }] } });
    Store.set('workouts', [{ id: 'w1', name: 'Push A', start: at(addDays(t, -2), 18), end: new Date(new Date(at(addDays(t, -2), 18)).getTime() + 58 * 60000).toISOString(), exercises: [{ name: 'Bench Press', sets: [{ id: 's0', type: 'warmup', weight: 40, reps: 10, done: true }, { id: 's1', type: 'normal', weight: 83.9, reps: 5, done: true }, { id: 's2', type: 'normal', weight: 83.9, reps: 5, done: true }] }] }]);
    Store.set('journal', [{ id: 'j1', date: addDays(t, -1), created: at(addDays(t, -1), 21), type: 'journal', title: 'Slow morning', body: 'Learning patience with the kids.', tags: [], mood: null, energy: null, photos: [], prayers: [] }]);
    Store.set('prayers', [{ id: 'pr1', title: 'Pat’s new job', details: '', cat: 'Friends', created: at(addDays(t, -20), 9), lastPrayed: null, count: 0, answered: null }]);
    Store.set('scripture', [{ id: 's1', date: '2025-03-01', created: '2025-03-01T10:00:00Z', kind: 'devotional', title: 'James 1', ref: 'James 1:2-4', translation: '', passage: '', body: 'Patience has its perfect work.', tags: [], series: '' }]);
    return Object.fromEntries(claudeCopy());
  });
  expect(Object.keys(files).sort()).toEqual(['claude-days-' + YEAR + '.jsonl', 'claude-notes-2025.jsonl', 'claude-notes-' + YEAR + '.jsonl', 'claude-now.json', 'claude-workouts-' + YEAR + '.jsonl'].sort());
  for (const [name, body] of Object.entries(files)) if (name.endsWith('.jsonl')) expect(body.split('\n').every(l => /^\{"d":"\d{4}-\d{2}-\d{2}"/.test(l))).toBe(true);

  const s = setup();
  try {
    const { tok } = await connect(s), at = tok.access_token, today = JSON.parse(files['claude-now.json']).today;
    for (const [name, body] of Object.entries(files)) s.put(name, body);
    const t = (await tool(s, at, 'dashboard_today')).data;
    expect(t).toMatchObject({ name: 'Sam', unit: 'lbs', food_today: { calories: 300, items: [{ meal: 'breakfast', name: 'Oatmeal', amount: '1 cup' }] } });
    expect(t.due_today.map(x => [x.id, x.title, x.time, x.area, x.priority])).toEqual([['t1', 'Call the plumber', '15:00', 'home', 'high']]);
    expect(t.overdue.map(x => [x.id, x.project, x.notes])).toEqual([['t2', 'Fall study', 'Chapter 3']]);
    expect((await tool(s, at, 'list_tasks', { view: 'done' })).data.tasks.map(x => x.id)).toEqual(['t3']);
    const food = (await tool(s, at, 'get_food_log', { from: plus(-1) })).data;
    expect(food.days.map(d => [d.date, d.calories])).toEqual([[plus(-1), 600], [today, 300]]);
    expect(food.days[0].weight).toBeCloseTo(182.1, 0); // in pounds
    const bench = (await tool(s, at, 'get_workouts', { exercise: 'bench' })).data.history[0];
    expect(bench.sets).toMatch(/^185 lbs × 5, 185 lbs × 5$/); // warm-ups left out
    expect((await tool(s, at, 'get_workouts')).data.workouts[0]).toMatchObject({ name: 'Push A', minutes: 58, sets: 2 });
    expect((await tool(s, at, 'search_records', { query: 'patience' })).data.results.map(r => [r.section, r.id])).toEqual([['journal', 'j1'], ['scripture', 's1']]);
    expect((await tool(s, at, 'search_records', { sections: ['task'] })).data.results.map(r => r.id)).toEqual(['t3']);
    expect((await tool(s, at, 'get_section', { section: 'foods' })).data.foods[0]).toMatchObject({ id: 'f1', per: '100 g', cal: 375, serving: '1 scoop = 32 g' });
    expect((await tool(s, at, 'get_section', { section: 'prayer' })).data.prayer.map(p => p.title)).toEqual(['Pat’s new job']);

    await tool(s, at, 'add_task', { title: 'Email the elders', due: plus(1), area: 'ministry', project: 'Fall study', waiting: true });
    await tool(s, at, 'complete_task', { task_id: 't1' });
    await tool(s, at, 'log_food', { meal: 'lunch', items: [{ name: 'Chili', calories: 999, recipe_id: 'r1', servings: 1 }, { name: 'Shake', calories: 999, food_id: 'f1', grams: 32 }, { name: 'Apple', amount: '1 medium', calories: 95, protein: 0.5, carbs: 25, fat: 0.3 }, { name: 'Almonds', amount: 'a handful', calories: 160, protein: 6, carbs: 6, fat: 14 }] });
    await tool(s, at, 'log_weight', { weight: 180 });
    await tool(s, at, 'add_prayer_request', { request: 'Safe travel', category: 'Family' });
    await tool(s, at, 'add_journal_entry', { body: 'Grateful today.' });
    await tool(s, at, 'add_grocery_items', { items: ['2 lb chicken breast'] });
    await tool(s, at, 'park_task', { task_id: 't4' });
    await tool(s, at, 'reschedule_task', { task_id: 't2', due: plus(5), time: '9:15' });
    expect((await tool(s, at, 'park_task', { task_id: 't5' })).text).toContain('already in Someday');
    expect((await tool(s, at, 'list_tasks', { view: 'someday' })).data.tasks.map(x => x.id)).toEqual(['t5']);
    const items = s.inbox();
    const r = await page.evaluate(items => {
      const kinds = items.map(x => claudeApply(x, 'c-' + x.id)), again = items.map(x => claudeApply(x, 'c-' + x.id)), t = ymd(), d = Store.get('nutrition')[t];
      const task = Store.get('tasks').find(x => x.title === 'Email the elders');
      return { kinds, again, task: task && { id: task.id, area: task.area, project: (projFind(task.project) || {}).name, waiting: task.waiting, due: task.due }, projects: Store.get('projects').length,
        t1: Store.get('tasks').find(x => x.id === 't1').status, lunch: d.entries.filter(e => e.meal === 'lunch').map(e => [e.name, e.cal, e.foodId || null, e.qty ?? null, e.unit || null]), weight: d.weight,
        slides: Store.get('tasks').find(x => x.id === 't4'), lesson: Store.get('tasks').find(x => x.id === 't2'), garage: Store.get('tasks').find(x => x.id === 't5'),
        prayer: Store.get('prayers').find(p => p.title === 'Safe travel'), journal: Store.get('journal').find(j => j.body === 'Grateful today.'), grocery: Store.get('grocery').map(g => [g.name, g.qty, g.unit]) };
    }, items);
    expect(r.kinds).toEqual(['task', 'done', 'food', 'weight', 'prayer', 'journal', 'grocery', 'someday', 'reschedule']);
    expect(r.again).toEqual([null, null, null, 'weight', null, null, 'grocery', null, null]); // records already there aren't added twice (weight and groceries rely on the inbox file being removed)
    expect(r.task).toEqual({ id: 'c-' + items[0].id, area: 'ministry', project: 'Fall study', waiting: true, due: plus(1) });
    expect(r.projects).toBe(1); // the existing project, not a new one
    expect(r.t1).toBe('done');
    expect(r.slides).toMatchObject({ title: 'Prep the slides', someday: true, due: null, time: '10:30', repeat: { freq: 'week', n: 1 }, status: 'todo', notes: `Draft one\nWas due ${plus(3)} at 10:30` }); // the date is kept, the repeat is not touched, and a second go added nothing
    expect(r.lesson).toMatchObject({ due: plus(5), time: '09:15', project: 'p1', notes: 'Chapter 3', status: 'todo' });
    expect(r.lesson.someday).toBeFalsy();
    expect(r.garage).toMatchObject({ someday: true, due: null, notes: '' }); // already parked: left exactly as it was
    expect(r.lunch).toEqual([['Chili', 420, null, 1, 'serving'], ['Protein shake', 120, 'f1', 32, 'g'], ['Apple', 95, null, 1, '1 medium'], ['Almonds (a handful)', 160, null, null, null]]);
    expect(r.weight).toBe(81.65);
    expect(r.prayer).toMatchObject({ id: 'c-' + items[4].id, cat: 'Family', answered: null });
    expect(r.journal).toMatchObject({ id: 'c-' + items[5].id, type: 'journal', date: today });
    expect(r.grocery[0]).toEqual(['chicken breast', 4, 'lb']); // added twice above, merged into one line
    expect(errors).toEqual([]);
  } finally { s.restore(); }
});

// The dashboard checks every request again, whatever the Worker said: only open tasks change, the old date is kept
// when a task is parked, and the same request twice changes nothing more.
test('Claude’s task edits only touch open tasks, keep the old date when parking, and do nothing twice', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve('index.html')).href);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  const r = await page.evaluate(() => {
    A.helpDismiss({ dataset: { what: 'tour' } });
    const t = ymd(), mk = (id, extra) => ({ id, title: id, notes: '', status: 'todo', priority: 'med', due: null, tags: [], created: new Date().toISOString(), completedAt: null, ...extra });
    Store.set('tasks', [
      mk('timed', { due: addDays(t, 2), time: '15:30', notes: 'Bring the keys  \n\n', repeat: { freq: 'week', n: 1 }, waiting: true, pushed: 1 }),
      mk('plain', { due: addDays(t, 4) }),
      mk('both', { due: addDays(t, -3), someday: true }),
      mk('undated'),
      mk('parked', { someday: true, notes: 'x' }),
      mk('finished', { status: 'done', due: addDays(t, 1), completedAt: new Date().toISOString() }),
      mk('doing', { status: 'doing', due: addDays(t, 5) })
    ]);
    const get = id => Store.get('tasks').find(x => x.id === id), snap = id => JSON.stringify(get(id)), copy = id => JSON.parse(snap(id)); // copies, since the records change again below
    const apply = x => claudeApply({ v: 1, id: 'z', ...x }, 'c-z');
    const out = {};
    // Parking
    const before = { finished: snap('finished'), parked: snap('parked'), undated: snap('undated') };
    out.park1 = ['timed', 'plain', 'both', 'undated', 'parked', 'finished', 'missing', 'doing'].map(id => apply({ what: 'someday', task: id }));
    out.park2 = ['timed', 'plain', 'both', 'undated', 'parked', 'finished', 'missing', 'doing'].map(id => apply({ what: 'someday', task: id }));
    out.timed = copy('timed'); out.plain = copy('plain'); out.both = copy('both'); out.doing = copy('doing');
    out.untouched = { finished: snap('finished') === before.finished, parked: snap('parked') === before.parked, undated: snap('undated') === before.undated };
    out.undated = copy('undated');
    out.badTask = [apply({ what: 'someday' }), apply({ what: 'someday', task: 5 }), apply({ what: 'someday', task: { id: 'plain' } })];
    // A parked task given its date again and parked again keeps one line, not two
    apply({ what: 'reschedule', task: 'plain', due: addDays(t, 4) });
    const again = apply({ what: 'someday', task: 'plain' });
    out.replay = [again, get('plain').notes];
    // Rescheduling
    const dueBefore = snap('finished');
    out.re = {
      bad: ['2026-02-31', '2026-13-01', 'tomorrow', '', null, 20261201, '2026-1-5'].map(d => apply({ what: 'reschedule', task: 'timed', due: d })),
      missing: [apply({ what: 'reschedule', task: 'timed' }), apply({ what: 'reschedule', due: addDays(t, 9) })],
      finished: apply({ what: 'reschedule', task: 'finished', due: addDays(t, 9) }),
      unknown: apply({ what: 'reschedule', task: 'missing', due: addDays(t, 9) }),
      timedStillParked: [get('timed').someday, get('timed').due],
      back: apply({ what: 'reschedule', task: 'timed', due: addDays(t, 6) }),
      backAgain: apply({ what: 'reschedule', task: 'timed', due: addDays(t, 6) }),
      timeKept: get('timed').time,
      badTime: apply({ what: 'reschedule', task: 'timed', due: addDays(t, 6), time: '25:00' }),
      newTime: apply({ what: 'reschedule', task: 'timed', due: addDays(t, 6), time: '08:05' }),
      newTimeAgain: apply({ what: 'reschedule', task: 'timed', due: addDays(t, 6), time: '08:05' }),
      from: apply({ what: 'reschedule', task: 'both', due: addDays(t, 1) }),
      doingDay: apply({ what: 'reschedule', task: 'doing', due: addDays(t, 8) })
    };
    out.afterRe = { timed: copy('timed'), both: copy('both'), doing: copy('doing'), finishedSame: snap('finished') === dueBefore };
    out.t = t;
    return out;
  });
  const day = n => { const d = new Date(r.t + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  // Parking: every open task is parked once; a task already in Someday with no date, a finished one and an unknown id are left alone
  expect(r.park1).toEqual(['someday', 'someday', 'someday', 'someday', null, null, null, 'someday']);
  expect(r.park2).toEqual([null, null, null, null, null, null, null, null]);
  expect(r.timed).toMatchObject({ someday: true, due: null, time: '15:30', waiting: true, pushed: 1, repeat: { freq: 'week', n: 1 }, status: 'todo', notes: `Bring the keys\nWas due ${day(2)} at 15:30` });
  expect(r.plain).toMatchObject({ someday: true, due: null, notes: `Was due ${day(4)}` });
  expect(r.both).toMatchObject({ someday: true, due: null, notes: `Was due ${day(-3)}` });
  expect(r.doing).toMatchObject({ someday: true, due: null, status: 'doing', notes: `Was due ${day(5)}` });
  expect(r.undated).toMatchObject({ someday: true, due: null, notes: '' }); // nothing to remember
  expect(r.untouched).toEqual({ finished: true, parked: true, undated: false });
  expect(r.badTask).toEqual([null, null, null]);
  expect(r.replay).toEqual(['someday', `Was due ${day(4)}`]); // back to Someday after being given its date again: the same line isn't added twice
  // Rescheduling: a real date is needed, only open tasks move, Someday is left, the time stays unless one is given
  expect(r.re.bad).toEqual([null, null, null, null, null, null, null]);
  expect(r.re.missing).toEqual([null, null]);
  expect([r.re.finished, r.re.unknown, r.re.timedStillParked]).toEqual([null, null, [true, null]]);
  expect([r.re.back, r.re.backAgain, r.re.timeKept]).toEqual(['reschedule', null, '15:30']);
  expect([r.re.badTime, r.re.newTime, r.re.newTimeAgain]).toEqual([null, 'reschedule', null]); // an unreadable time is ignored; with the date unchanged nothing is left to do
  expect(r.afterRe.timed).toMatchObject({ due: day(6), time: '08:05', repeat: { freq: 'week', n: 1 }, waiting: true });
  expect(r.afterRe.timed.someday).toBeFalsy();
  expect([r.re.from, r.afterRe.both.due, !!r.afterRe.both.someday, r.afterRe.both.notes]).toEqual(['reschedule', day(1), false, `Was due ${day(-3)}`]);
  expect([r.re.doingDay, r.afterRe.doing.due, r.afterRe.doing.status]).toEqual(['reschedule', day(8), 'doing']);
  expect(r.afterRe.finishedSame).toBe(true);
  expect(errors).toEqual([]);
});
