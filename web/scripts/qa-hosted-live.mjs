import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { chromiumPath } from './chromium.mjs';
import { QA_ACCOUNT_ERROR, qaHostedAccount } from '../hosted-account.mjs';

const url = process.env.QA_HOSTED_URL || 'http://127.0.0.1:5174';
try {
  const account = qaHostedAccount();
  const browser = await chromium.launch({ executablePath: process.platform === 'darwin' ? chromiumPath() : chromium.executablePath() });
  try {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', (error) => console.error(error.message));
    await page.goto(url);
    const runtime = await page.evaluate(async () => {
      const response = await fetch('/api/runtime');
      return response.json();
    });
    if (runtime.preview) {
      if (!runtime.auth.password) throw new Error(QA_ACCOUNT_ERROR);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    } else {
      await page.getByLabel('Email', { exact: true }).fill(account.email);
      await page.getByLabel('Password', { exact: true }).fill(account.password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Choose personal or organization' }).waitFor();
    const profile = await page.evaluate(async () => {
      const response = await fetch('/api/profile');
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    });
    assert.equal(profile.status, 200);
    assert.equal(typeof profile.body?.id, 'string');
    console.log('Hosted QA signed in with the secret account.');
  } finally {
    await browser.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
