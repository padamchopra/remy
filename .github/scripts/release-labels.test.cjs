const assert = require("node:assert/strict");
const test = require("node:test");
const { releaseLabelsForPaths } = require("./release-labels.cjs");

test("labels changes included in each release", () => {
  assert.deepEqual(releaseLabelsForPaths(["web/src/App.tsx"]), ["release: computer"]);
  assert.deepEqual(releaseLabelsForPaths([".github/actions/build-needed/action.yml"]), ["release: computer"]);
});

test("does not label changes excluded from release builds", () => {
  assert.deepEqual(releaseLabelsForPaths(["web/README.md", "docs/notes.md"]), []);
  assert.deepEqual(releaseLabelsForPaths(["README.md", ".github/workflows/release-pr.yml"]), []);
});
