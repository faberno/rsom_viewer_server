import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function localPhantom() {
  const manifest = await readFile('public/data/validation/manifest.json');
  const payload = await readFile('public/data/validation/volume.bin');
  const header = Buffer.alloc(12); header.write('RSOMPK01'); header.writeUInt32LE(manifest.length, 8);
  return Buffer.concat([header, manifest, payload]);
}

test.beforeEach(async ({ page }, testInfo) => {
  // Keep deterministic synthetic validation independent of the booth's real-data catalog.
  await page.addInitScript(saved => {
    localStorage.setItem('rsom-last-dataset', saved);
    localStorage.setItem('rsom-offline-selection', 'data/demo/manifest.json');
  }, testInfo.title.startsWith('diagnostic startup') ? 'recon-lite' : 'demo');
});

test('diagnostic startup replaces a remembered private volume with the synthetic fixture', async ({ page }) => {
  await page.route('**/data/private/**', route => route.abort());
  await page.goto('/?validation');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'demo');
  await expect(page.locator('#error')).toBeHidden();
});

test('missing manifest HTML has an actionable error', async ({ page }) => {
  await page.route('**/data/private/recon-lite/manifest.json', route => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><html>App fallback</html>'
  }));
  await page.goto('/?validation');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'demo');
  await page.locator('#resolution-light').click();
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'demo-lite');
  await page.locator('#dataset').selectOption('recon');
  await expect(page.locator('#error-message')).toContainText('This volume export is missing');
  await expect(page.locator('#error-message')).toContainText('Open from Files');
});

