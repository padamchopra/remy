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
  assert.equal(await page.getByRole('textbox').count(), 0, 'Social sign-in must not require an email');
  const signIns = [];
  await page.route('**/api/auth/sign-in/**', route => {
    signIns.push({ path: new URL(route.request().url()).pathname, input: route.request().postDataJSON() });
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Sign-in provider unavailable; try again.' }) });
  });
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.getByText('Sign-in provider unavailable; try again.', { exact: true }).waitFor();
  assert.equal(signIns[0].input.provider, 'google');
  assert.equal('email' in signIns[0].input, false);
  await page.getByRole('button', { name: 'Continue with single sign-on' }).click();
  await page.getByLabel('Work email').fill('qa@example.test');
  await page.getByLabel('Work email').press('Enter');
  await page.getByText('Sign-in provider unavailable; try again.', { exact: true }).waitFor();
  assert.equal(signIns.at(-1).path, '/api/auth/sign-in/sso');
  assert.equal(signIns.some(request => request.path.endsWith('/magic-link')), false);
  assert.deepEqual(errors, []);

  const passwordPage = await browser.newPage();
  const passwordSignIns = [];
  passwordPage.on('pageerror', error => errors.push(error.message));
  await passwordPage.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/runtime') return route.fulfill({ json: { mode: 'hub', auth: { password: true, magicLink: true, google: false, github: false, sso: false } } });
    if (path.startsWith('/api/auth/sign-in/') || path.startsWith('/api/auth/sign-up/')) {
      passwordSignIns.push({ path, input: route.request().postDataJSON() });
      return route.fulfill({ json: { user: { id: 'qa' } } });
    }
    if (path === '/api/sessions/web') return route.fulfill({ json: { expiresIn: 60 } });
    return route.fulfill({ status: 401, json: { error: 'Sign in again.' } });
  });
  await passwordPage.goto(new URL('/app/', url).href, { waitUntil: 'networkidle' });
  await passwordPage.getByRole('button', { name: 'Email sign-in link', exact: true }).waitFor();
  await passwordPage.getByRole('button', { name: 'Create your account', exact: true }).waitFor();
  await passwordPage.getByLabel('Email', { exact: true }).fill('qa@example.test');
  await passwordPage.getByLabel('Password', { exact: true }).fill('qa-test-password');
  const posted = passwordPage.waitForRequest((request) => new URL(request.url()).pathname === '/api/auth/sign-in/email');
  await passwordPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await posted;
  assert.equal(passwordSignIns.some(request => request.path.endsWith('/email')), true);
  assert.equal(passwordSignIns.find(request => request.path.endsWith('/email')).input.email, 'qa@example.test');
  assert.equal(passwordSignIns.find(request => request.path.endsWith('/email')).input.password, 'qa-test-password');

  const signupPage = await browser.newPage();
  signupPage.on('pageerror', error => errors.push(error.message));
  await signupPage.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/runtime') return route.fulfill({ json: { mode: 'hub', auth: { password: true, magicLink: true, google: false, github: false, sso: false } } });
    if (path === '/api/auth/sign-up/email' || path === '/api/sessions/web') {
      return route.fulfill({ json: path === '/api/sessions/web' ? { expiresIn: 60 } : { user: { id: 'qa' } } });
    }
    return route.fulfill({ status: 401, json: { error: 'Sign in again.' } });
  });
  await signupPage.goto(new URL('/app/', url).href, { waitUntil: 'networkidle' });
  await signupPage.getByRole('button', { name: 'Create your account', exact: true }).click();
  await signupPage.getByRole('heading', { name: 'Create your Remy account', exact: true }).waitFor();
  await signupPage.getByLabel('Email', { exact: true }).fill('new@example.test');
  await signupPage.getByLabel('Password', { exact: true }).fill('qa-new-password');
  const signedUp = signupPage.waitForRequest((request) => new URL(request.url()).pathname === '/api/auth/sign-up/email');
  await signupPage.getByRole('button', { name: 'Create account', exact: true }).click();
  const signup = await signedUp;
  assert.deepEqual(signup.postDataJSON(), { email: 'new@example.test', password: 'qa-new-password', name: 'new' });

  const errorPage = await browser.newPage();
  errorPage.on('pageerror', error => errors.push(error.message));
  await errorPage.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/runtime') return route.fulfill({ json: { mode: 'hub', auth: { password: true, magicLink: false, google: false, github: false, sso: false } } });
    if (path === '/api/auth/sign-up/email') return route.fulfill({ status: 422, json: { message: 'User already exists.' } });
    return route.fulfill({ status: 401, json: { error: 'Sign in again.' } });
  });
  await errorPage.goto(new URL('/app/', url).href, { waitUntil: 'networkidle' });
  await errorPage.getByRole('button', { name: 'Create your account', exact: true }).click();
  await errorPage.getByLabel('Email', { exact: true }).fill('existing@example.test');
  await errorPage.getByLabel('Password', { exact: true }).fill('qa-test-password');
  await errorPage.getByRole('button', { name: 'Create account', exact: true }).click();
  await errorPage.getByText('An account with this email already exists. Sign in instead.', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Combined deployment checks passed: public home, /app/ sign-in, Google/GitHub controls, email/password.');
} finally { await browser.close(); }
