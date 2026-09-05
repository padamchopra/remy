import assert from "node:assert/strict";
import test from "node:test";
import {
  readComposerDraft,
  readNewThreadTarget,
  writeComposerDraft,
  writeNewThreadTarget,
} from "../src/lib/composer-draft.ts";

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test("restores and clears an unsent composer draft", () => {
  globalThis.sessionStorage = new MemoryStorage();
  writeComposerDraft("thread:one", "Keep this thought");
  assert.equal(readComposerDraft("thread:one"), "Keep this thought");

  writeComposerDraft("thread:one", "");
  assert.equal(readComposerDraft("thread:one"), "");
});

test("keeps drafts scoped to their composer", () => {
  globalThis.sessionStorage = new MemoryStorage();
  writeComposerDraft("thread:one", "First");
  writeComposerDraft("new-thread", "Second");
  assert.equal(readComposerDraft("thread:one"), "First");
  assert.equal(readComposerDraft("new-thread"), "Second");
});

test("restores the last workspace and device for a new thread", () => {
  globalThis.localStorage = new MemoryStorage();
  writeNewThreadTarget({ workspaceId: "workspace-one", serverId: "device-two" });
  assert.deepEqual(readNewThreadTarget(), { workspaceId: "workspace-one", serverId: "device-two" });

  writeNewThreadTarget({ workspaceId: null, serverId: "device-one" });
  assert.deepEqual(readNewThreadTarget(), { workspaceId: null, serverId: "device-one" });
});

test("ignores an invalid remembered new-thread target", () => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.localStorage.setItem("remy.new-thread-target", JSON.stringify({ workspaceId: 4, serverId: "device-one" }));
  assert.equal(readNewThreadTarget(), undefined);
});
