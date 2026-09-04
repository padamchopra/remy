import assert from "node:assert/strict";
import test from "node:test";
import {
  codexSandbox,
  knowsEffort,
  knowsModel,
  modelLabel,
  PROVIDERS,
  providerEffort,
  providerId,
  providerModel,
  rememberProviderModels,
} from "./providers.js";

test("every provider offers a default, and names its own executable", () => {
  for (const provider of PROVIDERS) {
    assert.equal(provider.models[0]?.value, "", `${provider.id} should start with its default`);
    assert.ok(provider.command, `${provider.id} needs a command`);
  }
});

test("an unknown provider falls back rather than being stored", () => {
  assert.equal(providerId("codex"), "codex");
  assert.equal(providerId("cursor"), "cursor");
  assert.equal(providerId("gemini"), "claude");
  assert.equal(providerId(undefined, "codex"), "codex");
});

test("a model only ever belongs to the provider that answers to it", () => {
  assert.equal(providerModel("claude", "sonnet"), "sonnet");
  assert.equal(providerModel("claude", "claude-fable-5-1[1m]"), "claude-fable-5-1[1m]");
  assert.equal(providerModel("codex", "sonnet"), "");
  assert.equal(providerModel("codex", "gpt-5.6-sol"), "gpt-5.6-sol");
  assert.equal(knowsModel("claude", "gpt-5.6-sol"), false);
  assert.equal(knowsModel("claude", ""), true);
  assert.equal(providerModel("cursor", "grok-4.6[effort=high,fast=true]"), "grok-4.6[effort=high,fast=true]");
  assert.equal(providerModel("cursor", "not a safe alias"), "");
});

test("a model reads as its own name, and an empty one as the default", () => {
  assert.equal(modelLabel("claude", "opus"), "Opus 5");
  assert.equal(modelLabel("claude", "claude-fable-5-1[1m]"), "Fable 5.1");
  assert.equal(modelLabel("codex", "gpt-5.6-luna"), "GPT-5.6 Luna");
  assert.equal(modelLabel("codex", ""), "Default");
});

test("effort belongs to the selected provider model", () => {
  assert.equal(providerEffort("claude", "sonnet", "high"), "high");
  assert.equal(providerEffort("claude", "sonnet", "ultra"), "");
  assert.equal(knowsEffort("codex", "gpt-5.6-sol", "ultra"), true);

  rememberProviderModels("codex", [{
    value: "future-codex",
    label: "Future Codex",
    efforts: [{ value: "brief", label: "Brief" }],
  }]);
  assert.equal(providerEffort("codex", "future-codex", "brief"), "brief");
  assert.equal(providerEffort("codex", "future-codex", "high"), "");
});

test("Codex keeps a conservative sandbox fallback for each permission mode", () => {
  assert.equal(codexSandbox("default").sandbox, "read-only");
  assert.equal(codexSandbox("plan").sandbox, "read-only");
  assert.equal(codexSandbox("acceptEdits").sandbox, "workspace-write");
  assert.equal(codexSandbox("auto").sandbox, "workspace-write");
  assert.equal(codexSandbox("bypassPermissions").sandbox, "danger-full-access");
  assert.equal(codexSandbox("default").approval, "never");
});
