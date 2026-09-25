import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/// Drives the current hub, the current web app, and the current CLI: create a
/// connection key in Computers → Connected, then sign a computer in with it
/// from a terminal.
const info = JSON.parse(readFileSync(process.env.QA_SESSION, "utf8"));
const base = process.env.QA_WEB_URL ?? info.hubUrl;
const out = process.env.QA_ARTIFACTS ?? "/tmp/remy-pr-artifacts/remy-cli";
mkdirSync(out, { recursive: true });
const state = mkdtempSync(join(tmpdir(), "remy-cli-qa-"));

const computers = async () => (await (await fetch(`${info.hubUrl}/api/organizations/${info.organizationId}/computers`, { headers: { authorization: `Bearer ${info.tokens.ada}` } })).json()).computers;
const remy = (...args) => execFileSync(process.execPath, [join(process.cwd(), "server/dist/cli.js"), ...args], {
  encoding: "utf8",
  env: { ...process.env, MC_CONFIG_DIR: state, REMY_SERVER_RELEASE: "0.1.0" },
  timeout: 120_000,
}).trim();

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (process.platform === "darwin" ? chromiumPath() : chromium.executablePath()) });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
context.setDefaultTimeout(20_000);
await context.addCookies([{ name: "remy_session", value: info.tokens.ada, url: base, httpOnly: true, sameSite: "Lax" }]);
const page = await context.newPage();
try {
  await page.goto(`${base}/#/settings/devices?organization=${info.organizationId}`);
  await page.getByRole("navigation", { name: "Computer settings" }).getByRole("button", { name: "Connected", exact: true }).click();
  await page.getByRole("button", { name: "Add computer", exact: true }).click();

  const setup = page.getByRole("region", { name: "General computer settings" });
  await setup.waitFor();
  await page.screenshot({ path: `${out}/connect-a-computer.png`, clip: await setup.boundingBox() });

  await page.getByRole("button", { name: "Create a connection key", exact: true }).click();
  const command = await page.getByLabel("Connection command").innerText();
  assert.match(command, /^remy login remy_[A-Za-z0-9_-]+$/);

  // A key is a credential, so the capture keeps the shape and not the secret.
  await page.getByLabel("Connection command").evaluate((node) => { node.textContent = "remy login remy_aGVyZS1pcy1hLWRpc3Bvc2FibGUta2V5"; });
  await page.screenshot({ path: `${out}/connection-key.png`, clip: await setup.boundingBox() });

  const before = new Set((await computers()).map((computer) => computer.computerId));
  const signedIn = remy("login", command.replace("remy login ", ""), "--name", "Build box");
  assert.match(signedIn, /Build box is connected to your Remy account\./);
  assert.match(signedIn, /Run remy start to keep it available\./);

  const after = await computers();
  const added = after.find((computer) => !before.has(computer.computerId));
  assert.ok(added, "The signed-in computer is not in Computers");
  assert.equal(added.name, "Build box");
  // An admin adding a computer in an organization view adds it to that
  // organization; the personal case is covered in hub/src/computer-connection-keys.test.ts.
  assert.equal(added.ownership, "organization");

  assert.match(remy("status"), /Build box is connected to 127\.0\.0\.1/);
  assert.match(remy("status"), /It is stopped — run remy start/);

  // One use only: the same key cannot sign a second computer in.
  const second = mkdtempSync(join(tmpdir(), "remy-cli-qa-"));
  try {
    execFileSync(process.execPath, [join(process.cwd(), "server/dist/cli.js"), "login", command.replace("remy login ", "")], { encoding: "utf8", env: { ...process.env, MC_CONFIG_DIR: second }, timeout: 120_000 });
    throw new Error("A used connection key signed a second computer in");
  } catch (error) {
    assert.match(String(error.stderr ?? error.message), /Approve this computer, then try again\.|Start computer authorization again\./);
  } finally {
    rmSync(second, { recursive: true, force: true });
  }

  assert.match(remy("logout"), /This computer is disconnected from your Remy account\./);
  assert.equal((await computers()).some((computer) => computer.computerId === added.computerId), false);

  console.log(`PASS: a connection key from Computers → Connected signs a computer in from its terminal, once, and remy logout takes it off. Shots in ${out}`);
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true });
  throw error;
} finally {
  rmSync(state, { recursive: true, force: true });
  await context.close();
  await browser.close();
}
