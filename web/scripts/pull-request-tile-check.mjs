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

// GitHub's whole stack, merged bottom included, as the hub reads it.
const stackEntries = [
  { position: 1, number: 8944, title: "Move the rates call into its own module", state: "MERGED", isDraft: false },
  { position: 2, number: 8945, title: longTitle, state: "OPEN", isDraft: false },
  { position: 3, number: 8946, title: "Ship the stack middle", state: "OPEN", isDraft: false },
  { position: 4, number: 8947, title: "Ship the stack tip", state: "OPEN", isDraft: true },
];

function pullRequest(number, title, workspace, extra = {}) {
  return {
    url: `https://github.com/jupiter/mobile/pull/${number}`,
    number,
    title,
    repository: extra.repository ?? "jupiter/mobile",
    headRefName: extra.headRefName ?? "feature/android-1278",
    baseRefName: "main",
    isDraft: extra.isDraft ?? false,
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
              isDraft: true,
              stack: { number: 12, position: 4, size: 4, baseRefName: "main", entries: stackEntries },
              updatedAt: "2026-09-25T03:00:00.000Z",
            }),
            pullRequest(8946, "Ship the stack middle", jupiter, {
              stack: { number: 12, position: 3, size: 4, baseRefName: "main", entries: stackEntries },
              updatedAt: "2026-09-25T02:00:00.000Z",
            }),
            pullRequest(8945, longTitle, jupiter, {
              stack: { number: 12, position: 2, size: 4, baseRefName: "main", entries: stackEntries },
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
      [`${base}/github/pull-request-activity`]: {
        userId: "reader",
        viewer: "reader",
        seenAt: null,
        items: [{
          kind: "comment",
          id: "comment-1",
          at: "2026-09-25T00:30:00.000Z",
          author: { login: "grace", name: "Grace", avatarUrl: null },
          body: "<!-- CURSOR_AGENT_PR_BODY_BEGIN -->\nPlease check **details**.\n\n```\nmake test\n```",
          url: null,
          thread: null,
        }],
      },
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
  // A stack names its workspace once, above its rows.
  const stackHeader = stack.locator("[data-slot='pull-request-stack-header']");
  assert.equal(await stack.locator("[data-slot='pull-request-stack-rows'][role='list']").count(), 1);
  assert.equal(await stack.locator("[role='listitem']").count(), 3);
  assert.equal(await stackHeader.getByText("Merge from the bottom up into main", { exact: true }).count(), 1);
  assert.equal(await fileTile.locator("[data-slot='pull-request-stack-position']").textContent(), "2 of 4");
  // Status stays in the coloured icon, with an accessible label.
  const statusOf = async (tile) => {
    const icon = tile.locator("svg[data-status]").first();
    return { kind: await icon.getAttribute("data-status"), color: await icon.evaluate((node) => getComputedStyle(node).color), label: await icon.getAttribute("aria-label") };
  };
  const failing = await statusOf(fileTile);
  const draftTile = stack.locator("[data-slot='pull-request-tile']").filter({ hasText: "Ship the stack tip" });
  const draft = await statusOf(draftTile);
  const ready = await statusOf(stack.locator("[data-slot='pull-request-tile']").filter({ hasText: "Ship the stack middle" }));
  assert.deepEqual([failing.kind, failing.label], ["checks-failing", "Checks failing"]);
  assert.deepEqual([draft.kind, draft.label], ["draft", "Draft"]);
  assert.deepEqual([ready.kind, ready.label], ["ready", "Ready to merge"]);
  assert.equal(new Set([failing.color, draft.color, ready.color]).size, 3, "Failing, draft and ready are three colours");
  const folderRow = page.locator("[data-slot='pull-request-tile']").filter({ hasText: "Keep the default folder mark" });
  assert.equal(await folderRow.locator("svg[data-status]").getAttribute("aria-label"), "Ready to merge");
  assert.equal(await page.locator("[data-slot='pull-request-status']").count(), 0, "List rows have no visible status text");
  assert.equal(await stack.locator("[data-slot='pull-request-stack-position']").first().textContent(), "4 of 4");
  assert.equal(await fileTile.locator("[data-slot='workspace-icon']").count(), 0, "A stack row leaves the workspace to the header");
  const folderTile = page.locator("[data-slot='pull-request-tile']").filter({ hasText: "Keep the default folder mark" });
  await fileTile.waitFor();
  await folderTile.waitFor();
  assert.equal(await stackHeader.locator("svg.lucide-folder").count(), 0, "A set workspace icon does not flash the folder mark");
  assert.equal(await stackHeader.locator("img[data-slot='workspace-icon']").count(), 0, "The set icon waits on the image cache");
  assert.equal(await stackHeader.locator("span[data-slot='workspace-icon']").count(), 1, "The well stays empty until the set icon loads");
  assert.equal(await folderTile.locator("svg.lucide-folder").count(), 1, "A folder workspace still shows the folder glyph");
  if (artifacts) await stack.screenshot({ path: `${artifacts}/pr-tile-icon-pending.png` });

  holdImages = false;
  releaseImages();
  await stackHeader.locator("img[data-slot='workspace-icon']").waitFor();
  assert.equal(await stackHeader.locator("svg.lucide-folder").count(), 0);
  assert.equal(await stackHeader.locator("img[data-slot='workspace-icon']").count(), 1);
  const loadsAfterFirst = imageLoads;
  if (artifacts) {
    await stack.screenshot({ path: `${artifacts}/pr-tile-icon-loaded.png` });
    await page.screenshot({ path: `${artifacts}/pr-stack-list.png` });
    await page.screenshot({ path: `${artifacts}/pr-tile-icon-titles.png` });
  }

  const metrics = await fileTile.evaluate((row) => {
    const title = row.querySelector("[data-slot='pull-request-title']");
    const checks = row.querySelector("[data-slot='pull-request-tile-checks']");
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
  const review = page.locator("[data-slot='pull-request-tile']").first();
  assert.equal(await review.locator("svg[data-status]").getAttribute("data-status"), "your-review");
  assert.equal(await review.locator("svg[data-status]").getAttribute("aria-label"), "Your review");
  // Arrows move and select together, so the keyboard switches the list.
  await page.keyboard.press("ArrowLeft");
  assert.equal(await filter.getByRole("tab", { selected: true }).getByText(/^Yours/).count(), 1, "ArrowLeft selects Yours");
  assert.equal(await filter.getByRole("tab", { selected: true }).evaluate((tab) => tab === document.activeElement), true);
  await fileTile.waitFor();

  await fileTile.getByRole("button").first().click();
  await page.locator("[data-slot='pull-request-description']").waitFor();
  // The Summary artboard (4AN-0) heads the body with Description; the body keeps its own headings under it.
  assert.equal(await page.locator("[data-slot='pull-request-description']").getByRole("heading", { name: "Description", exact: true }).count(), 1, "The body sits under one Description heading");
  assert.equal(await page.locator("[data-slot='pane-header']").count(), 1, "The open pull request uses the shared pane header");
  const github = page.locator("[data-slot='pane-header']").getByRole("link", { name: "Open on GitHub", exact: true });
  assert.equal(await github.count(), 1);
  assert.equal(((await github.textContent()) ?? "").trim(), "", "Open on GitHub is the mark alone");
  await github.hover();
  await page.locator("[data-slot='tooltip-content']").filter({ hasText: "Open on GitHub" }).waitFor();
  assert.equal(await page.getByRole("tab", { name: "Summary", selected: true }).count(), 1);
  assert.equal(await page.getByText("CURSOR_AGENT_PR_BODY", { exact: false }).count(), 0, "GitHub comment markers stay off the description");
  assert.equal(await page.getByText("<!--", { exact: false }).count(), 0);
  await page.getByRole("heading", { name: "What", exact: true }).waitFor();
  await page.locator("pre").filter({ hasText: "adb reverse" }).waitFor();
  await page.getByText("Notes", { exact: true }).waitFor();
  assert.equal(await page.getByText("<details>", { exact: false }).count(), 0);
  assert.equal(await page.getByText("<summary>", { exact: false }).count(), 0);
  // Comments live on Activity now, not under the description.
  assert.equal(await page.getByText("Please check").count(), 0);

  // The summary's stack: bottom first, the open one marked, the rest one step away.
  const detailStack = page.getByRole("region", { name: "Stack #12", exact: true });
  await detailStack.waitFor();
  assert.equal(await detailStack.getByText("2 of 4 · merge in order", { exact: true }).count(), 1);
  const members = detailStack.locator("[data-slot='pull-request-stack-entry']");
  assert.equal(await members.count(), 4);
  assert.match((await members.nth(0).textContent()) ?? "", /^#8944.*Merged$/);
  assert.equal(await members.nth(1).getAttribute("aria-current"), "true", "The open pull request is marked");
  assert.match((await members.nth(1).textContent()) ?? "", /You are here$/);
  assert.equal(await members.nth(0).evaluate((node) => node.tagName), "A", "A member Remy does not have opens on GitHub");
  assert.equal(await members.nth(0).getAttribute("href"), "https://github.com/jupiter/mobile/pull/8944");
  assert.equal(await members.nth(2).evaluate((node) => node.tagName), "BUTTON", "A member Remy has opens here");
  assert.match((await members.nth(3).textContent()) ?? "", /Draft$/);
  if (artifacts) await detailStack.screenshot({ path: `${artifacts}/pr-open-stack.png` });
  await members.nth(2).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/pull-requests\/jupiter\/mobile\/8946$/);
  await page.getByRole("region", { name: "Stack #12", exact: true }).locator("[data-slot='pull-request-stack-entry'][aria-current='true']").filter({ hasText: "#8946" }).waitFor();
  await page.goBack();
  await page.waitForURL(/\/pull-requests\/jupiter\/mobile\/8945$/);

  // The rail's Checks (4AN-0): failing first, then running, passing and skipped, with a passed count.
  const checks = page.getByRole("region", { name: "Checks", exact: true });
  await checks.waitFor();
  assert.equal(await checks.getByRole("heading", { name: "Checks", exact: true }).count(), 1);
  assert.equal(await checks.getByText("2/4", { exact: true }).count(), 1);
  const checkRows = checks.locator("li");
  assert.equal(await checkRows.count(), 4);
  assert.match((await checkRows.nth(0).textContent()) ?? "", /^Maestro E2E/, "A failing check comes first");
  assert.equal(await checkRows.nth(0).getByLabel("Failed", { exact: true }).count(), 1);
  assert.match((await checkRows.nth(1).textContent()) ?? "", /^Unit/, "A running check comes next");
  if (artifacts) await page.screenshot({ path: `${artifacts}/pr-open-markdown-checks.png` });

  // The diff is a route of its own, arrives on first open, and Back leaves it.
  await page.getByRole("tab", { name: /^Files/ }).click();
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
  await page.getByRole("tab", { name: "Summary", selected: true }).waitFor();

  // Comments are on Activity, drawn as markdown with GitHub's markers dropped.
  await page.getByRole("tab", { name: /^Activity/ }).click();
  await page.waitForURL(/\/pull-requests\/jupiter\/mobile\/8945\/activity$/);
  await page.getByText("Please check").waitFor();
  assert.equal(await page.locator("strong").filter({ hasText: "details" }).count(), 1);
  await page.locator("pre").filter({ hasText: "make test" }).waitFor();
  assert.equal(await page.getByText("CURSOR_AGENT_PR_BODY", { exact: false }).count(), 0, "GitHub comment markers stay off comments");
  await page.goBack();
  await page.getByRole("tab", { name: "Summary", selected: true }).waitFor();

  await page.locator("[data-slot='pane-header']").getByRole("button", { name: "Pull requests", exact: true }).click();
  await fileTile.waitFor();

  await page.getByRole("button", { name: "Threads", exact: true }).click();
  await page.getByRole("heading", { name: "Threads", exact: true }).or(page.getByRole("form", { name: "New thread", exact: true })).waitFor();
  holdImages = true;
  await page.getByRole("button", { name: "Pull requests", exact: true }).click();
  await fileTile.waitFor();
  assert.equal(await stackHeader.locator("img[data-slot='workspace-icon']").count(), 1, "A cached set icon paints on the first frame");
  assert.equal(await stackHeader.locator("svg.lucide-folder").count(), 0, "Returning to the list does not flash the folder mark");
  assert.equal(imageLoads, loadsAfterFirst, "A cached workspace image is not fetched again");
  if (artifacts) await stack.screenshot({ path: `${artifacts}/pr-tile-icon-cached.png` });

  // Last, because a load starts the page over: a reload lands back on the files.
  await page.goto(new URL(`${appPrefix}/pull-requests/jupiter/mobile/8945/files`, origin).href);
  await page.locator("[data-slot='pull-request-file']").first().waitFor();
  assert.equal(await page.getByRole("tab", { name: /^Files/, selected: true }).count(), 1, "A reload lands back on the files");
} finally {
  await browser.close();
}
