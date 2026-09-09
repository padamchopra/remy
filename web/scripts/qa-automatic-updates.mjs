import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";
import { DatabaseSync } from "node:sqlite";
import WebSocket from "../../server/node_modules/ws/wrapper.mjs";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
const log = readFileSync(process.argv[2], "utf8");
const port = log.match(/listening on 127\.0\.0\.1:(\d+)/)?.[1];
const webPort = log.match(
  /QA sidecar is ready: http:\/\/127\.0\.0\.1:(\d+)/,
)?.[1];
const state = log.match(/Disposable state: (.+)/)?.[1];
assert(
  port &&
    webPort &&
    state?.includes("/remy-qa-") &&
    state.endsWith("/state") &&
    port !== "8420",
);
const base = `http://127.0.0.1:${port}`;
const db = new DatabaseSync(`${state}/remy.db`);
const row = db.prepare("select value from kv where key='config'").get();
const { token } = JSON.parse(row.value);
db.close();
const req = async (path, method = "GET", body) => {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
};
await req("/server/settings", "PATCH", {
  deviceName: "Studio Mac",
  automaticUpdates: false,
});
const socket = new WebSocket(
  base.replace("http", "ws") +
    "/notify/stream?client=desktop&updates=1&automaticUpdates=1&version=0.0.1&notify=0",
  { headers: { Authorization: `Bearer ${token}` } },
);
await new Promise((resolve) => socket.once("open", resolve));
let installs = 0;
socket.on("message", async (raw) => {
  const data = JSON.parse(String(raw));
  if (data.type !== "app-update") return;
  if (data.action === "download-automatic")
    await req("/server/app-update", "PATCH", {
      requestId: data.requestId,
      state: "ready",
    });
  if (data.action === "install-automatic") {
    installs++;
    await req("/server/app-update", "PATCH", {
      requestId: data.requestId,
      state: "installing",
    });
  }
});
const artifacts = "/tmp/remy-pr-artifacts/automatic-updates";
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({
  executablePath: chromiumPath(),
  headless: true,
});
try {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 850 },
    recordVideo: { dir: artifacts },
  });
  const page = await context.newPage();
  await page.route("**/server/identity", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: { ...data, tailnetHost: "studio.example.ts.net" },
    });
  });
  await page.goto(`http://127.0.0.1:${webPort}/#/settings/devices`);
  const control = page.getByRole("switch", {
    name: "Automatic updates",
    exact: true,
  });
  await control.waitFor();
  assert.equal(await control.getAttribute("aria-checked"), "false");
  await control.click();
  await page.getByText(/will relaunch in/).waitFor();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: artifacts + "/countdown.png" });
  if (process.env.QA_RELAUNCH === "1" || process.env.QA_EXPIRE === "1") {
    if (process.env.QA_EXPIRE === "1") await page.waitForTimeout(31_000);
    else await page.getByRole("button", { name: "Relaunch now" }).click();
    for (let i = 0; i < 30 && installs === 0; i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.equal(installs, 1);
    assert.equal((await req("/server/automatic-update")).phase, "installing");
  } else {
    await page.getByRole("button", { name: "Snooze 5 min" }).click();
    await page.getByText(/will relaunch in/).waitFor({ state: "hidden" });
    const snoozed = await req("/server/automatic-update");
    assert.equal(snoozed.phase, "waiting");
    assert(snoozed.snoozedUntil > Date.now() + 295000);
    assert.equal(installs, 0);
    // A second authenticated client changes the owning computer's setting.
    await req("/server/settings", "PATCH", { automaticUpdates: false });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[id^="automatic-updates-"]')
          ?.getAttribute("aria-checked") === "false",
    );
    await page.reload();
    await control.waitFor();
    assert.equal(await control.getAttribute("aria-checked"), "false");
  }
  await context.close();
  console.log(
    "PASS: UI scenario completed. Installer simulated; no app was restarted.",
  );
} finally {
  await req("/server/settings", "PATCH", { automaticUpdates: false });
  socket.close();
  await browser.close();
}
