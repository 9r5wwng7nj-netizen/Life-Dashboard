// Life Dashboard for Claude: a remote MCP server (a Claude "custom connector") on the link reader Worker.
// A person adds https://<this Worker>/mcp in Claude and signs in with Google. Claude then reads the copy the
// dashboard keeps for it in that person's private Drive app folder (claude-now.json and
// claude-{days,workouts,notes}-YYYY.jsonl, written on each sync once claude-connected.json exists), and
// leaves additions as claude-inbox-<id>.json files, which the dashboard takes in on its next sync. This
// Worker never edits records: it reads the copy and drops new items in the inbox.
//
// Sign-in is OAuth 2.1 for Claude (dynamic client registration, PKCE S256, rotating refresh tokens) in front
// of Google's sign-in with drive.appdata only. Codes and tokens are AES-GCM sealed with the Worker secret
// CONNECTOR_KEY; each connection's Google refresh token is kept, sealed, in the CONNECTOR_KV namespace.
import { offSearch } from './food.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const DRIVE = 'https://www.googleapis.com', DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth', GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token', GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';
const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const DAY = 86400, GRANT_TTL = 180 * DAY, VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id', 'Access-Control-Max-Age': '86400' };
const AREAS = ['ministry', 'home', 'personal', 'faith'], MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];
const PRAY_CATS = ['Family', 'Ministry', 'Church', 'Friends', 'Personal', 'World', 'Other'];
const NOTE_SECTIONS = ['journal', 'prayer', 'scripture', 'quote', 'media', 'task'];
const LANDS = 'It will appear in the dashboard the next time it syncs, usually when it is next opened.';
const NO_COPY = 'The dashboard hasn’t shared its copy with Claude yet. Open Life Dashboard on a device where Google Drive sync is on (Settings & Sync); it shares a copy when it next syncs. Then ask again.';

export const isConnectorPath = p => p === '/mcp' || p.startsWith('/oauth/') || p.startsWith('/.well-known/oauth-');

// --- Small helpers
const now = () => Math.floor(Date.now() / 1000);
const b64u = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const randomId = (n = 16) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async s => b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const oauthError = (error, description, status = 400) => json({ error, ...(description ? { error_description: description } : {}) }, status, CORS);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const low = s => String(s || '').toLowerCase();
const sum = a => a.reduce((x, y) => x + (+y || 0), 0);
const isDate = v => typeof v === 'string' && /^(19|20)\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z'));
const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
const mondayOf = d => addDays(d, -((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7));
const weekday = d => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(d + 'T12:00:00Z').getUTCDay()];
function localToday(tz, fallback) {
  try { const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); if (isDate(d)) return d; } catch (e) { }
  return isDate(fallback) ? fallback : new Date().toISOString().slice(0, 10);
}
// Words from Claude, tidied: one line (line), or with its line breaks (text); empty means left out.
const line = (v, max) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) || undefined : undefined;
const text = (v, max) => typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) || undefined : undefined;
const clamp = (v, lo, hi, dflt) => v == null || v === '' || !Number.isFinite(+v) ? dflt : Math.min(hi, Math.max(lo, Math.round(+v)));
function amount(v, lo, hi, name) {
  if (v == null || v === '') return undefined;
  if (!Number.isFinite(+v) || +v < lo || +v > hi) throw new Error(`${name} should be a number from ${lo} to ${hi}.`);
  return Math.round(+v * 10) / 10;
}
function dateArg(v, name) { if (v == null || v === '') return undefined; if (!isDate(v)) throw new Error(`${name} should be a date like 2026-10-17.`); return v; }
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// --- Sealing. A sealed value can be read only by this Worker, only as the kind it was made for, and only
// until it expires.
let sealKey = null;
async function keyFor(env) {
  if (sealKey && sealKey.secret === env.CONNECTOR_KEY) return sealKey.key;
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(env.CONNECTOR_KEY));
  sealKey = { secret: env.CONNECTOR_KEY, key: await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']) };
  return sealKey.key;
}
async function seal(env, kind, ttl, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(kind) }, await keyFor(env), enc.encode(JSON.stringify({ ...data, exp: now() + ttl }))));
  const out = new Uint8Array(12 + body.length); out.set(iv); out.set(body, 12); return b64u(out);
}
async function unseal(env, kind, token) {
  try {
    const raw = unb64u(String(token || '')); if (raw.length < 29) return null;
    const data = JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: enc.encode(kind) }, await keyFor(env), raw.slice(12))));
    return data && data.exp > now() ? data : null;
  } catch (e) { return null; }
}

export async function connector(request, env, ctx) {
  const url = new URL(request.url), path = url.pathname, origin = url.origin;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (path.startsWith('/.well-known/oauth-protected-resource')) return json({ resource: origin + '/mcp', authorization_servers: [origin], scopes_supported: ['dashboard'], bearer_methods_supported: ['header'], resource_name: 'Life Dashboard' }, 200, CORS);
  if (path.startsWith('/.well-known/oauth-authorization-server')) return json({ issuer: origin, authorization_endpoint: origin + '/oauth/authorize', token_endpoint: origin + '/oauth/token', registration_endpoint: origin + '/oauth/register', revocation_endpoint: origin + '/oauth/revoke', response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'], scopes_supported: ['dashboard'] }, 200, CORS);
  if (!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.CONNECTOR_KEY && env.CONNECTOR_KV)) return path === '/oauth/authorize' ? page('Not set up yet', '<p>The Claude connector isn’t set up on this server yet.</p>', 503) : oauthError('temporarily_unavailable', 'The Claude connector isn’t set up on this server yet.', 503);
  if (path === '/oauth/register' && request.method === 'POST') return register(request, env);
  if (path === '/oauth/authorize' && request.method === 'GET') return authorize(url, env);
  if (path === '/oauth/google' && request.method === 'GET') return fromGoogle(url, env);
  if (path === '/oauth/token' && request.method === 'POST') return token(request, env);
  if (path === '/oauth/revoke' && request.method === 'POST') return revoke(request, env);
  if (path === '/mcp') return mcp(request, env, ctx, origin);
  return json({ error: 'not_found' }, 404, CORS);
}

// --- OAuth for Claude. Claude registers itself (the client id is a sealed list of its return addresses),
// the person agrees on a short page, signs in with Google, and Claude trades the code for tokens.
const loopback = u => u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
function redirectAllowed(s) { if (s === CLAUDE_CALLBACK) return true; try { const u = new URL(s); return loopback(u) && !u.username && !u.password && !u.hash; } catch (e) { return false; } }
// Claude Code returns to a loopback address on a port chosen per session, so those match without the port.
function redirectMatches(registered, given) {
  if (registered === given) return true;
  try { const a = new URL(registered), b = new URL(given); return loopback(a) && loopback(b) && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search; } catch (e) { return false; }
}
const returnUrl = (uri, params) => { const u = new URL(uri); for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v); return u.toString(); };
const returnTo = (uri, params) => Response.redirect(returnUrl(uri, params), 302);

