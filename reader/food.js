// Open Food Facts' newer search service, for the app's food log (/food/search) and the Claude connector's
// search_foods. It answers well but doesn't allow browser calls, and its old service is often down. Only the
// per-100 g nutrients the app reads go back, and answers are kept for a day.
export const UA = 'Mozilla/5.0 (compatible; LifeDashboardReader/1.0; +https://9r5wwng7nj-netizen.github.io/Life-Dashboard/)';
const OFF_SEARCH = 'https://search.openfoodfacts.org/search', OFF_FIELDS = 'code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity';
const OFF_NUTR = ['energy-kcal_100g', 'energy_100g', 'proteins_100g', 'carbohydrates_100g', 'fat_100g', 'fiber_100g', 'sugars_100g', 'sodium_100g', 'salt_100g', 'saturated-fat_100g'];

// Returns { products, cached }. Throws a TimeoutError when Open Food Facts is slow, or an error with a status.
export async function offSearch(q, ctx, timeout = 10000) {
  const key = new Request(`https://reader.cache/food?q=${encodeURIComponent(q.toLowerCase())}`), cache = caches.default, hit = await cache.match(key);
  if (hit) return { products: (await hit.json()).products, cached: true };
  const r = await fetch(`${OFF_SEARCH}?${new URLSearchParams({ q, page_size: '24', fields: OFF_FIELDS, langs: 'en' })}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw Object.assign(new Error(`Open Food Facts answered ${r.status}`), { status: 502 });
  const d = await r.json().catch(() => ({}));
  const products = (d.hits || []).map(h => {
    const n = h.nutriments || {}, nutriments = {}; OFF_NUTR.forEach(k => { if (n[k] != null && n[k] !== '') nutriments[k] = n[k]; });
    return { code: String(h.code || ''), product_name: String(h.product_name || h.product_name_en || ''), brands: Array.isArray(h.brands) ? h.brands.join(', ') : String(h.brands || ''), serving_size: String(h.serving_size || ''), serving_quantity: h.serving_quantity ?? null, nutriments };
  }).filter(p => p.product_name);
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify({ products }), { headers: { 'Cache-Control': 'max-age=86400' } })));
  return { products, cached: false };
}
