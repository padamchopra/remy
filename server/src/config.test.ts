import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// config.ts opens the database at import time, so the whole suite runs against
// a throwaway directory. node:test gives each file its own process.
const stateDir = mkdtempSync(join(tmpdir(), "remy-config-test-"));
process.env.MC_CONFIG_DIR = stateDir;
process.env.HOME = stateDir;

const {
  hasTailscaleServePreference,
  patchSettings,
  publicSettings,
  setProviderEnabled,
  worktreeRootPath,
} = await import("./config.js");

test("takes a worktree root only when it is somewhere git can write", () => {
  assert.equal(worktreeRootPath("/vol/trees"), "/vol/trees");
  assert.equal(worktreeRootPath("/vol/trees/"), "/vol/trees");
  assert.equal(worktreeRootPath("~/trees"), join(stateDir, "trees"));
  assert.equal(worktreeRootPath("~"), stateDir);
  // A relative path would resolve against whatever the server's cwd happens to
  // be, so it is refused rather than guessed at.
  assert.equal(worktreeRootPath("trees"), "");
  assert.equal(worktreeRootPath("  "), "");
  assert.equal(worktreeRootPath(undefined), "");
  assert.equal(worktreeRootPath(42), "");
});

test("starts on the defaults a fresh install should have", () => {
  const settings = publicSettings();
  assert.equal(settings.defaultCheckout, "main");
  assert.equal(settings.worktreeBase, "remote");
  assert.equal(settings.worktreeRoot, "");
  assert.equal(settings.defaultModel, "");
  assert.equal(settings.defaultEffort, "");
  // Remy's own jobs are small and frequent, so they start on the cheap model
  // rather than on whatever the chats are using.
  assert.equal(settings.remyModel, "haiku");
  assert.equal(settings.deviceName, "");
  assert.equal(settings.deviceIcon, "");
  assert.equal(settings.deviceTint, "");
  assert.equal(settings.tailscaleServeEnabled, false);
  assert.deepEqual(settings.favoriteModels, []);
  assert.deepEqual(settings.enabledProviders, ["claude", "codex", "cursor"]);
});

test("remembers whether Tailnet reachability was explicitly chosen", () => {
  assert.equal(hasTailscaleServePreference(), false);
  assert.equal(patchSettings({ tailscaleServeEnabled: true }).tailscaleServeEnabled, true);
  assert.equal(hasTailscaleServePreference(), true);
  assert.equal(patchSettings({ tailscaleServeEnabled: false }).tailscaleServeEnabled, false);
});

test("keeps at least one provider on and moves defaults off a disabled provider", () => {
  patchSettings({ defaultProvider: "cursor", defaultModel: "auto", remyProvider: "cursor", remyModel: "auto" });
  let settings = setProviderEnabled("cursor", false);
  assert.deepEqual(settings.enabledProviders, ["claude", "codex"]);
  assert.equal(settings.defaultProvider, "claude");
  assert.equal(settings.defaultModel, "");
  assert.equal(settings.remyProvider, "claude");
  assert.equal(settings.remyModel, "");

  settings = setProviderEnabled("codex", false);
  assert.deepEqual(settings.enabledProviders, ["claude"]);
  assert.throws(() => setProviderEnabled("claude", false), /keep at least one provider on/);
  setProviderEnabled("codex", true);
  setProviderEnabled("cursor", true);
  patchSettings({ defaultProvider: "claude", defaultModel: "", remyProvider: "claude", remyModel: "haiku" });
});

test("keeps valid model favorites and drops values no provider accepts", () => {
  const settings = patchSettings({
    favoriteModels: ["claude:opus", "codex:gpt-5.6-terra", "claude:not-real", "claude:opus"],
  });
  assert.deepEqual(settings.favoriteModels, ["claude:opus", "codex:gpt-5.6-terra"]);
});

test("keeps a git-safe branch prefix and falls back to Remy", () => {
  assert.equal(patchSettings({ worktreeBranchPrefix: " padamchopra/ " }).worktreeBranchPrefix, "padamchopra");
  assert.equal(patchSettings({ worktreeBranchPrefix: "feature team" }).worktreeBranchPrefix, "feature-team");
  assert.equal(patchSettings({ worktreeBranchPrefix: "///" }).worktreeBranchPrefix, "remy");
});

test("stores only a usable device identity", () => {
  let settings = patchSettings({ deviceName: "  The Studio  ", deviceIcon: "monitor", deviceTint: "violet" });
  assert.equal(settings.deviceName, "The Studio");
  assert.equal(settings.deviceIcon, "monitor");
  assert.equal(settings.deviceTint, "violet");

  settings = patchSettings({ deviceIcon: "spaceship", deviceTint: "ultraviolet" });
  assert.equal(settings.deviceIcon, "");
  assert.equal(settings.deviceTint, "");
});

