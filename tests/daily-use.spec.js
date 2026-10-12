// Day-to-day behaviour: the task Inbox rule, the counts beside menu items, and typing on a phone.
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
  await page.evaluate(() => A.helpDismiss({ dataset: { what: 'tour' } })); // the start-here card has its own test
  return errors;
}
const task = (id, extra) => ({ id, title: id, notes: '', status: 'todo', priority: 'med', tags: [], created: new Date().toISOString(), ...extra });

test('a task stays in the Inbox until it has a due date and an area or project', async ({ page }) => {
  const errors = await open(page);
  const inbox = await page.evaluate(tasks => {
    Store.set('projects', [{ id: 'p1', name: 'Website', status: 'active', area: 'ministry' }]);
    Store.set('tasks', tasks); ui.taskTab = 'inbox'; go('tasks');
    return TK().filter(isInbox).map(t => t.id);
  }, [task('bare'), task('dated', { due: '2030-01-01' }), task('homed', { area: 'home' }), task('tagged', { tags: ['personal'] }), task('sorted', { due: '2030-01-01', area: 'home' }),
    task('in-project', { due: '2030-01-01', project: 'p1' }), task('someday', { someday: true }), task('waiting', { waiting: 'Sam' }), task('finished', { status: 'done' })]);
  expect(inbox).toEqual(['bare', 'dated', 'homed', 'tagged']);

  const row = id => page.locator('#view .card', { has: page.locator(`[data-action="taskEdit"][data-id="${id}"]`) });
  await expect(row('bare')).toContainText('Needs a due date and an area or project');
  await expect(row('dated')).toContainText('Needs an area or project');
  await expect(row('homed')).toContainText('Needs a due date');

  // One half is not enough; the second half clears it.
  await row('bare').locator('[data-action="tdSet"][data-v="today"]').click();
  await expect(row('bare')).toContainText('Needs an area or project');
  await row('bare').locator('[data-action="tdArea"][data-v="personal"]').click();
  await expect(row('bare')).toHaveCount(0);
  await row('dated').locator('[data-change="tdProject"]').selectOption('p1');
  await expect(row('dated')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('menu items show what needs attention today', async ({ page }) => {
  const errors = await open(page);
  const chip = view => page.locator(`#nav [data-view="${view}"] .chip`);
  await expect(page.locator('#nav .chip')).toHaveCount(0);
  await expect(page.locator('#menu-dot')).toBeHidden();

  await page.evaluate(([a, b]) => { Store.set('tasks', [a, b]); render(); }, [task('today', { due: new Date().toLocaleDateString('en-CA') }), task('later', { due: '2099-01-01' })]);
  await expect(chip('tasks')).toHaveText('1 task due');
  await expect(chip('tasks')).not.toHaveClass(/rose/);
  await page.evaluate(() => { TK()[1].due = '2020-01-01'; render(); });
  await expect(chip('tasks')).toHaveText('2 tasks due, some overdue');
  await expect(chip('tasks')).toHaveClass(/rose/);

  await page.evaluate(() => {
    Store.get('memory').push({ id: 'v', ref: 'John 11:35', text: 'Jesus wept.', box: 1, due: ymd(), reviews: 0, lapses: 0 });
    Store.get('readingPlans').push({ id: 'plan', name: 'Navigators', tpl: 'nav', start: ymd(), done: {} }); render();
  });
  await expect(chip('scripture')).toHaveText('2 reading to do and verse to review');
  await page.evaluate(() => { Store.get('readingPlans')[0].done[0] = ymd(); render(); });
  await expect(chip('scripture')).toHaveText('1 verse to review');

  // On a phone the menu is closed, so its button carries the dot.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#menu-dot')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open menu (items need attention)' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('on a touch screen every field is large enough that the phone does not zoom in', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  const page = await context.newPage();
  await open(page);
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  const views = await page.evaluate(() => VIEWS.filter(v => v.id).map(v => v.id));
  const small = [];
  for (const id of [...views, 'settings']) {
    await page.evaluate(v => (v === 'settings' ? openSettings() : go(v)), id);
    small.push(...await page.evaluate(v => [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]), select, textarea')]
      .filter(el => parseFloat(getComputedStyle(el).fontSize) < 16).map(el => `${v}: ${el.name || el.id || el.placeholder || el.tagName}`), id));
    if (id !== 'settings') expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${id} scrolls sideways`).toBe(true);
  }
  expect(small).toEqual([]);
  await context.close();
});
