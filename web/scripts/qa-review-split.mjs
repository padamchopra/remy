import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { chromiumPath } from './chromium.mjs';

const origin = process.env.WEBSITE_URL || 'http://127.0.0.1:5180';
const output = process.env.QA_ARTIFACTS || '/tmp/remy-pr-artifacts/review-agent-split';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (process.platform === 'darwin' ? chromiumPath() : chromium.executablePath()), headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.stack));
page.setDefaultTimeout(8000);
const account = { id: 'personal', name: 'Personal', personal: true, role: 'owner' };
const workspace = { id: 'studio', name: 'Remy', origin: 'https://github.com/studio/remy', organizationId: 'personal', icon: 'folder' };
const pr = {
  url: 'https://github.com/studio/remy/pull/42', number: 42, title: 'Keep work in app tabs', repository: 'studio/remy',
  headRefName: 'feature/app-tabs', baseRefName: 'main', isDraft: true, reviewDecision: '',
  updatedAt: new Date().toISOString(), additions: 84, deletions: 12, body: 'Keep your pull request and review thread side by side.',
  checks: [{ name: 'Web', state: 'pass' }], unreadComments: [], hasUnreadActivity: false,
  workspaceId: 'studio', workspaceName: 'Remy', workspacePath: '/workspaces/studio', worktreePath: 'hosted',
};
const id = '11111111-1111-4111-8111-111111111111';
const thread = {
  id, computerId: 'computer', revision: 1, stale: false, observedAt: Date.now(),
  access: { organizationId: 'personal', owner: { id: 'reader', label: 'Reader' }, participants: [], visibility: 'private' },
  detail: { id, title: 'Review #42: Keep work in app tabs', workspaceId: 'studio', branch: 'feature/app-tabs', state: 'idle',
    provider: 'codex', model: 'gpt-5.6-sol', permissionMode: 'default', entries: [
      { id: 'message', kind: 'user', text: 'Review pull request #42 Keep work in app tabs (feature/app-tabs → main)' },
      { id: 'answer', kind: 'assistant', text: 'The new tabs keep your pull request and review thread visible together.' },
    ] },
};
let reviewReady = false;
let startInput;
await page.routeWebSocket(/\/api\//, () => {});
await page.route('**/api/**', (route) => {
  const path = new URL(route.request().url()).pathname;
  const base = '/api/organizations/personal';
  if (path === `${base}/threads` && route.request().method() === 'POST') {
    startInput = route.request().postDataJSON();
    reviewReady = true;
    return route.fulfill({ status: 201, json: { id, computerId: 'computer', phase: 'ready' } });
  }
  const responses = {
    '/api/runtime': { mode: 'hub', auth: {} },
    '/api/profile': { id: 'reader', name: 'Alex' },
    '/api/personal': { personal: account },
    '/api/organizations': { organizations: [] },
    '/api/review-rules': { rules: [] },
    [base]: { organization: account },
    [`${base}/threads`]: { threads: reviewReady ? [thread] : [], cursor: 1, member: { id: 'reader', role: 'owner' } },
    [`${base}/computers`]: { computers: [{ computerId: 'computer', name: 'Studio Mac', ownership: 'personal', ownerUserId: 'reader', availability: 'available', canUse: true, capabilities: { workspaces: [{ id: 'studio', origin: workspace.origin }], providers: [{ id: 'codex', models: ['gpt-5.6-sol'] }] } }] },
    [`${base}/computers/preference`]: { computerId: 'computer' },
    [`${base}/model-defaults`]: { computer: { provider: 'codex', model: 'gpt-5.6-sol' } },
    [`${base}/model-access`]: { providers: [] },
    [`${base}/workspaces`]: { workspaces: [workspace], canManage: true },
    [`${base}/workspaces/studio`]: workspace,
    [`${base}/github/pull-requests`]: { pullRequests: [pr] },
    [`${base}/github/pull-request`]: { pullRequest: { state: 'OPEN', isDraft: true, checks: pr.checks, reviewers: [] } },
    [`${base}/github/pull-request-activity`]: { userId: 'reader', viewer: 'reader', seenAt: null, items: [] },
    [`${base}/github/pull-request-images`]: { images: {} },
    [`${base}/reviews`]: { review: reviewReady ? { threadId: id, computerId: 'computer', repository: 'studio/remy', number: 42, headSha: 'a'.repeat(40), reviewedSha: null, findings: [], proposals: [], rulesApplied: 0 } : null },
    [`${base}/reviews/last`]: { last: null },
    [`${base}/computers/computer/threads/${id}`]: thread,
    [`${base}/notifications`]: { notifications: [], devices: [] },
    [`${base}/connections`]: { canManage: true, providers: [], connections: [] },
    [`${base}/hosted`]: { available: false, enabledProviders: [], cloudPlacements: [] },
  };
  return route.fulfill({ status: path in responses ? 200 : 404, json: responses[path] ?? { error: 'Not in this review scenario' } });
});
try {
  await page.goto(`${origin}/app/pull-requests/studio/remy/42`);
  await page.getByRole('button', { name: 'Review with agent', exact: true }).click();
  await page.getByRole('button', { name: 'Permission mode: Ask', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Permission mode: Ask', exact: true }).click();
  await page.getByRole('option', { name: 'Auto', exact: true }).click();
  await page.getByRole('button', { name: 'Permission mode: Auto', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/review-permission.png` });
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  await page.waitForURL(/\/threads\/11111111/);
  assert.equal(startInput.permissionMode, 'auto');
  assert.deepEqual(startInput.review, { repository: 'studio/remy', number: 42 });
  assert.equal(await page.locator('section[aria-label="prs pane"]:visible').count(), 1);
  assert.equal(await page.locator('section[aria-label="Thread pane"]:visible').count(), 1);
  assert.equal(await page.getByText('This thread is unavailable').count(), 0);
  await page.reload();
  await page.getByRole('tab', { name: 'Review #42: Keep work in app tabs', exact: true }).first().waitFor();
  await page.getByText('The new tabs keep your pull request and review thread visible together.').waitFor();
  assert.equal(await page.locator('section[aria-label="prs pane"]:visible').count(), 1);
  assert.equal(await page.locator('section[aria-label="Thread pane"]:visible').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Threads', exact: true }).first().getAttribute('data-active'), 'true');
  assert.match(new URL(page.url()).pathname, /\/threads\/11111111/);
  await page.screenshot({ path: `${output}/pr-review-split.png` });
  await page.reload();
  await page.getByRole('tab', { name: 'Review #42: Keep work in app tabs', exact: true }).first().waitFor();
  await page.getByText('The new tabs keep your pull request and review thread visible together.').waitFor();
  assert.equal(await page.locator('section[aria-label$="pane"]:visible').count(), 2);
  assert.deepEqual(errors, []);
  console.log('Review split QA passed: PR left, review thread right, sidebar focus, URL and reload.');
} catch (error) {
  console.log('Failure state', page.url(), errors, (await page.locator('body').innerText()).slice(0, 2400));
  throw error;
} finally {
  await browser.close();
}
