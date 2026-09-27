import test from "node:test";
import assert from "node:assert/strict";
import { codeReferencesError, codeReferencesText } from "./code-references.js";

test("code references are refused only when they could never be valid", () => {
  const reference = { id: "r1", path: "web/src/a.tsx", startLine: 170, endLine: 172, comment: "Collapse past ten.", lines: [{ kind: "add", oldLine: null, newLine: 170, text: "{rows.map(" }] };
  assert.equal(codeReferencesError(undefined), undefined);
  assert.equal(codeReferencesError([reference]), undefined);
  assert.match(codeReferencesError("x")!, /up to 20/);
  assert.match(codeReferencesError(Array(21).fill(reference))!, /up to 20/);
  assert.match(codeReferencesError([{ ...reference, lines: [] }])!, /200 lines/);
  assert.match(codeReferencesError([{ ...reference, path: 7 }])!, /200 lines/);
});

test("a text-only provider reads the file, range and lines", () => {
  const text = codeReferencesText([{ path: "web/src/a.tsx", startLine: 170, endLine: 172, comment: "Collapse past ten.", lines: [
    { kind: "del", oldLine: 168, newLine: null, text: "old" },
    { kind: "add", oldLine: null, newLine: 170, text: "new" },
  ] }]);
  assert.equal(text, "File: web/src/a.tsx (L170-172)\nComment: Collapse past ten.\n```diff\n168\t-old\n170\t+new\n```");
  assert.equal(codeReferencesText(undefined), "");
});
