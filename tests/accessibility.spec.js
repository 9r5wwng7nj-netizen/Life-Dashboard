import { test, expect } from '@playwright/test';
import axe from 'axe-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

async function prepare(page, theme) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (theme) await page.addInitScript(theme => localStorage.setItem('ld.settings', JSON.stringify({ theme })), theme);
  await page.route('**/*', route => /^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort());
  await page.goto(pathToFileURL(path.resolve('index.html')).href);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.db && Array.isArray(Store.data.tasks));
  await page.addScriptTag({ content: axe.source });
}
async function violations(page) {
  // Scan a painted frame rather than the transient frame during a theme switch.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ rule: v.id, nodes: v.nodes.map(n => n.html) })));
}

for (const theme of ['light', 'dark']) test('accessible names and contrast across views and tabs — ' + theme, async ({ page }) => {
  await prepare(page, theme);
  const failures = [];
  const views = await page.evaluate(() => VIEWS.filter(v => v.id).map(v => v.id));
  for (const view of views) {
    await page.evaluate(view => go(view), view);
    const scan = async location => { const found = await violations(page); if (found.length) failures.push({ location, found }); };
    await scan(view);
    const tabs = await page.locator('#view [data-action="setTab"]').evaluateAll(els => [...new Map(els.map(e => [e.dataset.key + '=' + e.dataset.val, [e.dataset.key, e.dataset.val]])).values()]);
    for (const [key, value] of tabs) {
      await page.evaluate(([key, value]) => { ui[key] = value; render(); }, [key, value]);
      await scan(view + '/' + value);
    }
  }
  await page.evaluate(() => openSettings());
  const settings = await violations(page); if (settings.length) failures.push({ location: 'settings', found: settings });
  const unique = [...new Set(failures.flatMap(f => f.found.flatMap(v => v.nodes.map(html => v.rule + ': ' + html))))];
  expect(unique.join('\n')).toBe('');
});

test('dialog focus wraps, background is inert, Escape returns to opener', async ({ page }) => {
  await prepare(page);
  const opener = page.locator('[data-action="openSettings"]');
  await opener.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Settings & Sync' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#modal-title')).toBeFocused();
  await expect(page.locator('#app-shell')).toHaveAttribute('inert', '');
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Save settings', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('textbox', { name: 'Your name (for greeting)' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  expect(await page.locator('#app-shell').evaluate(el => el.inert)).toBe(false);
});

test('visible labels focus their fields and repeated dialog rendering retains input focus', async ({ page }) => {
  await prepare(page);
  await page.locator('[data-action="openSettings"]').click();
  await page.getByText('Your name (for greeting)', { exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Your name (for greeting)' });
  await expect(input).toBeFocused();
  await input.fill('Seth');
  await page.evaluate(() => openSettings());
  await expect(page.getByRole('textbox', { name: 'Your name (for greeting)' })).toBeFocused();
});

test('mobile sidebar is absent from tab order while closed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  expect(await page.locator('#sidebar').evaluate(el => el.inert)).toBe(true);
  const menu = page.getByRole('button', { name: 'Open menu' });
  await menu.focus(); await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#nav button').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  expect(await page.locator('#sidebar').evaluate(el => el.inert)).toBe(true);
});

test('view sections retain keyboard focus and notices are announced', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Workouts', exact: true }).click();
  await expect(page.locator('#view-title')).toBeFocused();
  const button = page.locator('#view [data-action="setTab"][data-val="history"]');
  await button.focus(); await page.keyboard.press('Enter');
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { toast('Saved successfully'); toast('Could not save', 'error'); });
  await expect(page.getByRole('status')).toHaveText('Saved successfully');
  await expect(page.getByRole('alert')).toHaveText('Could not save');
});

test('custom actions and hidden file pickers can be used by keyboard', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const el = document.createElement('span'); el.dataset.action = 'go'; el.dataset.view = 'tasks'; el.textContent = 'Open Tasks';
    document.querySelector('#view').appendChild(el); enhanceAccessibility();
  });
  await page.getByRole('button', { name: 'Open Tasks', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#view-title')).toHaveText('Tasks');
  await page.evaluate(() => Modal.open(modalShell('Photo upload', '<label class="btn">Choose photo<input type="file" class="hidden"></label>')));
  const picker = page.getByRole('button', { name: 'Choose photo', exact: true });
  await picker.focus();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  expect((await chooser).isMultiple()).toBe(false);
});

test('common editing dialogs have accessible controls', async ({ page }) => {
  await prepare(page);
  const failures = [];
  for (const kind of ['exercise', 'recipe', 'task', 'article']) {
    await page.evaluate(kind => {
      if (kind === 'exercise') libModal(null);
      if (kind === 'recipe') recEditor(null);
      if (kind === 'task') taskModal({ id: 'test', title: 'Example task', notes: '', status: 'todo', tags: [], subtasks: [{ id: 'step', text: 'A checklist step', done: false }] });
      if (kind === 'article') articleModal();
    }, kind);
    const found = await violations(page); if (found.length) failures.push({ kind, found });
    await page.keyboard.press('Escape');
  }
  expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
});