async function register(request, env) {
  let b; try { b = await request.json(); } catch (e) { b = null; }
  const uris = Array.isArray(b && b.redirect_uris) ? b.redirect_uris.map(String).slice(0, 5) : [];
  if (!uris.length || !uris.every(redirectAllowed)) return oauthError('invalid_redirect_uri', 'Only Claude’s own sign-in return addresses are accepted.');
  const name = line(b.client_name, 80) || 'Claude';
  const client_id = await seal(env, 'client', 100 * 365 * DAY, { r: uris, n: name });
  return json({ client_id, client_id_issued_at: now(), client_name: name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }, 201, CORS);
}

async function authorize(url, env) {
  const p = Object.fromEntries(url.searchParams), client = await unseal(env, 'client', p.client_id);
  const bad = '<p>Go back to Claude and add the connector again.</p>';
  if (!client) return page('This sign-in link isn’t valid', bad, 400);
  const redirect = p.redirect_uri || (client.r.length === 1 ? client.r[0] : '');
  if (!redirect || !client.r.some(r => redirectMatches(r, redirect))) return page('This sign-in link isn’t valid', bad, 400);
  if (p.response_type !== 'code') return returnTo(redirect, { error: 'unsupported_response_type', state: p.state });
  if (!p.code_challenge || p.code_challenge_method !== 'S256') return returnTo(redirect, { error: 'invalid_request', error_description: 'PKCE with S256 is required.', state: p.state });
  const verifier = randomId(32), state = await seal(env, 'state', 900, { c: p.client_id, ru: redirect, st: p.state || '', cc: p.code_challenge, gv: verifier });
  const google = GOOGLE_AUTH + '?' + new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: url.origin + '/oauth/google', response_type: 'code', scope: DRIVE_SCOPE, access_type: 'offline', prompt: 'select_account consent', state, code_challenge: await sha256(verifier), code_challenge_method: 'S256' });
  const who = new URL(redirect).hostname === 'claude.ai' ? 'Claude (claude.ai)' : 'Claude Code on this computer';
  return page('Connect Claude to your Life Dashboard', `<p><strong>${esc(who)}</strong> is asking to use your Life Dashboard. It will be able to:</p>
<ul><li>read your records: tasks, food, workouts, weight, Bible reading, prayer, journal, family and meals;</li>
<li>add tasks, food, weight, prayer requests, journal entries and grocery items, and tick off tasks.</li></ul>
<p>It can’t change or delete anything else. Sign in with the Google account your dashboard syncs with. Google will ask to let Life Dashboard see its own app data in your Drive; that is the only access it gets.</p>
<p class="muted">You can disconnect at any time in Claude’s settings.</p>`, 200, { google, cancel: returnUrl(redirect, { error: 'access_denied', state: p.state }) });
}

async function googleToken(env, form) {
  const r = await fetch(GOOGLE_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...form }) });
  return { ok: r.ok, t: await r.json().catch(() => ({})) };
}
const googleExpiry = t => now() + Math.max(60, (+t.expires_in || 3600) - 120);

async function fromGoogle(url, env) {
  const p = Object.fromEntries(url.searchParams), s = await unseal(env, 'state', p.state);
  if (!s) return page('That took too long', '<p>Go back to Claude and connect again.</p>', 400);
  if (p.error || !p.code) return returnTo(s.ru, { error: 'access_denied', error_description: 'Google sign-in was not completed.', state: s.st });
  const { ok, t } = await googleToken(env, { code: p.code, code_verifier: s.gv, grant_type: 'authorization_code', redirect_uri: url.origin + '/oauth/google' });
  if (!ok || !t.access_token || !t.refresh_token) return returnTo(s.ru, { error: 'access_denied', error_description: 'Google sign-in failed.', state: s.st });
  if (!String(t.scope || DRIVE_SCOPE).split(' ').includes(DRIVE_SCOPE)) {
    await fetch(GOOGLE_REVOKE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t.refresh_token }) }).catch(() => { });
    return page('Life Dashboard needs its Drive folder', '<p>Google’s screen has a box for Life Dashboard’s own app data in your Drive. Without it, Claude can’t read your dashboard. Go back to Claude, connect again, and leave that box ticked.</p>', 400);
  }
  const gid = randomId();
  await env.CONNECTOR_KV.put('g:' + gid, await seal(env, 'grant', GRANT_TTL, { rt: t.refresh_token, gen: 0, prev: -1, rot: 0 }), { expirationTtl: GRANT_TTL });
  await new Box(t.access_token).mark().catch(() => { }); // the dashboard starts keeping Claude's copy when it sees this
  return returnTo(s.ru, { code: await seal(env, 'code', 300, { g: gid, c: s.c, ru: s.ru, cc: s.cc, at: t.access_token, ax: googleExpiry(t) }), state: s.st });
}

