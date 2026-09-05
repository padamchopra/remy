import assert from "node:assert/strict";
import test from "node:test";

import { clearOptimisticUser, mergeEntryUpdates, registerOptimisticUser, uniqueEntries } from "../src/lib/thread-entry-merge.ts";

test("a live server echo replaces its optimistic user entry", () => {
  const optimistic = { id: "u-local", kind: "user", text: "Ship it", at: 100 };
  const persisted = { id: "u-server", kind: "user", text: "Ship it", at: 101 };
  registerOptimisticUser("thread-1", "computer-1", optimistic);
  try {
    assert.deepEqual(mergeEntryUpdates([optimistic], [persisted], "thread-1", "computer-1"), [persisted]);
  } finally {
    clearOptimisticUser(optimistic.id);
  }
});

test("repeated delivery of one entry leaves one visible copy", () => {
  const entry = { id: "u-same", kind: "user", text: "Once", at: 100 };
  assert.deepEqual(mergeEntryUpdates([entry, entry], [entry], "thread-1", "computer-1"), [entry]);
  assert.deepEqual(uniqueEntries([entry, entry]), [entry]);
});

test("intentional repeated messages with different ids remain distinct", () => {
  const first = { id: "u-first", kind: "user", text: "Again", at: 100 };
  const second = { id: "u-second", kind: "user", text: "Again", at: 200 };
  assert.deepEqual(mergeEntryUpdates([first], [second], "thread-1", "computer-1"), [first, second]);
});
