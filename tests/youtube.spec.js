// Find a video: YouTube search, subscriptions, playlists and liked videos through the person's own
// Google sign-in. Google's sign-in page and the YouTube API are both faked; nothing leaves the machine.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serveRepo, stopServer } from './serve.js';

const TOKEN = 'yt-test-token';
let server, base;
test.beforeAll(async () => { server = await serveRepo(); base = `http://localhost:${server.address().port}`; });
test.afterAll(() => stopServer(server));

const vid = n => `vid${String(n).padStart(8, '0')}`; // 11 characters, like a real video id
const CH_A = 'UC' + 'a'.repeat(22), CH_B = 'UC' + 'b'.repeat(22);
const VIDEOS = {
  [vid(1)]: { title: 'Romans overview', channelTitle: 'Bible Videos', channelId: CH_A, publishedAt: '2026-10-10T12:00:00Z', duration: 'PT8M5S' },
  [vid(2)]: { title: 'Prayer basics', channelTitle: 'Bible Videos', channelId: CH_A, publishedAt: '2026-10-12T12:00:00Z', duration: 'PT1H2M3S' },
  [vid(3)]: { title: 'Quick tip', channelTitle: 'Other Channel', channelId: CH_B, publishedAt: '2026-10-14T12:00:00Z', duration: 'PT45S' },
  [vid(4)]: { title: 'Liked sermon', channelTitle: 'Other Channel', channelId: CH_B, publishedAt: '2025-03-01T12:00:00Z', duration: 'PT40M' }
};
const item = id => ({ id, snippet: { title: VIDEOS[id].title, channelTitle: VIDEOS[id].channelTitle, channelId: VIDEOS[id].channelId, publishedAt: VIDEOS[id].publishedAt, liveBroadcastContent: 'none', thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` } } }, contentDetails: { duration: VIDEOS[id].duration } });

function fakeYouTube(context, { fail, failStatus = 403 } = {}) {
  const calls = [];
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  const json = (route, body, status = 200) => route.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  context.route('https://i.ytimg.com/**', route => route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }));
  context.route('https://www.googleapis.com/youtube/v3/**', route => {
    const req = route.request(), url = new URL(req.url()), p = url.searchParams, name = url.pathname.split('/').pop();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    calls.push(name + (p.get('playlistId') ? ':' + p.get('playlistId') : ''));
    if (fail) return json(route, { error: { code: failStatus, errors: [{ reason: fail }] } }, failStatus);
    if (req.headers().authorization !== `Bearer ${TOKEN}`) return json(route, { error: { code: 401 } }, 401);
    if (name === 'search') return json(route, { items: [vid(1), vid(2)].map(videoId => ({ id: { kind: 'youtube#video', videoId } })) });
    if (name === 'videos' && p.get('myRating') === 'like') return json(route, { items: [item(vid(4))] });
    if (name === 'videos') return json(route, { items: p.get('id').split(',').filter(id => VIDEOS[id]).map(item) });
    if (name === 'subscriptions') return json(route, { items: [CH_A, CH_B].map(channelId => ({ snippet: { resourceId: { channelId } } })) });
    if (name === 'playlists') return json(route, { items: [{ id: 'PLfavourites', snippet: { title: 'Favourites', thumbnails: {} }, contentDetails: { itemCount: 2 } }] });
    if (name === 'playlistItems') {
      const ids = { ['UU' + 'a'.repeat(22)]: [vid(2), vid(1)], ['UU' + 'b'.repeat(22)]: [vid(3)], PLfavourites: [vid(4), vid(1)] }[p.get('playlistId')] || [];
      return json(route, { items: ids.map(videoId => ({ contentDetails: { videoId, videoPublishedAt: VIDEOS[videoId].publishedAt } })) });
    }
    return json(route, { error: { code: 404 } }, 404);
  });
  return calls;
}
async function openApp(context, { connected = true } = {}) {
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  if (connected) await page.addInitScript(token => { if (!localStorage.getItem('ld.youtube')) localStorage.setItem('ld.youtube', JSON.stringify({ on: true, token, exp: Date.now() + 3600e3 })); }, TOKEN);
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  await page.evaluate(() => { A.helpDismiss({ dataset: { what: 'tour' } }); go('media'); });
  return { page, errors };
}

test('connecting YouTube asks Google for read-only access and comes back to Find a video', async ({ browser }) => {
  const context = await browser.newContext(), calls = fakeYouTube(context);
  let asked;
  await context.route('https://accounts.google.com/**', route => {
    asked = new URL(route.request().url()).searchParams;
    const back = `${asked.get('redirect_uri')}#access_token=${TOKEN}&token_type=Bearer&expires_in=3599&state=${asked.get('state')}`;
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(back)})</script>` });
  });
  const { page, errors } = await openApp(context, { connected: false });
  await page.click('#view [data-action="ytFind"]');
  await expect(page.locator('#modal')).toContainText('Connect your YouTube account');
  await page.click('#modal [data-action="ytConnect"]');
  await page.waitForFunction(() => typeof ytMeta === 'function' && ytMeta().token && !location.hash);
  expect(asked.get('scope')).toBe('https://www.googleapis.com/auth/youtube.readonly');
  expect(asked.get('response_type')).toBe('token');
  expect(asked.get('redirect_uri')).toBe(`${base}/index.html`);
  expect(asked.get('prompt')).toBe('select_account'); // lets the person pick a brand channel
  await expect(page.locator('#modal input[name="q"]')).toBeVisible(); // back in Find a video, ready to search
  expect(await page.evaluate(() => [S.view, localStorage.getItem('ld.sync')])).toEqual(['media', null]); // Drive sync untouched
  expect(calls).toEqual([]);

  // A reply meant for some other sign-in is ignored.
  await page.evaluate(() => localStorage.setItem('ld.youtube', JSON.stringify({ on: true, state: 'yt-expected' })));
  await page.goto('about:blank');
  await page.goto(`${base}/index.html#access_token=forged&expires_in=3599&state=yt-other`);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  expect(await page.evaluate(() => ytMeta().token || '')).toBe('');
  expect(errors, errors.join('\n')).toEqual([]);
  await context.close();
});

