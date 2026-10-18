// Food logging: cups and spoons where a food's weight per cup is known (or picked once), search that reaches
// Open Food Facts through the link reader and USDA's full set of lists, your own recipes in the results, and
// making a homemade food from its ingredients. The services are faked; nothing leaves the machine.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const APP = pathToFileURL(path.resolve('index.html')).href;
async function open(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('dialog', d => d.accept());
  await page.goto(APP);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  await page.evaluate(() => A.helpDismiss({ dataset: { what: 'tour' } }));
  return errors;
}
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

test('cups, tablespoons and teaspoons appear when a cup’s weight is known, after the units entries already use', async ({ page }) => {
  const errors = await open(page);
  const r = await page.evaluate(() => {
    const labels = f => unitsOf(f).map(u => u.label), food = (name, more) => ({ id: 'x', name, basis: '100g', servingLabel: '', servingG: null, extra: [], base: { cal: 400, p: 10, c: 60, f: 10 }, ...more });
    return {
      offServing: labels(food('Granola bites', { servingLabel: '1/2 cup (40 g)', servingG: 40 })),
      usdaCup: labels(food('Oats, raw', { extra: [{ label: '1 cup', g: 81 }] })),
      table: labels(food('Oats, raw')),
      soup: labels(food('Chicken noodle soup')),
      picked: labels(food('Mystery snack', { cupG: 140 })),
      factor: unitsOf(food('Granola bites', { servingLabel: '1/2 cup (40 g)', servingG: 40 })).find(u => u.label.startsWith('cup')).factor,
      ml: ['1 cup', '½ cup', '2 tbsp', '1 tsp', '8 fl oz', '250 ml', '3 balls'].map(volumeMl).map(v => v && Math.round(v))
    };
  });
  expect(r.offServing).toEqual(['1/2 cup (40 g)', 'g', 'oz', 'cup · 80 g', 'tbsp · 5 g', 'tsp · 1.7 g']); // a ½-cup serving gives a whole cup too
  expect(r.usdaCup).toEqual(['1 cup · 81 g', 'g', 'oz', 'tbsp · 5.1 g', 'tsp · 1.7 g']); // the food's own cup isn't repeated
  expect(r.table).toEqual(['g', 'oz', 'cup · 81 g', 'tbsp · 5.1 g', 'tsp · 1.7 g']); // oats from the recipe table
  expect(r.soup).toEqual(['g', 'oz']); // "chicken" alone doesn't make soup weigh like chicken
  expect(r.picked).toEqual(['g', 'oz', 'cup · 140 g', 'tbsp · 8.8 g', 'tsp · 2.9 g']);
  expect(r.factor).toBeCloseTo(0.8);
  expect(r.ml).toEqual([237, 118, 30, 5, 237, 250, null]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a food that doesn’t say what a cup weighs can be measured in cups after picking what it’s like', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => {
    Store.set('foods', [{ id: 'f1', name: 'Mystery snack', basis: '100g', servingLabel: '', servingG: null, extra: [], base: { cal: 500, p: 10, c: 60, f: 25 }, uses: 1, lastUsed: new Date().toISOString() }]);
    go('nutrition'); lfOpen('snacks'); lfSelect(Store.get('foods')[0]);
  });
  await page.click('#modal summary:has-text("Measure in cups instead")');
  await page.click('#modal [data-action="lfCupSet"][data-g="140"]');
  await expect(page.locator('#modal select[data-change="lfUnit"] option:checked')).toHaveText('cup · 140 g');
  await expect(page.locator('#lf-qty')).toHaveValue('1');
  expect(await page.evaluate(() => Store.get('foods')[0].cupG)).toBe(140); // remembered for next time
  await expect(page.locator('#lf-preview')).toContainText('700'); // 140 g of a 500 kcal/100 g food
  expect(errors, errors.join('\n')).toEqual([]);
});

