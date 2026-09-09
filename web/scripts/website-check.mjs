import { chromium } from 'playwright-core';
import { chromiumPath } from './chromium.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const url = process.env.WEBSITE_URL || 'http://127.0.0.1:5180';
const artifacts = process.env.WEBSITE_ARTIFACTS || '/tmp/remy-pr-artifacts/website';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (process.platform === 'darwin' ? chromiumPath() : chromium.executablePath()), headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const errors = [];
const unsafeRequests = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('websocket', (socket) => unsafeRequests.push(socket.url()));
page.on('request', (request) => {
  const target = new URL(request.url());
  if (target.origin !== new URL(url).origin || target.pathname.startsWith('/api/')) unsafeRequests.push(request.url());
});
try {
  await page.goto(url, { waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => scrollY), 0, 'demo must not steal focus and scroll the page');
  await page.screenshot({ path: `${artifacts}/desktop.png` });
  const demo = page.frameLocator('iframe[title="Interactive Remy demo"]');
  const message = demo.getByRole('textbox', { name: 'Message', exact: true });
  await message.fill('Show me how this demo works.');
  await demo.getByRole('button', { name: 'Send', exact: true }).click();
  await demo.getByText('This is a sample reply in the website demo.', { exact: false }).waitFor();
  await demo.getByRole('button', { name: 'Reset', exact: true }).click();
  await demo.getByText('This is a sample reply in the website demo.', { exact: false }).waitFor({ state: 'hidden' });
  await page.getByRole('tab', { name: 'Review the work', exact: true }).first().click();
  await demo.getByText('Review this change and check that keyboard users', { exact: false }).waitFor();
  await page.getByRole('tab', { name: 'Run parallel threads', exact: true }).first().click();
  await page.getByRole('button', { name: 'Is Remy free?', exact: true }).click();
  await page.getByText('Local Remy is free and needs no Remy account.', { exact: false }).waitFor();
  for (const frame of await page.locator('iframe').all()) {
    await frame.scrollIntoViewIfNeeded();
    await frame.contentFrame().getByRole('button', { name: 'Reset', exact: true }).waitFor();
  }
  await page.locator('.mobile-section').scrollIntoViewIfNeeded();
  await page.frameLocator('iframe[title="Remy browser demo in a narrow viewport"]').last().getByRole('button', { name: 'Reset', exact: true }).waitFor();
  await page.screenshot({ path: `${artifacts}/full.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await demo.getByRole('combobox', { name: 'Sample thread' }).waitFor();
  await page.screenshot({ path: `${artifacts}/mobile.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile page must not overflow');
  await demo.getByRole('combobox', { name: 'Sample thread' }).click();
  await demo.getByRole('option', { name: 'Review the keyboard fix' }).click();
  await demo.getByText('Review this change and check that keyboard users', { exact: false }).waitFor();
  await page.goto(`${url}/docs/`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Connect your devices' }).waitFor();
  await page.goto(`${url}/changelog/`, { waitUntil: 'networkidle' });
  await page.getByText('Unreleased', { exact: true }).waitFor();
  assert.deepEqual(errors, [], 'no browser errors');
  assert.deepEqual(unsafeRequests, [], 'website demo must not make API, WebSocket, or third-party requests');
  console.log('Website checks passed: desktop/mobile, sample send/reset, scene selection, FAQ, guides, changelog, no live requests.');
} finally {
  await browser.close();
}
