import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";

const url = new URL("/app/", process.env.WEBSITE_URL || "http://127.0.0.1:5180");
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
      ? [workspace("repo", "Example", "https://github.com/example/repo")]
      : [];
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

  await page.goto(new URL("/app/workspaces", url).href);
  const loading = page.getByRole("status", { name: "Loading workspaces", exact: true });
  await loading.waitFor();
  assert.equal(await page.getByRole("status", { name: "Loading", exact: true }).count(), 0, "First open does not show a spinner");
  assert.ok(await loading.locator("[data-slot='item']").count() >= 3, "First open shows workspace tile skeletons");
  releaseWorkspaces();
  holdWorkspaces = false;
  await page.getByText("Studio · https://github.com/example/repo", { exact: true }).waitFor();
  await loading.waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("status", { name: "Loading workspaces", exact: true }).count(), 0);

  await page.getByRole("button", { name: "Threads", exact: true }).click();
  await page.getByRole("region", { name: "Threads", exact: true }).waitFor();
  holdWorkspaces = true;
  const blocked = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/workspaces") && !/\/workspaces\/[^/]+$/.test(path)) blocked.push(path);
  });
  await page.getByRole("button", { name: "Workspaces", exact: true }).click();
  await page.getByText("Studio · https://github.com/example/repo", { exact: true }).waitFor();
  assert.equal(await page.getByRole("status", { name: "Loading workspaces", exact: true }).count(), 0, "Revisit does not shimmer");
  assert.equal(await page.getByRole("status", { name: "Loading", exact: true }).count(), 0, "Revisit does not spin");
  assert.deepEqual(blocked, [], "Revisit paints the last save without waiting on a new catalogue");

  console.log("Workspaces load: first-open skeletons, revisit from last save.");
  await context.close();
} finally {
  await browser.close();
}
