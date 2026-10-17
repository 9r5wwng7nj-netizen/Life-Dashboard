// The link reader Worker (reader/): page parsing and the request rules, run in Node with a fake fetch.
import { test, expect } from '@playwright/test';
import { readPage, recipeFrom, articleText, allowedTarget, minutes, decode } from '../reader/parse.js';
import worker from '../reader/worker.js';

const RECIPE_PAGE = `<html><head><title>Best Chili | Food Blog</title>
<meta property="og:title" content="Best Chili Ever">
<meta property="og:image" content="https://blog.example/chili.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"x"},
{"@type":["Recipe","NewsArticle"],"name":"Best Chili &amp; Cornbread","recipeYield":["6","6 bowls"],"totalTime":"PT1H15M",
"image":[{"@type":"ImageObject","url":"https://blog.example/chili-1.jpg"}],"author":{"@type":"Person","name":"Pat Cook"},
"recipeCategory":"Dinner","recipeCuisine":["American"],"nutrition":{"calories":"420 kcal"},
"recipeIngredient":["2 lb ground beef","1 &frac12; cups onion, diced","2 cans kidney beans"],
"recipeInstructions":[{"@type":"HowToSection","name":"Chili","itemListElement":[{"@type":"HowToStep","text":"Brown the beef<br> with the onion."},{"@type":"HowToStep","text":"Add the beans and simmer."}]},"Serve hot."]}]}</script>
</head><body><p>Some long story about chili that goes on and on.</p></body></html>`;
const ARTICLE_PAGE = `<html><head><meta property="og:title" content="How to Pray"><meta name="description" content="A short guide."><meta name="author" content="Sam Lee"><meta property="article:published_time" content="2026-09-30T10:00:00Z"><meta property="og:site_name" content="The Journal"></head>
<body><nav><p>Menu menu menu menu menu menu menu menu menu menu menu menu</p></nav><article><h2>Start small</h2>${'<p>Prayer is talking with God about everything that matters to you, every day, in plain words and with honest hearts.</p>'.repeat(6)}<ul><li>Morning</li><li>Evening</li></ul><script>var x = 1;</script></article></body></html>`;

test('a recipe page gives its full recipe', () => {
  const r = recipeFrom(RECIPE_PAGE);
  expect(r).toEqual({ title: 'Best Chili & Cornbread', ingredients: ['2 lb ground beef', '1 ½ cups onion, diced', '2 cans kidney beans'], steps: ['Brown the beef with the onion.', 'Add the beans and simmer.', 'Serve hot.'], servings: 6, time: 75, image: 'https://blog.example/chili-1.jpg', author: 'Pat Cook', category: ['Dinner'], cuisine: ['American'], calories: 420 });
  const page = readPage(RECIPE_PAGE, 'https://blog.example/best-chili');
  expect(page).toMatchObject({ title: 'Best Chili Ever', image: 'https://blog.example/chili.jpg', siteName: 'blog.example', author: 'Pat Cook', text: '' });
  expect(recipeFrom('<html><script type="application/ld+json">{broken</script></html>')).toBeNull();
  expect([minutes('PT45M'), minutes('PT1H'), minutes('P1DT2H'), minutes('')]).toEqual([45, 60, 1560, 0]);
  expect(decode('Fish &amp; chips &#8211; &#x2019;s &bogus;')).toBe('Fish & chips – ’s &bogus;');
});

test('an article page gives its details and readable text', () => {
  const page = readPage(ARTICLE_PAGE, 'https://journal.example/pray');
  expect(page).toMatchObject({ title: 'How to Pray', description: 'A short guide.', author: 'Sam Lee', published: '2026-09-30', siteName: 'The Journal', recipe: null });
  expect(page.text.startsWith('## Start small\n\nPrayer is talking with God')).toBe(true);
  expect(page.text).toContain('- Morning');
  expect(page.text).not.toContain('Menu menu');
  expect(articleText('<p>Too short to be an article.</p>')).toBe('');
});

test('only public web pages can be read', () => {
  const ok = u => !!allowedTarget(u);
  expect(['https://www.allrecipes.com/recipe/1/', 'http://blog.example/x?y=1'].map(ok)).toEqual([true, true]);
  expect(['ftp://example.com/x', 'http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.5/admin', 'http://[::1]/', 'https://printer.local/', 'https://user:pw@example.com/', 'https://example.com:8443/', 'http://intranet/', 'not a url'].map(ok)).toEqual(Array(10).fill(false));
});

test('the Worker answers only the app, reads pages, and keeps answers for an hour', async () => {
  const stored = new Map(), fetched = [];
  globalThis.caches = { default: { match: async req => stored.get(req.url)?.clone() || null, put: async (req, res) => { stored.set(req.url, res); } } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { fetched.push([String(url), opts.headers?.['User-Agent'] || '']); return new Response(RECIPE_PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }); };
  const later = [], ctx = { waitUntil: p => later.push(p) };
  const ask = (url, origin) => worker.fetch(new Request(`https://reader.example/?url=${encodeURIComponent(url)}`, { headers: origin ? { Origin: origin } : {} }), {}, ctx);
  try {
    expect((await ask('https://blog.example/chili', '')).status).toBe(403);
    expect((await ask('https://blog.example/chili', 'https://evil.example')).status).toBe(403);
    expect((await ask('http://169.254.169.254/latest', 'https://9r5wwng7nj-netizen.github.io')).status).toBe(400);

    const res = await ask('https://blog.example/chili', 'https://9r5wwng7nj-netizen.github.io');
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://9r5wwng7nj-netizen.github.io');
    expect((await res.json()).recipe.title).toBe('Best Chili & Cornbread');
    expect(fetched[0][1]).toContain('LifeDashboardReader');
    await Promise.all(later);
    const again = await ask('https://blog.example/chili', 'https://9r5wwng7nj-netizen.github.io');
    expect(again.headers.get('X-Reader-Cache')).toBe('hit');
    expect(fetched).toHaveLength(1);
  } finally { globalThis.fetch = realFetch; delete globalThis.caches; }
});

