import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// chat.ts opens the database at import time, so the suite runs against a
// throwaway directory. node:test gives each file its own process.
const stateDir = mkdtempSync(join(tmpdir(), "remy-chat-defaults-"));
process.env.MC_CONFIG_DIR = stateDir;
process.env.HOME = stateDir;

// A thread is refused outright on a machine without the provider's command, so
// all are stood up here rather than letting the suite depend on what happens
// to be installed.
const binDir = mkdtempSync(join(tmpdir(), "remy-chat-bin-"));
for (const command of ["claude", "codex", "agent"]) {
  const path = join(binDir, command);
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
}
process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;

const {
  archiveConversation,
  createChat,
  deleteChat,
  restoreArchivedChat,
  updateChat,
} = await import("./chat.js");
const { createAgent } = await import("./agents.js");
const { patchSettings } = await import("./config.js");

const cwd = mkdtempSync(join(tmpdir(), "remy-chat-cwd-"));

test("a new thread starts on this machine's default", () => {
  patchSettings({ defaultProvider: "claude", defaultModel: "opus", defaultEffort: "high" });
  const chat = createChat({ cwd });
  assert.equal(chat.provider, "claude");
  assert.equal(chat.model, "opus");
  assert.equal(chat.effort, "high");
});

test("a workspace with a provider of its own stands in for the machine's", () => {
  patchSettings({ defaultProvider: "claude", defaultModel: "opus" });
  const chat = createChat({
    cwd,
    workspaceDefault: { provider: "codex", model: "gpt-5.6-terra", effort: "xhigh" },
  });
  assert.equal(chat.provider, "codex");
  assert.equal(chat.model, "gpt-5.6-terra");
  assert.equal(chat.effort, "xhigh");
});

test("Cursor can be the workspace provider", () => {
  const chat = createChat({ cwd, workspaceDefault: { provider: "cursor", model: "auto" } });
  assert.equal(chat.provider, "cursor");
  assert.equal(chat.model, "auto");
});

test("a workspace that follows the machine changes nothing", () => {
  patchSettings({ defaultProvider: "claude", defaultModel: "haiku" });
  const chat = createChat({ cwd, workspaceDefault: { provider: null, model: null } });
  assert.equal(chat.provider, "claude");
  assert.equal(chat.model, "haiku");
});

test("an inherited agent still outranks a workspace default", () => {
  patchSettings({ defaultProvider: "claude", defaultModel: "sonnet" });
  const agent = createAgent({ name: "Follower" });
  const chat = createChat({
    cwd,
    agentId: agent.id,
    workspaceDefault: { provider: "codex", model: "gpt-5.6-terra" },
  });
  assert.equal(chat.provider, "claude");
  assert.equal(chat.model, "sonnet");
});

test("what the caller asked for outranks both", () => {
  patchSettings({ defaultProvider: "claude", defaultModel: "opus" });
  const chat = createChat({
    cwd,
    provider: "codex",
    model: "gpt-5.6-luna",
    effort: "low",
    workspaceDefault: { provider: "claude", model: "sonnet" },
  });
  assert.equal(chat.provider, "codex");
  assert.equal(chat.model, "gpt-5.6-luna");
  assert.equal(chat.effort, "low");
});

test("asking for a provider's own default is a choice, not a gap", () => {
  patchSettings({ defaultProvider: "claude", defaultModel: "opus" });
  // Picking Default in the window means "whatever Claude Code is set to", so it
  // must not be quietly filled in with the machine's model.
  const chat = createChat({ cwd, provider: "claude", model: "" });
  assert.equal(chat.provider, "claude");
  assert.equal(chat.model, undefined);
});

test("a started thread can change model, effort, and permission but not provider", () => {
  const chat = createChat({ cwd, provider: "codex", model: "gpt-5.6-sol", effort: "low" });
  const changed = updateChat(chat.id, {
    model: "gpt-5.6-terra",
    effort: "high",
    permissionMode: "bypassPermissions",
  });
  assert.equal(changed.provider, "codex");
  assert.equal(changed.model, "gpt-5.6-terra");
  assert.equal(changed.effort, "high");
  assert.equal(changed.permissionMode, "bypassPermissions");
  assert.throws(
    () => updateChat(chat.id, { provider: "claude" }),
    /keeps the provider it started with/,
  );
});

test("a thread can be pinned and restored from its archive", () => {
  const original = createChat({ cwd, provider: "codex", model: "gpt-5.6-sol", effort: "high" });
  const pinned = updateChat(original.id, { pinned: true });
  assert.equal(pinned.pinned, true);

  const conversation = archiveConversation(original.id);
  deleteChat(original.id);
  const restored = restoreArchivedChat({
    chatId: original.id,
    session: original.title,
    cwd: original.cwd,
    conversation,
  });
  assert.equal(restored.id, original.id);
  assert.equal(restored.provider, "codex");
  assert.equal(restored.model, "gpt-5.6-sol");
  assert.equal(restored.effort, "high");
  assert.equal(restored.pinned, undefined);
});

test("a new thread starts on the permission mode this machine was set to", () => {
  assert.equal(createChat({ cwd }).permissionMode, "default");
  patchSettings({ defaultPermissionMode: "acceptEdits" });
  assert.equal(createChat({ cwd }).permissionMode, "acceptEdits");
  // Whatever the caller asks for still wins, the way the model does.
  assert.equal(createChat({ cwd, permissionMode: "plan" }).permissionMode, "plan");
});