test("starts a thread on Ask until the machine is told otherwise", () => {
  assert.equal(publicSettings().defaultPermissionMode, "default");
  assert.equal(patchSettings({ defaultPermissionMode: "acceptEdits" }).defaultPermissionMode, "acceptEdits");
  // A mode this machine has never heard of keeps the one it had, rather than
  // quietly landing a thread on something more permissive than was asked for.
  assert.equal(patchSettings({ defaultPermissionMode: "yolo" }).defaultPermissionMode, "acceptEdits");
  assert.equal(patchSettings({ defaultPermissionMode: "default" }).defaultPermissionMode, "default");
});

test("keeps Remy's own model separate from the chat default", () => {
  patchSettings({ defaultModel: "opus" });
  assert.equal(publicSettings().remyModel, "haiku");
  patchSettings({ remyModel: "sonnet" });
  assert.equal(publicSettings().defaultModel, "opus");
  assert.equal(publicSettings().remyModel, "sonnet");
});

test("stores effort with the selected provider model", () => {
  let settings = patchSettings({ defaultProvider: "claude", defaultModel: "opus", defaultEffort: "high" });
  assert.equal(settings.defaultEffort, "high");

  settings = patchSettings({ defaultEffort: "not-real" });
  assert.equal(settings.defaultEffort, "high");

  settings = patchSettings({ defaultProvider: "codex", defaultModel: "gpt-5.6-sol", defaultEffort: "ultra" });
  assert.equal(settings.defaultEffort, "ultra");
  patchSettings({ defaultProvider: "claude", defaultModel: "opus", defaultEffort: "high" });
});

test("patches only the keys the caller sent", () => {
  patchSettings({ defaultCheckout: "worktree", defaultModel: "opus" });
  assert.equal(publicSettings().defaultCheckout, "worktree");
  assert.equal(publicSettings().defaultModel, "opus");

  // A client that knows about one setting must not reset the others.
  patchSettings({ worktreeBase: "local" });
  assert.equal(publicSettings().worktreeBase, "local");
  assert.equal(publicSettings().defaultCheckout, "worktree");
  assert.equal(publicSettings().defaultModel, "opus");
});

test("keeps the current value when a patch is not a value it knows", () => {
  patchSettings({ defaultCheckout: "worktree" });
  patchSettings({ defaultCheckout: "nonsense" });
  assert.equal(publicSettings().defaultCheckout, "worktree");

  patchSettings({ defaultModel: "gpt-4" });
  assert.equal(publicSettings().defaultModel, "opus");
});

test("turns the retired committer mode into agent attribution", () => {
  patchSettings({ defaultGitIdentity: "off" });
  patchSettings({ defaultGitIdentity: "full" });
  assert.equal(publicSettings().defaultGitIdentity, "author");
});

test("a provider and a model change together", () => {
  patchSettings({ defaultProvider: "claude", defaultModel: "sonnet" });
  assert.equal(publicSettings().defaultModel, "sonnet");

  // Moving to Codex cannot keep a Claude alias Codex would refuse.
  patchSettings({ defaultProvider: "codex" });
  assert.equal(publicSettings().defaultProvider, "codex");
  assert.equal(publicSettings().defaultModel, "");

  patchSettings({ defaultModel: "gpt-5.6-terra" });
  assert.equal(publicSettings().defaultModel, "gpt-5.6-terra");

  patchSettings({ defaultProvider: "claude", defaultModel: "opus" });
  assert.equal(publicSettings().defaultModel, "opus");
});

test("Remy's own jobs can be declined, and follow their own provider", () => {
  patchSettings({ remyProvider: "claude", remyModel: "haiku" });
  patchSettings({ remyModel: "off" });
  assert.equal(publicSettings().remyModel, "off");

  patchSettings({ remyProvider: "codex", remyModel: "gpt-5.6-luna" });
  assert.equal(publicSettings().remyProvider, "codex");
  assert.equal(publicSettings().remyModel, "gpt-5.6-luna");
  // And the chats' own default is untouched by any of it.
  assert.equal(publicSettings().defaultModel, "opus");
});

test("survives a round trip through the database", async () => {
  patchSettings({ worktreeRoot: "/vol/trees", defaultModel: "haiku" });
  // A second module instance reads the same row a restart would.
  const reloaded = await import(`./config.js?reload=${Date.now()}`);
  assert.equal(reloaded.publicSettings().worktreeRoot, "/vol/trees");
  assert.equal(reloaded.publicSettings().defaultModel, "haiku");
});