async function grantOf(env, gid) { const raw = await env.CONNECTOR_KV.get('g:' + gid); return raw ? unseal(env, 'grant', raw) : null; }
async function issue(env, gid, gen, gat, gexp) {
  const ttl = Math.max(60, Math.min(3600, gexp - now()));
  return json({ access_token: await seal(env, 'access', ttl, { g: gid, at: gat }), token_type: 'Bearer', expires_in: ttl, refresh_token: await seal(env, 'refresh', GRANT_TTL, { g: gid, n: gen }), scope: 'dashboard' }, 200, CORS);
}

async function token(request, env) {
  let p; try { p = /json/i.test(request.headers.get('Content-Type') || '') ? await request.json() : Object.fromEntries(new URLSearchParams(await request.text())); } catch (e) { p = {}; }
  if (p.grant_type === 'authorization_code') {
    const c = await unseal(env, 'code', p.code);
    if (!c || (p.client_id && p.client_id !== c.c) || (p.redirect_uri && !redirectMatches(c.ru, p.redirect_uri)) || typeof p.code_verifier !== 'string' || await sha256(p.code_verifier) !== c.cc) return oauthError('invalid_grant');
    const grant = await grantOf(env, c.g); if (!grant) return oauthError('invalid_grant');
    return issue(env, c.g, grant.gen, c.at, c.ax);
  }
  if (p.grant_type === 'refresh_token') {
    const r = await unseal(env, 'refresh', p.refresh_token); if (!r) return oauthError('invalid_grant');
    const grant = await grantOf(env, r.g); if (!grant) return oauthError('invalid_grant');
    // Each refresh token works once. The one just replaced keeps working for two minutes, for a retried request
    // or a storage read that hasn't caught up yet.
    const fresh = r.n >= grant.gen, grace = r.n === grant.prev && now() - grant.rot < 120;
    if (!fresh && !grace) return oauthError('invalid_grant');
    const { ok, t } = await googleToken(env, { grant_type: 'refresh_token', refresh_token: grant.rt });
    if (!ok || !t.access_token) {
      if (t.error === 'invalid_grant') { await env.CONNECTOR_KV.delete('g:' + r.g); return oauthError('invalid_grant'); } // Google access was removed
      return oauthError('temporarily_unavailable', 'Google didn’t answer. Try again shortly.', 503);
    }
    const next = fresh ? { ...grant, gen: r.n + 1, prev: r.n, rot: now() } : { ...grant };
    if (t.refresh_token) next.rt = t.refresh_token;
    if (fresh || t.refresh_token) await env.CONNECTOR_KV.put('g:' + r.g, await seal(env, 'grant', GRANT_TTL, next), { expirationTtl: GRANT_TTL });
    return issue(env, r.g, next.gen, t.access_token, googleExpiry(t));
  }
  return oauthError('unsupported_grant_type');
}

// Disconnecting removes Claude's copy from Drive (the dashboard stops refreshing it) and Google's access.
// Additions still waiting in the inbox stay, so they still arrive.
async function revoke(request, env) {
  let p; try { p = Object.fromEntries(new URLSearchParams(await request.text())); } catch (e) { p = {}; }
  const t = await unseal(env, 'refresh', p.token) || await unseal(env, 'access', p.token), grant = t && await grantOf(env, t.g);
  if (grant) {
    try {
      const { ok, t: g } = await googleToken(env, { grant_type: 'refresh_token', refresh_token: grant.rt });
      if (ok && g.access_token) { const box = new Box(g.access_token); for (const [name, f] of await box.list()) if (!name.startsWith('claude-inbox-')) await box.call(`/drive/v3/files/${encodeURIComponent(f.id)}`, { method: 'DELETE' }); }
    } catch (e) { }
    await fetch(GOOGLE_REVOKE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: grant.rt }) }).catch(() => { });
    await env.CONNECTOR_KV.delete('g:' + t.g);
  }
  return new Response(null, { status: 200, headers: CORS });
}

// --- The person's Drive app folder, as one request sees it.
let dropSeq = 0;
class Box {
  constructor(token) { this.token = token; this.files = null; this.texts = new Map(); }
  async call(path, options = {}) {
    const r = await fetch(DRIVE + path, { ...options, headers: { Authorization: 'Bearer ' + this.token, ...(options.headers || {}) } });
    if (r.status === 401) throw Object.assign(new Error('Sign in again'), { signin: true });
    if (!r.ok) throw new Error(`Google Drive answered ${r.status}. Try again in a moment.`);
    return r;
  }
  // The claude-* files by name (the newest, should a name ever be there twice).
  async list() {
    if (this.files) return this.files;
    const found = new Map(); let page = '', n = 0;
    do {
      const q = new URLSearchParams({ spaces: 'appDataFolder', q: "name contains 'claude' and trashed=false", fields: 'nextPageToken,files(id,name,modifiedTime)', pageSize: '1000', ...(page ? { pageToken: page } : {}) });
      const d = await (await this.call('/drive/v3/files?' + q)).json();
      for (const f of d.files || []) if (String(f.name).startsWith('claude-')) { const had = found.get(f.name); if (!had || (f.modifiedTime || '') > (had.modifiedTime || '')) found.set(f.name, f); }
      page = d.nextPageToken || '';
    } while (page && ++n < 10);
    return (this.files = found);
  }
  async text(name) {
    if (this.texts.has(name)) return this.texts.get(name);
    const f = (await this.list()).get(name), t = f ? await (await this.call(`/drive/v3/files/${encodeURIComponent(f.id)}?alt=media`)).text() : null;
    this.texts.set(name, t); return t;
  }
  async now() {
    const t = await this.text('claude-now.json');
    if (!t) { await this.mark(); throw new Error(NO_COPY); }
    return JSON.parse(t);
  }
  async write(name, data) {
    const mark = 'ld' + randomId(12), meta = JSON.stringify({ name, parents: ['appDataFolder'] });
    return this.call('/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + mark }, body: `--${mark}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${mark}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${mark}--` });
  }
  // claude-connected.json tells the dashboard to keep a copy for Claude. Using the connector puts it back after a disconnect.
  async mark() { if (!(await this.list()).has('claude-connected.json')) await this.write('claude-connected.json', { v: 1, connected: new Date().toISOString() }); }
  // Inbox names sort in the order they were added: the time, then a counter for additions in the same millisecond.
  async drop(item) { const id = Date.now().toString(36) + (dropSeq++ % 1296).toString(36).padStart(2, '0') + randomId(6).replace(/[-_]/g, 'x'); await this.write(`claude-inbox-${id}.json`, { v: 1, id, at: new Date().toISOString(), ...item }); return 'c-' + id; }
  // Additions that haven't reached the dashboard yet.
  async pending(what) {
    const names = [...(await this.list()).keys()].filter(k => k.startsWith('claude-inbox-')).sort().slice(0, 20), out = [];
    for (const name of names) {
      try { const x = JSON.parse(await this.text(name)); if (!what || x.what === what) out.push(clean({ what: x.what, id: 'c-' + x.id, title: x.title || x.request, task: x.task, date: x.date, meal: x.meal, items: Array.isArray(x.items) ? x.items.map(i => (i && i.name) || i).slice(0, 20) : undefined, weight_kg: x.kg, added: x.at })); } catch (e) { }
    }
    return out;
  }
  // Lines of claude-<kind>-YYYY.jsonl between two dates. Each line starts {"d":"YYYY-MM-DD", so only the
  // lines in range are read.
  async lines(kind, from, to) {
    const out = [];
    for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
      const t = await this.text(`claude-${kind}-${y}.jsonl`); if (!t) continue;
      for (const l of t.split('\n')) { const d = l.slice(6, 16); if (d >= from && d <= to) { try { out.push(JSON.parse(l)); } catch (e) { } } }
    }
    return out;
  }
  async noteYears() { return [...(await this.list()).keys()].map(k => (k.match(/^claude-notes-(\d{4})\.jsonl$/) || [])[1]).filter(Boolean).sort().reverse(); }
}