test('the Worker trades Google codes and refresh tokens, adding the client secret only it knows', async () => {
  const sent = [], realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const form = Object.fromEntries(new URLSearchParams(String(opts.body))); sent.push([String(url), form]);
    if (form.refresh_token === 'revoked') return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), { status: 400 });
    return new Response(JSON.stringify({ access_token: 'at', expires_in: 3599, id_token: 'not-passed-on', ...(form.grant_type === 'authorization_code' ? { refresh_token: 'rt' } : {}) }), { status: 200 });
  };
  const app = 'https://9r5wwng7nj-netizen.github.io', back = app + '/Life-Dashboard/index.html', env = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'shh' };
  const call = (path, { body, e = env, origin = app } = {}) => worker.fetch(new Request('https://reader.example' + path, body ? { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { headers: { Origin: origin } }), e, {});
  try {
    // Without the secret it says so, and sign-in stays one hour long.
    expect(await (await call('/google/ready', { e: {} })).json()).toEqual({ ready: false });
    expect((await call('/google/token', { e: {}, body: { code: 'c', verifier: 'v', redirect_uri: back } })).status).toBe(501);
    expect(await (await call('/google/ready')).json()).toEqual({ ready: true });
    expect((await call('/google/ready', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('/google/token', { body: { code: 'c', verifier: 'v', redirect_uri: 'https://evil.example/index.html' } })).status).toBe(400);
    expect((await call('/google/token')).status).toBe(405);

    const tok = await call('/google/token', { body: { code: 'c', verifier: 'v', redirect_uri: back } });
    expect(await tok.json()).toEqual({ access_token: 'at', expires_in: 3599, refresh_token: 'rt' });
    expect([tok.headers.get('Cache-Control'), tok.headers.get('Access-Control-Allow-Origin')]).toEqual(['no-store', app]);
    expect(sent[0]).toEqual(['https://oauth2.googleapis.com/token', { client_id: 'cid', client_secret: 'shh', grant_type: 'authorization_code', code: 'c', code_verifier: 'v', redirect_uri: back }]);
    expect(await (await call('/google/refresh', { body: { refresh_token: 'rt' } })).json()).toEqual({ access_token: 'at', expires_in: 3599, refresh_token: null });
    const refused = await call('/google/refresh', { body: { refresh_token: 'revoked' } });
    expect([refused.status, await refused.json()]).toEqual([400, { error: 'invalid_grant' }]);
    expect(await (await call('/google/revoke', { body: { token: 'rt' } })).json()).toEqual({ revoked: true });
    expect(sent.at(-1)[0]).toBe('https://oauth2.googleapis.com/revoke');
    const pre = await worker.fetch(new Request('https://reader.example/google/token', { method: 'OPTIONS', headers: { Origin: app } }), env, {});
    expect([pre.status, pre.headers.get('Access-Control-Allow-Methods'), pre.headers.get('Access-Control-Allow-Headers')]).toEqual([204, 'GET, POST', 'Content-Type']);
  } finally { globalThis.fetch = realFetch; }
});

test('the Worker searches Open Food Facts for the food log, passes back only what the app reads, and keeps answers', async () => {
  const stored = new Map(), asked = [], realFetch = globalThis.fetch;
  globalThis.caches = { default: { match: async req => stored.get(req.url)?.clone() || null, put: async (req, res) => { stored.set(req.url, res); } } };
  globalThis.fetch = async url => { asked.push(String(url)); return new Response(JSON.stringify({ hits: [
    { code: 5065000137014, product_name: 'Energy balls', brands: ['Nature Bites', 'Co'], serving_size: '1 ball (20 g)', serving_quantity: 20, nutriments: { 'energy-kcal_100g': 347, proteins_100g: 7.6, 'nova-group': 4, sugars_100g: '' }, ingredients_text: 'not passed on' },
    { code: '1', product_name: '', brands: [] }] }), { status: 200 }); };
  const later = [], ctx = { waitUntil: p => later.push(p) }, app = 'https://9r5wwng7nj-netizen.github.io';
  const ask = (q, origin = app) => worker.fetch(new Request(`https://reader.example/food/search?q=${encodeURIComponent(q)}`, { headers: { Origin: origin } }), {}, ctx);
  try {
    expect((await ask('energy balls', 'https://evil.example')).status).toBe(403);
    expect((await ask('   ')).status).toBe(400);
    const res = await ask('Energy  Balls');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ products: [{ code: '5065000137014', product_name: 'Energy balls', brands: 'Nature Bites, Co', serving_size: '1 ball (20 g)', serving_quantity: 20, nutriments: { 'energy-kcal_100g': 347, proteins_100g: 7.6 } }] });
    const sent = new URL(asked[0]);
    expect([sent.origin + sent.pathname, sent.searchParams.get('q'), sent.searchParams.get('langs')]).toEqual(['https://search.openfoodfacts.org/search', 'Energy Balls', 'en']);
    await Promise.all(later);
    expect((await ask('energy balls')).headers.get('X-Reader-Cache')).toBe('hit');
    expect(asked).toHaveLength(1);
  } finally { globalThis.fetch = realFetch; delete globalThis.caches; }
});
