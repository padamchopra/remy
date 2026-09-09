import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { chromiumPath } from './chromium.mjs';
const url = process.env.WEBSITE_URL || 'http://127.0.0.1:5180';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (process.platform === 'darwin' ? chromiumPath() : chromium.executablePath()), headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => route.fulfill({ status: route.request().url().endsWith('/api/runtime') ? 200 : 401, contentType: 'application/json', body: JSON.stringify(route.request().url().endsWith('/api/runtime') ? { mode: 'hub', auth: { google: true, github: true, magicLink: false, sso: true } } : { error: 'Sign in again.' }) }));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Your agents, within reach.' }).waitFor();
  assert.equal(await page.getByText('Sign in to Remy', { exact: true }).count(), 0);
  const destination = await page.locator('.hero').getByRole('link', { name: 'Open Remy', exact: true }).getAttribute('href');
  assert.equal(destination, 'https://app.tryremy.dev/');
  await page.goto(new URL("/app/", url).href, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Continue with Google' }).waitFor();
  await page.getByRole('button', { name: 'Continue with GitHub' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Combined deployment checks passed: public home, /app/ sign-in, Google/GitHub controls.');
} finally { await browser.close(); }
