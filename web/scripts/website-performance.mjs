import { chromium, devices } from 'playwright-core';
import { chromiumPath } from './chromium.mjs';
import assert from 'node:assert/strict';

const url = process.env.WEBSITE_URL || 'http://127.0.0.1:5180';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (process.platform === 'darwin' ? chromiumPath() : chromium.executablePath()), headless: true });
try {
  const page = await browser.newPage({ ...devices['iPhone 13'], deviceScaleFactor: 1 });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let releasePreview;
  const previewGate = new Promise((resolve) => { releasePreview = resolve; });
  await page.route('**/demo/index.html?**', async (route) => {
    await previewGate;
    await route.continue();
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const startupTabs = page.getByRole('tablist', { name: 'Explore Remy features', exact: true });
  for (const name of ['Review', 'Worktrees', 'Agents']) {
    await startupTabs.getByRole('tab', { name, exact: true }).click();
  }
  releasePreview();
  await page.frameLocator('.hero-preview iframe').locator('html[data-preview-scene="agents"]').waitFor();
  await page.unroute('**/demo/index.html?**');
  await page.goto(url, { waitUntil: 'networkidle' });
  const timings = [];
  for (const [section, label, title] of [['.hero-preview', 'Explore Remy features', 'Remy workspace preview'], ['.explorer', 'Explore the workbench', 'Remy feature preview']]) {
    await page.locator(section).scrollIntoViewIfNeeded();
    const frame = page.frameLocator(`${section} iframe`);
    await frame.locator('html[data-preview-scene]').waitFor();
    const instance = await frame.locator('html').evaluate(() => {
      window.previewInstance = crypto.randomUUID();
      return window.previewInstance;
    });
    const navigations = [];
    const record = (request) => { if (request.isNavigationRequest() && request.url().includes('/demo/')) navigations.push(request.url()); };
    page.on('request', record);
    await page.context().setOffline(true);
    for (const [name, scene] of [['Review', 'review'], ['Agents', 'agents'], ['Threads', 'threads'], ['Worktrees', 'worktrees'], ['Review', 'review']]) {
      const start = Date.now();
      await page.getByRole('tablist', { name: label, exact: true }).getByRole('tab', { name, exact: true }).click();
      await frame.locator(`html[data-preview-scene="${scene}"]`).waitFor({ timeout: 1500 });
      await frame.locator('html').evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const elapsed = Date.now() - start;
      timings.push({ section, scene, ms: elapsed });
      assert.equal(await frame.locator('html').evaluate(() => window.previewInstance), instance, `${title} must keep its document`);
      assert.equal(await page.locator(`${section} .demo-placeholder`).count(), 0, 'switching must never return to a loading placeholder');
      assert.ok(elapsed < 1000, `switch to ${scene} must complete in under one second at 4x CPU slowdown (${elapsed}ms)`);
    }
    await page.context().setOffline(false);
    page.off('request', record);
    assert.deepEqual(navigations, [], 'feature switching must not navigate or fetch a demo document');
  }
  console.log(JSON.stringify({ offlineSwitches: timings, newDocuments: 0 }, null, 2));
} finally {
  await browser.close();
}
