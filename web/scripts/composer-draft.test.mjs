import assert from "node:assert/strict";
import test from "node:test";
import { readComposerDraft, writeComposerDraft } from "../src/lib/composer-draft.ts";

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
