import assert from "node:assert/strict";
import test from "node:test";
import { contextGapLines, fileContextGaps, fileLines, validateFileContext } from "../src/lib/pull-request-context.ts";

const file = (headers) => ({ path: "src/file.ts", hunks: headers.map((header) => ({ header, lines: [] })) });

test("context gaps maintain old/new offsets across additions and deletions", () => {
  const gaps = fileContextGaps(file(["@@ -10,3 +10,5 @@", "@@ -20,4 +22,2 @@"]));
  assert.deepEqual(gaps, [
    { oldStart: 1, newStart: 1, count: 9, fromEnd: true },
    { oldStart: 13, newStart: 15, count: 7, fromEnd: false },
    { oldStart: 24, newStart: 24, fromEnd: false },
  ]);
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  assert.deepEqual(contextGapLines(gaps[0], lines, 3).map((line) => [line.oldLine, line.newLine]), [[7, 7], [8, 8], [9, 9]]);
  assert.deepEqual(contextGapLines(gaps[1], lines, 20).map((line) => line.newLine), [15, 16, 17, 18, 19, 20, 21]);
  assert.deepEqual(contextGapLines(gaps[2], lines, 20).map((line) => line.newLine), [24, 25, 26, 27, 28, 29, 30]);
});

test("zero-count ranges, single-line hunks, adjacent hunks, and deleted files", () => {
  assert.equal(fileContextGaps(file(["@@ -4,0 +5,2 @@"]))[0].count, 4);
  assert.equal(fileContextGaps(file(["@@ -5,2 +4,0 @@"]))[0].count, 4);
  assert.equal(fileContextGaps(file(["@@ -0,0 +1,2 @@"]))[0].count, 0);
  assert.equal(fileContextGaps(file(["@@ -1 +1 @@", "@@ -2 +2 @@"]))[1].count, 0);
  assert.deepEqual(fileContextGaps({ ...file(["@@ -1,2 +0,0 @@"]), deleted: true }), []);
  assert.deepEqual(fileContextGaps(file(["invalid"])), []);
  assert.deepEqual(fileContextGaps(file(["@@ -5,2 +9,2 @@"])), []);
});

test("context is bounded without duplicating or mutating changed lines", () => {
  const sample = file(["@@ -21,2 +21,2 @@"]);
  const snapshot = JSON.stringify(sample);
  const lines = Array.from({ length: 25 }, (_, i) => String(i + 1));
  const gaps = fileContextGaps(sample);
  assert.equal(contextGapLines(gaps[0], lines, 100).length, 20);
  assert.equal(contextGapLines(gaps[1], lines, 100).length, 3);
  assert.equal(contextGapLines(gaps[1], lines, 0).length, 0);
  assert.equal(JSON.stringify(sample), snapshot);
});

test("line splitting handles trailing newlines, CRLF, and empty files", () => {
  assert.deepEqual(fileLines("a\r\nb\r\n"), ["a", "b"]);
  assert.deepEqual(fileLines("a\n\n"), ["a", ""]);
  assert.deepEqual(fileLines("a"), ["a"]);
  assert.deepEqual(fileLines(""), []);
});

test("a changed revision never silently supplies wrong context", () => {
  const sample = { path: "file", hunks: [{ header: "@@ -1 +1 @@", lines: [
    { kind: "del", oldLine: 1, newLine: null, text: "old" },
    { kind: "add", oldLine: null, newLine: 1, text: "new" },
  ] }] };
  validateFileContext(sample, ["new"]);
  validateFileContext({ ...sample, deleted: true }, ["old"]);
  assert.throws(() => validateFileContext(sample, ["different"]), /doesn't match/);
});
