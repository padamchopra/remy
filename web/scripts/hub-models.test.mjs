import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  absWorkingDir: root,
  entryPoints: ["src/lib/hub-models.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  alias: { "@": resolve(root, "src") },
});
const { cloudCatalogue, cloudShareAllowsProvider, computerModels, enrolledModels, executionToChoice, hostedComposerChoice, hostedExecutionChoice, hostedModels, ownModels, threadModelPicker } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

test("hosted models keep the current choice selectable before access arrives", () => {
  const models = hostedModels([], { provider: "openrouter", model: "openrouter/auto" });
  assert.deepEqual(
    models.map((entry) => ({ id: entry.id, values: entry.models.map((model) => model.value) })),
    [{ id: "openrouter", values: ["openrouter/auto"] }],
  );
});

test("hosted models list enabled providers and prepend a missing current choice", () => {
  const models = hostedModels(
    [{ id: "openrouter", enabled: true, configured: true, models: ["test/model-a", "test/model-b"] }],
    { provider: "openrouter", model: "openrouter/auto" },
  );
  assert.deepEqual(
    models.find((entry) => entry.id === "openrouter")?.models.map((model) => model.value),
    ["openrouter/auto", "test/model-a", "test/model-b"],
  );
});

test("hosted models omit providers that are turned off", () => {
  const models = hostedModels(
    [{ id: "openrouter", enabled: false, configured: true, models: ["openrouter/auto"] }],
  );
  assert.deepEqual(models.map((entry) => entry.id), []);
});

test("hosted models do not paint an unconfigured saved default once access has arrived", () => {
  const models = hostedModels(
    [
      { id: "anthropic", enabled: true, configured: true, models: [] },
      { id: "openrouter", enabled: false, configured: false, models: [] },
    ],
    { provider: "openrouter", model: "openrouter/auto" },
  );
  assert.deepEqual(models.map((entry) => entry.id), ["anthropic"]);
});

test("hosted composer start uses an enabled provider instead of an unconfigured default", () => {
  const choice = hostedComposerChoice(
    [
      { id: "anthropic", enabled: true, configured: true, models: [] },
      { id: "openrouter", enabled: false, configured: false, models: [] },
    ],
    { provider: "openrouter", model: "openrouter/auto" },
  );
  assert.equal(choice.provider, "anthropic");
  assert.equal(
    hostedComposerChoice(
      [{ id: "openrouter", enabled: true, configured: true, models: ["vendor/model"] }],
      { provider: "openrouter", model: "openrouter/auto" },
    ).model,
    "openrouter/auto",
  );
});

test("cloud share grants match a gateway id or a legacy Codex runtime", () => {
  assert.equal(cloudShareAllowsProvider(undefined, "openrouter"), true);
  assert.equal(cloudShareAllowsProvider(new Set(["openrouter"]), "openrouter"), true);
  assert.equal(cloudShareAllowsProvider(new Set(["codex"]), "openrouter"), true);
  assert.equal(cloudShareAllowsProvider(new Set(["anthropic"]), "openrouter"), false);
  assert.equal(cloudShareAllowsProvider(new Set(["openrouter"]), "codex"), false);
});

test("hosted models never add a Claude Code account row, and add ChatGPT only when signed in", () => {
  const signedOut = hostedModels(
    [{ id: "openai", enabled: true, configured: true, models: [] }],
  );
  assert.deepEqual(signedOut.map((entry) => entry.id), ["openai"]);
  assert.equal(signedOut[0].label, "OpenAI");
  const signedIn = hostedModels(
    [{ id: "openai", enabled: true, configured: true, models: [] }],
    undefined,
    true,
  );
  assert.deepEqual(signedIn.map((entry) => ({ id: entry.id, label: entry.label })), [
    { id: "openai", label: "OpenAI" },
    { id: "codex", label: "ChatGPT" },
  ]);
  assert.ok(signedIn[1].models.length > 0);
  assert.equal(signedIn.find((entry) => entry.id === "claude"), undefined);
});

