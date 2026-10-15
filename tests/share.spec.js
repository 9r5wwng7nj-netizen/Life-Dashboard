// Add from a link: links are sorted into Media, Recipes or Tasks, and Android's share menu opens it.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const APP = pathToFileURL(path.resolve('index.html')).href;
async function open(page, query = '') {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  await page.route('**/*', route => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
  await page.goto(APP + query);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  await page.evaluate(() => { S.tour = 'done'; saveSettings(); });
  return errors;
}

test('links are sorted to the right place', async ({ page }) => {
  await open(page);
  const got = await page.evaluate(() => [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Watch this https://youtu.be/dQw4w9WgXcQ!', 'https://www.instagram.com/reel/C8abc123/', 'https://www.tiktok.com/@chef/video/123',
    'https://podcasts.apple.com/us/podcast/some-show/id123456', 'https://open.spotify.com/episode/abc', 'https://www.allrecipes.com/recipe/12345/easy-chili/',
    'https://www.budgetbytes.com/one-pot-pasta/', 'https://example.com/recipes/best-tacos', 'https://www.goodreads.com/book/show/123', 'https://www.amazon.com/Desiring-God/dp/1601423101',
    'https://www.thegospelcoalition.org/article/how-to-pray/', 'https://church.example.com/sermons/john-3', 'Call Sam tomorrow at 9',
  ].map(t => { const c = classifyShare(t); return c.to === 'media' ? `media:${c.kind}` : c.to; }));
  expect(got).toEqual(['media:video', 'media:video', 'media:video', 'media:video', 'media:podcast', 'media:podcast', 'recipe', 'recipe', 'recipe', 'media:book', 'media:book', 'media:article', 'media:sermon', 'task']);
});

test('a shared video goes to the Media library, filed under Up next', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('button', { name: 'Add from a link' }).click();
  await page.fill('#sh-text', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await expect(page.locator('#modal [data-action="shareTo"][data-v="media"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#modal [data-action="shareTo"][data-v="media"]')).toContainText('suggested');
  await expect(page.locator('#sh-kind')).toHaveValue('video');
  await page.fill('#sh-title', 'A sermon clip');
  await page.click('#modal [data-action="shareSave"]');
  await expect(page.locator('#modal')).toBeHidden();
  expect(await page.evaluate(() => Store.get('media').map(m => [m.title, m.kind, m.status, m.url]))).toEqual([['A sermon clip', 'video', 'queue', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ']]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a recipe link becomes a recipe, and the suggestion can be changed', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('button', { name: 'Add from a link' }).click();
  await page.fill('#sh-text', 'Try this one https://www.allrecipes.com/recipe/12345/easy-chili/');
  await expect(page.locator('#modal [data-action="shareTo"][data-v="recipe"]')).toHaveAttribute('aria-pressed', 'true');
  await page.fill('#sh-title', 'Easy chili');
  await page.click('#modal [data-action="shareSave"]');
  expect(await page.evaluate(() => Store.get('recipes').filter(r => r.title === 'Easy chili').map(r => [r.source, r.notes]))).toEqual([['https://www.allrecipes.com/recipe/12345/easy-chili/', 'Try this one']]);

  // An Instagram reel is suggested as a video, but it can be filed as a recipe instead.
  await page.getByRole('button', { name: 'Add from a link' }).click();
  await page.fill('#sh-text', 'https://www.instagram.com/reel/C8abc123/');
  await page.click('#modal [data-action="shareTo"][data-v="recipe"]');
  await page.fill('#sh-title', 'Aldi sheet-pan dinner');
  await page.click('#modal [data-action="shareSave"]');
  expect(await page.evaluate(() => Store.get('recipes').some(r => r.title === 'Aldi sheet-pan dinner' && r.source === 'https://www.instagram.com/reel/C8abc123/'))).toBe(true);
  expect(await page.evaluate(() => Store.get('media').length)).toBe(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('plain text becomes a task, and a task can keep a link in its notes', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Add from a link' }).click();
  await page.fill('#sh-text', 'Call Sam tomorrow #home');
  await expect(page.locator('#modal [data-action="shareTo"][data-v="task"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#modal [data-action="shareSave"]');
  await page.getByRole('button', { name: 'Add from a link' }).click();
  await page.fill('#sh-text', 'https://example.com/form');
  await page.click('#modal [data-action="shareTo"][data-v="task"]');
  await page.fill('#sh-title', 'Fill in the volunteer form fri');
  await page.click('#modal [data-action="shareSave"]');
  expect(await page.evaluate(() => TK().map(t => [t.title, daysBetween(ymd(), t.due) >= 0, t.notes]))).toEqual([['Call Sam', true, ''], ['Fill in the volunteer form', true, 'https://example.com/form']]);
});

test("Android's share menu opens the sheet already filled in", async ({ page }) => {
  await open(page, '?share_title=Great%20talk&share_text=Worth%20watching&share_url=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ');
  await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#sh-text')).toHaveValue('Worth watching https://youtu.be/dQw4w9WgXcQ');
  await expect(page.locator('#sh-title')).toHaveValue('Great talk');
  await expect(page.locator('#sh-kind')).toHaveValue('video');
  expect(await page.evaluate(() => location.search)).toBe('');
  const manifest = await page.evaluate(() => fetch('./manifest.webmanifest').then(r => r.json()).catch(() => null));
  if (manifest) expect(manifest.share_target.params).toEqual({ title: 'share_title', text: 'share_text', url: 'share_url' });
});

test('a pasted caption with a recipe fills in the ingredients and steps', async ({ page }) => {
  const errors = await open(page);
  const caption = `https://www.facebook.com/share/r/1AbCdEf/
Easy Aldi Sheet-Pan Chicken 🍗🔥
Feeds 4 in 30 minutes!
🛒 Ingredients:
- 1.5 lb chicken thighs
- 1 lb baby potatoes
- 2 bell peppers
- 2 tbsp olive oil
📝 Instructions:
1. Heat oven to 425°F.
2. Toss everything with oil and salt on a sheet pan.
3. Roast 25 minutes until golden.
#easydinner #aldifinds #mealprep`;
  await page.getByRole('button', { name: 'Add from a link' }).click();
  await page.fill('#sh-text', caption);
  await page.click('#modal [data-action="shareTo"][data-v="recipe"]');
  await expect(page.locator('#sh-hint')).toHaveText(/Found 4 ingredients and 3 steps/);
  await page.click('#modal [data-action="shareSave"]');
  const r = await page.evaluate(() => Store.get('recipes').find(x => x.source.includes('facebook.com')));
  expect(r.title).toBe('Easy Aldi Sheet-Pan Chicken 🍗🔥');
  expect(r.ingredients.split('\n')).toEqual(['1.5 lb chicken thighs', '1 lb baby potatoes', '2 bell peppers', '2 tbsp olive oil']);
  expect(r.steps.split('\n')).toEqual(['Heat oven to 425°F.', 'Toss everything with oil and salt on a sheet pan.', 'Roast 25 minutes until golden.']);
  expect(r.notes).toBe('');

  // A caption that lists ingredients on one line works too.
  expect(await page.evaluate(() => parseRecipeText('Quick tacos\nIngredients: 1 lb ground beef, 8 tortillas, 1 cup salsa\nDirections: Brown the beef. Fill the tortillas.'))).toMatchObject({ title: 'Quick tacos', ingredients: '1 lb ground beef\n8 tortillas\n1 cup salsa', steps: 'Brown the beef.\nFill the tortillas.' });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('with the link reader, a recipe page fills in the whole recipe and an article keeps a readable copy', async ({ browser }) => {
  // The reader only answers the hosted app, so this runs from a local server with the reader faked.
  const { serveRepo, stopServer } = await import('./serve.js');
  const server = await serveRepo(), base = `http://localhost:${server.address().port}`;
  const context = await browser.newContext(), page = await context.newPage(), asked = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.route('https://life-dashboard-reader.lifedashboard-9r5w.workers.dev/**', route => {
    const url = new URL(route.request().url()).searchParams.get('url'); asked.push(url);
    const body = url.includes('chili') ? { url, title: 'Best Chili', image: 'https://blog.example/chili.jpg', siteName: 'blog.example', author: 'Pat', recipe: { title: 'Best Chili', ingredients: ['2 lb ground beef', '2 cans beans'], steps: ['Brown the beef.', 'Simmer.'], servings: 6, time: 75, image: 'https://blog.example/chili.jpg', category: ['Dinner'], cuisine: [], calories: 420 }, text: '' }
      : { url, title: 'How to Pray', image: 'https://journal.example/p.jpg', siteName: 'The Journal', author: 'Sam Lee', published: '2026-09-30', description: 'A short guide.', recipe: null, text: 'Prayer is talking with God. '.repeat(30) };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': base }, body: JSON.stringify(body) });
  });
  await context.route(/noembed\.com/, route => route.abort());
  try {
    await page.goto(`${base}/index.html`);
    await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
    await page.evaluate(() => { S.tour = 'done'; saveSettings(); Store.set('recipes', []); });
    await page.getByRole('button', { name: 'Add from a link' }).click();
    await page.fill('#sh-text', 'https://blog.example/recipes/best-chili');
    await expect(page.locator('#sh-hint')).toContainText('read from the page');
    await page.click('#modal [data-action="shareSave"]');
    await expect(page.locator('#modal')).toBeHidden();
    expect(await page.evaluate(() => Store.get('recipes').map(r => [r.title, r.ingredients, r.steps, r.servings, r.time, r.cal, r.img, r.tags]))).toEqual([['Best Chili', '2 lb ground beef\n2 cans beans', 'Brown the beef.\nSimmer.', 6, 75, 420, 'https://blog.example/chili.jpg', ['Dinner']]]);

    await page.getByRole('button', { name: 'Add from a link' }).click();
    await page.fill('#sh-text', 'https://journal.example/pray');
    await page.click('#modal [data-action="shareSave"]');
    await expect(page.locator('#modal')).toBeHidden();
    const m = await page.evaluate(() => Store.get('media')[0]);
    expect([m.title, m.author, m.thumb, m.kind, m.article.site, m.article.byline, m.article.words > 100]).toEqual(['How to Pray', 'Sam Lee', 'https://journal.example/p.jpg', 'article', 'The Journal', 'Sam Lee', true]);
    expect(asked).toEqual(['https://blog.example/recipes/best-chili', 'https://journal.example/pray']);
    expect(errors).toEqual([]);
  } finally { await context.close(); await stopServer(server); }
});

test('Facebook and Instagram links are never sent to the reader', async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => ['https://www.facebook.com/share/r/1Ab/', 'https://fb.watch/xyz/', 'https://www.instagram.com/reel/C8/', 'https://www.budgetbytes.com/x/'].map(readerSkips))).toEqual([true, true, true, false]);
  expect(await page.evaluate(() => classifyShare('https://www.facebook.com/share/r/1AbCdEf/').kind)).toBe('video');
});
