import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";

const origin = process.env.WEBSITE_URL || "http://127.0.0.1:5180";
const appPrefix = process.env.WEBSITE_APP_PREFIX ?? (new URL(origin).port === "5180" ? "/app" : "");
const url = new URL(`${appPrefix}/`, origin);
const artifacts = process.env.QA_ARTIFACTS;
if (artifacts) mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (process.platform === "darwin" ? chromiumPath() : chromium.executablePath()),
});

function workspace(id, name, origin) {
  return { id, organizationId: "team", name, origin, restricted: false, icon: "folder", tint: "zinc", createdAt: 1, updatedAt: 1 };
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const personal = { id: "personal", name: "Personal", personal: true, role: "owner" };
  const team = { id: "team", name: "Studio", personal: false, role: "owner" };
  let releaseWorkspaces;
  let holdWorkspaces = true;
  const workspaceRead = new Promise((resolve) => { releaseWorkspaces = resolve; });
  await page.routeWebSocket(/\/api\//, () => {});
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const list = path.endsWith("/workspaces") && !/\/workspaces\/[^/]+$/.test(path);
    if (holdWorkspaces && list) await workspaceRead;
    const org = path.includes("/organizations/personal") ? personal : team;
    const base = `/api/organizations/${org.id}`;
    const workspaces = org.id === "team"
      ? [workspace("repo", "Example", "https://github.com/example/repo"), workspace("zed", "Zed", "https://git.sr.ht/~studio/zed")]
      : [];
    // Zed's thread is newer than any, so Zed leads the list despite its name.
    const threads = org.id === "team" ? [{
      id: "zed-thread", computerId: "cloud", revision: 1, stale: false, observedAt: Date.now(),
      access: { organizationId: "team", owner: { id: "reader", name: "Reader" }, participants: [], visibility: "private" },
      detail: { id: "zed-thread", title: "Tidy the build", state: "idle", entries: [], workspaceId: "zed", updatedAt: Date.now() - 4 * 3600_000 },
    }] : [];
    const responses = {
      "/api/runtime": { mode: "hub", auth: {} },
      "/api/profile": { id: "reader", name: "Reader" },
      "/api/personal": { personal },
      "/api/organizations": { organizations: [team] },
      [base]: { organization: org },
      [`${base}/threads`]: { threads, cursor: 0, member: { id: "reader", role: "owner" } },
      [`${base}/computers`]: { computers: [] },
      [`${base}/members`]: { members: [] },
      [`${base}/teams`]: { teams: [] },
      [`${base}/workspaces`]: { workspaces, canManage: true },
      [`${base}/notifications`]: { notifications: [], devices: [] },
      [`${base}/hosted`]: { available: false, enabledProviders: [] },
      [`${base}/connections`]: { canManage: true, providers: [], connections: [] },
      [`${base}/model-access`]: { providers: [] },
      [`${base}/model-favorites`]: { favorites: [] },
      [`${base}/profile-preferences`]: { preferences: {} },
    };
    return route.fulfill({
      status: path in responses ? 200 : 404,
      json: responses[path] ?? { error: "Unexpected request" },
    });
  });

  await page.goto(new URL(`${appPrefix}/workspaces`, origin).href);
  const loading = page.getByRole("status", { name: "Loading workspaces", exact: true });
  await loading.waitFor();
  assert.equal(await page.getByRole("status", { name: "Loading", exact: true }).count(), 0, "First open does not show a spinner");
  assert.ok(await loading.locator("[data-slot='item']").count() >= 3, "First open shows workspace row skeletons");
  const skeletonRow = await loading.locator("[data-slot='item']").first().evaluate((row) => row.getBoundingClientRect().height);
  assert.equal(skeletonRow, 52, "Skeleton rows are the height of real rows");
  if (artifacts) await page.screenshot({ path: `${artifacts}/workspaces-load-first-open.png` });
  releaseWorkspaces();
  holdWorkspaces = false;
  const list = page.locator('section[aria-label="Workspaces"] [data-slot="item-group"]');
  const example = page.getByRole("button", { name: "Open Example", exact: true });
  await example.waitFor();
  await loading.waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("status", { name: "Loading workspaces", exact: true }).count(), 0);
  assert.equal(await page.locator('[data-slot="pane-header"]').getByRole("button", { name: "Add workspace", exact: true }).count(), 1, "Add workspace sits in the pane header");
  const rows = list.locator('[data-slot="item"]');
  assert.deepEqual(await rows.evaluateAll((items) => items.map((item) => item.querySelector("span.truncate")?.textContent)), ["Zed", "Example"], "The newest thread leads");
  const zed = rows.filter({ hasText: "Zed" });
  assert.equal(await zed.getByText("git.sr.ht/~studio/zed", { exact: true }).count(), 1, "Another host shows host/path");
  assert.equal(await rows.filter({ hasText: "Example" }).getByText("example/repo", { exact: true }).count(), 1, "GitHub shows owner/repo");
  assert.equal(await zed.getByText("4h", { exact: true }).count(), 1, "The row says when its last thread moved");
  assert.equal(await zed.getByText("Studio", { exact: true }).count(), 1, "All names each row's owner");
  assert.equal(await page.getByText("2 workspaces", { exact: true }).count(), 1, "The count sits beside the search");
  const shape = await zed.evaluate((row) => ({ height: row.getBoundingClientRect().height, mark: row.querySelector('[data-slot="workspace-mark"]')?.getBoundingClientRect().width }));
  assert.deepEqual(shape, { height: 52, mark: 28 }, "Rows are 52px with a 28px mark");
  assert.equal(await page.locator("[data-slot='item'] [data-slot='badge']").count(), 0, "The list names no computers");

  const search = page.getByRole("searchbox", { name: "Search workspaces", exact: true });
  await page.locator("body").press("/");
  assert.ok(await search.evaluate((input) => input === document.activeElement), "/ focuses the search");
  await page.keyboard.type("repo");
  assert.equal(await rows.count(), 1, "Search matches the repository");
  await search.fill("studio");
  assert.equal(await rows.count(), 2, "Search matches the owner");
  await search.fill("chainkt");
  await page.getByText("No workspaces match “chainkt”", { exact: true }).waitFor();
  if (artifacts) await page.screenshot({ path: `${artifacts}/workspaces-no-match.png` });
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  assert.equal(await rows.count(), 2, "Clear search brings the rows back");
  await search.fill("zed");
  await search.press("Escape");
  assert.equal(await search.inputValue(), "", "Esc clears the search");
  assert.equal(await rows.count(), 2);

  await page.mouse.move(0, 0);
  const newThread = zed.getByRole("button", { name: "New thread", exact: true });
  assert.equal(await newThread.evaluate((button) => getComputedStyle(button).opacity), "0", "New thread waits for hover");
  await zed.hover({ position: { x: 20, y: 20 } });
  await page.waitForFunction((row) => getComputedStyle(row.querySelector('button[aria-label="New thread"]')).opacity === "1", await zed.elementHandle(), { timeout: 2000 });
  await newThread.hover();
  await page.getByRole("tooltip").or(page.locator('[data-slot="tooltip-content"]')).getByText("New thread", { exact: true }).waitFor();
  if (artifacts) await page.screenshot({ path: `${artifacts}/workspaces-load-populated.png` });
  const pane = await page.locator("main, [data-slot='sidebar-inset']").first().evaluate((node) => node.scrollWidth - node.clientWidth);
  assert.ok(pane <= 0, "The list does not scroll sideways");

  await page.getByRole("button", { name: "Threads", exact: true }).click();
  await page.getByRole("region", { name: "Threads", exact: true }).waitFor();
  holdWorkspaces = true;
  const blocked = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/workspaces") && !/\/workspaces\/[^/]+$/.test(path)) blocked.push(path);
  });
  await page.getByRole("button", { name: "Workspaces", exact: true }).click();
  await example.waitFor();
  assert.equal(await page.getByRole("status", { name: "Loading workspaces", exact: true }).count(), 0, "Revisit does not shimmer");
  assert.equal(await page.getByRole("status", { name: "Loading", exact: true }).count(), 0, "Revisit does not spin");
  assert.deepEqual(blocked, [], "Revisit paints the last save without waiting on a new catalogue");
  if (artifacts) await page.screenshot({ path: `${artifacts}/workspaces-load-revisit.png` });

  // New thread opens the composer on that row's workspace, not the default one.
  await zed.hover();
  await zed.getByRole("button", { name: "New thread", exact: true }).click();
  await page.waitForURL(/\/threads$/);
  const composerWorkspace = page.getByRole("button", { name: "Thread workspace", exact: true });
  await composerWorkspace.waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="Thread workspace"]')?.textContent?.includes("Zed"), null, { timeout: 4000 });
  if (artifacts) await page.screenshot({ path: `${artifacts}/workspaces-new-thread.png` });
  await page.getByRole("button", { name: "Workspaces", exact: true }).click();
  await example.waitFor();

  await page.setViewportSize({ width: 375, height: 812 });
  await example.waitFor();
  const phone = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(phone <= 0, "A phone does not scroll sideways");
  const phoneRow = await rows.first().evaluate((row) => row.scrollWidth - row.clientWidth);
  assert.ok(phoneRow <= 0, "A phone row fits its width");
  if (artifacts) await page.screenshot({ path: `${artifacts}/workspaces-phone.png` });

  console.log("Workspaces list: first-open skeletons, rows by last thread, search, hover action, revisit from last save, phone width.");
  await context.close();
} finally {
  await browser.close();
}
