import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { _electron as electron } from "../../web/node_modules/playwright-core/index.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const qaRoot = mkdtempSync(join(tmpdir(), "remy-native-browser-"));
const stateDir = join(qaRoot, "state");
const children = [];
let electronApp;
let site;

function cleanEnvironment(overrides = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("REMY_") || name.startsWith("MC_")) delete env[name];
  }
  delete env.ELECTRON_RUN_AS_NODE;
  return { ...env, ...overrides };
}

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createNetServer();
    probe.once("error", rejectPort);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") return rejectPort(new Error("Could not reserve a QA port."));
      probe.close((error) => error ? rejectPort(error) : resolvePort(address.port));
    });
  });
}

function start(program, args, cwd, env) {
  const child = spawn(program, args, { cwd, env, stdio: "pipe" });
  children.push(child);
  return child;
}

async function waitFor(url, init = {}) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function request(serverUrl, token, path, init = {}) {
  const started = performance.now();
  const response = await fetch(`${serverUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text}`);
  return { elapsed: performance.now() - started, body: text ? JSON.parse(text) : undefined };
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
}

function configure(directory, port, token) {
  mkdirSync(directory, { recursive: true });
  const database = new DatabaseSync(join(directory, "remy.db"));
  database.exec("create table if not exists kv (key text primary key, value text not null)");
  database.prepare("insert or replace into kv (key, value) values (?, ?)").run("config", JSON.stringify({
    port,
    token,
    notifySelf: false,
    repoUpdate: "off",
    remyModel: "off",
  }));
  database.close();
}

function processTree(pid) {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss=,%cpu="], { encoding: "utf8" })
    .trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number));
  const included = new Set([pid]);
  let added = true;
  while (added) {
    added = false;
    for (const [child, parent] of rows) {
      if (!included.has(parent) || included.has(child)) continue;
      included.add(child);
      added = true;
    }
  }
  return rows.filter(([child]) => included.has(child)).reduce((total, [, , rss, cpu]) => ({
    workingSetKb: total.workingSetKb + rss,
    cpuPercent: total.cpuPercent + cpu,
  }), { workingSetKb: 0, cpuPercent: 0 });
}

