// Life Dashboard link reader (Cloudflare Worker). The app sends a link; the Worker fetches the page
// and returns its recipe, title, picture and article text as JSON. It answers only Life Dashboard's
// own addresses, fetches only public web pages, and keeps answers for an hour.
import { readPage, allowedTarget } from './parse.js';

const ORIGINS = ['https://9r5wwng7nj-netizen.github.io', 'http://localhost:8080', 'http://127.0.0.1:8080'];
const MAX_BYTES = 3 * 1024 * 1024, TIMEOUT_MS = 10000;
const UA = 'Mozilla/5.0 (compatible; LifeDashboardReader/1.0; +https://9r5wwng7nj-netizen.github.io/Life-Dashboard/)';

const reply = (body, status, origin, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', ...extra } });

// Google sign-in that lasts. The app trades a one-time sign-in code for tokens here, and later trades
// its refresh token for a fresh one-hour access token. Only this Worker holds the app's client secret
// (the Worker secret GOOGLE_CLIENT_SECRET); it stores nothing. Without the secret, /google/ready says
// so and the app keeps using one-hour sign-ins.
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token', GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';
const REDIRECTS = ORIGINS.map(o => o + (o.includes('github.io') ? '/Life-Dashboard/index.html' : '/index.html'));
async function google(request, env, origin, path) {
  const ready = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), nostore = { 'Cache-Control': 'no-store' };
  if (path === '/google/ready') return reply({ ready }, 200, origin, nostore);
  if (!ready) return reply({ error: 'not_set_up' }, 501, origin, nostore);
  if (request.method !== 'POST') return reply({ error: 'Use POST' }, 405, origin, nostore);
  let b; try { b = await request.json(); } catch (e) { b = null; }
  const text = v => typeof v === 'string' && v.length > 0 && v.length < 4096;
  const form = { client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET };
  if (path === '/google/token' && b && text(b.code) && text(b.verifier) && REDIRECTS.includes(b.redirect_uri)) Object.assign(form, { grant_type: 'authorization_code', code: b.code, code_verifier: b.verifier, redirect_uri: b.redirect_uri });
  else if (path === '/google/refresh' && b && text(b.refresh_token)) Object.assign(form, { grant_type: 'refresh_token', refresh_token: b.refresh_token });
  else if (path === '/google/revoke' && b && text(b.token)) {
    const r = await fetch(GOOGLE_REVOKE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: b.token }) });
    return reply({ revoked: r.ok }, 200, origin, nostore);
  } else return reply({ error: 'bad_request' }, 400, origin, nostore);
  const r = await fetch(GOOGLE_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return reply({ error: d.error === 'invalid_grant' ? 'invalid_grant' : 'google_refused' }, r.status >= 500 ? 502 : 400, origin, nostore);
  return reply({ access_token: d.access_token, expires_in: d.expires_in, refresh_token: d.refresh_token || null }, 200, origin, nostore);
}

async function fetchText(url, signal) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.8' }, redirect: 'follow', signal });
  if (!res.ok) throw Object.assign(new Error(`The site answered ${res.status}`), { status: 502 });
  if (!/text\/html|application\/xhtml/i.test(res.headers.get('content-type') || '')) throw Object.assign(new Error('That link is not a web page'), { status: 415 });
  const finalUrl = res.url || url;
  if (!allowedTarget(finalUrl)) throw Object.assign(new Error('The page redirected somewhere that cannot be read'), { status: 400 });
  const reader = res.body.getReader(), parts = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) { reader.cancel(); break; } parts.push(value); }
  return { html: new TextDecoder().decode(await new Blob(parts).arrayBuffer()), finalUrl };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    if (!ORIGINS.includes(origin)) return new Response('Not available', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' } });
    const path = new URL(request.url).pathname;
    if (path.startsWith('/google/')) return google(request, env, origin, path);
    if (request.method !== 'GET') return reply({ error: 'Use GET' }, 405, origin);
    const target = allowedTarget(new URL(request.url).searchParams.get('url') || '');
    if (!target) return reply({ error: 'That link cannot be read' }, 400, origin);

    const cacheKey = new Request(`https://reader.cache/?url=${encodeURIComponent(target.href)}`), cache = caches.default, hit = await cache.match(cacheKey);
    if (hit) return reply(await hit.json(), 200, origin, { 'X-Reader-Cache': 'hit' });

    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      let body;
      const h = target.hostname.replace(/^www\./, '');
      if (h === 'tiktok.com' || h.endsWith('.tiktok.com')) {
        // TikTok pages need JavaScript; its public oEmbed gives the caption, author and cover picture.
        const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(target.href)}`, { signal: controller.signal });
        const d = r.ok ? await r.json() : {};
        body = { url: target.href, title: d.title || '', description: d.title || '', image: d.thumbnail_url || '', siteName: 'TikTok', author: d.author_name || '', published: '', recipe: null, text: '' };
      } else {
        const { html, finalUrl } = await fetchText(target.href, controller.signal);
        body = readPage(html, finalUrl);
      }
      ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(body), { headers: { 'Cache-Control': 'max-age=3600' } })));
      return reply(body, 200, origin);
    } catch (e) {
      return reply({ error: e.name === 'AbortError' ? 'The site took too long to answer' : e.message || 'The page could not be read' }, e.status || 502, origin);
    } finally { clearTimeout(timer); }
  }
};
