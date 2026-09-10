import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const home = mkdtempSync(join(tmpdir(), "remy-hosted-codex-"));
process.env.MC_CONFIG_DIR = home;
const { configureHostedCodex, hostedCodexAccountRequest } =
  await import("./hosted-codex-account.js");
const { setKv } = await import("./db.js");
test.after(() => rmSync(home, { recursive: true, force: true }));
test("connection selection changes the provider without overwriting saved credentials", () => {
  writeFileSync(join(home, "auth.json"), "private-test-account");
  configureHostedCodex(home, true);
  assert.match(
    readFileSync(join(home, "config.toml"), "utf8"),
    /model_provider = "openai"/,
  );
  assert.equal(process.env.REMY_HOSTED_CODEX_PROVIDER, "openai");
  configureHostedCodex(home, false);
  const config = readFileSync(join(home, "config.toml"), "utf8");
  assert.match(config, /env_key = "OPENAI_API_KEY"/);
  assert.equal(process.env.REMY_HOSTED_CODEX_PROVIDER, "remy_openai");
  assert.equal(
    readFileSync(join(home, "auth.json"), "utf8"),
    "private-test-account",
  );
  assert.ok(!config.includes("private-test-account"));
});
test("account management is unavailable outside a hosted workspace and only allows named operations", async () => {
  assert.equal(
    (await hostedCodexAccountRequest("GET", "/hub/codex-account", () => {}))
      .status,
    403,
  );
  setKv("hostedWorkspaceId", "test-workspace");
  process.env.CODEX_HOME = home;
  for (const [method, path] of [
    ["GET", "/hub/codex-account/start"],
    ["POST", "/hub/codex-account"],
    ["POST", "/hub/codex-account/exec"],
    ["GET", "/hub/codex-account/auth.json"],
  ]) {
    assert.equal(
      (await hostedCodexAccountRequest(method, path, () => {})).status,
      404,
    );
  }
});