test('production GPU shader agrees with NumPy imshow MIP, including different-depth maxima', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?validation');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'demo');
  await page.evaluate(() => (window as any).rsomValidation.load());
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'validation');
  const reference = await (await page.request.get('/data/validation/reference.json')).json();
  // Allow UI's interaction-quality timer to settle; test uses full-quality same shader.
  const pixels = await page.evaluate(() => (window as any).rsomValidation.pixels());
  const expected = reference.flatMap((row: number[][]) => row.flatMap(pair => [...pair, 0]));
  expect(pixels).toHaveLength(expected.length);
  expect(Math.max(...pixels.map((v: number, i: number) => Math.abs(v - expected[i])))).toBeLessThanOrEqual(1);
  // The visitor view is the same projection rotated clockwise: shallow z at the top.
  const upright = await page.evaluate(() => (window as any).rsomValidation.uprightPixels());
  const rotated: number[] = [];
  for (let z = 0; z < 9; z++) for (let x = 4; x >= 0; x--) rotated.push(...reference[x][z], 0);
  expect(Math.max(...upright.map((v: number, i: number) => Math.abs(v - rotated[i])))).toBeLessThanOrEqual(1);
  await page.locator('#toggle-0').click();
  const greenOnly = await page.evaluate(() => (window as any).rsomValidation.pixels());
  expect(greenOnly.filter((_: number, i: number) => i % 3 === 0).every((v: number) => v === 0)).toBeTruthy();
  await page.locator('#toggle-0').click();
  await page.locator('#technical summary').click();
  await page.locator('#low-0').fill('0.1'); await page.locator('#high-0').fill('0.75'); await page.locator('#gamma-0').fill('2');
  const mapped = await page.evaluate(() => (window as any).rsomValidation.pixels());
  for (let i = 0; i < mapped.length; i++) {
    const wanted = i % 3 === 0 ? 255 * Math.sqrt(Math.min(1, Math.max(0, (expected[i] / 255 - .1) / .65))) : expected[i];
    expect(Math.abs(mapped[i] - wanted)).toBeLessThanOrEqual(1);
  }
  await page.locator('#low-0').fill('0'); await page.locator('#high-0').fill('1'); await page.locator('#gamma-0').fill('1');
  // The fixture declares depth=y. Keep red's y=1 peak, exclude green's y=5 peak.
  await page.locator('#crop-end').focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
  const cropped = await page.evaluate(() => (window as any).rsomValidation.pixels());
  for (let i = 0; i < cropped.length; i++) expect(Math.abs(cropped[i] - (i % 3 === 0 ? expected[i] : 0))).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('touch-sized UI, channel controls, presets, dataset switching and desktop drag', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?validation'); await expect(page.locator('body')).toHaveAttribute('data-ready', 'demo');
  await expect(page.locator('header, .stage-heading, .data-badge, .gesture-hint, .panel-title')).toHaveCount(0);
  await expect(page.locator('.stage > *')).toHaveCount(4);
  const zLabel = page.locator('#axes text').filter({ hasText: '+z' });
  await expect(zLabel).toHaveAttribute('y', '119');
  await expect(page.locator('#resolution-full')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(250); // Capture restored still-image quality, not the initial interaction frame.
  await page.screenshot({ path: 'test-results/explorer-landscape.png' });
  await page.getByRole('button', { name: 'Side', exact: true }).click();
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  await page.locator('#reset').click();
  await page.locator('#toggle-1').click(); await expect(page.locator('#toggle-1')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#technical summary').click();
  await page.locator('#gamma-0').fill('1.5'); await expect(page.locator('#gamma-value-0')).toHaveText('1.50');
  const canvas = await page.locator('canvas').boundingBox();
  await page.mouse.move(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  await page.mouse.down(); await page.mouse.move(canvas!.x + canvas!.width / 2 + 90, canvas!.y + canvas!.height / 2 + 30, { steps: 6 }); await page.mouse.up();
  // A single shared depth track retains inclusive, independently keyboard-accessible endpoints.
  await page.locator('#crop-start').focus(); await page.keyboard.press('End');
  await expect(page.locator('#crop-value')).toHaveText('1 / 128 slices');
  await page.keyboard.press('ArrowRight'); await expect(page.locator('#crop-start')).toHaveAttribute('aria-valuenow', '127');
  await expect(page.locator('#depth-range')).toHaveClass(/handles-close/);
  await page.keyboard.press('Home');
  const handle = await page.locator('#crop-start').boundingBox(), track = await page.locator('#depth-range').boundingBox();
  await page.mouse.move(handle!.x + 22, handle!.y + 22); await page.mouse.down();
  await page.mouse.move(track!.x + 22 + (track!.width - 44) * .25, handle!.y + 22, { steps: 4 }); await page.mouse.up();
  expect(Number(await page.locator('#crop-start').getAttribute('aria-valuenow'))).toBeGreaterThan(20);
  await page.locator('#resolution-light').click(); await expect(page.locator('body')).toHaveAttribute('data-ready', 'demo-lite');
  await expect(page.locator('#dataset')).toHaveValue('demo');
  await expect(page.locator('#resolution-light')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#toggle-1')).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 834, height: 1194 }); await page.screenshot({ path: 'test-results/explorer-portrait.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/explorer-phone.png' });
  expect(errors).toEqual([]);
});

test('two-finger pan follows the gesture, pinch still zooms, and reset recenters', async ({ page, context }) => {
  await page.goto('/?validation'); await expect(page.locator('body')).toHaveAttribute('data-ready', 'demo');
  const view = () => page.evaluate(() => (window as any).rsomValidation.viewState());
  const before = await view();
  const bounds = (await page.locator('#volume').boundingBox())!;
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const fingers = (dx: number, dy: number, gap = 45) => [
    { x: x + dx - gap, y: y + dy, id: 1 }, { x: x + dx + gap, y: y + dy, id: 2 }
  ];
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(0, 0) });
  for (let step = 1; step <= 10; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(step * 7, step * 3.5) });
  }
  const panned = await view();
  // Pointer events arrive per finger, so the combined pan/pinch control may briefly adjust scale.
  expect(Math.abs(panned.center[0] - before.center[0] - 140 / bounds.width)).toBeLessThan(.01);
  expect(Math.abs(panned.center[1] - before.center[1] + 70 / bounds.height)).toBeLessThan(.01);
  expect(panned.zoom).toBeCloseTo(before.zoom, 6);
  // q and -q describe the same orientation.
  const alignment = panned.rotation.reduce((sum: number, value: number, i: number) => sum + value * before.rotation[i], 0);
  expect(Math.abs(alignment)).toBeCloseTo(1, 6);
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(70, 35, 70) });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect((await view()).zoom).toBeGreaterThan(before.zoom);
  await page.locator('#reset').click();
  const reset = await view();
  expect(reset.center[0]).toBeCloseTo(0, 6); expect(reset.center[1]).toBeCloseTo(0, 6); expect(reset.zoom).toBe(1);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.mouse.move(x, y); await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + 45, y + 25, { steps: 4 }); await page.mouse.up({ button: 'right' });
  expect((await view()).center[0]).toBeGreaterThan(.05);
  await page.getByRole('button', { name: 'Side', exact: true }).click();
  const preset = await view();
  expect(preset.center[0]).toBeCloseTo(0, 6); expect(preset.center[1]).toBeCloseTo(0, 6);
});

