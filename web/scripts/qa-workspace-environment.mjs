// Drives a workspace's environment on the disposable hub: Ada and Grace add
// Workspace and Personal values, each sees only what they should, and a
// fixture thread proves which values reach whose threads.
//   QA_HUB_WEB=1 QA_COMPUTER_POLICY=1 node hub/scripts/qa-threads.mjs
//   QA_SESSION=<file> QA_WEB_URL=<hub URL> node web/scripts/qa-workspace-environment.mjs
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";

const info = JSON.parse(readFileSync(process.env.QA_SESSION, "utf8"));
const web = process.env.QA_WEB_URL ?? info.hubUrl;
const out = process.env.QA_ARTIFACTS ?? "/tmp/remy-pr-artifacts/workspace-environments";
mkdirSync(out, { recursive: true });
const org = `${info.hubUrl}/api/organizations/${info.organizationId}`;
const call = async (path, method = "GET", body, user = "ada") => {
  const response = await fetch(org + path, {
    method,
    headers: { authorization: `Bearer ${info.tokens[user]}`, "content-type": "application/json", origin: info.hubUrl },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
};
const saveProfile = async (body, user = "ada") => {
  const response = await fetch(`${info.hubUrl}/api/profile`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${info.tokens[user]}`, "content-type": "application/json", origin: info.hubUrl },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, await response.text());
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Values reach a thread through the hub workspace with the computer's origin.
const created = await call("/workspaces", "POST", { name: "Release notes", origin: "https://example.test/studio/release.git" });
assert.equal(created.status, 201, JSON.stringify(created.body));
const workspace = created.body;
const path = `/workspaces/${workspace.id}/environment`;
const route = `${web}/#/workspaces/${workspace.id}?organization=${info.organizationId}`;
const browser = await chromium.launch({ executablePath: chromiumPath() });
const open = async (user, viewport = { width: 1280, height: 900 }) => {
  const context = await browser.newContext({ viewport, colorScheme: "dark" });
  await context.addCookies([{ name: "remy_session", value: info.tokens[user], url: web, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return { context, page, errors };
};
try {
  await saveProfile({ image: "https://github.com/octocat.png" });
  const ada = await open("ada");
  const { page } = ada;
  await page.goto(route);
  await page.getByText("No values yet", { exact: true }).waitFor();
  await page.mouse.move(4, 4);
  await page.screenshot({ path: `${out}/empty.png` });

  // The dialog: a pasted .env fills rows, each row picks its kind and scope.
  await page.getByRole("button", { name: "Add values", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Add values to Release notes", { exact: true }).waitFor();
  await dialog.getByLabel("Key 1", { exact: true }).focus();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text", "# sample\nDATABASE_URL=postgres://sample.test/release\nLOG_LEVEL=debug\n");
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await dialog.getByLabel("Key 2", { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel("Key 1", { exact: true }).inputValue(), "DATABASE_URL");
  assert.equal(await dialog.getByLabel("Value 2", { exact: true }).inputValue(), "debug");
  await dialog.getByRole("group", { name: "Kind 1" }).getByRole("button", { name: "Secret", exact: true }).click();
  assert.equal(await dialog.getByLabel("Value 1", { exact: true }).getAttribute("type"), "password");
  await dialog.getByRole("button", { name: "Add value", exact: true }).click();
  await dialog.getByLabel("Key 3", { exact: true }).fill("OPENAI_API_KEY");
  await dialog.getByLabel("Value 3", { exact: true }).fill("sample-personal-key");
  await dialog.getByRole("group", { name: "Kind 3" }).getByRole("button", { name: "Secret", exact: true }).click();
  await dialog.getByRole("group", { name: "Scope 3" }).getByRole("button", { name: "Personal", exact: true }).click();
  await dialog.getByRole("button", { name: "Add value", exact: true }).click();
  await dialog.getByLabel("Key 4", { exact: true }).fill("LOG_LEVEL");
  await dialog.getByLabel("Value 4", { exact: true }).fill("trace");
  await dialog.getByRole("group", { name: "Scope 4" }).getByRole("button", { name: "Personal", exact: true }).click();
  await page.mouse.move(4, 4);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/dialog.png` });
  await dialog.getByRole("button", { name: "Add values", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByText("OPENAI_API_KEY", { exact: true }).waitFor();
  await page.locator('[role="listitem"]', { hasText: "OPENAI_API_KEY" }).locator("img").waitFor();

  // Grace adds a Workspace value from her own session; Ada's view refreshes.
  const graceAdd = await call(path, "POST", { values: [{ key: "SENTRY_DSN", value: "https://sample@sentry.test/1", kind: "variable", scope: "workspace" }] }, "grace");
  assert.equal(graceAdd.status, 200, JSON.stringify(graceAdd.body));
  await page.getByText("SENTRY_DSN", { exact: true }).waitFor();

  const adaView = (await call(path)).body.values;
  assert.deepEqual(adaView.map((value) => `${value.scope}:${value.key}`), ["workspace:DATABASE_URL", "workspace:LOG_LEVEL", "personal:OPENAI_API_KEY", "personal:LOG_LEVEL", "workspace:SENTRY_DSN"]);
  assert.equal(adaView.find((value) => value.scope === "personal" && value.key === "LOG_LEVEL").overridden, true);
  const graceView = (await call(path, "GET", undefined, "grace")).body.values;
  assert.deepEqual(graceView.map((value) => value.key), ["DATABASE_URL", "LOG_LEVEL", "SENTRY_DSN"]);
  for (const view of [adaView, graceView]) {
    assert.ok(!JSON.stringify(view).includes("postgres://sample.test"), "a secret never reaches a browser");
    assert.ok(!JSON.stringify(view).includes("sample-personal-key"), "a secret never reaches a browser");
  }
  const strike = page.locator('[role="listitem"]', { hasText: "trace" }).locator(".line-through");
  assert.equal(await strike.count(), 1, "the overridden Personal value is struck through");
  await page.locator('[role="listitem"]', { hasText: "LOG_LEVEL" }).first().hover();
  await page.getByRole("button", { name: "Remove LOG_LEVEL" }).first().waitFor();
  await page.locator("[data-sonner-toast]").first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/values-hover.png` });

  // Grace cannot remove Ada's Personal value, and the Remove control is Ada's alone.
  const adaPersonal = adaView.find((value) => value.key === "OPENAI_API_KEY");
  assert.equal((await call(`${path}/${adaPersonal.id}`, "DELETE", undefined, "grace")).status, 404);
  assert.equal(graceView.every((value) => value.removable), true);

  // Delivery: each person's thread in this workspace gets the Workspace values
  // and only their own Personal ones, with the Workspace value winning.
  const computers = (await call("/computers")).body.computers;
  const computer = computers.find((entry) => entry.computerId === info.computerId);
  const local = computer.capabilities.workspaces[0].id;
  await call(`/computers/${info.computerId}`, "PATCH", { access: { mode: "organization", userIds: [], teamIds: [] } });
  const ask = async (user) => {
    const thread = (await call(`/computers/${info.computerId}/threads`, "POST", { workspaceId: local, title: "Check the environment", visibility: "private" }, user)).body;
    assert.ok(thread.id, JSON.stringify(thread));
    const sent = await call(`/computers/${info.computerId}/threads/${thread.id}/message`, "POST", { text: "Which values reach this thread: LOG_LEVEL=? DATABASE_URL OPENAI_API_KEY SENTRY_DSN=?", messageId: `u-${crypto.randomUUID()}` }, user);
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    for (let attempt = 0; attempt < 150; attempt++) {
      const entries = (await call(`/computers/${info.computerId}/threads/${thread.id}`, "GET", undefined, user)).body.detail?.entries ?? [];
      const reply = entries.find((entry) => entry.kind === "assistant" && /SENTRY_DSN=/.test(entry.text ?? ""));
      if (reply && /sentry\.test\/1$/.test(reply.text)) return { thread, reply: reply.text };
      await wait(100);
    }
    throw Error(`${user}'s thread never answered`);
  };
  const adaThread = await ask("ada");
  assert.equal(adaThread.reply, "LOG_LEVEL=debug, DATABASE_URL is set, OPENAI_API_KEY is set, SENTRY_DSN=https://sample@sentry.test/1");
  const graceThread = await ask("grace");
  assert.equal(graceThread.reply, "LOG_LEVEL=debug, DATABASE_URL is set, OPENAI_API_KEY is not set, SENTRY_DSN=https://sample@sentry.test/1");

  // Removing a Workspace value from the list reaches the next turn.
  await page.locator('[role="listitem"]', { hasText: "SENTRY_DSN" }).hover();
  await page.getByRole("button", { name: "Remove SENTRY_DSN", exact: true }).click();
  await page.getByText("SENTRY_DSN", { exact: true }).waitFor({ state: "detached" });
  const again = await call(`/computers/${info.computerId}/threads/${graceThread.thread.id}/message`, "POST", { text: "Which values reach this thread: SENTRY_DSN", messageId: `u-${crypto.randomUUID()}` }, "grace");
  assert.equal(again.status, 200);
  let removed = false;
  for (let attempt = 0; attempt < 150 && !removed; attempt++) {
    const entries = (await call(`/computers/${info.computerId}/threads/${graceThread.thread.id}`, "GET", undefined, "grace")).body.detail?.entries ?? [];
    removed = entries.some((entry) => entry.kind === "assistant" && entry.text === "SENTRY_DSN is not set");
    if (!removed) await wait(100);
  }
  assert.ok(removed, "a removed value leaves the thread's next turn");

  // Phone width: the list keeps key, scope and author, and nothing scrolls sideways.
  const phone = await open("ada", { width: 375, height: 812 });
  await phone.page.goto(route);
  await phone.page.getByText("OPENAI_API_KEY", { exact: true }).waitFor();
  await phone.page.getByRole("heading", { name: "Environment", exact: true }).scrollIntoViewIfNeeded();
  assert.ok(await phone.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no horizontal scroll at 375px");
  await phone.page.mouse.move(1, 1);
  await phone.page.screenshot({ path: `${out}/phone.png` });
  await phone.page.getByRole("button", { name: "Add values", exact: true }).click();
  await phone.page.getByRole("dialog").getByLabel("Key 1", { exact: true }).waitFor();
  await phone.page.waitForTimeout(400);
  assert.ok(await phone.page.getByRole("dialog").evaluate((node) => node.getBoundingClientRect().width <= window.innerWidth - 32 + 1), "the dialog fits a phone");
  await phone.page.screenshot({ path: `${out}/phone-dialog.png` });
  assert.deepEqual([...ada.errors, ...phone.errors], []);
  console.log(`PASS: workspace environment list, dialog and paste, secrets hidden, scope isolation, override, removal and delivery. Screenshots in ${out}`);
} finally {
  await browser.close();
  for (const value of (await call(path)).body?.values ?? []) if (value.scope === "personal") await call(`${path}/${value.id}`, "DELETE");
  await call(`/workspaces/${workspace.id}`, "DELETE");
}
