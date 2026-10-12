// Scripture memory practice: typing the first letter of each word through the three steps,
// scheduling, and the progress that is worked out from it.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const APP = pathToFileURL(path.resolve('index.html')).href;
const TEXT = 'For God so loved the world, that he gave his only Son', LETTERS = 'fgsltwthghos';

async function open(page, verse = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('dialog', d => d.accept());
  await page.goto(APP);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  await page.evaluate(([text, extra]) => {
    Store.get('memory').push({ id: 'v1', ref: 'John 3:16', text, tr: 'ESV', added: ymd(), box: 1, due: ymd(), reviews: 0, lapses: 0, ...extra });
    Store.save('memory'); ui.scrTab = 'memory'; go('scripture');
  }, [TEXT, verse]);
  return errors;
}
const verse = page => page.evaluate(() => { const { box, reviews, lapses, due } = Store.get('memory')[0]; return { box, reviews, lapses, dueIn: daysBetween(ymd(), due) }; });
const today = page => page.evaluate(() => Store.get('memkit').days[ymd()]);

test('a new verse is learned in three steps and earns progress', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('#view')).toContainText('Level 1');
  await expect(page.locator('#view')).toContainText('No streak yet');
  await page.click('[data-action="memPractice"]');
  const input = page.locator('#mem-in'), note = page.locator('#mem-note'), next = page.locator('#mem-next');
  await expect(input).toBeFocused();

  // Read: every word is visible from the start.
  await expect(page.locator('#mem-words')).toContainText('For God so loved');
  await expect(next).toBeDisabled();
  await input.pressSequentially(LETTERS);
  await expect(note).toContainText('+5 XP');
  await expect(next).toHaveText('Next: Recall');
  await input.press('Enter');

  // Recall: half the words are blanks until typed.
  await expect(page.locator('#mem-words [aria-hidden="true"]')).toHaveCount(6);
  await input.pressSequentially(LETTERS.toUpperCase()); // capitals count too
  await expect(next).toHaveText('Next: Master');
  await next.click();

  // Master: nothing is shown.
  await expect(page.locator('#mem-words [aria-hidden="true"]')).toHaveCount(12);
  await expect(page.locator('#mem-words')).not.toContainText('God');
  await input.pressSequentially(LETTERS);
  await expect(note).toContainText('Perfect · +30 XP');
  await expect(page.locator('#mem-words')).toContainText(TEXT);
  expect(await verse(page)).toEqual({ box: 2, reviews: 1, lapses: 0, dueIn: 3 });
  expect(await today(page)).toEqual({ xp: 45, n: 1, perfect: 1 });

  await expect(next).toHaveText('Finish');
  await next.click();
  await expect(page.locator('#modal')).toContainText('+45 XP');
  await page.click('#modal [data-action="closeModal"]:has-text("Done")');
  await expect(page.locator('#view')).toContainText('🔥 1-day streak');
  await expect(page.locator('#view .chip-on', { hasText: 'First verse' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a review goes straight to Master; a miss brings the verse back tomorrow and is graded once', async ({ page }) => {
  await open(page, { box: 3, reviews: 4 });
  await page.click('[data-action="memReview"]:not([data-all])');
  const input = page.locator('#mem-in'), note = page.locator('#mem-note');
  await expect(page.locator('#mem-words [aria-hidden="true"]')).toHaveCount(12);
  await input.pressSequentially('fgsl');
  await page.click('[data-action="memHint"]'); // shows "the" and counts as a miss
  await expect(page.locator('#mem-words')).toContainText('the');
  await input.pressSequentially('wzzzhos'); // three wrong letters
  await expect(note).toContainText('67%');
  await expect(page.locator('#mem-words .text-rose-700')).toHaveCount(4);
  expect(await verse(page)).toEqual({ box: 1, reviews: 5, lapses: 1, dueIn: 1 });

  await page.click('[data-action="memRestart"]');
  await input.pressSequentially(LETTERS);
  await expect(note).toContainText('Perfect');
  expect(await verse(page)).toEqual({ box: 1, reviews: 5, lapses: 1, dueIn: 1 });
  expect(await today(page)).toEqual({ xp: 35, n: 2, perfect: 1 });
});

test('practising a verse that is not due leaves its schedule alone', async ({ page }) => {
  await open(page, { box: 4, reviews: 6, due: '2099-01-01' });
  const before = await verse(page);
  await page.click('[data-action="memPractice"]');
  const input = page.locator('#mem-in');
  for (const label of ['Next: Recall', 'Next: Master', 'Finish']) { await input.pressSequentially(LETTERS); await expect(page.locator('#mem-next')).toHaveText(label); await input.press('Enter'); }
  await expect(page.locator('#modal')).toContainText('+45 XP');
  expect(await verse(page)).toEqual(before);
});

test('streak, level and badges are worked out from the days practised', async ({ page }) => {
  await open(page);
  const s = await page.evaluate(() => {
    const day = n => addDays(ymd(), n), days = {};
    for (const n of [-20, -19, -18, -17, -16, -15, -14, -13, -3, -2, -1]) days[day(n)] = { xp: 40, n: 2, perfect: 1 };
    Store.get('memkit').days = days; Store.save('memkit'); render();
    return memStats();
  });
  expect(s).toMatchObject({ xp: 440, level: 3, streak: 3, best: 8, reviews: 22, perfect: 11 });
  await expect(page.locator('#view')).toContainText('🔥 3-day streak');
  await expect(page.locator('#view')).toContainText('Practice today to keep your streak');
  await expect(page.locator('#view .chip-on', { hasText: '7-day streak' })).toBeVisible();
  await expect(page.locator('#view .chip-on', { hasText: '30-day streak' })).toHaveCount(0);
  // A day missed ends the streak.
  expect(await page.evaluate(() => { delete Store.get('memkit').days[addDays(ymd(), -1)]; return memStats().streak; })).toBe(0);
});

test('say-it-aloud mode still works and counts toward progress', async ({ page }) => {
  await open(page);
  await page.click('[data-action="memMode"][data-mode="say"]');
  await page.click('[data-action="memReview"]:not([data-all])');
  await page.click('[data-action="memShow"][data-v="2"]');
  await page.click('[data-action="memGrade"][data-ok="1"]');
  expect(await verse(page)).toEqual({ box: 2, reviews: 1, lapses: 0, dueIn: 3 });
  expect(await today(page)).toEqual({ xp: 10, n: 1, perfect: 0 });
  expect(await page.evaluate(() => Store.get('memkit').mode)).toBe('say');
});
