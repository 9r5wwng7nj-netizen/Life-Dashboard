// Start-here tour for new users and the what's-new message after an update.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';

const APP = pathToFileURL(path.resolve('index.html')).href;
const ready = page => page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
async function open(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  await page.goto(APP); await ready(page);
  return errors;
}

test('a new user is offered the tour, can walk through it, and is not shown old release notes', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('#view')).toContainText('New here? Take the two-minute tour');
  await expect(page.locator('#view')).not.toContainText('What’s new');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#menu-dot')).toBeVisible();

  await page.click('[data-action="helpTour"]');
  const dialog = page.locator('#modal [role="dialog"]'), slides = await page.evaluate(() => TOUR.map(s => s.title));
  for (const [i, title] of slides.entries()) {
    await expect(dialog.locator('h4')).toHaveText(title);
    await expect(dialog).toContainText(`Slide ${i + 1} of ${slides.length}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${title} fits a phone`).toBe(true);
    if (i < slides.length - 1) await dialog.getByRole('button', { name: 'Next' }).click();
  }
  await dialog.getByRole('button', { name: 'Back' }).click();
  await expect(dialog.locator('h4')).toHaveText(slides[slides.length - 2]);
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();

  // Seen once: the card and the dot are gone, and stay gone after a reload.
  await expect(page.locator('#view')).not.toContainText('New here?');
  await expect(page.locator('#menu-dot')).toBeHidden();
  await page.reload(); await ready(page);
  await expect(page.locator('#view')).not.toContainText('New here?');
  await expect(page.locator('#view')).not.toContainText('What’s new');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('an existing user is told about the newest update once', async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem('ld.settings')) localStorage.setItem('ld.settings', JSON.stringify({ name: 'Sam' })); });
  const errors = await open(page);
  const latest = await page.evaluate(() => RELEASES[0]);
  await expect(page.locator('#view')).toContainText(latest.title);
  await expect(page.locator('#view')).not.toContainText('New here?');
  await expect(page.locator('#help-dot')).toBeVisible();

  await page.click('[data-action="helpNews"]');
  const dialog = page.locator('#modal [role="dialog"]');
  await expect(dialog.locator('h4')).toHaveText(latest.slides[0].title);
  if (latest.slides[0].img) {
    await expect(dialog.locator('img')).toHaveJSProperty('complete', true);
    expect(await dialog.locator('img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  }
  // A slide's shortcut, when it has one, lands on the page the slide is about.
  const withGo = latest.slides.findIndex(sl => sl.go);
  if (withGo >= 0) {
    for (let i = 0; i < withGo; i++) await dialog.getByRole('button', { name: 'Next' }).click();
    const [view, key, tab, label] = latest.slides[withGo].go;
    await dialog.getByRole('button', { name: label }).click();
    await expect(page.locator('#view-title')).toHaveText(await page.evaluate(v => VIEWS.find(x => x.id === v).label, view));
    if (key) expect(await page.evaluate(k => ui[k], key)).toBe(tab);
  } else await page.keyboard.press('Escape');
  expect(await page.evaluate(() => S.newsSeen)).toBe(latest.id);

  await page.evaluate(() => go('dashboard'));
  await expect(page.locator('#view')).not.toContainText(latest.title);
  await expect(page.locator('#help-dot')).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Help in the menu reopens the tour and lists updates, and every slide picture exists', async ({ page }) => {
  await open(page);
  await page.click('[data-action="openHelp"]');
  const dialog = page.locator('#modal [role="dialog"]');
  await expect(dialog).toContainText('Finding your way');
  const releases = await page.evaluate(() => RELEASES);
  for (const r of releases) {
    await expect(dialog).toContainText(r.title);
    for (const s of r.slides) if (s.img) { expect(existsSync(path.resolve('assets/whatsnew', s.img)), s.img).toBe(true); expect(s.alt, `${s.img} needs alt text`).toBeTruthy(); }
  }
  expect(new Set(releases.map(r => r.id)).size).toBe(releases.length);
  await dialog.locator('[data-action="helpTour"]').click();
  await expect(page.locator('#modal h4')).toHaveText(await page.evaluate(() => TOUR[0].title));
});
