// Turns a web page into the parts Life Dashboard uses: a recipe (from the page's schema.org data),
// the page's title, description, picture and author, and a plain-text copy of an article.
// Pure functions, shared by the Worker and the tests.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', deg: '°', frac12: '½', frac14: '¼', frac34: '¾', frac13: '⅓', frac23: '⅔' };
export function decode(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const clean = s => decode(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const asList = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
const isType = (o, t) => o && typeof o === 'object' && asList(o['@type']).some(x => String(x).toLowerCase() === t);

// ISO 8601 durations such as PT1H15M, as minutes.
export function minutes(iso) {
  const m = String(iso || '').match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$/i);
  return m ? (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { out.push(JSON.parse(m[1].trim())); } catch (e) { try { out.push(JSON.parse(m[1].trim().replace(/[\u0000-\u001f]+/g, ' '))); } catch (e2) { /* a broken block is skipped */ } }
  }
  return out;
}
function findRecipe(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (Array.isArray(node)) { for (const x of node) { const r = findRecipe(x, depth + 1); if (r) return r; } return null; }
  if (isType(node, 'recipe')) return node;
  for (const k of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) { const r = findRecipe(node[k], depth + 1); if (r) return r; }
  return null;
}
function steps(v, out = []) {
  for (const s of asList(v)) {
    if (typeof s === 'string') clean(s).split(/\n+/).forEach(x => x && out.push(x));
    else if (isType(s, 'howtosection')) steps(s.itemListElement, out);
    else if (s && typeof s === 'object') { const t = clean(s.text || s.name); if (t) out.push(t); }
  }
  return out;
}
const imageOf = v => { for (const x of asList(v)) { if (typeof x === 'string') return x; if (x && x.url) return String(x.url); } return ''; };
const nameOf = v => { for (const x of asList(v)) { if (typeof x === 'string') return clean(x); if (x && x.name) return clean(x.name); } return ''; };

export function recipeFrom(html) {
  const r = jsonLd(html).map(d => findRecipe(d)).find(Boolean); if (!r) return null;
  const ingredients = asList(r.recipeIngredient || r.ingredients).map(clean).filter(Boolean), list = steps(r.recipeInstructions);
  if (!ingredients.length) return null;
  const yieldText = asList(r.recipeYield).map(String).join(' '), servings = +((yieldText.match(/\d+/) || [])[0]) || null;
  const kcal = +String((r.nutrition && r.nutrition.calories) || '').replace(/[^\d.]/g, '') || null;
  return {
    title: clean(r.name), ingredients, steps: list, servings, time: minutes(r.totalTime) || minutes(r.prepTime) + minutes(r.cookTime) || null,
    image: imageOf(r.image), author: nameOf(r.author), category: asList(r.recipeCategory).map(clean).filter(Boolean).slice(0, 2), cuisine: asList(r.recipeCuisine).map(clean).filter(Boolean).slice(0, 2), calories: kcal
  };
}

function meta(html, ...names) {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n.replace(/[:.]/g, '\\$&')}["'][^>]*>`, 'i'), tag = (html.match(re) || [])[0];
    const c = tag && (tag.match(/content=(["'])([\s\S]*?)\1/i) || [])[2]; if (c) return clean(c);
  }
  return '';
}
// The article's paragraphs as plain text: inside <article> or <main> when the page has one.
export function articleText(html, max = 40000) {
  const body = (html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<main[\s\S]*?<\/main>/i) || [html])[0]
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|figure)[\s\S]*?<\/\1>/gi, ' ');
  const paras = [...body.matchAll(/<(p|h2|h3|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi)].map(m => [m[1].toLowerCase(), clean(m[2])]).filter(([t, x]) => x.length > (t === 'p' ? 40 : 2));
  let out = '', words = 0;
  for (const [t, x] of paras) { const line = t === 'h2' || t === 'h3' ? `## ${x}` : t === 'li' ? `- ${x}` : t === 'blockquote' ? `> ${x}` : x; if (out.length + line.length > max) break; out += (out ? '\n\n' : '') + line; words += x.split(/\s+/).length; }
  return words >= 80 ? out : '';
}

export function readPage(html, url) {
  const recipe = recipeFrom(html);
  const title = meta(html, 'og:title', 'twitter:title') || clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  return {
    url, title, description: meta(html, 'og:description', 'description', 'twitter:description'), image: meta(html, 'og:image', 'twitter:image'),
    siteName: meta(html, 'og:site_name') || (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } })(),
    author: meta(html, 'author', 'article:author', 'parsely-author') || (recipe && recipe.author) || '', published: meta(html, 'article:published_time', 'date').slice(0, 10),
    recipe, text: recipe ? '' : articleText(html)
  };
}

// Only public web pages: no other ports, no local or private addresses.
export function allowedTarget(raw) {
  let u; try { u = new URL(raw); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || (u.port && !['80', '443'].includes(u.port))) return null;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return null; // addresses written as numbers are not needed for public pages
  return u;
}