// --- MCP over plain JSON POSTs (no streams, no sessions).
async function mcp(request, env, ctx, origin) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST', ...CORS } });
  const challenge = invalid => new Response(JSON.stringify({ error: invalid ? 'invalid_token' : 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"${invalid ? ', error="invalid_token"' : ''}`, ...CORS } });
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/i), who = m && await unseal(env, 'access', m[1]);
  if (!who) return challenge(!!m);
  let body; try { body = await request.json(); } catch (e) { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 200, CORS); }
  const box = new Box(who.at), out = [];
  try { for (const msg of Array.isArray(body) ? body : [body]) { const r = await rpc(msg, box, ctx); if (r) out.push(r); } }
  catch (e) { if (e.signin) return challenge(true); throw e; }
  if (!out.length) return new Response(null, { status: 202, headers: CORS });
  return json(Array.isArray(body) ? out : out[0], 200, CORS);
}
async function rpc(msg, box, ctx) {
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } }), ok = result => ({ jsonrpc: '2.0', id: msg.id, result });
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return msg && msg.id != null ? fail(-32600, 'Invalid request') : null;
  if (msg.id === undefined || msg.id === null) return null; // a notification
  if (msg.method === 'initialize') { const v = msg.params && msg.params.protocolVersion; return ok({ protocolVersion: VERSIONS.includes(v) ? v : VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'life-dashboard', title: 'Life Dashboard', version: '1.0.0' }, instructions: INSTRUCTIONS }); }
  if (msg.method === 'ping') return ok({});
  if (msg.method === 'tools/list') return ok({ tools: TOOLS.map(({ run, ...t }) => t) });
  if (msg.method !== 'tools/call') return fail(-32601, 'Method not found');
  const tool = TOOLS.find(t => t.name === (msg.params && msg.params.name));
  if (!tool) return fail(-32602, 'Unknown tool');
  try {
    const r = await tool.run((msg.params && msg.params.arguments) || {}, box, ctx);
    return ok({ content: [{ type: 'text', text: typeof r === 'string' ? r : JSON.stringify(r) }] });
  } catch (e) {
    if (e.signin) throw e;
    return ok({ content: [{ type: 'text', text: e instanceof SyntaxError ? 'The dashboard’s copy couldn’t be read. Open the dashboard so it saves a fresh one.' : e.message || 'Something went wrong.' }], isError: true });
  }
}

