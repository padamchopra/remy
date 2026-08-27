import assert from "node:assert/strict";
import test from "node:test";

import { isNewerToolVersion, readClaudeAuth, readCodexAuth, readCursorAbout, readGhAuth } from "./tooling.js";

test("compares provider CLI versions", () => {
  assert.equal(isNewerToolVersion("2.1.50", "2.1.49"), true);
  assert.equal(isNewerToolVersion("0.140.0", "0.140.0"), false);
  assert.equal(isNewerToolVersion("0.139.9", "0.140.0"), false);
  assert.equal(isNewerToolVersion("v1.2.1", "1.2"), true);
  assert.equal(isNewerToolVersion("latest", "1.2.0"), false);
});

test("reads the signed-in account out of gh auth status", () => {
  const output = [
    "github.com",
    "  ✓ Logged in to github.com account padamchopra (keyring)",
    "  - Active account: true",
    "  - Token scopes: 'gist', 'read:org', 'repo'",
  ].join("\n");
  assert.deepEqual(readGhAuth(output), { authenticated: true, account: "padamchopra" });
});

test("reads the older phrasing that says as instead of account", () => {
  assert.deepEqual(readGhAuth("  ✓ Logged in to github.com as padamchopra (oauth_token)"), {
    authenticated: true,
    account: "padamchopra",
  });
});

test("reports signed out rather than guessing an account", () => {
  const output = "You are not logged into any GitHub hosts. To log in, run: gh auth login";
  assert.deepEqual(readGhAuth(output), { authenticated: false });
  assert.deepEqual(readGhAuth(""), { authenticated: false });
});

test("reads Claude subscription billing separately from API billing", () => {
  assert.deepEqual(readClaudeAuth(JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    subscriptionType: "team",
    orgName: "Raccoons Labs",
  })), {
    authenticated: true,
    plan: "Team plan",
    organization: "Raccoons Labs",
  });
  assert.deepEqual(readClaudeAuth(JSON.stringify({
    loggedIn: true,
    authMethod: "api_key",
  })), {
    authenticated: true,
    plan: "API billing",
  });
  assert.deepEqual(readClaudeAuth(JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    apiKeySource: "ANTHROPIC_API_KEY",
  })), {
    authenticated: true,
    plan: "API billing",
  });
  assert.deepEqual(readClaudeAuth(JSON.stringify({ loggedIn: false })), { authenticated: false });
});

test("reads the strongest account detail each provider reports", () => {
  assert.deepEqual(readCodexAuth("Logged in using ChatGPT"), {
    authenticated: true,
    plan: "ChatGPT sign-in",
  });
  assert.deepEqual(readCodexAuth("Logged in using an API key"), {
    authenticated: true,
    plan: "API billing",
  });
  assert.deepEqual(readCursorAbout(JSON.stringify({
    subscriptionTier: "Pro+",
    userEmail: "dev@example.com",
  })), {
    authenticated: true,
    plan: "Pro+ plan",
  });
});