test("a ChatGPT start runs Codex on the account, not an API key gateway", () => {
  const choice = hostedComposerChoice([], { provider: "codex", model: "gpt-5.5" }, true);
  assert.deepEqual(choice, { provider: "codex", model: "gpt-5.5" });
  assert.deepEqual(hostedExecutionChoice(choice), { provider: "codex", model: "gpt-5.5" });
  const fallback = hostedComposerChoice(
    [{ id: "openai", enabled: true, configured: true, models: [] }],
    { provider: "codex", model: "gpt-5.5" },
  );
  assert.equal(fallback.provider, "openai");
});

test("hosted models keep Claude Opus 5.5 choosable while OpenRouter is selected", () => {
  const models = hostedModels(
    [
      { id: "anthropic", enabled: true, configured: true, models: [] },
      { id: "openrouter", enabled: true, configured: true, models: ["openrouter/auto", "anthropic/claude-opus-5.5"] },
    ],
    { provider: "openrouter", model: "openrouter/auto" },
  );
  assert.deepEqual(models.map((entry) => entry.id), ["anthropic", "openrouter"]);
  assert.ok(models.find((entry) => entry.id === "anthropic")?.models.some((model) => model.value === "claude-opus-5-5" && model.label === "Opus 5.5"));
  assert.equal(models.find((entry) => entry.id === "claude"), undefined);
  assert.equal(
    models.find((entry) => entry.id === "openrouter")?.models.find((model) => model.value === "anthropic/claude-opus-5.5")?.label,
    "Opus 5.5 (1M)",
  );
});

test("hosted execution maps OpenRouter onto Codex without a double remy prefix", () => {
  assert.deepEqual(hostedExecutionChoice({ provider: "openrouter", model: "openrouter/auto" }), {
    provider: "codex",
    model: "remy:openrouter:openrouter/auto",
  });
  assert.deepEqual(hostedExecutionChoice({ provider: "openrouter", model: "remy:openrouter:openrouter/auto" }), {
    provider: "codex",
    model: "remy:openrouter:openrouter/auto",
  });
  assert.deepEqual(hostedExecutionChoice({ provider: "codex", model: "remy:openrouter:openrouter/auto" }), {
    provider: "codex",
    model: "remy:openrouter:openrouter/auto",
  });
});

test("computer models take the names the computer reports", () => {
  const [claude] = computerModels([{
    id: "claude",
    models: ["", "sonnet"],
    modelInfo: [
      { value: "", label: "Default", resolvedLabel: "Sonnet 5 (200K)" },
      { value: "sonnet", label: "Sonnet 5", context: "200K" },
    ],
  }]);
  assert.deepEqual(claude.models.map((model) => [model.value, model.label, model.context, model.resolvedLabel]), [
    ["", "Default", undefined, "Sonnet 5 (200K)"],
    ["sonnet", "Sonnet 5", "200K", undefined],
  ]);
});

test("computer models from an older daemon take Remy's names, and keep unknown ids as ids", () => {
  const [claude, codex, cursor] = computerModels([
    { id: "claude", models: ["opus", "claude-opus-5-5"] },
    { id: "codex", models: ["gpt-5.4-mini"] },
    { id: "cursor", models: ["composer-2.5"] },
  ]);
  assert.deepEqual(claude.models.map((model) => model.label), ["Opus 5", "Opus 5.5"]);
  assert.deepEqual(codex.models.map((model) => model.label), ["GPT-5.4 Mini"]);
  assert.deepEqual(cursor.models.map((model) => model.label), ["composer-2.5"]);
});

test("a stored execution pair reads back as the picker's choice", () => {
  assert.deepEqual(executionToChoice("claude", "claude-opus-5.5", true), { provider: "anthropic", model: "claude-opus-5.5" });
  assert.deepEqual(executionToChoice("claude", "claude-opus-5.5", false), { provider: "claude", model: "claude-opus-5.5" });
  assert.deepEqual(executionToChoice("codex", "remy:openrouter:anthropic/claude-opus-5.5", true), { provider: "openrouter", model: "anthropic/claude-opus-5.5" });
  for (const choice of [{ provider: "anthropic", model: "x" }, { provider: "openrouter", model: "a/b" }]) {
    const pair = hostedExecutionChoice(choice);
    assert.deepEqual(executionToChoice(pair.provider, pair.model, true), choice);
  }
});

