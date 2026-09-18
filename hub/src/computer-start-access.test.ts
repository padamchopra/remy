import assert from "node:assert/strict";
import test from "node:test";
import {
  advertisedCloudStartProviders,
  advertisedProviderIds,
  canStartWithShareGrant,
  parseStartProviderInput,
  parseStartProviders,
  publicStartProviders,
  resolveStartProviders,
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
  assert.throws(() => parseStartProviderInput(["openrouter"], advertised), /providers others may start/);
});

test("cloud model access advertises Claude and Codex, and a share grant is start-only", () => {
  const advertised = advertisedCloudStartProviders([
    { id: "anthropic", enabled: true, configured: true },
    { id: "openrouter", enabled: true, configured: true },
    { id: "openai", enabled: false, configured: true },
    { id: "router", enabled: true, configured: false },
  ]);
  assert.deepEqual(advertised, ["claude", "codex"]);
  assert.equal(canStartWithShareGrant(true, ["claude"], advertised, "codex"), true);
  assert.equal(canStartWithShareGrant(false, ["claude"], advertised, "codex"), false);
  assert.equal(canStartWithShareGrant(false, ["claude"], advertised, "claude"), true);
  assert.equal(canStartWithShareGrant(false, null, advertised, "codex"), true);
});