test('verified offline preparation survives a cold page start and detects missing cache bytes', async ({ page, context }) => {
  await page.goto('/?validation'); await expect(page.locator('body')).toHaveAttribute('data-ready', 'demo');
  await page.locator('#offline-panel summary').click();
  await expect(page.locator('#offline-status')).not.toHaveText('Checking offline support…');
  await page.locator('#prepare').click();
  await expect(page.locator('#offline-status')).toContainText('Verified offline', { timeout: 30000 });
  await context.setOffline(true);
  await page.close();
  const cold = await context.newPage(); await cold.goto('/?validation');
  await expect(cold.locator('body')).toHaveAttribute('data-ready', 'demo');
  await cold.locator('#offline-panel summary').click(); await expect(cold.locator('#offline-status')).toContainText('Verified offline');
  await cold.evaluate(async () => {
    for (const key of await caches.keys()) if (key.startsWith('rsom-data-')) {
      const cache = await caches.open(key); for (const request of await cache.keys()) if (request.url.endsWith('volume.bin')) await cache.delete(request);
    }
  });
  await cold.reload();
  await cold.locator('#offline-panel summary').click();
  // HTTP cache may still render the volume, but it must never count as verified CacheStorage readiness.
  await expect(cold.locator('#offline-status')).toContainText('missing or unreadable');
});

test('context loss reports an error and recovers the selected volume', async ({ page }) => {
  await page.goto('/?validation'); await expect(page.locator('body')).toHaveAttribute('data-ready', 'demo');
  await page.evaluate(() => (window as any).rsomValidation.contextLoss());
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#error')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'demo');
});

test('local Files import on insecure HTTP makes no volume requests and matches NumPy', async ({ page }) => {
  const volumeRequests: string[] = [];
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  // A non-loopback HTTP origin exercises the same secure-context restriction as LAN Safari.
  await page.route('http://rsom.test:4173/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/data/')) volumeRequests.push(url.pathname);
    const response = await route.fetch({ url: `http://localhost:4173${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  await page.goto('http://rsom.test:4173/?local=1&validation');
  expect(await page.evaluate(() => isSecureContext)).toBe(false);
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#dataset')).toHaveValue('local-file');
  await expect(page.locator('.resolution')).toBeHidden();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open from Files', exact: true }).click();
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(false);
  expect(await chooser.element().getAttribute('accept')).toBe('.rsom,application/octet-stream');
  const buffer = await localPhantom();
  await chooser.setFiles({ name: 'phantom.rsom', mimeType: 'application/octet-stream', buffer });
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'local-file');
  await expect(page.locator('#local-status')).toContainText('not uploaded');
  const reference = JSON.parse(await readFile('public/data/validation/reference.json', 'utf8'));
  const expected = reference.flatMap((row: number[][]) => row.flatMap(pair => [...pair, 0]));
  const pixels = await page.evaluate(() => (window as any).rsomValidation.pixels());
  expect(Math.max(...pixels.map((v: number, i: number) => Math.abs(v - expected[i])))).toBeLessThanOrEqual(1);
  await page.locator('#offline-panel summary').click();
  await expect(page.locator('#prepare')).toBeDisabled();
  await expect(page.locator('#offline-status')).toContainText('computer must serve the app');
  await page.evaluate(() => (window as any).rsomValidation.contextLoss());
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#error')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'local-file');
  await page.screenshot({ path: 'test-results/local-files-http.png' });
  await page.reload();
  await expect(page.locator('#local-status')).toContainText('each time you open or reload');
  await expect(page.locator('body')).not.toHaveAttribute('data-ready');
  expect(volumeRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('local import rejects invalid files and can retry and switch back to catalog', async ({ page }) => {
  await page.goto('/?local=1&validation');
  await expect(page.locator('#loading')).toBeHidden();
  const upload = async (buffer: Buffer) => page.locator('#local-file').setInputFiles({ name: 'test.rsom', mimeType: 'application/octet-stream', buffer });
  await upload(Buffer.from('not a volume'));
  await expect(page.locator('#error-message')).toContainText('Choose an exported .rsom file');
  const buffer = await localPhantom();
  await upload(buffer.subarray(0, buffer.length - 1));
  await expect(page.locator('#error-message')).toContainText('Incomplete or oversized');
  const badChecksum = Buffer.from(buffer); badChecksum[badChecksum.length - 1] ^= 1;
  await upload(badChecksum);
  await expect(page.locator('#error-message')).toContainText('checksum mismatch');
  await upload(buffer);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'local-file');
  await page.locator('#dataset').selectOption('demo');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'demo');
  await expect(page.locator('.resolution')).toBeVisible();
  await page.locator('#dataset').selectOption('local-file');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'local-file');
});
