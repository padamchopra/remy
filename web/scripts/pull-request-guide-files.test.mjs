import assert from "node:assert/strict";
import test from "node:test";
import { guideFileGroups, pullRequestFileStat } from "../src/lib/pull-request-guide-files.ts";
import { contextGapLines, fileContextGaps } from "../src/lib/pull-request-context.ts";

const head = "a".repeat(40);
const base = "b".repeat(40);
const hunk = (id, line, revision = { head, base }) => ({
  id, path: "src/deeply/nested/example.ts", revision, header: `@@ -${line} +${line} @@`,
  lines: [
    { kind: "del", oldLine: line, newLine: null, text: "old" },
    { kind: "add", oldLine: null, newLine: line, text: "new" },
  ],
});
const first = hunk("H1", 10);
const middle = hunk("H2", 20);
const last = hunk("H3", 30);
const guide = { hunks: [first, middle, last] };
const current = { nodeId: "PR_1", headRefOid: head, baseRefOid: base, files: [{ path: first.path, viewed: true, hunks: guide.hunks }] };

test("groups same-file hunks and preserves their question anchors in source order", () => {
  const [group] = guideFileGroups(guide, [last, first], current);
  assert.equal(group.file.viewed, true);
  assert.equal(group.canMarkViewed, true);
  assert.deepEqual([...group.selectedByIndex].map(([index, hunk]) => [index, hunk.id]), [[0, "H1"], [2, "H3"]]);
  assert.deepEqual(pullRequestFileStat({ ...group.file, hunks: [...group.selectedByIndex.values()] }), { additions: 2, deletions: 2 });
});

test("context expansion stops at changes belonging to another guide step", () => {
  const [group] = guideFileGroups(guide, [first], current);
  assert.equal(group.file.hunks.length, 3);
  const gaps = fileContextGaps(group.file);
  const lines = Array.from({ length: 40 }, (_, index) => String(index + 1));
  assert.deepEqual(contextGapLines(gaps[1], lines, 100).map((line) => line.newLine), [11, 12, 13, 14, 15, 16, 17, 18, 19]);
  assert.equal(group.selectedByIndex.has(1), false);
});

test("separates the same file from different selected commits", () => {
  const later = hunk("H4", 10, { head: "c".repeat(40) });
  const groups = guideFileGroups({ hunks: [first, later] }, [first, later], current);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].pullRequest.headRefOid, head);
  assert.equal(groups[1].pullRequest.headRefOid, later.revision.head);
  assert.notEqual(groups[0].key, groups[1].key);
  assert.deepEqual(groups.map((group) => group.file.viewed), [true, true]);
});

test("old saved guides reuse current context only when every saved hunk matches", () => {
  const legacy = { ...first, revision: undefined };
  const [matching] = guideFileGroups({ hunks: [legacy] }, [legacy], current);
  assert.equal(matching.pullRequest.headRefOid, head);
  assert.equal(matching.file.hunks.length, 3);
  const stale = { ...legacy, header: "@@ -11 +11 @@" };
  const [mismatch] = guideFileGroups({ hunks: [stale] }, [stale], current);
  assert.equal(mismatch.pullRequest.headRefOid, undefined);
  assert.equal(mismatch.pullRequest.baseRefOid, undefined);
  assert.equal(mismatch.selectedByIndex.get(0), stale);
});

test("retains deleted and renamed file revisions and safely handles files no longer in the PR", () => {
  const deleted = { ...first, path: "old.ts", revision: { head, base, deleted: true, previousPath: "older.ts" } };
  const [group] = guideFileGroups({ hunks: [deleted] }, [deleted], current);
  assert.equal(group.file.deleted, true);
  assert.equal(group.file.previousPath, "older.ts");
  assert.equal(group.pullRequest.baseRefOid, base);
  assert.equal(group.canMarkViewed, false);
  assert.deepEqual(fileContextGaps(group.file), []);
});

test("metadata-only changes keep their file header without inventing a text diff", () => {
  const binary = { ...first, path: "asset.png", lines: [] };
  const [group] = guideFileGroups({ hunks: [binary] }, [binary], current);
  assert.equal(group.file.path, "asset.png");
  assert.deepEqual(group.file.hunks, []);
  assert.deepEqual(pullRequestFileStat(group.file), { additions: 0, deletions: 0 });
});
