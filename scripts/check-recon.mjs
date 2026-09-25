// Optional smoke check for the locally exported real dataset; requires the preview server.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1194, height: 834 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:4173/');
  await page.waitForFunction(() => document.body.dataset.ready === 'recon-lite');
  if (await page.locator('#dataset option').count() !== 1 || await page.locator('#dataset option').innerText() !== 'vol') throw new Error('Expected one real volume, without example or duplicate resolution entries');
  await page.goto('http://localhost:4173/?validation');
  for (const id of ['recon-lite', 'recon']) {
    await page.locator('#dataset').selectOption('recon');
    await page.locator(id === 'recon-lite' ? '#resolution-light' : '#resolution-full').click();
    await page.waitForFunction(id => document.body.dataset.ready === id, id, { timeout: 60000 });
    await page.waitForTimeout(350);
    if (await page.locator('#error').isVisible()) throw new Error(await page.locator('#error-message').innerText());
    const signals = await page.evaluate(() => {
      const pixels = window.rsomValidation.pixels();
      let red = 0, green = 0;
      for (let i = 0; i < pixels.length; i += 3) { red += pixels[i]; green += pixels[i + 1]; }
      return { red, green };
    });
    if (!signals.red || !signals.green) throw new Error(`Missing rendered channel in ${id}`);
    await page.waitForTimeout(100);
    await page.screenshot({ path: `test-results/${id}.png` });
    console.log(`${id}: both channels rendered; screenshot saved.`, signals);
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
