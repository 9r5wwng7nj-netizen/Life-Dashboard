// Phone-first quick wins: dashboard cards in the person's order, long lists shown 50 at a time,
// and on a phone the Log food button and recent foods come before everything else in Nutrition.
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

test('dashboard cards follow the order chosen in the card picker, and the order is kept and synced', async ({ page }) => {
  const errors = await open(page);
  const first = () => page.evaluate(() => { const titles = [...document.querySelectorAll('#view .card')].map(c => c.textContent); return DASH_CARDS.map(c => c[1]).filter(l => titles.some(t => t.includes(l))).sort((a, b) => titles.findIndex(t => t.includes(a)) - titles.findIndex(t => t.includes(b))); });
  expect((await first())[0]).toBe('Nutrition today');

  await page.click('#view [data-action="dashCardsEdit"]');
  // Tasks moves up three places, to the top; the button keeps focus while it moves.
  for (let i = 0; i < 3; i++) await page.click('#modal [data-action="dashCardMove"][data-val="tasks"][data-d="-1"]');
  await expect(page.locator('#modal [data-action="dashCardMove"][data-val="tasks"][data-d="-1"]')).toBeDisabled();
  expect(await page.evaluate(() => document.activeElement?.dataset?.val)).toBe('tasks');
  await page.locator('#modal [data-change="dashCardToggle"][data-val="weight"]').uncheck();
  await page.click('#modal button:has-text("Done")');
  expect((await first()).slice(0, 3)).toEqual(['Tasks', 'Nutrition today', 'Training']);

  await page.reload();
  await page.waitForFunction(() => typeof S !== 'undefined' && Store.data);
  expect(await page.evaluate(() => [S.cardOrder.slice(0, 2), S.hiddenCards, SYNC_SETTINGS.includes('cardOrder')])).toEqual([['tasks', 'nutrition'], ['weight'], true]);
  // A card the saved order doesn't know yet (from a newer version) still appears, at the end.
  expect(await page.evaluate(() => { S.cardOrder = ['meals', 'gone']; return dashOrder(); })).toEqual(['meals', 'nutrition', 'weight', 'training', 'tasks', 'faith', 'family']);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Journal and Media show 50 at a time, with a button for the next 50', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => {
    const today = ymd();
    Store.set('journal', Array.from({ length: 120 }, (_, i) => ({ id: 'j' + i, type: 'journal', date: addDays(today, -i), title: 'Entry ' + i, body: 'Words', created: addDays(today, -i) + 'T08:00:00Z' })));
    Store.set('media', Array.from({ length: 70 }, (_, i) => ({ id: 'm' + i, title: 'Talk ' + i, kind: 'sermon', status: 'done', created: addDays(today, -i) + 'T08:00:00Z' })));
    go('journal');
  });
  const entries = page.locator('#view [data-jlist]');
  await expect(entries).toHaveCount(50);
  await expect(page.locator('#view [data-action="showMore"][data-key="journal"]')).toContainText('Show 50 more · 70 not shown');
  await page.click('#view [data-action="showMore"][data-key="journal"]');
  await expect(entries).toHaveCount(100);
  await page.click('#view [data-action="showMore"][data-key="journal"]');
  await expect(entries).toHaveCount(120);
  await expect(page.locator('#view [data-action="showMore"]')).toHaveCount(0);
  // Search still looks through every entry.
  await page.fill('#j-search', 'Entry 119');
  await expect(entries).toHaveCount(1);

  await page.evaluate(() => go('media'));
  const cards = page.locator('#view [data-action="mediaOpen"]');
  await expect(cards).toHaveCount(50);
  await page.click('#view [data-action="showMore"][data-key="media"]');
  await expect(cards).toHaveCount(70);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('on a phone, Nutrition starts with Log food and one-tap recent foods', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page);
  await page.evaluate(() => {
    Store.set('foods', [{ id: 'f-oats', name: 'Rolled oats', basis: '100g', base: { cal: 380, p: 13, c: 67, f: 7 }, extra: [], uses: 3, lastUsed: new Date().toISOString(), lastQty: 1, lastUnit: '100g' }]);
    go('nutrition');
  });
  const log = page.locator('#view [data-action="lfOpen"]').first();
  await expect(log).toHaveText(/Log food/);
  expect((await log.boundingBox()).y).toBeLessThan(300);
  await page.click('#view [aria-label="Add Rolled oats again"]');
  expect(await page.evaluate(() => (Store.get('nutrition')[ymd()]?.entries || []).map(e => e.name))).toEqual(['Rolled oats']);
  await log.click();
  await expect(page.locator('#modal')).toBeVisible();

  // On a wide screen the Quick add card on the right already does this, so the phone bar is hidden.
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('#view [data-action="lfOpen"]:has-text("Log food")')).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('on a phone, the bottom bar holds four chosen sections around a + button that adds a task, weight or prayer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page);
  const bar = page.locator('#bottom-bar');
  await expect(bar).toBeVisible();
  expect(await bar.locator('.bar-item').allInnerTexts()).toEqual(['Dashboard', 'Tasks', 'Nutrition', 'Workouts']);
  await expect(bar.locator('[aria-current="page"]')).toHaveText('Dashboard');
  await bar.locator('[data-view="tasks"]').click();
  await expect(bar.locator('[aria-current="page"]')).toHaveText('Tasks');
  // The bar sits below the scrolling view, so it never covers the last thing on the page.
  const [viewBox, barBox] = await Promise.all([page.locator('#view').boundingBox(), bar.boundingBox()]);
  expect(viewBox.y + viewBox.height).toBeLessThanOrEqual(barBox.y + 1);

  await bar.locator('[data-action="quickAdd"]').click();
  await page.click('#modal [data-what="task"]');
  await expect(page.locator('#qa-task')).toBeFocused();
  await page.keyboard.type('Call the plumber tomorrow at 3');
  await page.keyboard.press('Enter');
  const plumber = await page.evaluate(() => { const t = Store.get('tasks').find(x => x.title === 'Call the plumber'); return t && [t.due, t.time]; });
  expect(plumber).toEqual([await page.evaluate(() => addDays(ymd(), 1)), '15:00']);

  await bar.locator('[data-action="quickAdd"]').click();
  await page.click('#modal [data-what="weight"]');
  await page.fill('#qa-weight', '181.4');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => round(toUnit(Store.get('nutrition')[ymd()].weight), 1))).toBe(181.4);

  await bar.locator('[data-action="quickAdd"]').click();
  await page.click('#modal [data-what="prayer"]');
  await page.fill('#qa-pray', 'Sam’s surgery');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => Store.get('prayers').map(p => [p.title, p.cat]))).toEqual([['Sam’s surgery', 'Personal']]);

  // Food and Link open their usual screens; food goes to today.
  await bar.locator('[data-action="quickAdd"]').click();
  await page.click('#modal [data-what="food"]');
  await expect(page.locator('#modal')).toContainText('Add to');
  expect(await page.evaluate(() => ui.lf.date === ymd())).toBe(true);
  await page.keyboard.press('Escape');

  // The four places can be changed (and must be four different sections); on a wide screen the bar is hidden.
  await page.evaluate(() => { S.bar = ['journal', 'tasks', 'scripture', 'family']; render(); });
  expect(await bar.locator('.bar-item').allInnerTexts()).toEqual(['Journal', 'Tasks', 'Scripture', 'Family']);
  await page.evaluate(() => { S.bar = ['tasks', 'tasks', 'nope', 'family']; render(); });
  expect(await bar.locator('.bar-item').allInnerTexts()).toEqual(['Dashboard', 'Tasks', 'Nutrition', 'Workouts']);
  expect(await page.evaluate(() => SYNC_SETTINGS.includes('bar'))).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(bar).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});
