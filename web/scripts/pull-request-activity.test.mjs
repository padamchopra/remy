import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({ absWorkingDir: root, entryPoints: ["src/lib/pull-request-activity.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const activity = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const author = (login, name = null) => ({ login, name, avatarUrl: null });
const at = (minutes) => new Date(Date.parse("2026-09-27T12:00:00Z") + minutes * 60_000).toISOString();
const thread = (id, state, owner = "me", updatedAt = Date.parse(at(-5))) => ({
  id, computerId: "mac", observedAt: 0, access: { owner: { id: owner, label: owner === "me" ? "Me" : "Ada" } }, detail: { state, updatedAt, title: "Search repositories" },
});
const base = {
  userId: "me",
  viewer: "padam",
  seenAt: Date.parse(at(-30)),
  items: [
    { kind: "review", id: "R1", at: at(-120), author: author("dee", "Dee Rahman"), state: "APPROVED", body: "", comments: 0, url: null, thread: null },
    { kind: "comment", id: "C1", at: at(-60), author: author("sam", "Sam Keane"), body: "Three notes inline.", url: null, thread: null },
    { kind: "comment", id: "C2", at: at(-20), author: author("padam"), body: "Mine", url: null, thread: null },
    { kind: "comment", id: "C3", at: at(-15), author: author("padam"), body: "From my thread", url: null, thread: { computerId: "mac", threadId: "t1", computerName: "MacBook Pro" } },
    { kind: "checks", id: "checks:x", at: at(-11), commit: "3e91f2a", state: "fail", failed: ["typecheck", "server tests"], total: 5 },
    { kind: "review", id: "R2", at: at(-10), author: author("linus"), state: "COMMENTED", body: "", comments: 3, url: null, thread: null },
  ],
};

test("the badge counts what arrived since you last opened Activity, never your own or thread events", () => {
  // C2 and C3 are yours; the checks and linus's review are new; the rest came before.
  assert.equal(activity.unseenActivity(base), 2);
  assert.equal(activity.unseenActivity({ ...base, seenAt: null }), 0);
  assert.equal(activity.unseenActivity({ ...base, seenAt: Date.parse(at(0)) }), 0);
  assert.equal(activity.unseenActivity(undefined), 0);
});

test("thread events come from what the linked thread is doing", () => {
  const linked = thread("t1", "working");
  const events = activity.threadEvents(base, linked);
  assert.deepEqual(events.map((event) => event.text), ["Your thread is working on this branch"]);
  assert.equal(events[0].thread, linked);
  // No linked thread draws nothing; a done thread has no live event.
  assert.deepEqual(activity.threadEvents(base, undefined), []);
  assert.deepEqual(activity.threadEvents(base, thread("t1", "done")), []);
  const theirs = thread("t1", "needs_input", "ada");
  assert.deepEqual(activity.threadEvents(base, theirs).map((event) => event.text), ["Ada's thread needs you"]);
});

test("the timeline is one list, oldest first, newest beside the composer", () => {
  const linked = thread("t1", "working");
  const entries = activity.activityTimeline(base, linked);
  assert.deepEqual(entries.map((entry) => entry.id), ["R1", "C1", "C2", "C3", "checks:x", "R2", "thread:t1"]);
  assert.deepEqual(activity.activityTimeline(undefined, undefined), []);
});

test("reviews and checks read as sentences", () => {
  const [approved] = base.items;
  assert.equal(activity.reviewSentence(approved), "Dee Rahman approved these changes");
  assert.equal(activity.reviewSentence(base.items[5]), "linus left 3 comments on lines");
  assert.equal(activity.reviewSentence({ ...base.items[5], comments: 1 }), "linus left a comment on lines");
  assert.equal(activity.reviewSentence({ ...approved, state: "CHANGES_REQUESTED" }), "Dee Rahman requested changes");
  assert.equal(activity.reviewSentence({ ...approved, state: "COMMENTED", body: "Nice" }), "Dee Rahman reviewed");
  assert.equal(activity.checksSentence(base.items[4]), "typecheck and server tests failed on 3e91f2a");
  assert.equal(activity.checksSentence({ ...base.items[4], failed: ["a", "b", "c", "d", "e"] }), "a, b and 3 more failed on 3e91f2a");
  assert.equal(activity.checksSentence({ ...base.items[4], failed: ["a", "b", "c"] }), "a, b and c failed on 3e91f2a");
  assert.equal(activity.checksSentence({ ...base.items[4], state: "pass", failed: [] }), "All 5 checks passed on 3e91f2a");
  assert.equal(activity.checksSentence({ ...base.items[4], state: "pass", failed: [], total: 1 }), "The check passed on 3e91f2a");
});

test("times are short, and a thread's comment names its computer", () => {
  const now = Date.parse(at(0));
  assert.equal(activity.shortAgo(at(0), now), "now");
  assert.equal(activity.shortAgo(at(-11), now), "11m");
  assert.equal(activity.shortAgo(at(-120), now), "2h");
  assert.equal(activity.shortAgo(at(-60 * 50), now), "2d");
  assert.equal(activity.shortAgo("nonsense", now), "");
  assert.equal(activity.fromThreadLabel({ computerId: "mac", threadId: "t", computerName: "MacBook Pro" }), "From a thread on MacBook Pro");
  assert.equal(activity.fromThreadLabel({ computerId: "mac", threadId: "t", computerName: null }), "From a thread");
  assert.equal(activity.activityThreadMessage({ number: 7, url: "https://github.com/a/b/pull/7" }, "  Rebase please \n"), "About pull request #7 (https://github.com/a/b/pull/7):\n\nRebase please");
});
