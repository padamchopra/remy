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
const { hostedComposerChoice, hostedExecutionChoice, hostedModels } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

test("hosted models keep the current choice selectable before access arrives", () => {
  const models = hostedModels([], false, { provider: "openrouter", model: "openrouter/auto" });
  assert.deepEqual(
    models.map((entry) => ({ id: entry.id, values: entry.models.map((model) => model.value) })),
    [{ id: "openrouter", values: ["openrouter/auto"] }],
  );
});

test("hosted models list enabled providers and prepend a missing current choice", () => {
  const models = hostedModels(
    [{ id: "openrouter", enabled: true, configured: true, models: ["test/model-a", "test/model-b"] }],
    false,
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
    false,
  );
  assert.deepEqual(models.map((entry) => entry.id), []);
});

test("hosted models do not paint an unconfigured saved default once access has arrived", () => {
  const models = hostedModels(
    [
      { id: "anthropic", enabled: true, configured: true, models: [] },
      { id: "openrouter", enabled: false, configured: false, models: [] },
    ],
    false,
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
    false,
    { provider: "openrouter", model: "openrouter/auto" },
  );
  assert.equal(choice.provider, "anthropic");
  assert.equal(
    hostedComposerChoice(
      [{ id: "openrouter", enabled: true, configured: true, models: ["vendor/model"] }],
      false,
      { provider: "openrouter", model: "openrouter/auto" },
    ).model,
    "openrouter/auto",
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
