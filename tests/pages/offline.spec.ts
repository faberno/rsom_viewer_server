import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('viewer-only app opens at a project URL and imports local files after an offline cold start', async ({ page, context }) => {
  const volumeRequests: string[] = [];
  context.on('request', request => {
    if (/\/data\/|\.rsom(?:$|\?)/.test(request.url())) volumeRequests.push(request.url());
  });
  await page.goto('./?validation');
  await expect(page.locator('#dataset option')).toHaveText(['From Files']);
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('.resolution')).toBeHidden();
  await page.locator('#offline-panel summary').click();
  await expect(page.locator('#prepare')).toBeEnabled();
  await page.locator('#prepare').click();
  await expect(page.locator('#offline-status')).toContainText('Verified offline · app only');

  await context.setOffline(true);
  await page.close();
  const cold = await context.newPage();
  await cold.goto('./');
  await expect(cold.locator('#local-status')).toContainText('each time you open or reload');
  await cold.locator('#offline-panel summary').click();
  await expect(cold.locator('#offline-status')).toContainText('Verified offline · app only');

  // The test supplies a local fixture; it is never part of the published artifact.
  const manifest = await readFile('public/data/validation/manifest.json');
  const bytes = await readFile('public/data/validation/volume.bin');
  const header = Buffer.alloc(12); header.write('RSOMPK01'); header.writeUInt32LE(manifest.length, 8);
  await cold.locator('#local-file').setInputFiles({
    name: 'private.rsom', mimeType: 'application/octet-stream', buffer: Buffer.concat([header, manifest, bytes])
  });
  await expect(cold.locator('body')).toHaveAttribute('data-ready', 'local-file');
  expect(volumeRequests).toEqual([]);

  await cold.evaluate(async () => {
    for (const key of await caches.keys()) {
      if (!key.startsWith('rsom-shell-')) continue;
      const cache = await caches.open(key);
      for (const request of await cache.keys()) if (request.url.endsWith('icon.svg')) await cache.delete(request);
    }
  });
  await cold.locator('#prepare').click();
  await expect(cold.locator('#offline-status')).toContainText('Not ready offline');
  await expect(cold.locator('#offline-status')).toContainText('missing or unreadable');
});
