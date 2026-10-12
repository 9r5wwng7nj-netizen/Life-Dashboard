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
  const chip = view => page.locator(`#nav [data-view="${view}"] .nav-count`);
  await expect(page.locator('#nav .nav-count')).toHaveCount(0);
  // Every menu item can carry a count, whether or not it has anything to count yet.
  expect(await page.evaluate(() => VIEWS.filter(v => v.id).every(v => typeof NAV_COUNTS[v.id] === 'function'))).toBe(true);
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

  // A workout in progress shows a dot; the family review counts only for people who use it.
  await expect(chip('family')).toHaveCount(0);
  await page.evaluate(() => { Store.set('activeWorkout', { id: 'w', name: 'Workout', start: new Date().toISOString(), exercises: [] }); Store.get('freviews').push({ id: 'r', week: '2020-01-06' }); render(); });
  await expect(page.locator('#nav [data-view="fitness"]')).toContainText('workout in progress');
  await expect(chip('family')).toHaveText('1 weekly family review to do');
  await page.evaluate(() => { NAV_COUNTS.journal = () => ({ n: 4, what: 'things to try' }); render(); });
  await expect(chip('journal')).toHaveText('4 things to try');

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

test('the template library can be used as it is or added and changed', async ({ page }) => {
  const errors = await open(page);
  const lib = await page.evaluate(() => TEMPLATE_LIBRARY);
  expect(lib.length).toBeGreaterThanOrEqual(20);
  expect(new Set(lib.map(l => l.key)).size).toBe(lib.length);
  for (const l of lib) {
    expect(['ministry', 'home', 'personal', 'faith'], l.name).toContain(l.area);
    expect(l.items.length, l.name).toBeGreaterThanOrEqual(5);
    expect(l.items.map(i => i.off), `${l.name} is in date order`).toEqual([...l.items.map(i => i.off)].sort((a, b) => a - b));
    expect(l.items.every(i => Number.isInteger(i.off) && i.text.trim() && i.text.length <= 70), l.name).toBe(true);
    expect(l.items.some(i => i.off === 0), `${l.name} has a day 0`).toBe(true);
  }

  await page.evaluate(() => { ui.taskTab = 'templates'; go('tasks'); });
  await expect(page.locator('#view')).toContainText('Template library');
  expect(await page.evaluate(() => Store.get('ttemplates').length)).toBe(0);

  await page.click('[data-action="libAdd"][data-key="dinner"]');
  expect(await page.evaluate(() => Store.get('ttemplates').map(t => [t.name, t.lib, t.items.length]))).toEqual([['Host a dinner', 'dinner', 6]]);
  await expect(page.locator('[data-action="libAdd"][data-key="dinner"]')).toHaveCount(0);

  // Using one adds it once, then dates every task from the event day; each lands with a date and an area.
  await page.click('[data-action="libUse"][data-key="dinner"]');
  await page.fill('#modal input[name="date"]', '2030-06-15');
  await page.click('#modal button:has-text("Add tasks")');
  const made = await page.evaluate(() => ({ templates: Store.get('ttemplates').length, tasks: TK().map(t => [t.title, t.due, t.area]), inbox: TK().filter(isInbox).length, projects: Store.get('projects').map(p => p.name) }));
  expect(made.templates).toBe(1);
  expect(made.tasks).toHaveLength(6);
  expect(made.tasks[0]).toEqual(['Invite guests and ask about allergies', '2030-06-08', 'home']);
  expect(made.tasks[5]).toEqual(['Send a thank-you for coming', '2030-06-16', 'home']);
  expect(made.inbox).toBe(0);
  expect(made.projects).toEqual(['Host a dinner · Jun 15']);
  expect(errors, errors.join('\n')).toEqual([]);
});
