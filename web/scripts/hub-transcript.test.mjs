import assert from "node:assert/strict";
import test from "node:test";
import { applyThreadTail, mergeThreadTranscript, prependThreadEntries, threadCheckpoints } from "../src/lib/hub-transcript.ts";

test("a later tail keeps messages already read above it", () => {
  const earlier = [{ id: "u" }, { id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(applyThreadTail(earlier, [{ id: "d" }, { id: "e" }]).map((entry) => entry.id), ["u", "a", "b", "c", "d", "e"]);
  assert.deepEqual(applyThreadTail([{ id: "c" }, { id: "d" }], [{ id: "u" }, { id: "a" }]).map((entry) => entry.id), ["c", "d", "u", "a"]);
});

test("an earlier page is added once, in front", () => {
  assert.deepEqual(
    prependThreadEntries([{ id: "u" }, { id: "a" }, { id: "c" }], [{ id: "c" }, { id: "d" }]).map((entry) => entry.id),
    ["u", "a", "c", "d"],
  );
});

test("a live tail keeps earlier pages, and a gap starts the read again", () => {
  const open = mergeThreadTranscript(
    { entries: [], complete: false, replaced: false },
    { id: "thread", entries: [{ id: "c" }, { id: "d" }], history: { hasEarlier: true, before: "c" } },
  );
  assert.deepEqual(open.entries.map((entry) => entry.id), ["c", "d"]);
  assert.equal(open.before, "c");
  assert.equal(open.complete, false);
  const kept = mergeThreadTranscript(
    { ...open, entries: [{ id: "u" }, { id: "a" }, { id: "c" }, { id: "d" }] },
    { id: "thread", entries: [{ id: "d" }, { id: "e" }], history: { hasEarlier: true, before: "d" } },
  );
  assert.deepEqual(kept.entries.map((entry) => entry.id), ["u", "a", "c", "d", "e"]);
  assert.equal(kept.before, "c");
  assert.equal(kept.replaced, false);
  const stale = mergeThreadTranscript(kept, {
    id: "thread", entries: [{ id: "d" }, { id: "e" }], stale: true, history: { hasEarlier: true, before: "d" },
  });
  assert.deepEqual(stale.entries.map((entry) => entry.id), ["u", "a", "c", "d", "e"]);
  assert.equal(stale.before, undefined);
  assert.equal(stale.complete, false);
  const gap = mergeThreadTranscript(stale, {
    id: "thread", entries: [{ id: "z" }], history: { hasEarlier: true, before: "z" },
  });
  assert.deepEqual(gap.entries.map((entry) => entry.id), ["z"]);
  assert.equal(gap.before, "z");
  assert.equal(gap.replaced, false);
  const restart = mergeThreadTranscript(
    { id: "thread", entries: [{ id: "u" }], before: "z", complete: false, replaced: false },
    { id: "thread", entries: [{ id: "z" }], history: { hasEarlier: true, before: "z" } },
  );
  assert.deepEqual(restart.entries.map((entry) => entry.id), ["z"]);
  assert.equal(restart.replaced, true);
  const done = mergeThreadTranscript(gap, { id: "thread", entries: [{ id: "u" }, { id: "z" }] });
  assert.equal(done.complete, true);
  assert.equal(done.before, undefined);
});

test("each message you sent is a mark, with the latest reply beside it", () => {
  assert.deepEqual(threadCheckpoints([
    { id: "u1", kind: "user", text: "Use one avatar." },
    { id: "t1", kind: "tool", text: "ran" },
    { id: "a1", kind: "assistant", text: "First pass." },
    { id: "a2", kind: "assistant", text: "Done." },
    { id: "u2", kind: "user", text: "  " },
  ]), [
    { id: "u1", userText: "Use one avatar.", assistantText: "Done." },
    { id: "u2", userText: "Your message" },
  ]);
});
