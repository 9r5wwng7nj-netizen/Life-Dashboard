// Barcode scanning without the browser's own detector (as in Safari on iPhone): the bundled ZXing
// reader decodes camera frames. A fake camera plays a generated barcode so the whole path runs.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const APP = pathToFileURL(path.resolve('index.html')).href;
const CODE = '5901234123457';

// EAN-13 bars as 95 modules (1 = black). A UPC-A code is the same with a leading 0.
function eanModules(code) {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = L.map(x => [...x].reverse().map(b => (b === '1' ? '0' : '1')).join('')), R = L.map(x => [...x].map(b => (b === '1' ? '0' : '1')).join(''));
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const d = [...code].map(Number), par = PARITY[d[0]];
  return [...'101' + d.slice(1, 7).map((x, i) => (par[i] === 'L' ? L : G)[x]).join('') + '01010' + d.slice(7).map(x => R[x]).join('') + '101'].map(Number);
}
// A few frames of a 640×480 video showing the barcode, in the Y4M format Chromium's fake camera plays.
function barcodeVideo(code) {
  const W = 640, H = 480, mods = eanModules(code), unit = 4, bw = mods.length * unit, ox = (W - bw) >> 1, oy = 140, bh = 200;
  const y = Buffer.alloc(W * H, 235);
  for (let j = oy; j < oy + bh; j++) mods.forEach((m, i) => { if (m) y.fill(16, j * W + ox + i * unit, j * W + ox + (i + 1) * unit); });
  const uv = Buffer.alloc((W / 2) * (H / 2) * 2, 128), frame = Buffer.concat([Buffer.from('FRAME\n'), y, uv]);
  const file = path.join(os.tmpdir(), `ld-barcode-${code}.y4m`);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...Array(10).fill(frame)]));
  return file;
}
test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${barcodeVideo(CODE)}`] } });

async function open(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => { delete window.BarcodeDetector; }); // behave like Safari
  await page.goto(APP);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  return errors;
}

test('the bundled reader decodes EAN-13 and UPC-A barcodes', async ({ page }) => {
  const errors = await open(page);
  const read = await page.evaluate(async codes => {
    const read = await barcodeReader(), out = [];
    for (const mods of codes) {
      const c = document.createElement('canvas'), unit = 3; c.width = mods.length * unit + 60; c.height = 160; const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000'; mods.forEach((m, i) => { if (m) g.fillRect(30 + i * unit, 20, unit, 120); });
      out.push(await read(c));
    }
    const blank = document.createElement('canvas'); blank.width = 300; blank.height = 100; out.push(await read(blank));
    return out;
  }, [eanModules(CODE), eanModules('0036000291452')]);
  expect(read).toEqual([CODE, '036000291452', null]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('scanning with the camera finds the food on the label', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(code => {
    Store.get('foods').push({ id: 'granola', name: 'Test Granola', brand: '', barcode: code, source: 'custom', basis: 'serving', servingLabel: '1 serving', servingG: '', extra: [], base: { cal: 200, p: 5, c: 30, f: 6 } });
    Store.save('foods'); go('nutrition'); lfOpen('breakfast'); ui.lf.tab = 'barcode'; lfDraw();
  }, CODE);
  await expect(page.locator('#scan-video')).toBeVisible();
  await page.click('[data-action="scanStart"]');
  await page.waitForFunction(() => ui.lf && ui.lf.sel && ui.lf.sel.name === 'Test Granola', null, { timeout: 15000 });
  expect(await page.evaluate(() => [ui.lf.code, scanStream])).toEqual([CODE, null]); // the camera is released once the code is read
  expect(errors, errors.join('\n')).toEqual([]);
});
