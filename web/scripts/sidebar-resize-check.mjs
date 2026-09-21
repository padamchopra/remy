/// The sidebar's width is the person's, on their device: drag its edge, keep
/// it across reloads, and reach it from the keyboard. One sidebar serves both
/// shells, so checking it on the website demo checks it for the Mac window and
/// the hosted app too.
import { chromium } from 'playwright-core';
import { chromiumPath } from './chromium.mjs';
import assert from 'node:assert/strict';

const url = process.env.WEBSITE_URL || 'http://127.0.0.1:5180';
const DEFAULT = 240, MIN = 208, MAX = 480;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (process.platform === 'darwin' ? chromiumPath() : chromium.executablePath()), headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

await page.goto(new URL('/demo/', url).href);
await page.waitForSelector('.sidebar-thread');
const handle = page.locator('[data-slot="sidebar-resize-handle"]');
await handle.waitFor();
const width = async () => Math.round(await page.locator('[data-slot="sidebar"]').first().evaluate(node => node.getBoundingClientRect().width));
const drag = async (by) => {
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + by, box.y + 300, { steps: 10 });
  await page.mouse.up();
};

assert.equal(await width(), DEFAULT, 'the sidebar opens at its default width');
await drag(90);
assert.equal(await width(), DEFAULT + 90, 'dragging the edge resizes the sidebar');

await page.reload();
await page.waitForSelector('.sidebar-thread');
assert.equal(await width(), DEFAULT + 90, 'the width survives a reload on this device');

await drag(-600);
assert.equal(await width(), MIN, 'the width stops at its floor');
await drag(900);
assert.equal(await width(), MAX, 'the width stops at its ceiling');

await handle.focus();
await page.keyboard.press('ArrowLeft');
assert.equal(await width(), MAX - 8, 'an arrow key steps the width');
await page.keyboard.down('Shift');
await page.keyboard.press('ArrowLeft');
await page.keyboard.up('Shift');
assert.equal(await width(), MAX - 40, 'Shift takes a bigger step');
await handle.dblclick();
assert.equal(await width(), DEFAULT, 'a double-click puts it back');

// A thread row has to stay readable at either end of the range.
for (const stored of [MIN, MAX]) {
  await page.evaluate(value => localStorage.setItem('remy.sidebar-width', String(value)), stored);
  await page.reload();
  await page.waitForSelector('.sidebar-thread');
  assert.equal(await width(), stored, `the sidebar opens at ${stored}px`);
  const row = page.locator('.sidebar-thread').first();
  const overflow = await row.evaluate(node => node.scrollWidth - node.clientWidth);
  assert.ok(overflow <= 0, `no horizontal overflow at ${stored}px, got ${overflow}`);
  const lines = await page.locator('.sidebar-thread-title').first().evaluate(node => node.getClientRects().length);
  assert.ok(lines >= 1, `the title still renders at ${stored}px`);
}

assert.deepEqual(errors, []);
await browser.close();
console.log('Sidebar resize passed: drag, reload, both clamps, keyboard steps, reset, and rows at either end.');
