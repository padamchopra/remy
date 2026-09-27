import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({ absWorkingDir: root, entryPoints: ["src/lib/diff-words.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const words = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const marked = (text, ranges) => ranges.map(([start, end]) => text.slice(start, end));

test("tokens are words, runs of whitespace and single punctuation marks", () => {
  assert.deepEqual(words.diffTokens("  const x_1 = f(a, b);"), ["  ", "const", " ", "x_1", " ", "=", " ", "f", "(", "a", ",", " ", "b", ")", ";"]);
  assert.deepEqual(words.diffTokens("café naïve"), ["café", " ", "naïve"]);
  assert.deepEqual(words.diffTokens(""), []);
});

test("only the words that differ are marked, on both lines", () => {
  const before = "{repositories.map((repository) => (";
  const after = "{rows.map((repository) => (";
  const diff = words.wordDiff(before, after);
  assert.deepEqual(marked(before, diff.before), ["repositories"]);
  assert.deepEqual(marked(after, diff.after), ["rows"]);
});

test("a changed phrase is one mark across the whitespace inside it", () => {
  const before = "return the old value now";
  const after = "return a brand new value now";
  const diff = words.wordDiff(before, after);
  assert.deepEqual(marked(before, diff.before), ["the old"]);
  assert.deepEqual(marked(after, diff.after), ["a brand new"]);
});

test("pairs too different to compare, identical lines and blank lines stay plain", () => {
  assert.equal(words.wordDiff("import { a } from './a';", "export default function Page() {}"), undefined);
  assert.equal(words.wordDiff("same", "same"), undefined);
  assert.equal(words.wordDiff("   ", "x"), undefined);
});

test("the similarity threshold decides at about 40 percent shared", () => {
  // "a b c d e" vs "a b x y z": shared "a b " is 4 of 9 characters each side.
  assert.ok(words.wordDiff("a b c d e", "a b x y z"));
  assert.equal(words.wordDiff("a b c d e", "a x y z w"), undefined);
});

test("very long lines are not compared", () => {
  const long = `${"x".repeat(1_001)}`;
  assert.equal(words.wordDiff(long, `${long}y`), undefined);
  const many = Array.from({ length: 500 }, (_, index) => `w${index}`).join(" ");
  assert.equal(words.wordDiff(many, `${many} end`), undefined);
});

test("a change block pairs deleted and added lines in order and leaves extras plain", () => {
  const lines = [
    { kind: "ctx", text: "const grouped = useMemo();" },
    { kind: "del", text: "const a = 1;" },
    { kind: "del", text: "const b = 2;" },
    { kind: "del", text: "const c = 3;" },
    { kind: "add", text: "const a = 10;" },
    { kind: "add", text: "const b = 20;" },
    { kind: "ctx", text: "}" },
    { kind: "add", text: "const d = 4;" },
    { kind: "del", text: "let e = 5;" },
    { kind: "ctx", text: "" },
    { kind: "add", text: "let e = 6;" },
  ];
  const map = words.hunkWordDiff(lines);
  assert.deepEqual([...map.keys()].sort((a, b) => a - b), [1, 2, 4, 5]);
  assert.deepEqual(marked(lines[1].text, map.get(1)), ["1"]);
  assert.deepEqual(marked(lines[4].text, map.get(4)), ["10"]);
  assert.deepEqual(marked(lines[5].text, map.get(5)), ["20"]);
});

test("a line splits into plain and marked pieces", () => {
  assert.deepEqual(words.splitByRanges("const a = 10;", [[10, 12]]), [
    { text: "const a = ", marked: false },
    { text: "10", marked: true },
    { text: ";", marked: false },
  ]);
  assert.deepEqual(words.splitByRanges("plain", undefined), [{ text: "plain", marked: false }]);
});
