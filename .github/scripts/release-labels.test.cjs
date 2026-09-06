const assert = require("node:assert/strict");
const test = require("node:test");
const { releaseLabelsForPaths } = require("./release-labels.cjs");

test("labels changes included in each release", () => {
  assert.deepEqual(releaseLabelsForPaths(["web/src/App.tsx"]), ["release: mac"]);
  assert.deepEqual(releaseLabelsForPaths(["mobile/src/App.tsx"]), ["release: testflight"]);
  assert.deepEqual(releaseLabelsForPaths([".github/actions/build-needed/action.yml"]), [
    "release: mac",
    "release: testflight",
  ]);
});

test("does not label changes excluded from release builds", () => {
  assert.deepEqual(releaseLabelsForPaths(["web/README.md", "mobile/notes.md"]), []);
  assert.deepEqual(releaseLabelsForPaths(["README.md", ".github/workflows/mac-pr.yml"]), []);
});
