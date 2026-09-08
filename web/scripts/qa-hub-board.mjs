import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";
import { readFileSync, mkdirSync } from "node:fs";
const info = JSON.parse(readFileSync(process.env.QA_SESSION, "utf8"));
const base = process.env.QA_WEB_URL;
const out = process.env.QA_ARTIFACTS ?? "/tmp/remy-pr-artifacts/wrk-12";
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
await initial.close();
const a = await context("ada", true);
const page = await a.newPage();
const local = async (path, method = "GET", body) => page.evaluate(async ({ path, method, body }) => {
  const response = await fetch("/api/server/hub/board" + path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}, { path, method, body });
try {
  await page.goto(settings);
  await page.getByRole("button", { name: "Synchronize Tasks", exact: true }).click();
  await page.getByRole("alertdialog").waitFor();
  assert.equal(await page.getByRole("checkbox", { name: /Also share/ }).isChecked(), false);
  await page.keyboard.press("Escape");
  assert.equal((await local("")).body.enabled, false);
  await page.getByRole("button", { name: "Synchronize Tasks", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Synchronize Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Stop synchronizing Tasks" }).waitFor();
  assert.equal((await local("")).body.imported, false);
  assert.equal((await local("/tickets")).body.items.length, 0);
  assert.equal((await api("grace", `/computers/${office.computerId}/board-access`, "PUT")).status, 404);
  assert.equal((await api("ada", "/computers/board-sync", "POST", { version: {}, events: [] })).status, 403);
  const ticket = crypto.randomUUID();
  assert.equal((await api("ada", "/board/events", "POST", { entity: "ticket", entityId: ticket, kind: "create", payload: { title: "Prepare next release", number: 1 } })).status, 201);
  await until(async () => (await local("/tickets")).body.items.some((t) => t.id === ticket), "Live update did not reach the computer");
  await page.screenshot({ path: `${out}/sync-enabled.png` });
  // Disable the replica to simulate a sleeping computer while the hub keeps accepting work.
  await page.getByRole("button", { name: "Stop synchronizing Tasks" }).click();
  const sleepingTicket = crypto.randomUUID();
  await api("ada", "/board/events", "POST", { entity: "ticket", entityId: sleepingTicket, kind: "create", payload: { title: "Ready when you wake", number: 2 } });
  assert.equal((await local("/tickets")).body.items.some((t) => t.id === sleepingTicket), false);
  await page.getByRole("button", { name: "Synchronize Tasks", exact: true }).click();
  await page.getByRole("checkbox", { name: /Also share/ }).check();
  await page.screenshot({ path: `${out}/import-consent.png` });
  await page.getByRole("alertdialog").getByRole("button", { name: "Synchronize Tasks", exact: true }).click();
  await until(async () => (await local("/tickets")).body.items.some((t) => t.id === sleepingTicket), "Wake did not catch up");
  assert.equal((await local("")).body.imported, true);
  const imported = (await local("/tickets")).body.items.length;
  await local("", "PUT", { enabled: true, importExisting: true });
  assert.equal((await local("/tickets")).body.items.length, imported);
  const localTicket = crypto.randomUUID();
  await local("/events", "POST", { entity: "ticket", entityId: localTicket, kind: "create", payload: { title: "Created from this computer" } });
  await until(async () => (await api("ada", "/board/tickets")).body.items.some((t) => t.id === localTicket), "Local update did not reach the hub");
  await api("ada", "/board/events", "POST", { entity: "ticket", entityId: ticket, kind: "link", payload: { chatId: info.threadId, computerId: info.computerId } });
  await until(async () => (await local("/tickets")).body.items.find((t) => t.id === ticket)?.fields.threads?.[0]?.computerId === info.computerId, "Thread lost its computer");
  await page.reload();
  await page.getByRole("button", { name: "Stop synchronizing Tasks" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  await until(async () => page.locator('[aria-label="Organization computers"]').evaluate((e) => e.clientWidth >= 300 && e.scrollWidth <= e.clientWidth), "Narrow layout overflowed");
  await page.screenshot({ path: `${out}/narrow.png` });
  console.log("PASS: consent, import-once, private isolation, live convergence, wake catch-up, computer links, reload, narrow layout and grant boundaries");
} finally {
  await local("", "PUT", { enabled: false });
  await a.close(); await browser.close();
}
console.log(`VIDEO=${await page.video().path()}`);