test('search finds Open Food Facts through the link reader, USDA’s branded foods, your recipes, and offers to make it', async ({ page }) => {
  const errors = await open(page), asked = [];
  await page.route('https://life-dashboard-reader.lifedashboard-9r5w.workers.dev/**', route => {
    asked.push(new URL(route.request().url()).pathname + new URL(route.request().url()).search);
    return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ products: [{ code: '5065000137014', product_name: 'Energy balls', brands: 'Energy balls', serving_size: '1 ball (20 g)', serving_quantity: 20, nutriments: { 'energy-kcal_100g': 347, proteins_100g: 7.6, carbohydrates_100g: 52, fat_100g: 12 } }] }) });
  });
  let usda;
  await page.route('https://api.nal.usda.gov/**', route => {
    const rq = route.request(); if (rq.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    usda = { method: rq.method(), url: rq.url(), body: rq.postDataJSON() };
    return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ foods: [{ fdcId: 1, description: 'ENERGY BITES', dataType: 'Branded', brandName: 'TRAIL CO', servingSize: 30, servingSizeUnit: 'GRM', householdServingFullText: '2 BITES', foodNutrients: [{ nutrientNumber: '208', value: 420 }, { nutrientNumber: '203', value: 9 }] }] }) });
  });
  await page.route('https://world.openfoodfacts.org/**', route => route.abort());
  await page.evaluate(() => {
    Store.set('recipes', [{ id: 'r1', title: 'Energy balls (peanut butter)', servings: 12, cal: 110, p: 3, c: 12, f: 6, ingredients: 'oats' }]);
    go('nutrition'); lfOpen('snacks');
  });
  await page.fill('#lf-q', 'energy balls');
  await page.press('#lf-q', 'Enter');
  const results = page.locator('#lf-results');
  await expect(results).toContainText('My recipes');
  await expect(results).toContainText('Energy balls (peanut butter)');
  await expect(results).toContainText('Open Food Facts');
  await expect(results).toContainText('Energy bites'); // USDA branded
  await expect(results.locator('[data-action="lfMakeRecipe"]')).toBeVisible();
  expect(asked).toEqual(['/food/search?q=energy%20balls']);
  // The filters travel in a POST body (USDA's gateway refuses about half of filtered GET searches), and every word must match.
  expect(usda.method).toBe('POST');
  expect(usda.url).toBe('https://api.nal.usda.gov/fdc/v1/foods/search?api_key=DEMO_KEY');
  expect(usda.body).toEqual({ query: 'energy balls', dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'], requireAllWords: true, pageSize: 15 });
  // A branded USDA food keeps its serving, in lower case.
  await results.locator('[data-src="usda"]').first().click();
  await expect(page.locator('#modal select[data-change="lfUnit"] option').first()).toHaveText('2 bites · 30 g');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('when USDA refuses or can’t be reached, its section says so plainly and Open Food Facts still shows', async ({ page }) => {
  const errors = await open(page);
  let usda = 'refuse';
  await page.route('https://life-dashboard-reader.lifedashboard-9r5w.workers.dev/**', route => route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ products: [{ code: '1', product_name: 'Energy balls', nutriments: { 'energy-kcal_100g': 347 } }] }) }));
  await page.route('https://api.nal.usda.gov/**', route => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors })
    : usda === 'refuse' ? route.fulfill({ status: 400, headers: { ...cors, 'Content-Type': 'text/html' }, body: '<html><title>400 Bad Request</title></html>' }) : route.abort());
  await page.route('https://world.openfoodfacts.org/**', route => route.abort());
  await page.evaluate(() => { go('nutrition'); lfOpen('snacks'); });
  await page.fill('#lf-q', 'energy balls');
  await page.press('#lf-q', 'Enter');
  const results = page.locator('#lf-results');
  await expect(results).toContainText('USDA didn’t answer this time (error 400). Search again in a moment.');
  await expect(results.locator('[data-src="off"]')).toHaveCount(1);
  usda = 'unreachable'; // a refused preflight (for example the demo key's hourly limit) looks like this too
  await page.press('#lf-q', 'Enter');
  await expect(results).toContainText('the shared demo key may have hit its hourly limit');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Make it from its ingredients: the recipe’s nutrition is worked out and it is ready to log', async ({ page }) => {
  const errors = await open(page);
  await page.route('https://**/*', route => route.abort());
  await page.evaluate(() => { go('nutrition'); lfOpen('snacks', { q: 'energy balls' }); ui.lf.online = { usda: { items: [] }, off: { items: [] } }; lfDraw(); });
  await page.click('#modal [data-action="lfMakeRecipe"]');
  await expect(page.locator('#modal input[name="title"]')).toHaveValue('Energy balls');
  await page.fill('#modal input[name="servings"]', '12');
  await page.fill('#modal textarea[name="ingredients"]', '1 cup rolled oats\n1/2 cup peanut butter\n1/3 cup honey\n1/2 cup chocolate chips');
  await page.click('#modal button:has-text("Save")');
  const r = await page.evaluate(() => { const x = Store.get('recipes').find(r => r.title === 'Energy balls'); return x && [x.cal > 100 && x.cal < 250, !!x.macroCalc]; });
  expect(r).toEqual([true, true]);
  await expect(page.locator('#lf-results')).toContainText('My recipes');
  await page.click('#lf-results [data-action="lfRecipe"]');
  expect(await page.evaluate(() => (Store.get('nutrition')[ymd()]?.entries || []).map(e => e.name))).toEqual(['Energy balls']);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('calories fill in from protein, carbs and fat as you type, unless you type your own', async ({ page }) => {
  const errors = await open(page);
  const kcal = () => page.locator('#modal input[name="cal"]');
  // Quick add in Log food: 4 per gram of protein and carbs, 9 per gram of fat.
  await page.evaluate(() => { go('nutrition'); lfOpen('lunch'); });
  await page.click('#modal [data-action="lfTab"][data-v="quick"]');
  await page.fill('#modal input[name="p"]', '30');
  await expect(kcal()).toHaveValue('120');
  await page.fill('#modal input[name="c"]', '40');
  await page.fill('#modal input[name="f"]', '10');
  await expect(kcal()).toHaveValue('370');
  // A number typed by hand is kept while the macros change; clearing it brings the automatic total back.
  await page.fill('#modal input[name="cal"]', '400');
  await page.fill('#modal input[name="p"]', '35');
  await expect(kcal()).toHaveValue('400');
  await page.fill('#modal input[name="cal"]', '');
  await page.fill('#modal input[name="c"]', '41');
  await expect(kcal()).toHaveValue('394');
  await page.click('#modal button:has-text("Add to Lunch")');
  expect(await page.evaluate(() => Store.get('nutrition')[ymd()].entries.map(e => [e.name, e.cal, e.p, e.c, e.f]))).toEqual([['Quick add', 394, 35, 41, 10]]);
  // Creating a food works the same way.
  await page.evaluate(() => { Modal.close(); foodEditor(null); });
  await page.fill('#modal input[name="p"]', '10');
  await page.fill('#modal input[name="c"]', '20');
  await page.fill('#modal input[name="f"]', '5');
  await expect(kcal()).toHaveValue('165');
  // Editing an entry: a label's own calories (more than 5 off the macros) are kept; a total that matches keeps updating.
  await page.evaluate(() => { Modal.close(); ensureDay(ymd()).entries.push({ id: 'lab', name: 'Protein bar', cal: 250, p: 10, c: 20, f: 5, meal: 'snacks' }, { id: 'calc', name: 'Yogurt', cal: 165, p: 10, c: 20, f: 5, meal: 'snacks' }); macroModal('Edit entry', findEntry('lab'), 'entrySave', 'lab', true); });
  await page.fill('#modal input[name="p"]', '12');
  await expect(kcal()).toHaveValue('250');
  await page.evaluate(() => { Modal.close(); macroModal('Edit entry', findEntry('calc'), 'entrySave', 'calc', true); });
  await page.fill('#modal input[name="p"]', '20');
  await expect(kcal()).toHaveValue('205');
  expect(errors, errors.join('\n')).toEqual([]);
});
