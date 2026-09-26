import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { ComputerAccountStore } from "./computer-accounts.js";
import {
  CLAUDE_ACCOUNT_SECRET,
  CLAUDE_OAUTH_AUTH_URL,
  CLAUDE_OAUTH_CLIENT_ID,
  CLAUDE_OAUTH_TOKEN_URL,
  cancelClaudeAccount,
  claudeComputerEnvironment,
  completeClaudeAccount,
  logoutClaudeAccount,
  publicClaudeAccount,
  startClaudeAccount,
} from "./claude-account.js";

function store() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(new URL("../migrations", import.meta.url)).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  const prepare = (sql: string, values: unknown[] = []): unknown => ({
    bind: (...args: unknown[]) => prepare(sql, args),
    first: async () => sqlite.prepare(sql).get(...(values as never[])) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...(values as never[])) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...(values as never[])).changes) } }),
  });
  return {
    sqlite,
    accounts: new ComputerAccountStore({ prepare } as unknown as D1Database, async () => "root-secret", () => 1000),
  };
}

test("Claude Code sign-in stores PKCE on the computer and never returns tokens", async () => {
  const { sqlite, accounts } = store();
  try {
    const started = await startClaudeAccount(accounts, "mac");
    assert.equal(started.phase, "pending");
    assert.ok(started.verificationUrl?.startsWith(`${CLAUDE_OAUTH_AUTH_URL}?`));
    const url = new URL(started.verificationUrl!);
    assert.equal(url.searchParams.get("client_id"), CLAUDE_OAUTH_CLIENT_ID);
    assert.equal(url.searchParams.get("code"), "true");
    const publicStatus = publicClaudeAccount(await accounts.secrets("mac"));
    assert.equal(publicStatus.phase, "pending");
    assert.ok(!JSON.stringify(publicStatus).includes("codeVerifier"));
    assert.ok(!JSON.stringify(await accounts.secrets("mac")).includes("access_token"));
    assert.deepEqual(await accounts.secrets("other"), {});
  } finally {
    sqlite.close();
  }
});

test("Claude Code completes from a pasted code and injects credentials for that computer", async () => {
  const { sqlite, accounts } = store();
  const started = await startClaudeAccount(accounts, "mac");
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
    const connected = await completeClaudeAccount(accounts, "mac", { code: `pasted-code#${state}` });
    assert.equal(connected.phase, "connected");
    assert.equal(connected.subscription, "pro");
    assert.ok(!JSON.stringify(connected).includes("private-"));
    const env = await claudeComputerEnvironment(accounts, "mac");
    const written = JSON.parse(env.CLAUDE_CREDENTIALS_JSON) as { claudeAiOauth: { accessToken: string } };
    assert.equal(written.claudeAiOauth.accessToken, "private-access");
    assert.deepEqual(await claudeComputerEnvironment(accounts, "other"), {});
    const row = sqlite.prepare("SELECT ciphertext FROM computer_account_secrets WHERE computer_id='mac' AND name=?").get(CLAUDE_ACCOUNT_SECRET) as { ciphertext: string };
    assert.doesNotMatch(row.ciphertext, /private-access/);
  } finally {
    globalThis.fetch = original;
    sqlite.close();
  }
});

test("Claude Code disconnect and cancel clear the connection without leaking secrets", async () => {
  const { sqlite, accounts } = store();
  try {
    await startClaudeAccount(accounts, "mac");
    assert.equal((await cancelClaudeAccount(accounts, "mac")).phase, "signedOut");
    await accounts.setSecret("mac", CLAUDE_ACCOUNT_SECRET, JSON.stringify({
      accessToken: "private-access",
      refreshToken: "private-refresh",
      expiresAt: Date.now() + 60_000,
      scopes: ["user:inference"],
    }));
    assert.equal((await logoutClaudeAccount(accounts, "mac")).phase, "signedOut");
    assert.deepEqual(await claudeComputerEnvironment(accounts, "mac"), {});
    await accounts.setSecret("mac", CLAUDE_ACCOUNT_SECRET, JSON.stringify({
      accessToken: "private-access",
      refreshToken: "private-refresh",
      expiresAt: Date.now() + 60_000,
      scopes: ["user:inference"],
    }));
    await accounts.forget("mac");
    assert.deepEqual(await accounts.secrets("mac"), {});
  } finally {
    sqlite.close();
  }
});