// --- Reading
const entriesOut = e => (e || []).map(([meal, name, amount, cal, p, c, f]) => clean({ meal, name, amount: amount || undefined, calories: cal, protein: p, carbs: c, fat: f }));
async function today(a, box) {
  const n = await box.now(), t = localToday(n.tz, n.today), open = (n.tasks || []).filter(x => !x.someday), food = (n.food || []).find(d => d.d === t);
  const w = n.workouts || {}, done = (w.recent || []).filter(x => x.d === t), r = n.reading || {}, prayers = n.prayers || [];
  return clean({
    as_of: n.made, today: t, weekday: weekday(t), name: n.name || undefined, unit: n.unit,
    big3: n.week && n.week.monday === mondayOf(t) ? n.week.big3 : 'Not picked for this week yet',
    due_today: open.filter(x => x.due === t), overdue: open.filter(x => x.due && x.due < t),
    time_blocks: (n.blocks || {})[t] || [],
    food_today: food ? { calories: food.cal, protein: food.p, carbs: food.c, fat: food.f, items: entriesOut(food.e) } : 'Nothing logged yet',
    targets: n.targets ? { calories: n.targets.cal, protein: n.targets.p, carbs: n.targets.c, fat: n.targets.f } : undefined,
    weight: n.weight ? clean({ unit: n.weight.unit, trend: n.weight.trend, change_7_days: n.weight.change7, change_30_days: n.weight.change30, last_weigh_in: (n.weight.last || []).slice(-1)[0] }) : undefined,
    workout: clean({ in_progress: w.active || undefined, done_today: done.length ? done.map(x => x.name) : undefined, next: w.next || undefined }),
    bible_reading: r.plan ? clean({ plan: r.plan, today: (r.days || {})[t], streak_days: r.streak, behind_days: r.behind || undefined, memory_verses_due: r.memoryDue || undefined }) : undefined,
    meals_today: ((n.meals || {}).plan || {})[t] || [],
    upcoming_dates: ((n.family || {}).dates || []).filter(x => x.d >= t && x.d <= addDays(t, 30)),
    prayer_list: { open_requests: prayers.length, longest_unprayed: prayers.slice(0, 5).map(p => p.title) },
    this_week: (n.weeks || [])[0], last_week: (n.weeks || [])[1],
    waiting_to_sync: await box.pending()
  });
}
async function listTasks(a, box) {
  const n = await box.now(), t = localToday(n.tz, n.today), view = a.view || 'open';
  const views = { open: () => true, today: x => x.due === t && !x.someday, overdue: x => x.due && x.due < t && !x.someday, upcoming: x => x.due && x.due > t && x.due <= addDays(t, 14) && !x.someday, waiting: x => x.waiting, someday: x => x.someday, inbox: x => x.inbox, done: () => true };
  if (!views[view]) throw new Error('view should be one of ' + Object.keys(views).join(', ') + '.');
  let list = ((view === 'done' ? n.done : n.tasks) || []).filter(views[view]);
  if (a.area) list = list.filter(x => x.area === a.area);
  if (a.project) { const p = low(a.project); list = list.filter(x => low(x.project).includes(p)); }
  if (a.person) { const p = low(a.person); list = list.filter(x => low(x.person).includes(p)); }
  if (a.query) { const words = low(a.query).split(/\s+/).filter(Boolean); list = list.filter(x => words.every(w => low(`${x.title} ${x.notes || ''} ${x.project || ''}`).includes(w))); }
  return clean({ as_of: n.made, today: t, view, count: list.length, tasks: list.slice(0, clamp(a.limit, 1, 200, 100)), waiting_to_sync: view === 'done' ? undefined : await box.pending('task') });
}
async function foodLog(a, box) {
  const n = await box.now(), t = localToday(n.tz, n.today), to = dateArg(a.to, 'to') || t, from = dateArg(a.from, 'from') || addDays(to, -6);
  if (from > to) throw new Error('“from” is after “to”.');
  const span = daysBetween(from, to) + 1; if (span > 400) throw new Error('Ask for 400 days or fewer at a time.');
  const items = a.items !== undefined ? !!a.items : span <= 14;
  if (items && span > 31) throw new Error('Items can be listed for up to 31 days at a time. Ask again with items set to false for daily totals.');
  const days = (await box.lines('days', from, to)).map(x => clean({ date: x.d, calories: x.cal, protein: x.p, carbs: x.c, fat: x.f, fiber: x.fib, target_calories: x.tc, target_protein: x.tp, weight: x.w, items: items ? entriesOut(x.e) : undefined }));
  const logged = days.filter(x => x.calories > 0), avg = k => Math.round(sum(logged.map(x => x[k])) / logged.length);
  return clean({ as_of: n.made, from, to, weight_unit: n.unit, days_logged: logged.length, average_per_logged_day: logged.length ? { calories: avg('calories'), protein: avg('protein'), carbs: avg('carbs'), fat: avg('fat') } : undefined, days });
}
async function workouts(a, box) {
  const n = await box.now(), t = localToday(n.tz, n.today), ex = line(a.exercise, 80), to = dateArg(a.to, 'to') || t, from = dateArg(a.from, 'from') || addDays(to, ex ? -365 : -29);
  if (from > to) throw new Error('“from” is after “to”.');
  if (daysBetween(from, to) > 731) throw new Error('Ask for two years or less at a time.');
  const list = await box.lines('workouts', from, to);
  if (ex) {
    const q = low(ex), history = [];
    for (const w of list) for (const [name, sets, best] of w.ex || []) if (low(name).includes(q)) history.push(clean({ date: w.d, workout: w.name, exercise: name, sets, best }));
    return { as_of: n.made, weight_unit: n.unit, from, to, exercise: ex, sessions: history.length, history: history.slice(-100) };
  }
  const w = n.workouts || {};
  return clean({ as_of: n.made, weight_unit: n.unit, from, to, count: list.length, in_progress: w.active || undefined, next: w.next || undefined, workouts: list.slice(-60).map(x => clean({ date: x.d, name: x.name, minutes: x.min, sets: x.sets, volume: x.vol, exercises: (x.ex || []).map(([name, sets, best]) => clean({ name, sets, best })), note: x.note })) });
}
function noteOut(x, words, full) {
  const body = String(x.x || ''); let snippet;
  if (!full) { const at = words.map(w => low(body).indexOf(w)).filter(i => i >= 0).sort((p, q) => p - q)[0] ?? 0, a0 = Math.max(0, at - 80); snippet = (a0 ? '…' : '') + body.slice(a0, a0 + 280).replace(/\s+/g, ' ').trim() + (a0 + 280 < body.length ? '…' : ''); }
  const { d, s, id, t, x: _, ...extra } = x;
  return clean({ section: s, id, date: d, title: t, ...(full ? { text: body } : { snippet }), ...extra });
}
async function search(a, box) {
  const n = await box.now(), words = low(a.query).split(/[^\p{L}\p{N}’']+/u).filter(w => w.length > 1).slice(0, 8);
  const sections = new Set(Array.isArray(a.sections) && a.sections.length ? a.sections.filter(s => NOTE_SECTIONS.includes(s)) : NOTE_SECTIONS);
  const from = dateArg(a.from, 'from') || '0000-00-00', to = dateArg(a.to, 'to') || '9999-99-99', limit = clamp(a.limit, 1, 50, 20), hits = [];
  // A cheap look at each raw line first; only likely lines are read, then checked against their words.
  const tests = words.map(w => new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  for (const y of await box.noteYears()) {
    if (y < from.slice(0, 4) || y > to.slice(0, 4)) continue;
    const lines = (await box.text(`claude-notes-${y}.jsonl`) || '').split('\n');
    for (let i = lines.length - 1; i >= 0 && hits.length < limit; i--) {
      const l = lines[i], d = l.slice(6, 16);
      if (!l || d < from || d > to || !tests.every(r => r.test(l))) continue;
      let x; try { x = JSON.parse(l); } catch (e) { continue; }
      if (!sections.has(x.s)) continue;
      const hay = low([x.t, x.x, x.ref, x.tags, x.cat, x.by, x.project].flat().filter(Boolean).join(' '));
      if (words.every(w => hay.includes(w))) hits.push(noteOut(x, words, false));
    }
    if (hits.length >= limit) break;
  }
  return { as_of: n.made, query: a.query || '', count: hits.length, results: hits };
}
async function record(a, box) {
  const n = await box.now(), id = line(a.id, 200); if (!id) throw new Error('Give the id from search_records or list_tasks.');
  const task = [...(n.tasks || []), ...(n.done || [])].find(x => x.id === id); if (task) return { as_of: n.made, section: 'task', ...task };
  const needle = `"id":${JSON.stringify(id)}`;
  for (const y of await box.noteYears()) {
    const t = await box.text(`claude-notes-${y}.jsonl`) || '', i = t.indexOf(needle); if (i < 0) continue;
    const x = JSON.parse(t.slice(t.lastIndexOf('\n', i) + 1, t.indexOf('\n', i) < 0 ? undefined : t.indexOf('\n', i)));
    if (!a.section || x.s === a.section) return { as_of: n.made, ...noteOut(x, [], true) };
  }
  throw new Error('No record with that id. Use search_records to find it.');
}
const SECTIONS = { projects: n => n.projects, family: n => n.family, meals: n => ({ plan: (n.meals || {}).plan, grocery: (n.meals || {}).grocery }), recipes: n => (n.meals || {}).recipes, prayer: n => n.prayers, reading: n => n.reading, media: n => n.media, foods: n => n.foods, week: n => ({ plan: n.week, numbers: n.weeks }), weight: n => n.weight, blocks: n => n.blocks };
async function section(a, box) {
  const n = await box.now(), f = SECTIONS[a.section];
  if (!f) throw new Error('section should be one of ' + Object.keys(SECTIONS).join(', ') + '.');
  return { as_of: n.made, section: a.section, unit: n.unit, [a.section]: f(n) ?? null };
}
// The copy when there is one; a sign-in problem still goes back to Claude so it can sign in again.
const copyOrNull = box => box.now().catch(e => { if (e.signin) throw e; return null; });
async function foods(a, box, ctx) {
  const q = line(a.query, 120); if (!q) throw new Error('Say which food to look up.');
  const n = await copyOrNull(box), words = low(q).split(' ');
  const mine = n ? (n.foods || []).filter(f => words.every(w => low(`${f.name} ${f.brand || ''}`).includes(w))).slice(0, 10) : [];
  let off = [], note;
  try { off = (await offSearch(q, ctx, 8000)).products; } catch (e) { note = 'Open Food Facts didn’t answer, so only saved foods are listed.'; }
  const kcal = x => x['energy-kcal_100g'] != null ? +x['energy-kcal_100g'] : x.energy_100g != null ? Math.round(+x.energy_100g / 4.184) : undefined;
  return clean({ query: q, your_saved_foods: mine, open_food_facts: off.slice(0, 10).map(p => { const x = p.nutriments || {}; return clean({ name: p.product_name, brand: p.brands || undefined, per_100g: clean({ calories: kcal(x), protein: x.proteins_100g, carbs: x.carbohydrates_100g, fat: x.fat_100g, fiber: x.fiber_100g }), serving: p.serving_size || undefined, serving_grams: p.serving_quantity ?? undefined }); }), note });
}

// --- Adding. Each addition is one inbox file; the dashboard checks it again before taking it in.
async function whenToday(box) { const n = await copyOrNull(box); return n ? localToday(n.tz, n.today) : new Date().toISOString().slice(0, 10); }
async function addTask(a, box) {
  const title = line(a.title, 300); if (!title) throw new Error('A task needs a title.');
  const time = typeof a.time === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(a.time.trim()) ? a.time.trim().padStart(5, '0') : undefined;
  if (a.area != null && !AREAS.includes(a.area)) throw new Error('area should be one of ' + AREAS.join(', ') + '.');
  const item = clean({ what: 'task', title, due: dateArg(a.due, 'due'), time, area: a.area || undefined, project: line(a.project, 120), person: line(a.person, 80), notes: text(a.notes, 4000), priority: ['high', 'med', 'low'].includes(a.priority) ? a.priority : undefined, someday: a.someday === true || undefined, waiting: a.waiting === true || undefined });
  const id = await box.drop(item);
  return `Added “${title}”${item.due ? `, due ${item.due}${time ? ' at ' + time : ''}` : ''} (id ${id}). ${LANDS}`;
}
async function completeTask(a, box) {
  const id = line(a.task_id, 200); if (!id) throw new Error('Give the task’s id from list_tasks.');
  const n = await copyOrNull(box), t = n && (n.tasks || []).find(x => x.id === id);
  if (n && !t && !id.startsWith('c-')) throw new Error('No open task with that id. Use list_tasks to find it.');
  await box.drop({ what: 'done', task: id });
  return `Marked “${t ? t.title : id}” done. ${LANDS}`;
}
async function logFood(a, box) {
  if (!MEALS.includes(a.meal)) throw new Error('meal should be one of ' + MEALS.join(', ') + '.');
  const t = await whenToday(box), date = dateArg(a.date, 'date') || t;
  if (date > addDays(t, 1) || date < addDays(t, -730)) throw new Error('Food can be logged for today or earlier days.');
  const raw = Array.isArray(a.items) ? a.items : []; if (!raw.length || raw.length > 20) throw new Error('Give between 1 and 20 items.');
  const items = raw.map((x, i) => {
    const name = line(x && x.name, 200); if (!name) throw new Error(`Item ${i + 1} needs a name.`);
    return clean({ name, amount: line(x.amount, 80), cal: amount(x.calories, 0, 5000, 'calories') ?? 0, p: amount(x.protein, 0, 500, 'protein'), c: amount(x.carbs, 0, 1000, 'carbs'), f: amount(x.fat, 0, 500, 'fat'), fiber: amount(x.fiber, 0, 300, 'fiber'), sugar: amount(x.sugar, 0, 1000, 'sugar'), sodium: amount(x.sodium_mg, 0, 50000, 'sodium_mg'), satfat: amount(x.saturated_fat, 0, 300, 'saturated_fat'), food: line(x.food_id, 120), grams: amount(x.grams, 0, 10000, 'grams'), recipe: line(x.recipe_id, 120), servings: amount(x.servings, 0, 100, 'servings') });
  });
  await box.drop({ what: 'food', date, meal: a.meal, items });
  return `Logged ${items.length} item${items.length === 1 ? '' : 's'} for ${a.meal} on ${date} (${Math.round(sum(items.map(x => x.cal)))} kcal). ${LANDS}`;
}
async function logWeight(a, box) {
  const n = await copyOrNull(box), unit = a.unit === 'kg' || a.unit === 'lb' ? a.unit : n && n.unit === 'kg' ? 'kg' : 'lb';
  const v = amount(a.weight, 1, 1500, 'weight'); if (v == null) throw new Error('Give the weight.');
  const kg = unit === 'kg' ? v : v * 0.45359237; if (kg < 20 || kg > 350) throw new Error('That weight doesn’t look right.');
  const t = n ? localToday(n.tz, n.today) : await whenToday(box), date = dateArg(a.date, 'date') || t;
  if (date > addDays(t, 1)) throw new Error('A weigh-in can’t be in the future.');
  await box.drop({ what: 'weight', date, kg: Math.round(kg * 100) / 100 });
  return `Recorded ${v} ${unit} for ${date}. ${LANDS}`;
}
async function addPrayer(a, box) {
  const request = line(a.request, 300); if (!request) throw new Error('Say what to pray for.');
  await box.drop(clean({ what: 'prayer', request, details: text(a.details, 4000), cat: PRAY_CATS.includes(a.category) ? a.category : undefined }));
  return `Added “${request}” to the prayer list. ${LANDS}`;
}
async function addJournal(a, box) {
  const body = text(a.body, 20000); if (!body) throw new Error('The entry needs some words.');
  const t = await whenToday(box), date = dateArg(a.date, 'date') || t; if (date > addDays(t, 1)) throw new Error('A journal entry can’t be dated in the future.');
  await box.drop(clean({ what: 'journal', date, title: line(a.title, 200), body }));
  return `Added a journal entry for ${date}. ${LANDS}`;
}
async function addGrocery(a, box) {
  const items = (Array.isArray(a.items) ? a.items : []).map(x => line(x, 120)).filter(Boolean).slice(0, 50);
  if (!items.length) throw new Error('Give at least one item.');
  await box.drop({ what: 'grocery', items });
  return `Added ${items.length} item${items.length === 1 ? '' : 's'} to the grocery list. ${LANDS}`;
}

const INSTRUCTIONS = 'Life Dashboard is this person’s own planner and tracker: tasks and projects, food and weight, workouts, Bible reading and prayer, journal, family, meals and groceries. Start with dashboard_today. What you read is the copy the dashboard saved at its last sync (as_of); say so when it is old. Dates are the person’s local dates (YYYY-MM-DD) and weights use their unit. What you add waits in a drop box and appears in the dashboard the next time it syncs, usually when it is next opened. Before logging food, use the person’s saved foods or search_foods for real numbers when you can.';
const obj = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const str = description => ({ type: 'string', description }), date = description => ({ type: 'string', format: 'date', description });
const READ = { readOnlyHint: true, openWorldHint: false }, ADD = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const TOOLS = [
  { name: 'dashboard_today', title: 'Today at a glance', description: 'Today and this week: the Big 3, tasks due today and overdue, time blocks, food so far against targets, weight trend, the workout, today’s Bible reading, meals, upcoming family dates, the prayer list, this week’s numbers and anything added that hasn’t synced yet. Start here.', inputSchema: obj({}), annotations: READ, run: today },
  { name: 'list_tasks', title: 'List tasks', description: 'Tasks by view: open (default), today, overdue, upcoming (next 14 days), waiting, someday, inbox (no date or home yet) or done (finished in the last 30 days; older ones are in search_records). Filter by area, project, person or words. Each task has an id for complete_task.', inputSchema: obj({ view: { type: 'string', enum: ['open', 'today', 'overdue', 'upcoming', 'waiting', 'someday', 'inbox', 'done'] }, area: { type: 'string', enum: AREAS }, project: str('Part of a project name'), person: str('Part of a person’s name'), query: str('Words in the title or notes'), limit: { type: 'integer', minimum: 1, maximum: 200 } }), annotations: READ, run: listTasks },
  { name: 'get_food_log', title: 'Food log', description: 'Food by day: calories, protein, carbs, fat and fiber, the day’s targets and weight, and each item eaten (for up to 31 days). Defaults to the last 7 days; up to 400 days of daily totals with items false.', inputSchema: obj({ from: date('First day (default 6 days before “to”)'), to: date('Last day (default today)'), items: { type: 'boolean', description: 'List each item eaten (default true for 14 days or fewer)' } }), annotations: READ, run: foodLog },
  { name: 'get_workouts', title: 'Workouts', description: 'Workouts in a date range (default the last 30 days) with each exercise’s working sets and best set, or one exercise’s history (default the last year) to see progress. Warm-up sets are left out.', inputSchema: obj({ from: date('First day'), to: date('Last day (default today)'), exercise: str('Part of an exercise name, for its history') }), annotations: READ, run: workouts },
  { name: 'search_records', title: 'Search records', description: 'Search the journal, prayer requests (including answered ones), Scripture study notes, quotes and illustrations, media library notes and finished tasks. Newest first. Leave out query to list by date. Use get_record for the full text.', inputSchema: obj({ query: str('Words to find (all must appear)'), sections: { type: 'array', items: { type: 'string', enum: NOTE_SECTIONS } }, from: date('Earliest date'), to: date('Latest date'), limit: { type: 'integer', minimum: 1, maximum: 50 } }), annotations: READ, run: search },
  { name: 'get_record', title: 'Read a record', description: 'The full text of one record from search_records, or a task by its id.', inputSchema: obj({ id: str('The id from search_records or list_tasks'), section: { type: 'string', enum: NOTE_SECTIONS } }, ['id']), annotations: READ, run: record },
  { name: 'get_section', title: 'Read a part of the dashboard', description: 'One part in full: projects; family (people, birthdays, anniversary, gift ideas, upcoming dates); meals (the plan for the next two weeks and the grocery list); recipes (with nutrition per serving); prayer (open requests); reading (Bible plan and memory verses); media (in progress and up next); foods (saved foods with nutrition and ids for log_food); week (this week’s plan and numbers); weight; blocks (time blocks this week).', inputSchema: obj({ section: { type: 'string', enum: Object.keys(SECTIONS) } }, ['section']), annotations: READ, run: section },
  { name: 'search_foods', title: 'Look up a food', description: 'Nutrition for a food: the person’s saved foods that match, and packaged foods from Open Food Facts (per 100 g and per serving). For everyday foods with no match, typical values are fine.', inputSchema: obj({ query: str('The food, with a brand if there is one') }, ['query']), annotations: { readOnlyHint: true, openWorldHint: true }, run: foods },
  { name: 'add_task', title: 'Add a task', description: 'Add a task to the dashboard.', inputSchema: obj({ title: str('What to do, as a short title'), due: date('Due date'), time: str('Time of day, HH:MM (24-hour)'), area: { type: 'string', enum: AREAS }, project: str('Project name (made if new)'), person: str('Person it involves'), notes: str('Details'), priority: { type: 'string', enum: ['high', 'med', 'low'] }, someday: { type: 'boolean', description: 'Park it for someday' }, waiting: { type: 'boolean', description: 'Waiting on someone else' } }, ['title']), annotations: ADD, run: addTask },
  { name: 'complete_task', title: 'Tick off a task', description: 'Mark an open task done, by its id from list_tasks or dashboard_today.', inputSchema: obj({ task_id: str('The task’s id') }, ['task_id']), annotations: ADD, run: completeTask },
  { name: 'log_food', title: 'Log food', description: 'Log what the person ate at one meal. Each item needs calories, and protein, carbs and fat in grams when known. For a saved food give food_id and grams, or for a recipe recipe_id and servings, and the dashboard works the numbers out itself.', inputSchema: obj({ meal: { type: 'string', enum: MEALS }, date: date('Day eaten (default today)'), items: { type: 'array', minItems: 1, maxItems: 20, items: obj({ name: str('Food'), amount: str('How much, as said (“2 slices”, “1 cup”)'), calories: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' }, fiber: { type: 'number' }, sugar: { type: 'number' }, sodium_mg: { type: 'number' }, saturated_fat: { type: 'number' }, food_id: str('A saved food’s id (get_section foods or search_foods)'), grams: { type: 'number', description: 'Grams eaten of the saved food' }, recipe_id: str('A recipe’s id (get_section recipes)'), servings: { type: 'number', description: 'Servings of the recipe' } }, ['name', 'calories']) } }, ['meal', 'items']), annotations: ADD, run: logFood },
  { name: 'log_weight', title: 'Log weight', description: 'Record a weigh-in. The unit defaults to the person’s own.', inputSchema: obj({ weight: { type: 'number' }, unit: { type: 'string', enum: ['lb', 'kg'] }, date: date('Day (default today)') }, ['weight']), annotations: ADD, run: logWeight },
  { name: 'add_prayer_request', title: 'Add a prayer request', description: 'Add a request to the prayer list.', inputSchema: obj({ request: str('What to pray for'), details: str('More detail'), category: { type: 'string', enum: PRAY_CATS } }, ['request']), annotations: ADD, run: addPrayer },
  { name: 'add_journal_entry', title: 'Add a journal entry', description: 'Add a journal entry in the person’s own words.', inputSchema: obj({ body: str('The entry'), title: str('A title'), date: date('Day (default today)') }, ['body']), annotations: ADD, run: addJournal },
  { name: 'add_grocery_items', title: 'Add to the grocery list', description: 'Add items to the grocery list, with amounts when given (“2 lb chicken breast”).', inputSchema: obj({ items: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string' } } }, ['items']), annotations: ADD, run: addGrocery }
];

// --- A small page for the sign-in steps that happen in the browser.
function page(title, html, status = 200, links = null) {
  const buttons = links ? `<p class="row"><a class="go" href="${esc(links.google)}">Continue with Google</a><a class="no" href="${esc(links.cancel)}">Cancel</a></p>` : '';
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root{color-scheme:light dark;--bg:#f1f5f9;--card:#fff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--brand:#0f766e}
@media (prefers-color-scheme:dark){:root{--bg:#020617;--card:#0f172a;--ink:#e2e8f0;--muted:#94a3b8;--line:#1e293b;--brand:#2dd4bf}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,sans-serif}main{max-width:32rem;margin:2rem auto;padding:1.5rem;background:var(--card);border:1px solid var(--line);border-radius:1rem}
@media (max-width:540px){main{margin:1rem;padding:1.25rem}}h1{font-size:1.3rem;line-height:1.3;margin:0 0 .75rem}ul{padding-left:1.2rem}.muted{color:var(--muted);font-size:.9rem}
.row{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.25rem}a{display:inline-block;padding:.65rem 1.1rem;border-radius:.75rem;text-decoration:none;font-weight:600}.go{background:var(--brand);color:#fff}.no{color:var(--ink);border:1px solid var(--line)}
@media (prefers-color-scheme:dark){.go{color:#042f2e}}</style></head><body><main><h1>${esc(title)}</h1>${html}${buttons}</main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' } });
}
