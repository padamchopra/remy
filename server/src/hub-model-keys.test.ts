import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// The database opens at import time, so the whole file runs against a throwaway
// directory. node:test gives each file its own process.
process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "mc-hub-model-keys-"));
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;

const keys = await import("./hub-model-keys.js");
const environments = await import("./environments.js");

test("delivered keys are stored sealed, inherited, and reported as changed once", () => {
  assert.equal(keys.applyHubModelKeys({ values: { ANTHROPIC_API_KEY: "test-anthropic-value" } }), true);
  assert.deepEqual(keys.hubModelKeys(), { ANTHROPIC_API_KEY: "test-anthropic-value" });
  assert.equal(process.env.ANTHROPIC_API_KEY, "test-anthropic-value");
  assert.equal(keys.applyHubModelKeys({ values: { ANTHROPIC_API_KEY: "test-anthropic-value" } }), false);

  assert.equal(keys.applyHubModelKeys({ values: { ANTHROPIC_API_KEY: "test-next-value" } }), true);
  assert.equal(process.env.ANTHROPIC_API_KEY, "test-next-value");
});

test("a removed key stops being inherited", () => {
  keys.applyHubModelKeys({ values: { OPENAI_API_KEY: "test-openai-value" } });
  assert.equal(process.env.OPENAI_API_KEY, "test-openai-value");

  assert.equal(keys.applyHubModelKeys({ values: {} }), true);
  assert.deepEqual(keys.hubModelKeys(), {});
  assert.equal(process.env.OPENAI_API_KEY, undefined);
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
});

test("only the provider keys Remy delivers are accepted", () => {
  assert.throws(() => keys.applyHubModelKeys(null));
  assert.throws(() => keys.applyHubModelKeys({ values: "ANTHROPIC_API_KEY" }));
  assert.throws(() => keys.applyHubModelKeys({ values: { ANTHROPIC_API_KEY: 7 } }));
  assert.throws(() => keys.applyHubModelKeys({ values: { ANTHROPIC_API_KEY: "a".repeat(8193) } }));

  keys.applyHubModelKeys({ values: { ANTHROPIC_API_KEY: "test-anthropic-value", PATH: "/tmp/test", MC_CONFIG_DIR: "/tmp/test" } });
  assert.deepEqual(keys.hubModelKeys(), { ANTHROPIC_API_KEY: "test-anthropic-value" });
  assert.notEqual(process.env.PATH, "/tmp/test");
});

test("a thread runs with the keys this computer was given", async () => {
  keys.applyHubModelKeys({ values: { ANTHROPIC_API_KEY: "test-anthropic-value" } });
  assert.deepEqual(await environments.taskEnvironment("/tmp"), { ANTHROPIC_API_KEY: "test-anthropic-value" });
  assert.equal(environments.redactKnownSecrets("key test-anthropic-value here"), "key [REDACTED] here");
});

test("detaching the computer forgets its keys", () => {
  keys.applyHubModelKeys({ values: { ANTHROPIC_API_KEY: "test-anthropic-value" } });
  keys.forgetHubModelKeys();
  assert.deepEqual(keys.hubModelKeys(), {});
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined);

  keys.restoreHubModelKeys();
  assert.deepEqual(keys.hubModelKeys(), {});
});
