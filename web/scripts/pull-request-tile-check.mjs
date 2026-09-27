import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";

const origin = process.env.WEBSITE_URL || "http://127.0.0.1:5180";
const appPrefix = process.env.WEBSITE_APP_PREFIX ?? (new URL(origin).port === "5180" ? "/app" : "");
const artifacts = process.env.QA_ARTIFACTS;
if (artifacts) mkdirSync(artifacts, { recursive: true });
const png = readFileSync(new URL("../public/favicon.png", import.meta.url)).toString("base64");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (process.platform === "darwin" ? chromiumPath() : executablePathFallback()),
});

function executablePathFallback() {
  return chromium.executablePath();
}

const longTitle = "[ANDROID-1278] Restore checkout after a failed cloud start and keep the thread on Jupiter Mobile";
const markedBody = `<!-- CURSOR_AGENT_PR_BODY_BEGIN -->
## What

Restore checkout after a failed cloud start.

\`\`\`
adb reverse tcp:8081 tcp:8081
\`\`\`

<details>
<summary>Notes</summary>
Keep the thread on the same computer.
</details>
<!-- CURSOR_AGENT_PR_BODY_END -->`;

function pullRequest(number, title, workspace, extra = {}) {
  return {
    url: `https://github.com/jupiter/mobile/pull/${number}`,
    number,
    title,
    repository: extra.repository ?? "jupiter/mobile",
    headRefName: extra.headRefName ?? "feature/android-1278",
    baseRefName: "main",
    isDraft: false,
    reviewDecision: extra.reviewDecision ?? "APPROVED",
    updatedAt: extra.updatedAt ?? "2026-09-25T00:00:00.000Z",
    additions: 18,
    deletions: 4,
    body: extra.body ?? "",
    checks: extra.checks ?? [{ name: "ci", state: "pass" }],
    comments: extra.comments ?? [],
    unreadComments: [],
    hasUnreadActivity: false,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaceIcon: workspace.icon,
    workspaceTint: workspace.tint,
    workspacePath: "/repo",
    worktreePath: extra.worktreePath === undefined ? "hosted" : extra.worktreePath,
    stack: extra.stack ?? null,
  };
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const personal = { id: "personal", name: "Personal", personal: true, role: "owner" };
  const team = { id: "team", name: "Studio", personal: false, role: "owner" };
  const jupiter = { id: "jupiter", organizationId: "team", name: "Jupiter Mobile", origin: "https://github.com/jupiter/mobile", icon: "icon.png", tint: "orange" };
  const remy = { id: "remy", organizationId: "team", name: "remy", origin: "https://github.com/padamchopra/remy", icon: "folder", tint: "zinc" };
  let releaseImages;
  let holdImages = true;
  const imageRead = new Promise((resolve) => { releaseImages = resolve; });
  let imageLoads = 0;
  await page.routeWebSocket(/\/api\//, () => {});
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const org = path.includes("/organizations/personal") ? personal : team;
    const base = `/api/organizations/${org.id}`;
    if (path === `${base}/github/workspace-images` && url.searchParams.get("path")) {
      imageLoads += 1;
      if (holdImages) await imageRead;
      return route.fulfill({ json: { mime: "image/png", data: png } });
    }
    const responses = {
      "/api/runtime": { mode: "hub", auth: {} },
      "/api/profile": { id: "reader", name: "Reader" },
      "/api/personal": { personal },
      "/api/organizations": { organizations: [team] },
      [base]: { organization: org },
      [`${base}/threads`]: { threads: [], cursor: 0, member: { id: "reader", role: "owner" } },
      [`${base}/computers`]: { computers: [] },
      [`${base}/members`]: { members: [] },
      [`${base}/teams`]: { teams: [] },
      [`${base}/workspaces`]: {
        workspaces: org.id === "team" ? [jupiter, remy] : [],
        canManage: true,
      },
      [`${base}/github/pull-requests`]: {
        pullRequests: org.id === "team"
          ? [
            pullRequest(8947, "Ship the stack tip", jupiter, {
              stack: { number: 12, position: 3, size: 3, baseRefName: "main" },
              updatedAt: "2026-09-25T03:00:00.000Z",
            }),
            pullRequest(8946, "Ship the stack middle", jupiter, {
              stack: { number: 12, position: 2, size: 3, baseRefName: "main" },
              updatedAt: "2026-09-25T02:00:00.000Z",
            }),
            pullRequest(8945, longTitle, jupiter, {
              stack: { number: 12, position: 1, size: 3, baseRefName: "main" },
              body: markedBody,
              comments: [{
                author: "grace",
                body: "<!-- CURSOR_AGENT_PR_BODY_BEGIN -->\nPlease check **details**.\n\n```\nmake test\n```",
              }],
              checks: [
                { name: "Maestro E2E", state: "fail" },
                { name: "Android - Dev APK", state: "pass" },
                { name: "Unit", state: "pending" },
                { name: "Lint", state: "skipping" },
              ],
              updatedAt: "2026-09-25T01:00:00.000Z",
            }),
            pullRequest(12, "Keep the default folder mark", remy),
            pullRequest(88, "Please review the wallet sheet", jupiter, {
              reviewDecision: "REVIEW_REQUIRED",
              worktreePath: null,
              repository: "jupiter/mobile",
              updatedAt: "2026-09-24T00:00:00.000Z",
            }),
          ]
          : [],
      },
      [`${base}/github/pull-request-files`]: {
        files: [
          { path: "src/checkout.ts", status: "modified", additions: 2, deletions: 1, patch: "@@ -1,2 +1,3 @@\n import x\n-old()\n+restore()\n+keep()" },
          { path: "assets/logo.png", status: "added", additions: 0, deletions: 0 },
        ],
        truncated: false,
        patchesOmitted: false,
      },
      [`${base}/github/workspace-images`]: { images: [], truncated: false },
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

  await page.goto(new URL(`${appPrefix}/pull-requests`, origin).href);
  await page.locator("[data-slot='pane-header']").waitFor();
  const filter = page.getByLabel("Filter pull requests", { exact: true });
  assert.equal(await filter.count(), 1);
  assert.equal(await filter.getByText(/^Yours/).count(), 1);
  assert.equal(await filter.getByText(/^Review requested/).count(), 1);
  assert.equal(await filter.getByText(/Needs you/).count(), 0);
  assert.equal(await filter.getByText(/^All$/).count(), 0);
  assert.equal(await filter.getAttribute("role"), "tablist", "The filter is one segmented control");
  assert.equal(await filter.getByRole("tab", { selected: true }).getByText(/^Yours/).count(), 1, "Yours is selected by default");
  const filterBox = await filter.boundingBox();
  const searchBox = await page.locator("[data-slot='input-group']").filter({ has: page.getByLabel("Search pull requests") }).boundingBox();
  assert.equal(Math.round(filterBox.height), Math.round(searchBox.height), "The filter is as tall as the search field");

  const stack = page.locator("[data-slot='pull-request-stack']");
  await stack.waitFor();
  assert.equal(await stack.getByText("Stack #12", { exact: true }).count(), 1);
  assert.equal(await stack.locator("[data-slot='pull-request-tile']").count(), 3);
  const fileTile = stack.locator("[data-slot='pull-request-tile']").filter({ hasText: "[ANDROID-1278]" });
  const folderTile = page.locator("[data-slot='pull-request-tile']").filter({ hasText: "Keep the default folder mark" });
  await fileTile.waitFor();
  await folderTile.waitFor();
  assert.equal(await fileTile.locator("svg.lucide-folder").count(), 0, "A set workspace icon does not flash the folder mark");
  assert.equal(await fileTile.locator("img[data-slot='workspace-icon']").count(), 0, "The set icon waits on the image cache");
  assert.equal(await fileTile.locator("span[data-slot='workspace-icon']").count(), 1, "The well stays empty until the set icon loads");
  assert.equal(await folderTile.locator("svg.lucide-folder").count(), 1, "A folder workspace still shows the folder glyph");
  if (artifacts) await fileTile.screenshot({ path: `${artifacts}/pr-tile-icon-pending.png` });

  holdImages = false;
  releaseImages();
  await fileTile.locator("img[data-slot='workspace-icon']").waitFor();
  assert.equal(await fileTile.locator("svg.lucide-folder").count(), 0);
  assert.equal(await fileTile.locator("img[data-slot='workspace-icon']").count(), 1);
  const loadsAfterFirst = imageLoads;
  if (artifacts) {
    await fileTile.screenshot({ path: `${artifacts}/pr-tile-icon-loaded.png` });
    await page.screenshot({ path: `${artifacts}/pr-stack-list.png` });
    await page.screenshot({ path: `${artifacts}/pr-tile-icon-titles.png` });
  }

  const metrics = await fileTile.evaluate((row) => {
    const title = row.querySelector("[data-slot='pull-request-title']");
    const checks = row.lastElementChild?.previousElementSibling?.previousElementSibling;
    if (!(title instanceof HTMLElement) || !(checks instanceof HTMLElement)) {
      return { titleWidth: 0, titleRight: 0, checksLeft: 0, unused: Infinity, truncated: false, text: "" };
    }
    const titleBox = title.getBoundingClientRect();
    const checksBox = checks.getBoundingClientRect();
    return {
      titleWidth: titleBox.width,
      titleRight: titleBox.right,
      checksLeft: checksBox.left,
      unused: checksBox.left - titleBox.right,
      truncated: title.scrollWidth > title.clientWidth + 1,
      text: title.textContent ?? "",
    };
  });
  assert.equal(metrics.text, longTitle);
  assert.ok(metrics.titleWidth > 280, "The title uses the remaining row instead of a narrow column");
  assert.ok(metrics.unused >= 8 && metrics.unused <= 24, `Title should meet the trailing columns; unused=${metrics.unused}`);

  await filter.getByText(/^Review requested/).click();
  await page.getByText("Please review the wallet sheet").waitFor();
  assert.equal(await page.locator("[data-slot='pull-request-tile']").count(), 1);
  // Arrows move and select together, so the keyboard switches the list.
  await page.keyboard.press("ArrowLeft");
  assert.equal(await filter.getByRole("tab", { selected: true }).getByText(/^Yours/).count(), 1, "ArrowLeft selects Yours");
  assert.equal(await filter.getByRole("tab", { selected: true }).evaluate((tab) => tab === document.activeElement), true);
  await fileTile.waitFor();

  await fileTile.getByRole("button").first().click();
  await page.locator("[data-slot='pull-request-description']").waitFor();
  assert.equal(await page.getByRole("heading", { name: "Description", exact: true }).count(), 0, "The body's own headings are the only ones");
  assert.equal(await page.locator("[data-slot='pane-header']").count(), 1, "The open pull request uses the shared pane header");
  const github = page.locator("[data-slot='pane-header']").getByRole("link", { name: "Open on GitHub", exact: true });
  assert.equal(await github.count(), 1);
  assert.equal(((await github.textContent()) ?? "").trim(), "", "Open on GitHub is the mark alone");
  await github.hover();
  await page.locator("[data-slot='tooltip-content']").filter({ hasText: "Open on GitHub" }).waitFor();
  assert.equal(await page.getByRole("tab", { name: "Overview", selected: true }).count(), 1);
  assert.equal(await page.getByText("CURSOR_AGENT_PR_BODY", { exact: false }).count(), 0, "GitHub comment markers stay off the description");
  assert.equal(await page.getByText("<!--", { exact: false }).count(), 0);
  await page.getByRole("heading", { name: "What", exact: true }).waitFor();
  await page.locator("pre").filter({ hasText: "adb reverse" }).waitFor();
  await page.getByText("Notes", { exact: true }).waitFor();
  assert.equal(await page.getByText("<details>", { exact: false }).count(), 0);
  assert.equal(await page.getByText("<summary>", { exact: false }).count(), 0);
  await page.getByRole("heading", { name: /^Comments/ }).waitFor();
  await page.getByText("Please check").waitFor();
  assert.equal(await page.locator("strong").filter({ hasText: "details" }).count(), 1);
  await page.locator("pre").filter({ hasText: "make test" }).waitFor();

  const checks = page.locator("[data-slot='pull-request-checks']");
  await checks.waitFor();
  assert.equal(await checks.getByRole("heading", { name: "Checks", exact: true }).count(), 1);
  assert.equal(await checks.getByText("CHECKS", { exact: true }).count(), 0);
  assert.equal(await checks.getByText("2 failing", { exact: false }).count() + await checks.getByText("1 failing", { exact: false }).count(), 1);
  assert.equal(await checks.locator("[data-slot='pull-request-check-group'][data-check-state='fail']").count(), 1);
  assert.equal(await checks.locator("[data-slot='pull-request-check-group'][data-check-state='pending']").count(), 1);
  assert.equal(await checks.locator("[data-slot='pull-request-check-group'][data-check-state='pass']").count(), 1);
  assert.equal(await checks.locator("[data-slot='pull-request-check'][data-check-state='fail']").getByText("Maestro E2E").count(), 1);
  if (artifacts) await page.screenshot({ path: `${artifacts}/pr-open-markdown-checks.png` });

  // The diff is a route of its own, arrives on first open, and Back leaves it.
  await page.getByRole("tab", { name: /Files changed/ }).click();
  await page.waitForURL(/\/pull-requests\/jupiter\/mobile\/8945\/files$/);
  const file = page.locator("[data-slot='pull-request-file']").first();
  await file.waitFor();
  assert.equal(await page.locator("[data-slot='pull-request-file']").count(), 2);
  await file.getByText("restore()", { exact: false }).waitFor();
  await page.getByText("GitHub has no text diff for this file.").waitFor();
  await page.keyboard.press("j");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-file-index")), "1", "j moves to the next file");
  await page.keyboard.press("k");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-file-index")), "0", "k moves back");
  if (artifacts) await page.screenshot({ path: `${artifacts}/pr-open-files.png` });
  await page.goBack();
  await page.getByRole("tab", { name: "Overview", selected: true }).waitFor();

  await page.locator("[data-slot='pane-header']").getByRole("button", { name: "Pull requests", exact: true }).click();
  await fileTile.waitFor();

  await page.getByRole("button", { name: "Threads", exact: true }).click();
  await page.getByRole("heading", { name: "Threads", exact: true }).or(page.getByRole("form", { name: "New thread", exact: true })).waitFor();
  holdImages = true;
  await page.getByRole("button", { name: "Pull requests", exact: true }).click();
  await fileTile.waitFor();
  assert.equal(await fileTile.locator("img[data-slot='workspace-icon']").count(), 1, "A cached set icon paints on the first frame");
  assert.equal(await fileTile.locator("svg.lucide-folder").count(), 0, "Returning to the list does not flash the folder mark");
  assert.equal(imageLoads, loadsAfterFirst, "A cached workspace image is not fetched again");
  if (artifacts) await fileTile.screenshot({ path: `${artifacts}/pr-tile-icon-cached.png` });

  // Last, because a load starts the page over: a reload lands back on the files.
  await page.goto(new URL(`${appPrefix}/pull-requests/jupiter/mobile/8945/files`, origin).href);
  await page.locator("[data-slot='pull-request-file']").first().waitFor();
  assert.equal(await page.getByRole("tab", { name: /Files changed/, selected: true }).count(), 1, "A reload lands back on the files");
} finally {
  await browser.close();
}
