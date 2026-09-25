import assert from "node:assert/strict";
import test from "node:test";
import { HostedSettingsStore } from "./hosted-settings.js";
import {
  CLAUDE_ACCOUNT_SECRET,
  CLAUDE_OAUTH_AUTH_URL,
  CLAUDE_OAUTH_CLIENT_ID,
  CLAUDE_OAUTH_TOKEN_URL,
  cancelClaudeAccount,
  claudeAccountConnected,
  claudeComputerEnvironment,
  completeClaudeAccount,
  logoutClaudeAccount,
  publicClaudeAccount,
  startClaudeAccount,
} from "./claude-account.js";
import { cloudStartAccess, publicModelAccessResponse } from "./model-access.js";

function store() {
  const records = new Map<string, string>();
  return {
    async secrets() {
      return Object.fromEntries(records);
    },
    async setSecret(_org: string, name: string, value: string | null) {
      if (value === null) records.delete(name);
      else records.set(name, value);
    },
  } as unknown as HostedSettingsStore;
}

test("Claude Code sign-in stores PKCE on the account and never returns tokens", async () => {
  const settings = store();
  const started = await startClaudeAccount(settings, "org");
  assert.equal(started.phase, "pending");
  assert.ok(started.verificationUrl?.startsWith(`${CLAUDE_OAUTH_AUTH_URL}?`));
  const url = new URL(started.verificationUrl!);
  assert.equal(url.searchParams.get("client_id"), CLAUDE_OAUTH_CLIENT_ID);
  assert.equal(url.searchParams.get("code"), "true");
  const publicStatus = publicClaudeAccount(await settings.secrets("org"));
  assert.equal(publicStatus.phase, "pending");
  assert.ok(!JSON.stringify(publicStatus).includes("codeVerifier"));
  assert.ok(!JSON.stringify(await settings.secrets("org")).includes("access_token"));
});

test("Claude Code completes from a pasted code and injects credentials for a computer", async () => {
  const settings = store();
  const started = await startClaudeAccount(settings, "org");
  const state = new URL(started.verificationUrl!).searchParams.get("state")!;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    assert.equal(String(input), CLAUDE_OAUTH_TOKEN_URL);
    const body = JSON.parse(String(init?.body)) as { grant_type: string; code?: string; code_verifier?: string };
    assert.equal(body.grant_type, "authorization_code");
    assert.equal(body.code, "pasted-code");
    assert.ok(body.code_verifier);
    return Response.json({
      access_token: "private-access",
      refresh_token: "private-refresh",
      expires_in: 3600,
      subscription_type: "pro",
    });
  }) as typeof fetch;
  try {
    const connected = await completeClaudeAccount(settings, "org", { code: `pasted-code#${state}` });
    assert.equal(connected.phase, "connected");
    assert.equal(connected.subscription, "pro");
    assert.ok(!JSON.stringify(connected).includes("private-"));
    assert.equal(claudeAccountConnected(await settings.secrets("org")), true);
    const listed = publicModelAccessResponse(await settings.secrets("org"));
    assert.equal(listed.accounts.claude.phase, "connected");
    assert.ok(!JSON.stringify(listed).includes("private-"));
    const env = await claudeComputerEnvironment(settings, "org", await settings.secrets("org"));
    const written = JSON.parse(env.CLAUDE_CREDENTIALS_JSON) as { claudeAiOauth: { accessToken: string } };
    assert.equal(written.claudeAiOauth.accessToken, "private-access");
    assert.deepEqual(
      cloudStartAccess(await settings.secrets("org")).map((entry) => entry.id).filter((id) => id === "claude"),
      ["claude"],
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("Claude Code disconnect and cancel clear the connection without leaking secrets", async () => {
  const settings = store();
  await startClaudeAccount(settings, "org");
  assert.equal((await cancelClaudeAccount(settings, "org")).phase, "signedOut");
  await settings.setSecret("org", CLAUDE_ACCOUNT_SECRET, JSON.stringify({
    accessToken: "private-access",
    refreshToken: "private-refresh",
    expiresAt: Date.now() + 60_000,
    scopes: ["user:inference"],
  }));
  assert.equal((await logoutClaudeAccount(settings, "org")).phase, "signedOut");
  assert.equal(claudeAccountConnected(await settings.secrets("org")), false);
  assert.deepEqual(await claudeComputerEnvironment(settings, "org", await settings.secrets("org")), {});
});