test('search, then add a video to Up next or watch it in the app', async ({ browser }) => {
  const context = await browser.newContext(), calls = fakeYouTube(context);
  const { page, errors } = await openApp(context);
  await page.click('#view [data-action="ytFind"]');
  await page.fill('#modal input[name="q"]', 'romans');
  await page.press('#modal input[name="q"]', 'Enter');
  const modal = page.locator('#modal');
  await expect(modal).toContainText('Romans overview');
  await expect(modal).toContainText('Bible Videos · 8:05');
  await expect(modal).toContainText('1:02:03');
  expect(calls).toEqual(['search', 'videos']);

  await modal.locator('[data-action="ytAdd"][data-i="0"][data-s="queue"]').click();
  await expect(modal.locator('.chip-on', { hasText: 'In your library' })).toHaveCount(1);
  expect(await page.evaluate(() => Store.get('media').map(m => [m.kind, m.title, m.author, m.url, m.status, m.date]))).toEqual([['video', 'Romans overview', 'Bible Videos', `https://www.youtube.com/watch?v=${vid(1)}`, 'queue', '2026-10-10']]);

  await modal.locator('[data-action="ytAdd"][data-i="1"][data-s="active"]').click();
  await expect(page.locator('#modal')).toBeHidden();
  await expect(page.locator('#view #m-yt')).toHaveAttribute('src', new RegExp(`/embed/${vid(2)}\\?`));

  // Searching the same words again within half an hour uses what was already found.
  await page.evaluate(() => { ui.medOpen = null; render(); });
  await page.click('#view [data-action="ytFind"]');
  await expect(modal).toContainText('Prayer basics');
  expect(calls.filter(c => c === 'search')).toHaveLength(1);
  expect(errors, errors.join('\n')).toEqual([]);
  await context.close();
});

