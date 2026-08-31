import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ConvEntry } from "./transcript.js";
// Type-only, so it is erased at compile time and does not open the database
// before the directory override below takes effect.
import type { ChatRow } from "./chat-storage.js";

// The storage module opens its database at import time against `configDir`, so
// the whole suite runs against a throwaway directory. node:test gives each file
// its own process, so setting this here cannot leak into another test file.
const stateDir = mkdtempSync(join(tmpdir(), "mc-chat-storage-"));
process.env.MC_CONFIG_DIR = stateDir;

// Imported after the override so paths.ts resolves to the temp directory.
const storage = await import("./chat-storage.js");

function entry(id: string, text: string): ConvEntry {
  return { id, kind: "assistant", text };
}

function chat(id: string, overrides: Partial<ChatRow> = {}): ChatRow {
  return {
    id,
    title: `Chat ${id}`,
    cwd: "/tmp",
    provider: "claude",
    permissionMode: "default",
    createdAt: 1,
    updatedAt: 2,
    turns: 0,
    todos: [],
    ...overrides,
  };
}

test("stores a chat and reads it back with its feed in order", () => {
  assert.equal(storage.chatStorageAvailable(), true, storage.chatStorageError() ?? "");
  storage.saveChat(chat("a", {
    model: "opus",
    effort: "high",
    claudeSessionId: "session-1",
    turns: 3,
    costUsd: 0.5,
    pinned: true,
  }));
  storage.saveEntry("a", entry("e1", "first"));
  storage.saveEntry("a", entry("e2", "second"));
  storage.saveEntry("a", entry("e3", "third"));

  const loaded = storage.loadChats(100).find((c) => c.id === "a");
  assert.ok(loaded);
  assert.equal(loaded.model, "opus");
  assert.equal(loaded.effort, "high");
  assert.equal(loaded.claudeSessionId, "session-1");
  assert.equal(loaded.turns, 3);
  assert.equal(loaded.costUsd, 0.5);
  assert.equal(loaded.pinned, true);
  assert.deepEqual(loaded.entries.map((e) => e.id), ["e1", "e2", "e3"]);
});

test("a thread on Codex keeps the id that resumes it there", () => {
  storage.saveChat(chat("codex", { provider: "codex", model: "gpt-5.6-terra", codexThreadId: "thread-7" }));

  const loaded = storage.loadChats(100).find((c) => c.id === "codex");
  assert.equal(loaded?.provider, "codex");
  assert.equal(loaded?.model, "gpt-5.6-terra");
  assert.equal(loaded?.codexThreadId, "thread-7");
  assert.equal(loaded?.claudeSessionId, undefined);
});

test("a thread on Cursor keeps its ACP session id", () => {
  storage.saveChat(chat("cursor", {
    provider: "cursor",
    model: "auto",
    cursorSessionId: "cursor-session-7",
  }));

  const loaded = storage.loadChats(100).find((c) => c.id === "cursor");
  assert.equal(loaded?.provider, "cursor");
  assert.equal(loaded?.model, "auto");
  assert.equal(loaded?.cursorSessionId, "cursor-session-7");
});

test("re-saving an entry updates it in place, keeping its position", () => {
  storage.saveChat(chat("b"));
  storage.saveEntry("b", entry("s1", "partial"));
  storage.saveEntry("b", entry("s2", "after"));
  // What a streaming block does: same id, more text, over and over.
  storage.saveEntry("b", entry("s1", "partial and then some"));

  const loaded = storage.loadChats(100).find((c) => c.id === "b");
  assert.deepEqual(loaded?.entries.map((e) => e.id), ["s1", "s2"]);
  assert.equal(loaded?.entries[0]?.text, "partial and then some");
});

test("activity updates persist in place and disappear when their thread is deleted", () => {
  storage.saveChat(chat("activity"));
  const entry: ConvEntry = { id: "activity:child", kind: "tool", activity: { id: "child", kind: "subagent", provider: "claude", title: "Review", status: "running", startedAt: 1, updatedAt: 2 } };
  storage.saveEntry("activity", entry);
  storage.saveEntry("activity", { ...entry, activity: { ...entry.activity!, status: "completed", output: "Done", completedAt: 3 } });
  const entries = storage.loadChats(100).find((row) => row.id === "activity")!.entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].activity?.status, "completed");
  storage.removeChat("activity");
  assert.equal(storage.loadChats(100).find((row) => row.id === "activity"), undefined);
});

test("the entry limit keeps the newest entries", () => {
  storage.saveChat(chat("c"));
  for (let i = 1; i <= 10; i += 1) storage.saveEntry("c", entry(`n${i}`, `line ${i}`));

  const loaded = storage.loadChats(3).find((c) => c.id === "c");
  assert.deepEqual(loaded?.entries.map((e) => e.id), ["n8", "n9", "n10"]);
});

test("trimming drops the oldest entries and leaves the rest ordered", () => {
  storage.saveChat(chat("d"));
  for (let i = 1; i <= 6; i += 1) storage.saveEntry("d", entry(`t${i}`, `line ${i}`));
  storage.trimEntries("d", 2);

  const loaded = storage.loadChats(100).find((c) => c.id === "d");
  assert.deepEqual(loaded?.entries.map((e) => e.id), ["t5", "t6"]);
});

test("deleting entries and chats removes them", () => {
  storage.saveChat(chat("e"));
  storage.saveEntry("e", entry("x1", "one"));
  storage.saveEntry("e", entry("x2", "two"));
  storage.deleteEntries("e", ["x1"]);
  assert.deepEqual(
    storage.loadChats(100).find((c) => c.id === "e")?.entries.map((x) => x.id),
    ["x2"],
  );

  storage.removeChat("e");
  assert.equal(storage.loadChats(100).some((c) => c.id === "e"), false);
});

test("newest chat first", () => {
  storage.saveChat(chat("old", { updatedAt: 1_000 }));
  storage.saveChat(chat("new", { updatedAt: 2_000 }));
  const ids = storage.loadChats(1).map((c) => c.id);
  assert.ok(ids.indexOf("new") < ids.indexOf("old"));
});
