import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const stateDir = mkdtempSync(join(tmpdir(), "remy-subthreads-state-"));
process.env.MC_CONFIG_DIR = stateDir;

const binDir = mkdtempSync(join(tmpdir(), "remy-subthreads-bin-"));
for (const command of ["claude", "codex", "agent"]) {
  const path = join(binDir, command);
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
}
process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;

const {
  chatGroup,
  createChat,
  deleteChatGroup,
  getChat,
} = await import("./chat.js");
const storage = await import("./chat-storage.js");

const cwd = mkdtempSync(join(tmpdir(), "remy-subthreads-cwd-"));

test("a subthread inherits the parent's exact execution context", () => {
  const parent = createChat({
    cwd,
    provider: "codex",
    model: "gpt-5.6-sol",
    effort: "high",
    permissionMode: "bypassPermissions",
  });
  const child = createChat({
    cwd: "/a/path/the/caller/must/not-control",
    parentChatId: parent.id,
    provider: "claude",
    model: "opus",
    effort: "low",
    permissionMode: "plan",
  });

  assert.equal(child.parentChatId, parent.id);
  assert.equal(child.cwd, parent.cwd);
  assert.equal(child.provider, parent.provider);
  assert.equal(child.model, parent.model);
  assert.equal(child.effort, parent.effort);
  assert.equal(child.permissionMode, parent.permissionMode);
  assert.equal(storage.loadChat(child.id, 10)?.parentChatId, parent.id);
  assert.throws(
    () => createChat({ parentChatId: child.id }),
    /cannot start another subthread/,
  );

  assert.deepEqual(chatGroup(parent.id).map((chat) => chat.id), [parent.id, child.id]);
  deleteChatGroup(parent.id);
  assert.equal(getChat(parent.id), undefined);
  assert.equal(getChat(child.id), undefined);
});
