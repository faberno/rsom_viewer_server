// Optional real-data local-file smoke check. Requires the LAN HTTP preview server.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const origin = process.argv[2] || 'http://192.168.178.91:4173';
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1194, height: 834 } });
  const errors = [], volumeRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/data/')) volumeRequests.push(request.url()); });
  await page.goto(`${origin}/?local=1&validation`);
  await page.locator('#loading').waitFor({ state: 'hidden' });
  for (const name of ['vol-light', 'vol-full']) {
    await page.locator('#local-file').setInputFiles(`public/data/private/transfers/${name}.rsom`);
    await page.waitForFunction(() => document.body.dataset.ready === 'local-file', null, { timeout: 60000 });
    await page.waitForFunction(name => document.querySelector('#local-status').textContent.includes(name), name);
    assert.equal(await page.locator('#error').isVisible(), false);
    const signals = await page.evaluate(() => {
      const pixels = window.rsomValidation.pixels();
      let red = 0, green = 0;
      for (let i = 0; i < pixels.length; i += 3) { red += pixels[i]; green += pixels[i + 1]; }
      return { red, green };
    });
    assert.ok(signals.red > 0 && signals.green > 0);
    await page.screenshot({ path: `test-results/local-${name}.png` });
    const download = await page.request.head(`${origin}/data/private/transfers/${name}.rsom`);
    assert.equal(download.status(), 200);
    console.log(name, signals, 'download bytes:', download.headers()['content-length']);
  }
  assert.deepEqual(volumeRequests, []);
  assert.deepEqual(errors, []);
  console.log('Both real local files rendered with no browser volume requests. Secure context:', await page.evaluate(() => isSecureContext));
} finally { await browser.close(); }
