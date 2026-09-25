import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "remy-hosted-claude-"));
process.env.MC_CONFIG_DIR = home;
process.env.CLAUDE_CREDENTIALS_JSON = JSON.stringify({
  claudeAiOauth: {
    accessToken: "private-access",
    refreshToken: "private-refresh",
    expiresAt: Date.now() + 60_000,
    scopes: ["user:inference"],
  },
});
const { configureHostedClaude } = await import("./hosted-claude-account.js");
test.after(() => rmSync(home, { recursive: true, force: true }));

test("hosted Claude drops injected credentials instead of writing an account file", () => {
  configureHostedClaude(home, process.env.CLAUDE_CREDENTIALS_JSON);
  assert.equal(existsSync(join(home, ".credentials.json")), false);
  assert.equal(process.env.CLAUDE_CREDENTIALS_JSON, undefined);
});
