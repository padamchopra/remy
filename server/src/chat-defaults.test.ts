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
const { patchSettings } = await import("./config.js");

const cwd = mkdtempSync(join(tmpdir(), "remy-chat-cwd-"));

test("a new thread with no pick starts on the first provider's own default", () => {
  const chat = createChat({ cwd });
  assert.equal(chat.provider, "claude");
  assert.equal(chat.model, undefined);
  assert.equal(chat.effort, undefined);
});

test("what the caller asked for outranks the machine's default", () => {
  const chat = createChat({
    cwd,
    provider: "codex",
    model: "gpt-5.6-luna",
    effort: "low",
  });
  assert.equal(chat.provider, "codex");
  assert.equal(chat.model, "gpt-5.6-luna");
  assert.equal(chat.effort, "low");
});

test("asking for a provider's own default is a choice, not a gap", () => {
  // Picking Default in the window means "whatever Claude Code is set to", so it
  // must not be quietly filled in with another model.
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

test("a new thread starts on Ask unless the caller picks a permission mode", () => {
  // A stored default from an older Remy is ignored.
  patchSettings({ defaultPermissionMode: "acceptEdits" });
  assert.equal(createChat({ cwd }).permissionMode, "default");
  assert.equal(createChat({ cwd, permissionMode: "plan" }).permissionMode, "plan");
});
