import assert from "node:assert/strict";
import test from "node:test";
import { claudeModels, codexModels, cursorModels } from "./provider-discovery.js";

test("Claude's SDK names the installed generations and context windows", () => {
  const models = claudeModels([
    {
      value: "default",
      resolvedModel: "claude-opus-5[1m]",
      displayName: "Default (recommended)",
      description: "Use the default model (currently Opus 5 (1M context))",
    },
    {
      value: "sonnet",
      resolvedModel: "claude-sonnet-5",
      displayName: "Sonnet",
      description: "Sonnet 5 · Efficient for routine tasks",
    },
  ]);

  assert.deepEqual(models[0], { value: "", label: "Default", resolvedLabel: "Opus 5 (1M)" });
  assert.equal(models[1]?.label, "Sonnet 5");
  assert.equal(models[1]?.context, "200K");
});

test("Claude generation decimals stay decimals", () => {
  const [fable, haiku] = claudeModels([
    {
      value: "claude-fable-5-1[1m]",
      resolvedModel: "claude-fable-5-1",
      displayName: "Fable",
      description: "Fable 5.1 · Most capable for ambitious work",
    },
    {
      value: "haiku",
      resolvedModel: "claude-haiku-4-5-20251001",
      displayName: "Haiku",
      description: "Haiku 4.5 · Fastest for quick answers",
    },
  ]);
  assert.equal(fable?.label, "Fable 5.1");
  assert.equal(fable?.context, "1M");
  assert.equal(haiku?.label, "Haiku 4.5");
});

test("Codex app-server models keep its live names and default", () => {
  const models = codexModels([
    {
      model: "gpt-5.6-sol",
      displayName: "GPT-5.6-Sol",
      isDefault: true,
      hidden: false,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Fast." },
        { reasoningEffort: "high", description: "Deep." },
      ],
    },
    { model: "hidden", displayName: "Hidden", hidden: true },
  ]);

  assert.equal(models[0]?.resolvedLabel, "GPT-5.6 Sol");
  assert.equal(models[0]?.defaultEffort, "high");
  assert.deepEqual(models[0]?.efforts, [
    { value: "low", label: "Low", detail: "Fast." },
    { value: "high", label: "High", detail: "Deep." },
  ]);
  assert.equal(models[1]?.label, "GPT-5.6 Sol");
  assert.equal(models.length, 2);
});

test("Codex formats Astra model names for the picker", () => {
  const models = codexModels([{ model: "gpt-6-astra", displayName: "GPT-6-Astra" }]);

  assert.equal(models[1]?.label, "GPT-6 Astra");
});

test("Cursor models come from the installed CLI and show its active default", () => {
  const models = cursorModels(
    "Available models\n\nauto - Auto (default)\ngrok-4.6[effort=high,fast=true] - Grok 4.6 High Fast (256K)\n",
    "CLI Version         2026.08.11\nModel               Cursor Grok 4.6 High Fast\n",
  );

  assert.deepEqual(models[0], { value: "", label: "Default", resolvedLabel: "Cursor Grok 4.6 High Fast" });
  assert.deepEqual(models[1], { value: "auto", label: "Auto" });
  assert.equal(models[2]?.value, "grok-4.6[effort=high,fast=true]");
  assert.equal(models[2]?.context, "256K");
});