test("a running thread's picker offers its own provider's models and writes back its gateway", () => {
  const picker = threadModelPicker({ provider: "codex", model: "remy:openrouter:openai/gpt-5" }, undefined, []);
  assert.equal(picker.modelProvider, "openrouter");
  assert.deepEqual(picker.value, { provider: "openrouter", model: "openai/gpt-5", effort: "" });
  assert.deepEqual(picker.options({ provider: "openrouter", model: "openai/gpt-6" }), { model: "remy:openrouter:openai/gpt-6", effort: null });
  const local = threadModelPicker({ provider: "claude", model: "claude-opus-5.5" }, { capabilities: { providers: [{ id: "claude", models: ["claude-opus-5.5"] }] } }, []);
  assert.equal(local.modelProvider, "claude");
  assert.deepEqual(local.providers.map((provider) => provider.id), ["claude"]);
});

test("each of your own keys joins the cloud catalogue as its own tab", () => {
  const own = [
    { id: "chatgpt", configured: true, allowed: true, keyName: null, models: [], keys: [] },
    { id: "openrouter", configured: true, allowed: true, keyName: "Primary", models: ["anthropic/claude-opus-5.5"], keys: [{ id: "primary", name: "Primary", models: ["anthropic/claude-opus-5.5"] }, { id: "sandbox", name: "Sandbox", models: ["openrouter/auto"] }] },
    { id: "anthropic", configured: false, allowed: false, keyName: null, models: [], keys: [] },
    { id: "openai", configured: false, allowed: true, keyName: null, models: [], keys: [] },
  ];
  assert.deepEqual(ownModels(own).map((entry) => entry.id), ["own:openrouter:primary", "own:openrouter:sandbox"]);
  const catalogue = cloudCatalogue([{ id: "openrouter", enabled: true, configured: true, models: ["openrouter/auto"] }], undefined, false, own);
  assert.deepEqual(catalogue.map((entry) => [entry.id, entry.label]), [["openrouter", "OpenRouter"], ["own:openrouter:primary", "OpenRouter · Your Primary"], ["own:openrouter:sandbox", "OpenRouter · Your Sandbox"]]);
  assert.deepEqual(catalogue[1].models.map((model) => model.value), ["anthropic/claude-opus-5.5"]);
});

test("a thread on your own key starts on the provider's runtime and says the key is yours", () => {
  assert.deepEqual(hostedExecutionChoice({ provider: "own:openrouter:primary", model: "openrouter/auto" }), { provider: "codex", model: "remy:openrouter:openrouter/auto", modelSource: "own", modelProvider: "openrouter", modelConnection: "primary" });
  assert.deepEqual(hostedExecutionChoice({ provider: "own:anthropic:work", model: "claude-opus-5-5" }), { provider: "claude", model: "claude-opus-5-5", modelSource: "own", modelProvider: "anthropic", modelConnection: "work" });
  const enrolled = enrolledModels([{ connectionId: "ada:openrouter:team", provider: "openrouter", owner: "Ada", keyId: "team", keyName: "Team", models: ["openrouter/auto"] }]);
  assert.equal(enrolled[0].label, "OpenRouter · Ada · Team");
  assert.deepEqual(hostedExecutionChoice({ provider: enrolled[0].id, model: "openrouter/auto" }), { provider: "codex", model: "remy:openrouter:openrouter/auto", modelSource: "enrolled", modelProvider: "openrouter", modelConnection: "ada:openrouter:team" });
  assert.deepEqual(hostedExecutionChoice({ provider: "openrouter", model: "openrouter/auto" }), { provider: "codex", model: "remy:openrouter:openrouter/auto" });
});

test("a saved default on your own key survives when that key is on", () => {
  const own = [{ id: "openrouter", configured: true, allowed: true, keyName: "Primary", models: ["openrouter/auto"], keys: [{ id: "primary", name: "Primary", models: ["openrouter/auto"] }] }];
  assert.deepEqual(hostedComposerChoice([], { provider: "own:openrouter:primary", model: "openrouter/auto" }, false, own), { provider: "own:openrouter:primary", model: "openrouter/auto" });
  assert.equal(hostedComposerChoice([], { provider: "own:openrouter:primary", model: "openrouter/auto" }, false, []).provider, "own:openrouter:primary");
});
