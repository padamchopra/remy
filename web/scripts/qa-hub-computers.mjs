import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";
import { readFileSync, mkdirSync } from "node:fs";
const info = JSON.parse(readFileSync(process.env.QA_SESSION, "utf8"));
const base = process.env.QA_WEB_URL;
const out = process.env.QA_ARTIFACTS ?? "/tmp/remy-pr-artifacts/wrk-11";
mkdirSync(out, { recursive: true });
const org = `/api/organizations/${info.organizationId}`;
const api = async (member, suffix, method = "GET", body) => {
  const response = await fetch(info.hubUrl + org + suffix, {
    method,
    headers: {
      authorization: `Bearer ${info.tokens[member]}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => null),
  };
};
const until = async (condition, message) => {
  for (let i = 0; i < 160; i++) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(message);
};
await api("ada", `/computers/${info.computerId}`, "PATCH", {
  name: "Studio",
  access: { mode: "owner", userIds: [], teamIds: [] },
});
const studio = (await api("ada", "/computers")).body.computers.find(
  (c) => c.computerId === info.computerId,
);
const started = await api(
  "ada",
  `/computers/${info.computerId}/threads`,
  "POST",
  {
    workspaceId: studio.capabilities.workspaces[0].id,
    title: "Prepare the release notes",
    visibility: "open",
  },
);
assert.equal(started.status, 201);
info.threadId = started.body.id;
const browser = await chromium.launch({ executablePath: chromiumPath() });
const context = async (member, record = false) => {
  const c = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: "dark",
    ...(record
      ? { recordVideo: { dir: out, size: { width: 1280, height: 900 } } }
      : {}),
  });
  await c.route("**/api/server/identity", async (route) => {
    const response = await route.fetch();
    const identity = await response.json();
    if (identity.tailnetHost) identity.tailnetHost = "office.example.test";
    await route.fulfill({ response, json: identity });
  });
  await c.route("**/api/tailnet", async (route) => {
    const response = await route.fetch();
    const result = await response.json();
    result.devices = (result.devices ?? []).map((device, index) => ({ ...device, name: `Build computer ${index + 1}`, hostname: `build-${index + 1}.example.test`, host: `build-${index + 1}.example.test`, url: `https://build-${index + 1}.example.test` }));
    await route.fulfill({ response, json: result });
  });
  await c.addCookies([
    {
      name: "remy_session",
      value: info.tokens[member],
      url: base,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await c.addInitScript(() =>
    localStorage.setItem(
      "remy.provider-update-dismissals.v1",
      JSON.stringify(["claude:2.1.263"]),
    ),
  );
  return c;
};
const settings = `${base}/#/settings/devices?organization=${info.organizationId}`;
const threadRoute = `${base}/#/threads/${info.threadId}?organization=${info.organizationId}&computer=${info.computerId}`;
const initial = await context("ada");
const setup = await initial.newPage();
await setup.goto(settings);
await setup.waitForSelector('[aria-label="Organization computers"]');
await setup.evaluate(async () => {
  const r = await fetch("/api/server/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceName: "Office Mac mini",
      deviceIcon: "server",
    }),
  });
  if (!r.ok) throw Error("Could not name QA computer");
});
// Authorization codes are deliberately outside the reviewer recording.
if (
  await setup
    .getByRole("button", { name: "Attach this Mac", exact: true })
    .count()
) {
  await setup
    .getByRole("button", { name: "Attach this Mac", exact: true })
    .click();
  await setup.getByLabel("Organization address").fill(info.hubUrl);
  await setup.getByLabel("Computer owner", { exact: true }).click();
  await setup
    .getByRole("option", { name: "Your organization", exact: true })
    .click();
  await setup.getByRole("button", { name: "Continue", exact: true }).click();
  await setup
    .getByRole("button", { name: "Approve computer", exact: true })
    .click();
  await setup
    .getByRole("button", { name: "Detach this Mac", exact: true })
    .waitFor();
}
const registered = await api("ada", "/computers");
const office = registered.body.computers.find(
  (c) => c.computerId !== info.computerId,
);
assert.ok(office);
assert.equal(office.ownerUserId, null);
assert.equal(office.access.mode, "organization");
assert.equal(office.name, "Office Mac mini");
assert.equal(office.icon, "server");
await until(
  async () =>
    (await api("grace", "/computers")).body.computers.some(
      (c) =>
        c.computerId === office.computerId && c.availability === "available",
    ),
  "Office computer did not connect",
);
const officeWorkspace = office.capabilities.workspaces[0].id;
assert.equal(
  (
    await api("grace", `/computers/${office.computerId}/threads`, "POST", {
      workspaceId: officeWorkspace,
      title: "Check the office release",
    })
  ).status,
  201,
);
await initial.close();
const a = await context("ada", true);
const page = await a.newPage();
const g = await context("grace");
const teammate = await g.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
teammate.on("pageerror", (e) => errors.push(e.message));
await api("ada", `/computers/${info.computerId}`, "PATCH", {
  access: { mode: "owner", userIds: [], teamIds: [] },
});
try {
  await page.goto(settings);
  await teammate.goto(threadRoute);
  await teammate
    .getByText("This thread is unavailable", { exact: true })
    .waitFor();
  assert.equal(
    (
      await api("grace", `/computers/${info.computerId}/threads`, "POST", {
        title: "Denied",
      })
    ).status,
    404,
  );
  const card = page.locator(`[data-computer-id="${info.computerId}"]`);
  await card.getByRole("button", { name: "Edit computer" }).click();
  await page.getByLabel("Who can use this computer", { exact: true }).click();
  await page
    .getByRole("option", { name: "Selected members and teams", exact: true })
    .click();
  await page.getByLabel("Grace", { exact: true }).check();
  await page.getByLabel("Computer icon", { exact: true }).click();
  await page.getByRole("option", { name: "Monitor", exact: true }).click();
  await page.getByLabel("Computer icon", { exact: true }).click();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Save computer", exact: true })
    .click();
  await teammate.getByText("Started by Ada", { exact: true }).waitFor();
  const available = (await api("grace", "/computers")).body.computers.find(
    (c) => c.computerId === info.computerId,
  );
  assert.ok(available);
  assert.equal(
    (
      await api("grace", `/computers/${info.computerId}/threads`, "POST", {
        workspaceId: available.capabilities.workspaces[0].id,
        title: "Review the release checklist",
      })
    ).status,
    201,
  );
  await teammate
    .getByRole("button", { name: "Join thread", exact: true })
    .click();
  await teammate
    .getByPlaceholder("Write a message…")
    .fill("Ask for approval before continuing.");
  await teammate
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await card
    .getByRole("button", { name: /Prepare the release notes/ })
    .waitFor();
  await page.screenshot({ path: out + "/computers.png" });
  await card.getByRole("button", { name: /Prepare the release notes/ }).click();
  await page.getByText("Started by Ada", { exact: true }).waitFor();
  await page.screenshot({ path: out + "/attribution.png" });
  await fetch(info.controlUrl + `/notify?threadId=${info.threadId}`, {
    method: "POST",
    headers: { authorization: `Bearer ${info.controlToken}` },
  });
  await until(
    async () =>
      (await api("grace", "/notifications")).body.notifications.some(
        (n) => n.title === "Release notes need you",
      ),
    "Addressed notification missing",
  );
  await teammate.getByRole("button", { name: /^Notifications/ }).click();
  await teammate
    .getByRole("dialog")
    .getByText("Release notes need you", { exact: true })
    .waitFor();
  await teammate.waitForTimeout(250);
  await teammate.screenshot({
    path: out + "/notifications.png",
    animations: "disabled",
  });
  await teammate.getByLabel("Show alerts in this window").uncheck();
  await teammate.getByLabel("Show alerts in this window").check();
  await teammate.keyboard.press("Escape");
  await page.goto(settings);
  await card.getByRole("button", { name: "Edit computer" }).click();
  await page.getByLabel("Who can use this computer", { exact: true }).click();
  await page.getByRole("option", { name: "Only me", exact: true }).click();
  await page
    .getByRole("button", { name: "Save computer", exact: true })
    .click();
  await teammate
    .getByText("This thread is unavailable", { exact: true })
    .waitFor();
  assert.equal(
    (await api("grace", "/notifications")).body.notifications.length,
    0,
  );
  await card.getByRole("button", { name: "Edit computer" }).click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Studio release computer with a deliberately long readable name");
  await page.getByLabel("Who can use this computer", { exact: true }).click();
  await page
    .getByRole("option", { name: "Everyone in your organization", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save computer", exact: true })
    .click();
  await teammate.getByText("Started by Ada", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + "/mobile.png" });
  assert.ok(
    await page
      .locator('[aria-label="Organization computers"]')
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await card.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.ok(
    (await api("ada", "/computers")).body.computers.some(
      (c) => c.computerId === info.computerId,
    ),
  );
  const team = await api("ada", "/teams", "POST", {
    name: "Release reviewers",
  });
  assert.equal(team.status, 201);
  const teamId = team.body.id;
  await page.reload();
  await card.getByRole("button", { name: "Edit computer" }).click();
  await page.getByLabel("Who can use this computer", { exact: true }).click();
  await page
    .getByRole("option", { name: "Selected members and teams", exact: true })
    .click();
  await page.getByLabel("Grace", { exact: true }).uncheck();
  await page.getByLabel("Release reviewers", { exact: true }).check();
  await page
    .getByRole("button", { name: "Save computer", exact: true })
    .click();
  await teammate
    .getByText("This thread is unavailable", { exact: true })
    .waitFor();
  assert.equal(
    (await api("ada", `/teams/${teamId}/members/grace`, "PUT")).status,
    204,
  );
  await teammate.getByText("Started by Ada", { exact: true }).waitFor();
  assert.equal(
    (await api("ada", `/teams/${teamId}/members/grace`, "DELETE")).status,
    204,
  );
  await teammate
    .getByText("This thread is unavailable", { exact: true })
    .waitFor();
  await api("ada", `/teams/${teamId}/members/grace`, "PUT");
  await teammate.getByText("Started by Ada", { exact: true }).waitFor();
  await fetch(info.controlUrl + "/disconnect", {
    method: "POST",
    headers: { authorization: `Bearer ${info.controlToken}` },
  });
  await teammate
    .getByText(
      "This computer is offline; you’re reading its last saved update.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    (
      await api(
        "grace",
        `/computers/${info.computerId}/threads/${info.threadId}/message`,
        "POST",
        { text: "Offline write" },
      )
    ).status,
    503,
  );
  await fetch(info.controlUrl + "/reconnect", {
    method: "POST",
    headers: { authorization: `Bearer ${info.controlToken}` },
  });
  await until(
    async () =>
      !(
        await api(
          "grace",
          `/computers/${info.computerId}/threads/${info.threadId}`,
        )
      ).body.stale,
    "Thread did not reconnect",
  );
  await fetch(info.controlUrl + "/reset", {
    method: "POST",
    headers: { authorization: `Bearer ${info.controlToken}` },
  });
  await until(
    async () =>
      (await api("grace", "/computers")).body.computers.some(
        (c) =>
          c.computerId === info.computerId && c.availability === "available",
      ),
    "Computer did not survive coordinator restart",
  );
  await teammate.reload();
  await teammate.getByText("Started by Ada", { exact: true }).waitFor();
  const push = await api("grace", "/notifications/devices", "POST", {
    token: "a".repeat(64),
    environment: "sandbox",
    name: "Grace’s iPhone",
  });
  assert.equal(push.status, 201);
  await teammate.getByRole("button", { name: /^Notifications/ }).click();
  await teammate.getByLabel("Grace’s iPhone", { exact: true }).uncheck();
  await until(
    async () =>
      (await api("grace", "/notifications/devices")).body.devices[0]
        ?.enabled === 0,
    "Phone preference did not persist",
  );
  await teammate.getByLabel("Grace’s iPhone", { exact: true }).check();
  await teammate
    .getByRole("dialog")
    .getByRole("button", { name: "Open thread", exact: true })
    .first()
    .click();
  await teammate.getByText("Started by Ada", { exact: true }).waitFor();
  await card.getByRole("button", { name: "Remove", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove computer", exact: true })
    .click();
  await teammate
    .getByText("This thread is unavailable", { exact: true })
    .waitFor();
  const localThread = await fetch(
    info.controlUrl + `/local-thread?threadId=${info.threadId}`,
    {
      headers: { authorization: `Bearer ${info.controlToken}` },
    },
  ).then((r) => r.json());
  assert.equal(localThread.exists, true);
  assert.equal(localThread.state, "needs_input");
  await page
    .getByRole("button", { name: "Detach this Mac", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove computer", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Attach this Mac", exact: true })
    .waitFor();
  assert.equal((await api("ada", "/computers")).body.computers.length, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, officeId: office.computerId }));
} catch (error) {
  await page.screenshot({ path: out + "/failure.png" });
  await teammate.screenshot({ path: out + "/failure-teammate.png" });
  console.error("Teammate page:", await teammate.locator("body").innerText());
  console.error("Visible page:", await page.locator("body").innerText());
  throw error;
} finally {
  const video = page.video();
  await a.close();
  await g.close();
  await browser.close();
  console.log(JSON.stringify({ video: await video.path() }));
}
