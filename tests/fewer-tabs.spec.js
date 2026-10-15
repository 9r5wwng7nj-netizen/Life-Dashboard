// Fewer tabs: merged tabs still open from old links, tabs hidden by default are hidden once for
// existing settings, workout import/export lives in Settings, and dashboard cards can be hidden.
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
const tab = (page, key, id) => page.locator(`#view [data-action="setTab"][data-key="${key}"][data-val="${id}"]`);

test('settings saved before this change get People and Media Stats hidden once, and a later choice stands', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => { localStorage.setItem('ld.settings', JSON.stringify({ name: 'Sam', view: 'tasks', hiddenTabs: { recTab: ['pantry'] } })); });
  await page.reload();
  await page.waitForFunction(() => typeof S !== 'undefined');
  expect(await page.evaluate(() => [S.tabsV, S.hiddenTabs, S.name])).toEqual([2, { recTab: ['pantry'], taskTab: ['stats', 'people'], medTab: ['stats'] }, 'Sam']);
  await expect(tab(page, 'taskTab', 'people')).toHaveCount(0);
  await expect(page.locator('#view [role="group"] [data-val="plan"]')).toHaveCount(1);

  // Showing People again is remembered: the one-time hide does not run twice.
  await page.click('#view [data-action="tabsEdit"][data-key="taskTab"]');
  await page.locator('#modal [data-change="tabsToggle"][data-val="people"]').check();
  await page.click('#modal button:has-text("Done")');
  await page.reload();
  await page.waitForFunction(() => typeof S !== 'undefined');
  expect(await page.evaluate(() => S.hiddenTabs.taskTab)).toEqual(['stats']);
  await expect(tab(page, 'taskTab', 'people')).toHaveCount(1);
  expect(await page.evaluate(() => SYNC_SETTINGS.includes('tabsV') && SYNC_SETTINGS.includes('hiddenCards'))).toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('merged tabs show both parts, and links to the old tabs land in the right place', async ({ page }) => {
  const errors = await open(page);
  const view = page.locator('#view');

  // Workouts: History has the calendar on top; Import / Export is gone from the tabs.
  await page.evaluate(() => {
    const s = new Date(); s.setHours(7, 0, 0, 0);
    Store.set('workouts', [{ id: 'w1', name: 'Push', start: s.toISOString(), end: new Date(s.getTime() + 36e5).toISOString(), exercises: [{ name: 'Bench Press', sets: [{ type: 'normal', weight: 60, reps: 8 }] }] }]);
    ui.fitTab = 'stats'; go('fitness');
  });
  await expect(tab(page, 'fitTab', 'history')).toHaveAttribute('aria-pressed', 'true');
  await expect(tab(page, 'fitTab', 'stats')).toHaveCount(0);
  await expect(tab(page, 'fitTab', 'data')).toHaveCount(0);
  await expect(view.locator('[data-action="statMonth"]').first()).toBeVisible();
  await expect(view).toContainText('Push');

  // Nutrition: Body & weight holds measurements; Plan holds habits.
  await page.evaluate(() => { ui.nutTab = 'body'; go('nutrition'); });
  await expect(tab(page, 'nutTab', 'trend')).toHaveText(/Body & weight/);
  await expect(view).toContainText('Log measurements');
  await page.evaluate(() => { ui.nutTab = 'history'; render(); });
  await expect(tab(page, 'nutTab', 'plan')).toHaveAttribute('aria-pressed', 'true');
  await expect(view).toContainText('Habits & adherence');
  for (const id of ['body', 'history']) await expect(tab(page, 'nutTab', id)).toHaveCount(0);

  // Scripture: Notes sit under Highlights; Library sits under Study and its links scroll there.
  await page.evaluate(() => { ui.scrTab = 'notes'; go('scripture'); });
  await expect(tab(page, 'scrTab', 'marks')).toHaveAttribute('aria-pressed', 'true');
  await expect(view.locator('[data-action="scrNoteNew"]').first()).toBeAttached();
  await page.evaluate(() => A.goScrLib());
  await expect(tab(page, 'scrTab', 'study')).toHaveAttribute('aria-pressed', 'true');
  await expect(view.locator('#scr-library')).toBeInViewport();
  for (const id of ['notes', 'library']) await expect(tab(page, 'scrTab', id)).toHaveCount(0);

  // Family: check-ins fold into This week; milestones sit with memories.
  await page.evaluate(() => { ui.famTab = 'overview'; go('family'); });
  await expect(view.locator('#fam-checkin')).not.toHaveAttribute('open', '');
  await view.locator('[data-action="famCheckinOpen"]').click();
  await expect(view.locator('#fam-checkin')).toHaveAttribute('open', '');
  await expect(view.locator('#fam-checkin [data-submit="ciSave"]')).toBeVisible();
  await page.evaluate(() => { ui.famTab = 'milestones'; render(); });
  await expect(tab(page, 'famTab', 'memories')).toHaveText(/Memories & milestones/);
  await expect(view.locator('[data-submit="msAdd"]')).toBeAttached();
  for (const id of ['checkin', 'milestones']) await expect(tab(page, 'famTab', id)).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Someday is a filter in All tasks, and tasks added there go to Someday', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => {
    const t = (id, extra) => ({ id, title: id, notes: '', status: 'todo', priority: 'med', tags: [], area: 'home', created: new Date().toISOString(), ...extra });
    Store.set('tasks', [t('Paint the fence', { due: '2030-01-01' }), t('Learn guitar', { someday: true })]);
    ui.taskTab = 'someday'; go('tasks');
  });
  const view = page.locator('#view'), chip = view.locator('[data-action="taskSomedayToggle"]');
  await expect(tab(page, 'taskTab', 'someday')).toHaveCount(0);
  await expect(tab(page, 'taskTab', 'all')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(view).toContainText('Learn guitar');
  await expect(view).not.toContainText('Paint the fence');

  await page.fill('#view [data-submit="taskAdd"] input[name="title"]', 'Visit Japan');
  await page.press('#view [data-submit="taskAdd"] input[name="title"]', 'Enter');
  expect(await page.evaluate(() => TK().find(x => x.title === 'Visit Japan')?.someday)).toBe(true);

  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(chip).toContainText('Someday (2)');
  await expect(view).toContainText('Paint the fence');
  await expect(view).not.toContainText('Learn guitar');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('workout import and export are in Settings', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => A.openSettings());
  const modal = page.locator('#modal');
  for (const a of ['hevyImport', 'hevyExport', 'fitJsonExport']) await expect(modal.locator(`[data-action="${a}"]`)).toHaveCount(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('dashboard cards can be hidden and shown again', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => go('dashboard'));
  const view = page.locator('#view');
  await expect(view).toContainText('Training');
  await view.locator('[data-action="dashCardsEdit"]').first().click();
  const box = id => page.locator(`#modal [data-change="dashCardToggle"][data-val="${id}"]`);
  await expect(box('training')).toBeChecked();
  await box('training').uncheck();
  await box('meals').uncheck();
  await page.click('#modal button:has-text("Done")');
  await expect(view).not.toContainText('Training');
  await expect(view).toContainText('Nutrition today');
  expect(await page.evaluate(() => S.hiddenCards)).toEqual(['training', 'meals']);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ld.settings')).hiddenCards)).toEqual(['training', 'meals']);

  // Hiding every card leaves a way back.
  await page.evaluate(() => { S.hiddenCards = DASH_CARDS.map(c => c[0]); render(); });
  await expect(view).toContainText('Every card is hidden');
  await view.locator('[data-action="dashCardsEdit"]').last().click();
  await box('tasks').check();
  await page.click('#modal button:has-text("Done")');
  await expect(view.locator('.card', { hasText: 'Tasks' }).first()).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});
