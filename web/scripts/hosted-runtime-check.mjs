import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";

const url = new URL("/app/", process.env.WEBSITE_URL || "http://127.0.0.1:5180");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (process.platform === "darwin" ? chromiumPath() : chromium.executablePath()) });
const artifacts = process.env.QA_ARTIFACTS;
if (artifacts) mkdirSync(artifacts, { recursive: true });
const personal = { id: "personal", name: "Personal", personal: true, role: "owner" };
const team = { id: "team", name: "Studio", personal: false, role: "owner" };
try {
  for (const returning of [false, true]) {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 850 }, isMobile: mobile, hasTouch: mobile });
      if (returning) await context.addInitScript(() => localStorage.setItem("remy.warm-cache", JSON.stringify({
        version: 1, at: Date.now(),
        servers: [{ id: "local", name: "Build Mac", url: "/api", local: true, online: true }],
        chats: [], dms: [], workspaces: [], agents: [], projects: [], details: [],
      })));
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const errors = [], unexpected = [], requests = [];
      let available = true;
      page.on("pageerror", error => errors.push(error.message));
      await page.routeWebSocket(/\/api\//, () => {});
      await page.route("**/api/**", route => {
        const path = new URL(route.request().url()).pathname;
        requests.push(path);
        const org = path.startsWith("/api/organizations/team") ? team : personal;
        const base = `/api/organizations/${org.id}`;
        const responses = {
          "/api/runtime": { mode: "hub", auth: { google: true } },
          "/api/profile": { id: "reader", name: "Reader" },
          "/api/personal": { personal },
          "/api/organizations": { organizations: [team] },
          [base]: { organization: org },
          [`${base}/threads`]: { threads: [], cursor: 0, member: { id: "reader", role: "owner" } },
          [`${base}/computers`]: { computers: [] },
          [`${base}/computers/options`]: { role: "owner", members: [], teams: [] },
          [`${base}/hosted`]: { settings: { enabled: false, provider: "fly-sprites", region: "", cpu: 1, memoryMiB: 2048, maxComputers: 5, idleMinutes: 12 }, secretNames: [], available },
          [`${base}/workspaces`]: { workspaces: [], canManage: true },
          [`${base}/notifications`]: { notifications: [], devices: [] },
          [`${base}/environments`]: { environments: [], assignments: [], workspaces: [] },
        };
        if (!(path in responses)) unexpected.push(path);
        return route.fulfill({ status: path in responses ? 200 : 404, json: responses[path] ?? { error: "Not found" } });
      });
      for (const org of [personal, team]) {
        const target = new URL(url);
        target.hash = `/threads?organization=${org.id}`;
        await page.goto(target.href);
        await page.getByText("Add your first workspace", { exact: true }).waitFor();
        await page.getByRole("heading", { name: "Threads", exact: true }).waitFor();
        if (artifacts && returning && mobile && org.personal) await page.screenshot({ path: `${artifacts}/threads-phone.png` });
        assert.equal(await page.locator("main header").count(), 1, "Threads has one title bar");
        assert.equal(await page.locator("main").getByRole("button", { name: "Notifications", exact: true }).count(), 0);
        await page.getByRole("button", { name: "Set up a computer" }).click();
        await page.getByText("Cloud execution", { exact: true }).waitFor();
        target.hash = `/settings/devices?organization=${org.id}`;
        await page.goto(target.href);
        for (const reload of [false, true]) {
          if (reload) await page.reload();
          await page.getByText("Cloud execution", { exact: true }).waitFor();
          await page.getByLabel("Hosted workspace").waitFor();
          assert.equal(await page.getByRole("button", { name: "Attach this Mac", exact: true }).count(), 0);
          if (mobile) await page.getByRole("button", { name: "Toggle Sidebar" }).click();
          await page.getByRole("button", { name: "Notifications", exact: true }).click();
          await page.getByRole("dialog").waitFor();
          await page.keyboard.press("Escape");
          await page.getByLabel("Hosted workspace").click();
          await page.getByRole("option", { name: org.personal ? "Personal defaults" : "Organization defaults" }).click();
          if (artifacts && returning && mobile && org.personal) await page.screenshot({ path: `${artifacts}/computers-phone.png` });
          assert.ok(await page.locator("section[aria-label=Computers]").evaluate(e => e.scrollWidth <= e.clientWidth), "Computers must fit the phone viewport");
        }
        available = false;
        await page.reload();
        await page.getByRole("button", { name: "Check availability again" }).waitFor();
        available = true;
        await page.getByRole("button", { name: "Check availability again" }).click();
        await page.getByLabel("Hosted workspace").waitFor();
        if (mobile) await page.getByRole("button", { name: "Toggle Sidebar" }).click();
        await page.getByRole("button", { name: "Threads", exact: true }).click();
        await page.getByText("Add your first workspace", { exact: true }).waitFor();
        if (mobile) await page.locator('[data-mobile="true"]').waitFor({ state: "hidden" });
        target.hash = `/settings/environments?organization=${org.id}`;
        await page.goto(target.href);
        await page.getByText("Define values once", { exact: false }).waitFor();
        assert.ok(requests.includes(`/api/organizations/${org.id}/environments`));
      }
      assert.deepEqual(unexpected, [], "Hosted navigation must not request local APIs or unknown endpoints");
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`Hosted runtime passed: ${returning ? "saved local state" : "fresh profile"}, ${mobile ? "touch phone" : "desktop"}.`);
    }
  }
} finally {
  await browser.close();
}