async function cleanup() {
  if (electronApp) {
    const electronProcess = electronApp.process();
    await Promise.race([
      electronApp.close().catch(() => undefined),
      new Promise((resolveWait) => setTimeout(resolveWait, 3_000)),
    ]);
    if (electronProcess.exitCode === null) electronProcess.kill("SIGKILL");
  }
  for (const child of children.toReversed()) {
    if (child.exitCode !== null) continue;
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolveExit) => child.once("exit", resolveExit)),
      new Promise((resolveWait) => setTimeout(resolveWait, 1_000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  site?.closeAllConnections?.();
  await Promise.race([
    new Promise((resolveClose) => site?.close(resolveClose)),
    new Promise((resolveWait) => setTimeout(resolveWait, 1_000)),
  ]);
  rmSync(qaRoot, { recursive: true, force: true });
}

try {
  const serverPort = await freePort();
  const webPort = await freePort();
  const sitePort = await freePort();
  const token = randomBytes(32).toString("hex");
  configure(stateDir, serverPort, token);

  site = createHttpServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(`<!doctype html><meta charset="utf-8"><title>Native browser QA</title>
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f3f0ff; color: #211a36; font: 16px -apple-system, BlinkMacSystemFont, sans-serif; }
        main { width: min(680px, calc(100% - 48px)); padding: 48px; border: 1px solid #d8cff5; border-radius: 24px; background: white; box-shadow: 0 24px 80px #6750a422; }
        small { color: #7359bd; font-weight: 700; letter-spacing: .12em; }
        h1 { margin: 12px 0 8px; font-size: 38px; letter-spacing: -.04em; }
        p { margin: 0 0 32px; color: #665f73; line-height: 1.5; }
        section { display: flex; gap: 12px; align-items: center; }
        button, input, a { min-height: 44px; border-radius: 12px; font: inherit; }
        button { padding: 0 20px; border: 0; background: #6547bb; color: white; font-weight: 650; }
        input { min-width: 0; flex: 1; padding: 0 14px; border: 1px solid #d8d3e3; }
        a { display: inline-grid; place-items: center; padding: 0 16px; color: #6547bb; font-weight: 650; text-decoration: none; }
      </style>
      <main>
        <small>LIVE NATIVE PAGE</small>
        <h1>Your browsing session stays put.</h1>
        <p>Switch tabs, resize Remy, or control this page remotely without replacing the browser underneath.</p>
        <section>
          <button id="count" onclick="this.textContent = 'Count ' + (Number(this.dataset.count || 0) + 1); this.dataset.count = Number(this.dataset.count || 0) + 1">Count 0</button>
          <input aria-label="Name" placeholder="Type without losing focus">
          <a href="/?popup=1" target="_blank">Open popup</a>
        </section>
      </main>`);
  });
  await new Promise((resolveListen) => site.listen(sitePort, "127.0.0.1", resolveListen));

  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const nativeServer = start(process.execPath, [join(root, "server/dist/index.js")], join(root, "server"), cleanEnvironment({ MC_CONFIG_DIR: stateDir }));
  await waitFor(`${serverUrl}/health`, { headers: { Authorization: `Bearer ${token}` } });
  const { body: created } = await request(serverUrl, token, "/chats", {
    method: "POST",
    body: JSON.stringify({ cwd: root, title: "Native browser QA" }),
  });
  const chatId = created.chat.id;

  start(process.execPath, [join(root, "web/node_modules/vite/bin/vite.js"), "--port", String(webPort), "--strictPort"], join(root, "web"), cleanEnvironment({
    MC_CONFIG_DIR: stateDir,
    MC_SERVER_URL: serverUrl,
    MC_TOKEN: token,
  }));
  await waitFor(webUrl);

  electronApp = await electron.launch({
    executablePath: join(root, "desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
    args: [join(root, "desktop")],
    env: cleanEnvironment({
      MC_CONFIG_DIR: stateDir,
      MC_SERVER_URL: serverUrl,
      MC_TOKEN: token,
      MC_DEV_SERVER_URL: webUrl,
    }),
  });
  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate((id) => { location.hash = `#/threads/${id}`; }, chatId);
  await page.getByRole("button", { name: "Add tab" }).first().waitFor();
  const nativeBaseline = processTree(electronApp.process().pid);
  await page.getByRole("button", { name: "Add tab" }).first().click();
  await page.getByRole("menuitem", { name: "Browser", exact: true }).click();
  await page.getByRole("textbox", { name: "Browser address" }).fill(`http://127.0.0.1:${sitePort}`);
  await page.getByRole("button", { name: "Open address" }).click();
  await page.getByLabel("Native browser page").waitFor();

  const nativeBefore = await electronApp.evaluate(({ webContents }) => webContents.getAllWebContents()
    .filter((contents) => contents.getTitle() === "Native browser QA")
    .map((contents) => ({ id: contents.id, url: contents.getURL(), crashed: contents.isCrashed() })));
  if (nativeBefore.length !== 1) throw new Error(`Expected one native browser view, found ${nativeBefore.length}.`);
  if (await page.locator('img[alt="Native browser QA"]').count()) throw new Error("The desktop panel still rendered a screenshot frame.");

  await page.getByRole("tab", { name: "Native browser QA", exact: true }).click();
  const hidden = await electronApp.evaluate(({ webContents }) => webContents.getAllWebContents()
    .find((contents) => contents.getTitle() === "Native browser QA")?.id);
  await page.getByRole("tab", { name: /^Browser/ }).click();
  await page.getByLabel("Native browser page").waitFor();
  if (hidden !== nativeBefore[0].id) throw new Error("Hiding the panel replaced its browser session.");
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1120, 720));
  await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  const resized = await electronApp.evaluate(({ webContents }) => webContents.getAllWebContents()
    .find((contents) => contents.getTitle() === "Native browser QA")?.id);
  if (resized !== nativeBefore[0].id) throw new Error("Resizing the panel replaced its browser session.");

  await request(serverUrl, token, `/chats/${chatId}/browser/click?instance=default`, {
    method: "POST",
    body: JSON.stringify({ role: "button", name: "Count 0" }),
  });
  const { body: firstSnapshot } = await request(serverUrl, token, `/chats/${chatId}/browser/snapshot?instance=default`, { method: "POST", body: "{}" });
  if (!firstSnapshot.text.includes("Count 1")) throw new Error("The remote semantic action did not reach the native page.");

  await electronApp.evaluate(async ({ webContents }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getTitle() === "Native browser QA");
    await contents?.executeJavaScript("document.querySelector('#count').click()", true);
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  const { body: secondSnapshot } = await request(serverUrl, token, `/chats/${chatId}/browser/snapshot?instance=default`, { method: "POST", body: "{}" });
  if (!secondSnapshot.text.includes("Count 2")) throw new Error("Native page activity did not synchronize back to the semantic session.");

  await electronApp.evaluate(async ({ webContents }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getTitle() === "Native browser QA");
    await contents?.executeJavaScript("document.querySelector('a').click()", true);
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  const popup = await electronApp.evaluate(({ webContents }) => webContents.getAllWebContents()
    .filter((contents) => contents.getTitle() === "Native browser QA")
    .map((contents) => ({ id: contents.id, url: contents.getURL() })));
  if (popup.length !== 1 || popup[0].id !== nativeBefore[0].id || !popup[0].url.includes("popup=1")) {
    throw new Error(`A page popup did not stay in its native browser session: ${JSON.stringify(popup)}.`);
  }
  await request(serverUrl, token, `/chats/${chatId}/browser/back?instance=default`, { method: "POST", body: "{}" });

  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: /Reset zoom/ }).waitFor();
  const zoom = await electronApp.evaluate(({ webContents }) => webContents.getAllWebContents()
    .find((contents) => contents.getTitle() === "Native browser QA")?.getZoomFactor());
  if (!zoom || zoom <= 1) throw new Error("Zoom did not reach the native page.");

  const nativeReads = [];
  const remoteCaptures = [];
  for (let index = 0; index < 5; index += 1) {
    nativeReads.push((await request(serverUrl, token, `/chats/${chatId}/browser?instance=default&presentation=native`)).elapsed);
    remoteCaptures.push((await request(serverUrl, token, `/chats/${chatId}/browser?instance=default`)).elapsed);
  }
  const metrics = await electronApp.evaluate(async ({ app }) => {
    process.getCPUUsage();
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    return {
      idleCpuPercent: process.getCPUUsage().percentCPUUsage,
      workingSetKb: app.getAppMetrics().reduce((total, process) => total + process.memory.workingSetSize, 0),
    };
  });
  const nativeProcesses = processTree(electronApp.process().pid);

  await request(serverUrl, token, `/chats/${chatId}/browser/open?instance=second`, {
    method: "POST",
    body: JSON.stringify({ url: `http://127.0.0.1:${sitePort}/?tab=second` }),
  });
  await electronApp.evaluate(async ({ webContents }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getTitle() === "Native browser QA" && !candidate.getURL().includes("tab=second"));
    await contents?.executeJavaScript("localStorage.setItem('remy-auth-qa', 'kept')");
  });

  await electronApp.evaluate(({ webContents }) => webContents.getAllWebContents()
    .find((contents) => contents.getTitle() === "Native browser QA" && !contents.getURL().includes("tab=second"))?.forcefullyCrashRenderer());
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  const recovered = await electronApp.evaluate(({ webContents }) => webContents.getAllWebContents()
    .find((contents) => contents.getTitle() === "Native browser QA" && !contents.getURL().includes("tab=second"))?.getURL());
  if (!recovered?.startsWith(`http://127.0.0.1:${sitePort}`)) throw new Error("The crashed native page did not recover its URL.");
  const recoveryState = await electronApp.evaluate(async ({ webContents }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getTitle() === "Native browser QA" && !candidate.getURL().includes("tab=second"));
    return contents?.executeJavaScript("localStorage.getItem('remy-auth-qa')");
  });
  if (recoveryState !== "kept") throw new Error("The recovered page lost its authenticated session storage.");
  const unrelated = await electronApp.evaluate(({ webContents }) => webContents.getAllWebContents()
    .find((contents) => contents.getURL().includes("tab=second"))?.getURL());
  if (!unrelated?.includes("tab=second")) throw new Error("Recovering one browser lost another tab.");
  if (!page.url().includes(chatId)) throw new Error("Recovering the browser changed the Remy thread.");

  const fallbackState = join(qaRoot, "fallback-state");
  const fallbackPort = await freePort();
  const fallbackToken = randomBytes(32).toString("hex");
  configure(fallbackState, fallbackPort, fallbackToken);
  const fallbackUrl = `http://127.0.0.1:${fallbackPort}`;
  const fallbackServer = start(process.execPath, [join(root, "server/dist/index.js")], join(root, "server"), cleanEnvironment({ MC_CONFIG_DIR: fallbackState }));
  await waitFor(`${fallbackUrl}/health`, { headers: { Authorization: `Bearer ${fallbackToken}` } });
  const { body: fallbackCreated } = await request(fallbackUrl, fallbackToken, "/chats", {
    method: "POST",
    body: JSON.stringify({ cwd: root, title: "Screenshot browser QA" }),
  });
  const fallbackBaseline = processTree(fallbackServer.pid);
  await request(fallbackUrl, fallbackToken, `/chats/${fallbackCreated.chat.id}/browser/open`, {
    method: "POST",
    body: JSON.stringify({ url: `http://127.0.0.1:${sitePort}` }),
  });
  const screenshotCaptures = [];
  for (let index = 0; index < 5; index += 1) {
    screenshotCaptures.push((await request(fallbackUrl, fallbackToken, `/chats/${fallbackCreated.chat.id}/browser`)).elapsed);
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  const fallbackProcesses = processTree(fallbackServer.pid);
  await request(fallbackUrl, fallbackToken, `/chats/${fallbackCreated.chat.id}/browser/close`, { method: "POST", body: "{}" });

  console.log(JSON.stringify({
    nativeSessionPersisted: true,
    resizeSessionPersisted: true,
    semanticRoundTrip: true,
    popupStayedInSession: true,
    crashRecovered: true,
    authenticationPersisted: true,
    unrelatedTabSurvived: true,
    nativeStateMedianMs: Number(median(nativeReads).toFixed(1)),
    remoteCaptureMedianMs: Number(median(remoteCaptures).toFixed(1)),
    screenshotBaselineMedianMs: Number(median(screenshotCaptures).toFixed(1)),
    nativeWorkingSetDeltaKb: nativeProcesses.workingSetKb - nativeBaseline.workingSetKb,
    screenshotWorkingSetDeltaKb: fallbackProcesses.workingSetKb - fallbackBaseline.workingSetKb,
    screenshotIdleCpuPercent: Number(fallbackProcesses.cpuPercent.toFixed(2)),
    ...metrics,
  }, null, 2));
} finally {
  await cleanup();
}
