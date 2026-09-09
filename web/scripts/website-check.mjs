import { chromium, devices } from 'playwright-core';
import { chromiumPath } from './chromium.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const url = process.env.WEBSITE_URL || 'http://127.0.0.1:5180';
const artifacts = process.env.WEBSITE_ARTIFACTS || '/tmp/remy-pr-artifacts/website';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (process.platform === 'darwin' ? chromiumPath() : chromium.executablePath()), headless: true });
const errors = [];
const unsafeRequests = [];
function observe(page) {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) => unsafeRequests.push(socket.url()));
  page.on('request', (request) => {
    const target = new URL(request.url());
    if (target.origin !== new URL(url).origin || target.pathname.startsWith('/api/')) unsafeRequests.push(request.url());
  });
}
async function swipe(session, x = 180, y = 540, distance = -420) {
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  const travel = Math.max(distance, 40 - y);
  for (let step = 1; step <= 12; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + travel * step / 12 }] });
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await new Promise((resolve) => setTimeout(resolve, 200));
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  observe(page);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => scrollY), 0, 'preview must not steal focus');
  await page.screenshot({ path: `${artifacts}/desktop.png` });
  for (const section of ['.nav-actions', '.hero-actions', '.closing', '.site-footer']) {
    assert.equal(await page.locator(section).getByRole('link', { name: 'Open Remy', exact: true }).first().getAttribute('href'), 'https://app.tryremy.dev/');
  }
  const keyboardTabs = page.getByRole('tablist', { name: 'Explore Remy features', exact: true });
  await keyboardTabs.getByRole('tab', { name: 'Threads', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await keyboardTabs.getByRole('tab', { name: 'Worktrees', exact: true, selected: true }).waitFor();
  await page.keyboard.press('ArrowLeft');
  await keyboardTabs.getByRole('tab', { name: 'Threads', exact: true, selected: true }).waitFor();
  await page.getByRole('tab', { name: 'Review', exact: true }).first().click();
  await page.frameLocator('iframe[title="Remy workspace preview"]').getByText('Review this change and check that keyboard users', { exact: false }).waitFor();
  await page.getByRole('tab', { name: 'Threads', exact: true }).first().click();
  await page.locator('.explorer').scrollIntoViewIfNeeded();
  await page.frameLocator('.explorer iframe[title="Remy feature preview"]').getByText('Main checkout', { exact: true }).waitFor();
  await page.locator('.mobile-section').scrollIntoViewIfNeeded();
  await page.frameLocator('iframe[title="Remy browser demo in a narrow viewport"]').locator('.demo-banner').waitFor();
  await page.getByRole('button', { name: 'Is Remy free?', exact: true }).click();
  await page.getByText('Local Remy is free and needs no Remy account.', { exact: false }).waitFor();
  await page.screenshot({ path: `${artifacts}/full.png`, fullPage: true });

  const phone = await browser.newPage({ ...devices['iPhone 13'], deviceScaleFactor: 1 });
  observe(phone);
  await phone.goto(url, { waitUntil: 'networkidle' });
  await phone.evaluate(() => document.fonts.ready);
  await phone.screenshot({ path: `${artifacts}/mobile.png` });
  for (const tablist of await phone.getByRole('tablist').all()) {
    for (const tab of await tablist.getByRole('tab').all()) {
      assert.ok(await tab.evaluate((element) => {
        const label = element.querySelector('span');
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && box.height >= 44 && label.getBoundingClientRect().left >= box.left && label.getBoundingClientRect().right <= box.right;
      }), 'every feature label must fit inside a visible touch target');
    }
  }
  const topTabs = phone.getByRole('tablist', { name: 'Explore Remy features', exact: true });
  for (const [name, scene] of [['Worktrees', 'worktrees'], ['Review', 'review'], ['Agents', 'agents'], ['Threads', 'threads']]) {
    await topTabs.getByRole('tab', { name, exact: true }).click();
    assert.equal(await topTabs.getByRole('tab', { name, exact: true }).getAttribute('aria-selected'), 'true');
    await phone.frameLocator(".hero-preview iframe").locator(`html[data-preview-scene="${scene}"]`).waitFor();
  }
  await phone.goto(url, { waitUntil: 'networkidle' });
  const touch = await phone.context().newCDPSession(phone);
  await swipe(touch);
  assert.ok(await phone.evaluate(() => scrollY > 200), 'a finger swipe on the hero must scroll the page');
  await phone.locator('.hero-preview').scrollIntoViewIfNeeded();
  const preview = await phone.locator('.hero-preview .demo-viewport').boundingBox();
  const before = await phone.evaluate(() => scrollY);
  await swipe(touch, preview.x + preview.width / 2, preview.y + preview.height / 2, -220);
  assert.ok(await phone.evaluate(() => scrollY) > before + 80, 'swiping over the embedded preview must scroll the outer page');
  await phone.screenshot({ path: `${artifacts}/mobile-preview.png` });
  for (let step = 0; step < 30; step++) {
    if (await phone.locator('.site-footer').evaluate((element) => element.getBoundingClientRect().bottom <= innerHeight + 2)) break;
    await swipe(touch, 180, 540, -620);
  }
  assert.ok(await phone.locator('.site-footer').evaluate((element) => element.getBoundingClientRect().top < innerHeight), 'touch scrolling must reach the footer');
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile page must not overflow');
  await phone.goto(url);
  await phone.getByRole('button', { name: 'Open navigation' }).click();
  assert.equal(await phone.locator('.mobile-links').getByRole('link', { name: 'Open Remy', exact: true }).getAttribute('href'), 'https://app.tryremy.dev/');
  await phone.locator('.mobile-links').getByRole('link', { name: 'Features', exact: true }).click();
  await phone.locator('.mobile-links').waitFor({ state: 'hidden' });
  await phone.getByRole('button', { name: 'Open navigation' }).click();
  await phone.locator('.mobile-links').getByRole('link', { name: 'Docs', exact: true }).click();
  await phone.getByRole('heading', { name: 'Connect your devices' }).waitFor();
  await phone.goto(`${url}/changelog/`);
  await phone.getByText('Unreleased', { exact: true }).waitFor();
  await phone.goto(url);
  await phone.getByRole('link', { name: 'Try the live demo' }).click();
  await phone.getByRole('combobox', { name: 'Sample thread' }).waitFor();
  const message = phone.getByRole('textbox', { name: 'Message', exact: true });
  await message.fill('Show me how this demo works.');
  await phone.getByRole('button', { name: 'Send', exact: true }).click();
  await phone.getByText('This is a sample reply in the website demo.', { exact: false }).waitFor();
  await phone.getByRole('button', { name: 'Reset', exact: true }).click();
  await phone.getByText('This is a sample reply in the website demo.', { exact: false }).waitFor({ state: 'hidden' });
  await phone.getByRole('combobox', { name: 'Sample thread' }).click();
  await phone.getByRole('option', { name: 'Review the keyboard fix' }).click();
  await phone.getByText('Review this change and check that keyboard users', { exact: false }).waitFor();
  for (const width of [320, 360, 768]) {
    await phone.setViewportSize({ width, height: 844 });
    await phone.goto(url);
    await swipe(touch);
    assert.ok(await phone.evaluate(() => scrollY > 200), `touch scroll works at ${width}px`);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no overflow at ${width}px`);
  }
  assert.deepEqual(errors, [], 'no browser errors');
  assert.deepEqual(unsafeRequests, [], 'no API, WebSocket, or third-party requests');
  console.log('Website checks passed: real touch scrolling over hero and previews through footer, 320/360/390/768px, mobile navigation, demo send/reset, scenes, FAQ and supporting pages.');
} finally {
  await browser.close();
}
