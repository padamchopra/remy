import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "mc-hub-claude-account-"));
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "mc-claude-config-"));
delete process.env.CLAUDE_CREDENTIALS_JSON;

const account = await import("./hub-claude-account.js");
const credentials = join(process.env.CLAUDE_CONFIG_DIR, ".credentials.json");
const payload = JSON.stringify({
  claudeAiOauth: {
    accessToken: "private-access",
    refreshToken: "private-refresh",
    expiresAt: Date.now() + 60_000,
    scopes: ["user:inference"],
  },
});

test.after(() => {
  rmSync(process.env.MC_CONFIG_DIR!, { recursive: true, force: true });
  rmSync(process.env.CLAUDE_CONFIG_DIR!, { recursive: true, force: true });
});

test("delivered Claude credentials are written and the environment copy is dropped", () => {
  process.env.CLAUDE_CREDENTIALS_JSON = payload;
  assert.equal(account.applyHubClaudeAccount({ values: { ANTHROPIC_API_KEY: "test-anthropic-value" } }), false);
  assert.equal(account.applyHubClaudeAccount({ values: {}, claudeCredentials: payload }), true);
  assert.equal(JSON.parse(readFileSync(credentials, "utf8")).claudeAiOauth.accessToken, "private-access");
  assert.equal(process.env.CLAUDE_CREDENTIALS_JSON, undefined);
  assert.equal(account.applyHubClaudeAccount({ claudeCredentials: payload }), false);
});

test("removing the account forgets the credentials file this computer was given", () => {
  account.applyHubClaudeAccount({ claudeCredentials: payload });
  assert.equal(account.applyHubClaudeAccount({ claudeCredentials: null }), true);
  assert.equal(existsSync(credentials), false);
  assert.equal(account.applyHubClaudeAccount({ claudeCredentials: null }), false);
});

test("an older hub that omits Claude credentials leaves a local sign-in alone", () => {
  account.applyHubClaudeAccount({ claudeCredentials: payload });
  assert.equal(account.applyHubClaudeAccount({ values: {} }), false);
  assert.equal(existsSync(credentials), true);
  account.forgetHubClaudeAccount();
  assert.equal(existsSync(credentials), false);
});

test("only a credentials payload is accepted", () => {
  assert.throws(() => account.applyHubClaudeAccount({ claudeCredentials: 7 }));
  assert.throws(() => account.applyHubClaudeAccount({ claudeCredentials: "a".repeat(32769) }));
  assert.throws(() => account.applyHubClaudeAccount({ claudeCredentials: "not-json" }));
});
