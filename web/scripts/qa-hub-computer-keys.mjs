import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";
import { mkdirSync, readFileSync } from "node:fs";

/// Drives the current hub and the current daemon: set a provider key on the
/// connected computer from the web, and check the computer was given it.
const info = JSON.parse(readFileSync(process.env.QA_SESSION, "utf8"));
const base = process.env.QA_WEB_URL ?? info.hubUrl;
const out = process.env.QA_ARTIFACTS ?? "/tmp/remy-pr-artifacts/computer-model-keys";
mkdirSync(out, { recursive: true });

const control = async (path) => (await fetch(`${info.controlUrl}${path}`, { headers: { authorization: `Bearer ${info.controlToken}` } })).json();
const api = async (suffix) => (await fetch(`${info.hubUrl}/api/organizations/${info.organizationId}${suffix}`, { headers: { authorization: `Bearer ${info.tokens.ada}` } })).json();
const until = async (condition, message) => {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
};

// Re-runnable: start from a computer with no key of its own.
for (const id of ["anthropic", "openai"]) {
  await fetch(`${info.hubUrl}/api/organizations/${info.organizationId}/computers/${info.computerId}/model-keys`, {
    method: "PUT",
    headers: { authorization: `Bearer ${info.tokens.ada}`, "content-type": "application/json" },
    body: JSON.stringify({ id, apiKey: null }),
  });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (process.platform === "darwin" ? chromiumPath() : chromium.executablePath()) });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
context.setDefaultTimeout(20_000);
await context.addCookies([{ name: "remy_session", value: info.tokens.ada, url: base, httpOnly: true, sameSite: "Lax" }]);
const page = await context.newPage();
try {
  await page.goto(`${base}/#/settings/devices?organization=${info.organizationId}`);
  await page.getByRole("navigation", { name: "Computer settings" }).getByRole("button", { name: "Connected", exact: true }).click();
  await page.getByRole("button", { name: "Studio", exact: true }).click();

  const keys = page.getByRole("region", { name: "Provider keys" });
  await keys.waitFor();
  const accounts = page.getByRole("region", { name: "Provider accounts" });
  await accounts.waitFor();
  await accounts.getByRole("button", { name: "Connect Claude Code", exact: true }).waitFor();
  await accounts.getByRole("button", { name: "Connect Codex", exact: true }).waitFor();
  await keys.getByText("Claude uses the sign-in on this computer.", { exact: true }).waitFor();
  await keys.getByText("Codex uses the sign-in on this computer.", { exact: true }).waitFor();
  await page.screenshot({ path: `${out}/provider-keys-empty.png`, clip: await keys.boundingBox() });

  await keys.getByRole("button", { name: "Add key" }).first().click();
  await keys.getByLabel("Anthropic API key").fill("disposable-anthropic-qa-key");
  await keys.getByRole("button", { name: "Save key", exact: true }).click();
  await keys.getByText("Claude uses this key.", { exact: true }).waitFor();
  await page.getByText("Your key is on this computer.", { exact: true }).waitFor();
  await page.screenshot({ path: `${out}/provider-keys-saved.png`, clip: await keys.boundingBox() });

  // The management read says configured, never the value.
  const read = await api(`/computers/${info.computerId}/model-keys`);
  assert.deepEqual(read.providers.map((entry) => [entry.id, entry.configured]), [["anthropic", true], ["openai", false]]);
  assert.equal(JSON.stringify(read).includes("disposable-anthropic-qa-key"), false);

  // The computer pulled it over its own connection.
  await until(async () => (await control("/model-keys")).names.includes("ANTHROPIC_API_KEY"), "The computer was never given its key");

  // Reloading reads the same state back, and removing it takes it off the computer.
  await page.reload();
  await keys.waitFor();
  await keys.getByText("Claude uses this key.", { exact: true }).waitFor();
  assert.equal(await keys.getByRole("button", { name: "Replace key" }).count(), 1);
  await keys.getByRole("button", { name: "Remove" }).click();
  await keys.getByText("Claude uses the sign-in on this computer.", { exact: true }).waitFor();
  await until(async () => (await control("/model-keys")).names.length === 0, "The computer kept a removed key");

  console.log(`PASS: provider keys set from Computers → Connected reach the computer and come back off it. Shots in ${out}`);
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true });
  throw error;
} finally {
  await context.close();
  await browser.close();
}
