import assert from "node:assert/strict";
import test from "node:test";
import {
  advertisedCloudProvidersFor,
  advertisedCloudStartProviders,
  advertisedProviderIds,
  canStartWithShareGrant,
  parseStartProviderInput,
  parseStartProviders,
  publicStartProviders,
  resolveStartProviders,
  startGrantCandidates,
} from "./computer-start-access.js";

test("a stored start-provider list is the advertised intersection, and a missing list keeps every advertised provider", () => {
  const advertised = advertisedProviderIds({
    capabilities: { providers: [{ id: "claude" }, { id: "cursor" }, { id: "unknown" }] },
  });
  assert.deepEqual(advertised, ["claude", "cursor"]);
  assert.deepEqual(resolveStartProviders(null, advertised), ["claude", "cursor"]);
  assert.deepEqual(resolveStartProviders(["claude", "codex"], advertised), ["claude"]);
  assert.deepEqual(parseStartProviders(null), null);
  assert.deepEqual(parseStartProviders('["cursor","claude","cursor"]'), ["claude", "cursor"]);
  assert.deepEqual(
    publicStartProviders(advertised, ["cursor"]),
    [
      { id: "claude", label: "Claude", allowed: false },
      { id: "cursor", label: "Cursor", allowed: true },
    ],
  );
  assert.deepEqual(parseStartProviderInput(undefined, advertised), undefined);
  assert.deepEqual(parseStartProviderInput(["cursor"], advertised), ["cursor"]);
  assert.throws(() => parseStartProviderInput(["codex"], advertised), /currently has/);
  assert.throws(() => parseStartProviderInput(["openrouter"], advertised), /currently has/);
  assert.throws(() => parseStartProviderInput(["not-a-provider"], advertised), /providers others may start/);
});

test("cloud model access advertises configured gateways, not the Codex runtime they execute through", () => {
  const advertised = advertisedCloudStartProviders([
    { id: "anthropic", enabled: true, configured: true },
    { id: "openrouter", enabled: true, configured: true },
    { id: "openai", enabled: false, configured: true },
    { id: "router", enabled: true, configured: false },
  ]);
  assert.deepEqual(advertised, ["anthropic", "openrouter"]);
  assert.deepEqual(
    publicStartProviders(advertised, null),
    [
      { id: "anthropic", label: "Anthropic", allowed: true },
      { id: "openrouter", label: "OpenRouter", allowed: true },
    ],
  );
  assert.deepEqual(advertisedCloudStartProviders([
    { id: "openrouter", enabled: true, configured: true },
  ]), ["openrouter"]);
  assert.deepEqual(parseStartProviderInput(["openrouter"], advertised), ["openrouter"]);
  assert.deepEqual(parseStartProviderInput(["codex"], advertised), ["openrouter"]);
  assert.deepEqual(parseStartProviderInput(["claude"], advertised), ["anthropic"]);
  assert.deepEqual(resolveStartProviders(["codex"], advertised), ["openrouter"]);
  assert.equal(canStartWithShareGrant(true, ["anthropic"], advertised, "codex", "remy:openrouter:openrouter/auto"), true);
  assert.equal(canStartWithShareGrant(false, ["anthropic"], advertised, "codex", "remy:openrouter:openrouter/auto"), false);
  assert.equal(canStartWithShareGrant(false, ["anthropic"], advertised, "openrouter", "openrouter/auto"), false);
  assert.equal(canStartWithShareGrant(false, ["anthropic"], advertised, "anthropic"), true);
  assert.equal(canStartWithShareGrant(false, null, advertised, "codex", "remy:openrouter:openrouter/auto"), true);
  assert.equal(canStartWithShareGrant(false, ["openrouter"], advertised, "codex", "remy:openrouter:openrouter/auto"), true);
  assert.deepEqual(startGrantCandidates("codex", "remy:openrouter:openrouter/auto"), ["openrouter", "codex"]);
});

test("cloud model access advertises Anthropic from an API key, not a Claude Code account", () => {
  assert.deepEqual(advertisedCloudStartProviders([
    { id: "anthropic", enabled: true, configured: true },
    { id: "openai", enabled: true, configured: true },
  ]), ["anthropic", "openai"]);
  assert.deepEqual(advertisedCloudStartProviders([
    { id: "openai", enabled: true, configured: true },
  ]), ["openai"]);
});

test("Cursor Cloud advertises only Cursor regardless of model access", () => {
  assert.deepEqual(advertisedCloudProvidersFor("cursor-cloud", [
    { id: "anthropic", enabled: true, configured: true },
    { id: "openrouter", enabled: true, configured: true },
  ]), ["cursor"]);
  assert.deepEqual(advertisedCloudProvidersFor("modal", [
    { id: "anthropic", enabled: true, configured: true },
  ]), ["anthropic"]);
  assert.deepEqual(advertisedCloudProvidersFor("fly-sprites", [
    { id: "openrouter", enabled: true, configured: true },
  ]), ["openrouter"]);
});
