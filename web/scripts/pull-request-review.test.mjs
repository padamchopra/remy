import assert from "node:assert/strict";
import test from "node:test";
import { sameReviewSource, reviewReference } from "../src/lib/pull-request-review.ts";
const source = { path: "src/file.ts", head: "a".repeat(40), header: "@@ -10 +11 @@", lines: [
  { kind: "del", oldLine: 10, newLine: null, text: "old" },
  { kind: "add", oldLine: null, newLine: 11, text: "new" },
] };

test("Code and Guide match identical revisions without mixing shifted or changed lines", () => {
  assert.equal(sameReviewSource(source, structuredClone(source)), true);
  assert.equal(sameReviewSource(source, { ...source, head: "b".repeat(40) }), false);
  assert.equal(sameReviewSource(source, { ...source, header: "@@ -11 +12 @@" }), false);
  assert.equal(sameReviewSource(source, { ...source, lines: [{ ...source.lines[0], text: "different" }] }), false);
});

test("both tabs create the same thread comment with exact selected lines", () => {
  const reference = reviewReference(source, 0, 1, "  Change this value.  ");
  assert.equal(reference.path, source.path);
  assert.equal(reference.startLine, 10);
  assert.equal(reference.endLine, 11);
  assert.equal(reference.comment, "Change this value.");
  assert.deepEqual(reference.lines, source.lines);
  assert.equal(reviewReference(source, 0, 1, " "), undefined);
  assert.throws(() => reviewReference({ ...source, lines: Array(201).fill(source.lines[0]) }, 0, 200, "change"), /200 lines/);
});
