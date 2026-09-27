import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function load(entry) {
  const bundled = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
}
const review = await load("src/lib/pull-request-review-state.ts");
const { parsePullRequestPatch } = await load("src/lib/pull-request-patch.ts");

const hunks = parsePullRequestPatch([
  "@@ -166,7 +166,8 @@ function RepositoryList()",
  " const [query, setQuery] = useState(\"\");",
  "-{repositories.map((repository) => (",
  "-<RepositoryRow repository={repository} />",
  "+{grouped.map(([owner, rows]) => (",
  "+<RepositoryGroup owner={owner}>",
  "+{rows.map((repository) => (",
  " </div>",
].join("\n"));
const lines = hunks[0].lines;

const author = { login: "sam", name: "Sam Keane", avatarUrl: null };
const comment = (id, pending = false) => ({ id, databaseId: 1, body: "x", createdAt: "", url: null, pending, author });
const thread = (id, extra) => ({ id, path: "a.tsx", line: null, startLine: null, originalLine: null, originalStartLine: null, side: "RIGHT", startSide: null, isResolved: false, isOutdated: false, file: false, comments: [comment(`${id}-c`)], ...extra });

test("a file is read only while GitHub says VIEWED; a changed one opens again", () => {
  const state = { viewed: { "a.ts": "VIEWED", "b.ts": "DISMISSED", "c.ts": "UNVIEWED" } };
  assert.equal(review.isViewed(state, "a.ts"), true);
  assert.equal(review.isViewed(state, "b.ts"), false);
  assert.equal(review.isViewed(state, "c.ts"), false);
  assert.equal(review.isViewed(undefined, "a.ts"), false);
});

test("queued comments are your pending ones, replies included", () => {
  assert.equal(review.queuedComments({ threads: [
    { ...thread("t1"), comments: [comment("a"), comment("b", true)] },
    { ...thread("t2"), comments: [comment("c", true)] },
  ] }), 2);
  assert.equal(review.queuedComments(undefined), 0);
});

test("your own pull request is told apart by login, ignoring case", () => {
  assert.equal(review.isOwnPullRequest({ viewer: { login: "Padam" }, author: "padam" }), true);
  assert.equal(review.isOwnPullRequest({ viewer: { login: "padam" }, author: "sam" }), false);
  assert.equal(review.isOwnPullRequest(undefined), false);
});

test("a selection stays on the anchor's side and names its range", () => {
  // Anchor on the first added line (index 3), shift-click down two rows.
  const added = review.selectionTarget(lines, { anchor: 3, focus: 5 });
  assert.deepEqual([added.side, added.startLine, added.line, added.from, added.to], ["RIGHT", 167, 169, 3, 5]);
  assert.equal(review.lineRangeLabel(added.startLine, added.line), "L167–L169");
  const single = review.selectionTarget(lines, { anchor: 1, focus: 1 });
  assert.deepEqual([single.side, single.startLine, single.line], ["LEFT", null, 167]);
  assert.equal(review.lineRangeLabel(null, 167), "L167");
  // A deleted anchor extended over context keeps to the old file's numbers.
  const mixed = review.selectionTarget(lines, { anchor: 2, focus: 0 });
  assert.deepEqual([mixed.side, mixed.startLine, mixed.line], ["LEFT", 166, 168]);
});

test("shift-click onto the other side stops at the last row on the anchor's side", () => {
  // From a deleted line, clicking an added line stops on the last deletion.
  assert.equal(review.extendSelection(lines, 1, 4), 2);
  // From an added line upward over deletions, it stops on the first addition.
  assert.equal(review.extendSelection(lines, 5, 1), 3);
  // Context has both numbers, so either side may reach it.
  assert.equal(review.extendSelection(lines, 5, 6), 6);
  assert.equal(review.extendSelection(lines, 1, 0), 0);
});

test("the reference carries the path, range, lines and comment", () => {
  const target = review.selectionTarget(lines, { anchor: 3, focus: 5 });
  const reference = review.lineCommentReference("web/src/AddWorkspace.tsx", target, "  Collapse past ten. ");
  assert.equal(reference.path, "web/src/AddWorkspace.tsx");
  assert.deepEqual([reference.startLine, reference.endLine, reference.comment], [167, 169, "Collapse past ten."]);
  assert.deepEqual(reference.lines.map((line) => line.newLine), [167, 168, 169]);
  assert.match(reference.id, /^[0-9a-f-]{36}$/);
});

test("conversations sit under their row; outdated, file-level and unseen ones fold above", () => {
  const threads = [
    thread("current", { line: 168, side: "RIGHT" }),
    thread("old-side", { line: 167, side: "LEFT" }),
    thread("outdated", { line: null, originalLine: 170, isOutdated: true }),
    thread("file", { file: true }),
    thread("off-diff", { line: 400 }),
    { ...thread("other"), path: "b.tsx", line: 168 },
  ];
  const placed = review.placeThreads(threads, "a.tsx", hunks);
  assert.deepEqual([...placed.atRow.entries()].map(([key, list]) => [key, list.map((entry) => entry.id)]), [
    ["0:4", ["current"]],
    ["0:1", ["old-side"]],
  ]);
  assert.deepEqual(placed.elsewhere.map((entry) => entry.id), ["outdated", "file", "off-diff"]);
});

test("Finish review says what goes out with it", () => {
  assert.equal(review.finishReviewSummary(0), "Only your note and verdict go out.");
  assert.equal(review.finishReviewSummary(1), "One comment goes out with it.");
  assert.equal(review.finishReviewSummary(3), "Three comments go out with it.");
  assert.equal(review.finishReviewSummary(42), "42 comments go out with it.");
});

test("a pending review is one with comments of yours still in it", () => {
  assert.equal(review.hasPendingReview(undefined), false);
  assert.equal(review.hasPendingReview({ threads: [thread("t1")] }), false);
  assert.equal(review.hasPendingReview({ threads: [thread("t1"), { ...thread("t2"), comments: [comment("c", true)] }] }), true);
});

test("the comment box drops Comment while a review is pending, and the primary stays", () => {
  assert.deepEqual(review.lineCommentActions({ destination: false, pending: false }), { actions: ["comment", "review"], primary: "review" });
  assert.deepEqual(review.lineCommentActions({ destination: false, pending: true }), { actions: ["review"], primary: "review" });
  assert.deepEqual(review.lineCommentActions({ destination: true, pending: false }), { actions: ["review", "comment", "send"], primary: "send" });
  assert.deepEqual(review.lineCommentActions({ destination: true, pending: true }), { actions: ["review", "send"], primary: "send" });
});