test('subscriptions, playlists, liked videos and a channel’s videos', async ({ browser }) => {
  const context = await browser.newContext(), calls = fakeYouTube(context);
  const { page, errors } = await openApp(context);
  const modal = page.locator('#modal'), titles = () => modal.locator('.line-clamp-2').allTextContents();
  await page.click('#view [data-action="ytFind"]');

  await modal.locator('[data-action="ytView"][data-v="subs"]').click();
  await expect(modal).toContainText('Newest from your subscribed channels');
  await expect.poll(titles).toEqual(['Quick tip', 'Prayer basics', 'Romans overview']); // newest first
  await expect(modal.locator('.chip', { hasText: 'Short' })).toHaveCount(1);

  await modal.locator('[data-action="ytView"][data-v="lists"]').click();
  await modal.locator('[data-action="ytList"]').click();
  await expect(modal).toContainText('Favourites');
  await expect.poll(titles).toEqual(['Liked sermon', 'Romans overview']);
  await modal.locator('[data-action="ytBack"]').click();
  await expect(modal.locator('[data-action="ytList"]')).toContainText('2 videos');

  await modal.locator('[data-action="ytView"][data-v="liked"]').click();
  await expect.poll(titles).toEqual(['Liked sermon']);
  await modal.locator('[data-action="ytChannel"]').first().click();
  await expect(modal.locator('.font-semibold', { hasText: 'Other Channel' })).toBeVisible();
  await expect.poll(titles).toEqual(['Quick tip']);
  await modal.locator('[data-action="ytBack"]').click();
  await expect.poll(titles).toEqual(['Liked sermon']);
  expect(calls).toContain('playlistItems:UU' + 'b'.repeat(22));
  expect(errors, errors.join('\n')).toEqual([]);
  await context.close();
});

test('an expired connection asks to reconnect, and setup problems are explained', async ({ browser }) => {
  let context = await browser.newContext();
  fakeYouTube(context);
  await context.addInitScript(() => localStorage.setItem('ld.youtube', JSON.stringify({ on: true, token: 'old', exp: Date.now() - 1000 })));
  let { page, errors } = await openApp(context, { connected: false });
  await page.click('#view [data-action="ytFind"]');
  await expect(page.locator('#modal')).toContainText('lasts about an hour');
  await expect(page.locator('#modal [data-action="ytConnect"]')).toHaveText(/Reconnect YouTube/);
  expect(errors, errors.join('\n')).toEqual([]);
  await context.close();

  context = await browser.newContext();
  fakeYouTube(context, { fail: 'accessNotConfigured' });
  ({ page, errors } = await openApp(context));
  await page.click('#view [data-action="ytFind"]');
  await page.fill('#modal input[name="q"]', 'anything');
  await page.press('#modal input[name="q"]', 'Enter');
  await expect(page.locator('#modal')).toContainText('Turn on the YouTube Data API v3');
  await page.click('#modal [data-action="ytDisconnect"]');
  expect(await page.evaluate(() => localStorage.getItem('ld.youtube'))).toBeNull();
  await expect(page.locator('#modal [data-action="ytConnect"]')).toHaveText(/Connect YouTube/);
  expect(errors, errors.join('\n')).toEqual([]);
  await context.close();
});

test('a copy opened as a file explains that finding videos needs the hosted app', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve('index.html')).href);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  await page.evaluate(() => { A.helpDismiss({ dataset: { what: 'tour' } }); go('media'); });
  await page.click('#view [data-action="ytFind"]');
  await expect(page.locator('#modal')).toContainText('works in the hosted copy');
});

test('an account with no YouTube channel is told how to pick the right one', async ({ browser }) => {
  const context = await browser.newContext();
  fakeYouTube(context, { fail: 'channelNotFound', failStatus: 404 });
  const { page, errors } = await openApp(context);
  await page.click('#view [data-action="ytFind"]');
  await page.locator('#modal [data-action="ytView"][data-v="lists"]').click();
  await expect(page.locator('#modal')).toContainText('couldn’t find a channel');
  await expect(page.locator('#modal [data-action="ytConnect"]')).toHaveText(/Reconnect YouTube/);
  expect(errors, errors.join('\n')).toEqual([]);
  await context.close();
});
