import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { chromiumPath } from './chromium.mjs';

const origin = process.env.WEBSITE_URL || 'http://127.0.0.1:5180';
const output = process.env.QA_ARTIFACTS || '/tmp/remy-pr-artifacts/review-agent-split';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (process.platform === 'darwin' ? chromiumPath() : chromium.executablePath()), headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
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
const filePath = 'android/browser-repository/src/main/java/ag/jup/jupiter/android/browser/repository/BrowserSiteClearanceWithAnExtraLongName.kt';
const commits = [{ sha: 'a'.repeat(40), title: 'First change', author: 'Alex', date: '2026-09-30T00:00:00Z' }, { sha: 'b'.repeat(40), title: 'Second change', author: 'Alex', date: '2026-09-30T01:00:00Z' }];
let reviewReady = false;
let startInput;
const notifications = [];
const notificationSockets = [];
await page.routeWebSocket(/\/api\//, socket => { if (socket.url().includes('/notifications/live')) notificationSockets.push(socket); });
await page.route('**/api/**', (route) => {
  const path = new URL(route.request().url()).pathname;
  const base = '/api/organizations/personal';
  if (path === `${base}/threads` && route.request().method() === 'POST') {
    startInput = route.request().postDataJSON();
    reviewReady = true;
    return route.fulfill({ status: 201, json: { id, computerId: 'computer', phase: 'ready' } });
  }
  if (path === `${base}/github/pull-request-files`) {
    const selected = new URL(route.request().url()).searchParams.getAll('commit');
    return route.fulfill({ json: { files: selected.length ? commits.filter(commit => selected.includes(commit.sha)).map(commit => ({ path: filePath, status: 'modified', additions: 1, deletions: 1, patch: `@@ -1 +1 @@\n-old\n+${commit.title}`, commitSha: commit.sha, commitTitle: commit.title })) : [{ path: filePath, status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+combined' }] } });
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
    [`${base}/github/pull-request-commits`]: { commits },
    [`${base}/github/pull-request`]: { pullRequest: { state: 'OPEN', isDraft: true, checks: pr.checks, reviewers: [] } },
    [`${base}/github/pull-request-activity`]: { userId: 'reader', viewer: 'reader', seenAt: null, items: [] },
    [`${base}/github/pull-request-images`]: { images: {} },
    [`${base}/reviews`]: { review: reviewReady ? { threadId: id, computerId: 'computer', repository: 'studio/remy', number: 42, headSha: 'a'.repeat(40), reviewedSha: null, findings: [], proposals: [], rulesApplied: 0 } : null },
    [`${base}/reviews/last`]: { last: null },
    [`${base}/computers/computer/threads/${id}`]: thread,
    [`${base}/notifications`]: { notifications, devices: [] },
    [`${base}/connections`]: { canManage: true, providers: [], connections: [] },
    [`${base}/hosted`]: { available: false, enabledProviders: [], cloudPlacements: [] },
  };
  return route.fulfill({ status: path in responses ? 200 : 404, json: responses[path] ?? { error: 'Not in this review scenario' } });
});
try {
  const tabActions = async (action) => {
    await page.getByRole('tab', { name: 'Review #42: Keep work in app tabs', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: action, exact: true }).click();
  };
  await page.goto(`${origin}/app/pull-requests/studio/remy/42`);
  const prPane = page.locator('section[aria-label="prs pane"]');
  await prPane.getByRole('tab', { name: 'Commits', exact: true }).click();
  await prPane.getByRole('checkbox', { name: 'Select commit aaaaaaa', exact: true }).check();
  await prPane.getByRole('button', { name: 'View files', exact: true }).click();
  await prPane.getByRole('button', { name: '1 commit', exact: true }).waitFor();
  await prPane.getByLabel('Diffs').getByText('First change', { exact: true }).waitFor();
  assert.equal(await prPane.getByLabel('Diffs').getByText('Second change', { exact: true }).count(), 0);
  await prPane.getByRole('button', { name: '1 commit', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select commit bbbbbbb', exact: true }).check();
  await page.keyboard.press('Escape');
  await prPane.getByRole('button', { name: '2 commits', exact: true }).waitFor();
  await prPane.getByLabel('Diffs').getByText('Second change', { exact: true }).waitFor();
  assert.equal(await prPane.locator('[data-slot="pull-request-file"]').count(), 2);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    await prPane.getByRole('button', { name: 'All commits', exact: true }).waitFor();
    await prPane.getByRole('tab', { name: 'Commits', exact: true }).click();
    await prPane.getByRole('checkbox', { name: 'Select commit aaaaaaa', exact: true }).check();
    await prPane.getByRole('checkbox', { name: 'Select commit bbbbbbb', exact: true }).check();
    await prPane.getByRole('button', { name: 'View files', exact: true }).click();
    const pickerBox = await prPane.getByRole('button', { name: '2 commits', exact: true }).boundingBox();
    await page.touchscreen.tap(pickerBox.x + pickerBox.width / 2, pickerBox.y + pickerBox.height / 2);
    const popup = page.locator('[data-slot="popover-content"]');
    await popup.waitFor({ state: "visible" });
    await popup.getByRole("checkbox", { name: "Select commit aaaaaaa", exact: true }).waitFor();
    assert.ok(await popup.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight && element.scrollWidth <= element.clientWidth; }), `Commit picker fits ${width}px phone`);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-slot="popover-content"]')].some(element => getComputedStyle(element).opacity === "1"));
    await popup.screenshot({ path: `${output}/commit-picker-${width}.png` });
    await page.keyboard.press('Escape');
    await popup.waitFor({ state: "hidden" });
    const fileButton = prPane.getByRole('button', { name: 'Show changed files', exact: true });
    const fileButtonBox = await fileButton.boundingBox();
    await page.touchscreen.tap(fileButtonBox.x + fileButtonBox.width / 2, fileButtonBox.y + fileButtonBox.height / 2);
    const filePopup = page.locator('[data-slot="popover-content"][aria-label="Changed files"]');
    await filePopup.waitFor({ state: 'visible' });
    assert.equal(await prPane.locator('aside[aria-label="Changed files"]').isVisible(), false, 'A narrow pane gives the diff its full width');
    await filePopup.getByRole('button', { name: `Open file ${filePath} at bbbbbbb`, exact: true }).click();
    await filePopup.waitFor({ state: 'hidden' });
    await prPane.locator('[data-file-index="1"]').waitFor();
    const header = prPane.locator('[data-slot="file-toolbar"]').nth(1);
    assert.ok(await header.evaluate(element => element.scrollWidth <= element.clientWidth), `The long file header fits ${width}px`);
    const focus = await prPane.locator('[data-file-index="1"]').evaluate(element => document.activeElement === element);
    assert.ok(focus, 'Choosing a file focuses its header after closing the overlay');
    await header.screenshot({ path: `${output}/file-header-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await prPane.getByRole('button', { name: '2 commits', exact: true }).click();
  await page.getByRole('button', { name: 'All commits', exact: true }).click();
  await page.keyboard.press('Escape');
  await prPane.getByText('combined', { exact: true }).waitFor();
  assert.equal(await prPane.locator('[data-slot="pull-request-file"]').count(), 1);
  await page.screenshot({ path: `${output}/all-commit-files.png` });
  await prPane.getByRole('tab', { name: 'Summary', exact: true }).click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    const phoneHeader = page.locator('section[aria-label="prs pane"] [data-slot="pane-header"]');
    await phoneHeader.getByRole('button', { name: 'Review with agent', exact: true }).waitFor();
    assert.ok(await phoneHeader.evaluate(element => element.scrollWidth <= element.clientWidth), `The header fits a ${width}px phone`);
    const trigger = await phoneHeader.getByRole('button', { name: 'Review with agent', exact: true }).boundingBox();
    await page.touchscreen.tap(trigger.x + trigger.width / 2, trigger.y + trigger.height / 2);
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    await cancel.waitFor();
    const cancelBox = await cancel.boundingBox();
    await page.touchscreen.tap(cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2);
    await cancel.waitFor({ state: 'hidden' });
    await phoneHeader.screenshot({ path: `${output}/phone-${width}-pr-header.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('tab', { name: 'Pull request #42', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Split left and right', exact: true }).click();
  await page.getByRole('separator', { name: 'Resize panes' }).press('Home');
  for (let step = 0; step < 16; step++) await page.getByRole('separator', { name: 'Resize panes' }).press('ArrowRight');
  const prHeader = page.locator('section[aria-label="prs pane"] [data-slot="pane-header"]');
  const crumb = await prHeader.getByRole('button', { name: 'Pull requests', exact: true }).boundingBox();
  const reviewButton = await prHeader.getByRole('button', { name: 'Review with agent', exact: true }).boundingBox();
  assert.ok(Math.abs(crumb.y + crumb.height / 2 - reviewButton.y - reviewButton.height / 2) < 2,
    'The compact header keeps breadcrumbs and actions in one aligned row');
  assert.equal(await prHeader.getByRole('button', { name: 'Remy', exact: true }).isVisible(), false,
    'The workspace shortcut does not crowd a narrow pane');
  assert.ok((await prHeader.boundingBox()).height <= 57, 'The compact split header remains one row');
  assert.ok(await prHeader.evaluate(element => element.scrollWidth <= element.clientWidth), 'The narrow header contains its content');
  await prHeader.screenshot({ path: `${output}/narrow-pr-header.png` });
  await page.getByRole('button', { name: 'Close New thread', exact: true }).click();
  await page.getByRole('tab', { name: 'Pull request #42', exact: true }).click();
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
  const splitHeaders = page.locator('[data-slot="split-tab-group"]');
  assert.equal(await splitHeaders.count(), 1, 'A split has one joined header group');
  assert.equal(await splitHeaders.getByRole('tab').count(), 2);
  assert.equal(await splitHeaders.getByRole('tab', { name: 'Pull request #42', exact: true }).count(), 1);
  assert.equal(await page.getByText('This thread is unavailable').count(), 0);
  await page.reload();
  await page.getByRole('tab', { name: 'Review #42: Keep work in app tabs', exact: true }).first().waitFor();
  assert.equal(await splitHeaders.getByRole('tab', { name: 'Review #42: Keep work in app tabs', exact: true }).count(), 1);
  await page.getByText('The new tabs keep your pull request and review thread visible together.').waitFor();
  const reviewPane = page.locator('section[aria-label="Thread pane"]:visible');
  assert.equal(await reviewPane.getByRole('tablist').count(), 0, 'A thread pane cannot contain another tab collection');
  assert.equal(await reviewPane.getByRole('button', { name: 'Back', exact: true }).count(), 0);
  assert.equal(await reviewPane.getByRole('button', { name: 'Add tab', exact: true }).count(), 0);
  assert.equal(await page.locator('section[aria-label="prs pane"]:visible').count(), 1);
  assert.equal(await page.locator('section[aria-label="Thread pane"]:visible').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Threads', exact: true }).first().getAttribute('data-active'), 'true');
  assert.match(new URL(page.url()).pathname, /\/threads\/11111111/);
  thread.detail.state = 'working';
  thread.detail.permissionMode = 'bypassPermissions';
  thread.detail.context = { tokens: 25000, limit: 100000, compactions: 0, droppedTokens: 0 };
  await page.reload();
  const toolbar = reviewPane.locator('[data-composer-toolbar]');
  const checkToolbar = async label => {
    await toolbar.getByRole('button', { name: 'Stop', exact: true }).waitFor();
    const layout = await toolbar.evaluate(element => {
      const box = element.getBoundingClientRect();
      const controls = [...element.querySelectorAll('button')].map(button => {
        const rect = button.getBoundingClientRect();
        return { name: button.getAttribute('aria-label'), left: rect.left, right: rect.right, center: rect.y + rect.height / 2 };
      });
      return { left: box.left, right: box.right, width: box.width, controls };
    });
    assert.ok(layout.controls.every(control => control.left >= layout.left && control.right <= layout.right + 1), `${label}: controls fit the toolbar ${JSON.stringify(layout)}`);
    if (layout.width >= 280) assert.ok(Math.max(...layout.controls.map(control => control.center)) - Math.min(...layout.controls.map(control => control.center)) < 2, `${label}: controls share one row`);
    const permission = toolbar.locator('[data-permission-picker]');
    const box = await permission.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByRole('option', { name: 'Auto', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await toolbar.getByRole('button', { name: 'Model', exact: true }).click();
    await page.getByRole('option').first().waitFor();
    await page.keyboard.press('Escape');
    await toolbar.screenshot({ path: `${output}/composer-${label}.png` });
  };
  await checkToolbar('split');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    await checkToolbar(`phone-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  thread.detail.state = 'idle';
  thread.detail.permissionMode = 'default';
  delete thread.detail.context;
  await page.reload();
  await reviewPane.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
  await reviewPane.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this draft while resizing.');
  const resize = async (ratio, horizontal) => {
    const handle = page.getByRole('separator', { name: 'Resize panes' });
    const box = await handle.boundingBox();
    const container = await handle.evaluate(element => {
      const box = element.parentElement.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(horizontal ? container.x + container.width * ratio : box.x + box.width / 2,
      horizontal ? box.y + box.height / 2 : container.y + container.height * ratio, { steps: 12 });
    await page.mouse.up();
    const panes = await page.locator('section[aria-label$="pane"]:visible').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }));
    const sizes = panes.map(box => horizontal ? box.width : box.height);
    assert.ok(Math.abs(sizes[0] / (sizes[0] + sizes[1]) - ratio) < 0.02, 'Dragging changes the actual pane ratio');
    assert.equal(await reviewPane.getByRole('textbox', { name: 'Message', exact: true }).inputValue(), 'Keep this draft while resizing.');
  };
  await resize(0.68, true);
  await tabActions('Split top and bottom');
  await resize(0.3, false);
  await page.reload();
  await page.getByText('The new tabs keep your pull request and review thread visible together.').waitFor();
  assert.equal(await page.getByRole('separator', { name: 'Resize panes' }).getAttribute('aria-valuenow'), '30');
  assert.equal(await page.getByRole('separator', { name: 'Resize panes' }).getAttribute('aria-orientation'), 'horizontal');
  await tabActions('Split left and right');
  await page.getByRole('separator', { name: 'Resize panes' }).press('End');
  await page.getByRole('separator', { name: 'Resize panes' }).press('ArrowLeft');
  assert.equal(await page.getByRole('separator', { name: 'Resize panes' }).getAttribute('aria-valuenow'), '93');
  await page.getByRole('separator', { name: 'Resize panes' }).dblclick();
  assert.equal(await page.getByRole('separator', { name: 'Resize panes' }).getAttribute('aria-valuenow'), '50');
  await reviewPane.getByRole('button', { name: 'Thread details', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Running work', exact: true }).click();
  await page.getByRole('dialog', { name: 'Running work', exact: true }).waitFor();
  await page.getByRole('dialog').press('Escape');
  for (let step = 0; step < 6; step++) await page.getByRole('separator', { name: 'Resize panes' }).press('ArrowRight');
  await page.screenshot({ path: `${output}/pr-review-split.png` });
  await page.reload();
  await page.getByRole('tab', { name: 'Review #42: Keep work in app tabs', exact: true }).first().waitFor();
  await page.getByText('The new tabs keep your pull request and review thread visible together.').waitFor();
  assert.equal(await page.locator('section[aria-label$="pane"]:visible').count(), 2);
  assert.equal(await page.getByRole('separator', { name: 'Resize panes' }).getAttribute('aria-valuenow'), '62');
  const lastTab = page.getByRole('tab', { name: 'Review #42: Keep work in app tabs', exact: true });
  const end = await lastTab.evaluate(element => element.parentElement.getBoundingClientRect().right);
  const plus = await page.getByRole('button', { name: 'New tab', exact: true }).boundingBox();
  assert.ok(Math.abs(plus.x - end) < 8, 'New tab sits immediately after the last tab');
  assert.equal(await page.getByRole('button', { name: /^(Split left and right|Split top and bottom|Unsplit)$/ }).count(), 0);
  await tabActions('Unsplit');
  assert.equal(await splitHeaders.count(), 0, 'Unsplit restores independent headers');
  assert.equal(await page.locator('section[aria-label$="pane"]:visible').count(), 1);
  assert.equal(await page.getByRole('separator', { name: 'Resize panes' }).count(), 0);
  assert.equal(await reviewPane.getByRole('tablist').count(), 0);
  const source = await page.getByRole('tab', { name: 'Pull request #42', exact: true }).boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height + 20, { steps: 5 });
  const drop = reviewPane.locator('[data-drop-side="left"]');
  await drop.waitFor();
  const target = await drop.boundingBox();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
  assert.equal(await page.locator('section[aria-label$="pane"]:visible').count(), 2, 'Dragging a header creates a split');
  assert.equal(await page.getByRole('separator', { name: 'Resize panes' }).count(), 1);
  assert.equal(await splitHeaders.getByRole('tab').count(), 2, 'Dragging joins the split headers');
  await lastTab.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Unsplit', exact: true }).waitFor();
  await page.getByRole('menu').press('Escape');
  await page.evaluate(() => {
    localStorage.removeItem('remy.app-tabs:v1');
    localStorage.setItem('remy:review-agent-pane', JSON.stringify({ 'studio/remy#42': true }));
  });
  await page.goto(`${origin}/app/pull-requests/studio/remy/42`);
  await page.waitForURL(/\/threads\/11111111/);
  assert.equal(await splitHeaders.getByRole('tab').count(), 2, 'An existing review opens in joined split tabs');
  assert.equal(await page.locator('section[aria-label="prs pane"]:visible').count(), 1);
  assert.equal(await page.locator('section[aria-label="Thread pane"]:visible').count(), 1);
  assert.equal(await page.getByRole('textbox', { name: 'Message the review agent', exact: true }).count(), 0, 'The legacy embedded agent is hidden');
  await page.screenshot({ path: `${output}/restored-review-split.png` });
  await page.getByRole('separator', { name: 'Resize panes' }).press('Home');
  assert.ok(await prHeader.evaluate(element => element.scrollWidth <= element.clientWidth), 'At the minimum split ratio the toolbar scrolls within the pane');
  for (let step = 0; step < 10; step++) await page.getByRole('separator', { name: 'Resize panes' }).press('ArrowRight');
  const tinyCrumb = await prHeader.getByRole('button', { name: 'Pull requests', exact: true }).boundingBox();
  const tinyReview = await prHeader.getByRole('button', { name: 'Review agent', exact: true }).boundingBox();
  assert.ok(tinyReview.y >= tinyCrumb.y + tinyCrumb.height, 'Very narrow panes intentionally use two rows');
  assert.ok(Math.abs(tinyReview.x - tinyCrumb.x) < 5, 'Both rows align to the leading edge');
  await prHeader.screenshot({ path: `${output}/tiny-pr-header.png` });
  assert.ok(await prHeader.evaluate(element => element.scrollWidth <= element.clientWidth), 'The narrow two-row header contains its controls');
  await page.getByRole('separator', { name: 'Resize panes' }).press('End');
  assert.equal(await prHeader.getByRole('button', { name: 'Remy', exact: true }).isVisible(), true, 'Wide panes restore the workspace shortcut');
  await page.getByRole('separator', { name: 'Resize panes' }).dblclick();
  const notify = async (threadId, title) => {
    notifications.push({ id: `notice-${notifications.length}`, threadId, title, message: 'Your thread has finished.', readAt: null, createdAt: new Date().toISOString() });
    const read = page.waitForResponse(response => new URL(response.url()).pathname === '/api/organizations/personal/notifications');
    for (const socket of notificationSockets) socket.send(JSON.stringify({ kind: 'notifications.changed' }));
    await read;
  };
  await notify(id, 'Focused thread finished');
  await notify('another-thread', 'Another thread finished');
  await page.getByText('Another thread finished', { exact: true }).waitFor();
  assert.equal(await page.getByText('Focused thread finished', { exact: true }).count(), 0, 'Focused threads do not toast');
  await page.getByRole('tab', { name: 'Pull request #42', exact: true }).click();
  await notify(id, 'Unfocused split thread finished');
  await page.getByText('Unfocused split thread finished', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Review #42: Keep work in app tabs', exact: true }).click();
  await page.getByText('Unfocused split thread finished', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: 'Sign in again', exact: true }).count(), 0);
  thread.detail.entries[1].text = 'Failed to authenticate: OAuth session expired and could not be refreshed';
  thread.detail.entries.push({ ...thread.detail.entries[1], id: 'auth-retry' });
  await page.reload();
  await page.getByRole('button', { name: 'Sign in again', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Sign in again', exact: true }).count(), 1, 'Only the latest failure offers sign-in recovery');
  await page.screenshot({ path: `${output}/thread-sign-in.png` });
  await page.getByRole('button', { name: 'Sign in again', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('device') === 'computer');
  assert.equal(await page.locator('section[aria-label="settings pane"]:visible').count(), 1, 'Authentication recovery opens computer settings');
  await prHeader.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open workspace', exact: true }).click();
  await page.waitForURL(/\/workspaces\/studio/);
  assert.deepEqual(errors, []);
  console.log('Review split QA passed: commit list, selected commit patches, all commits, phone picker, one tab strip, adjacent plus, context menu, header drag, PR left, review right, resizing, preserved draft, keyboard, saved ratio, thread details, sidebar focus and reload.');
} catch (error) {
  console.log('Failure state', page.url(), errors, (await page.locator('body').innerText()).slice(0, 2400));
  throw error;
} finally {
  await browser.close();
}
