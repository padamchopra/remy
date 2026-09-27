import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PullRequestGuide } from "./pull-request-guides.js";

const stateDir = mkdtempSync(join(tmpdir(), "remy-pull-request-guides-"));
process.env.MC_CONFIG_DIR = stateDir;
process.env.HOME = stateDir;

const {
  compactGuideHunks, flattenGuideHunks, parseGuideSteps, uncoveredGuideHunkIds,
  discoverPullRequestGuide, readSavedPullRequestGuide, pullRequestGuideContext, generatePullRequestGuide,
} = await import("./pull-request-guides.js");
const { db } = await import("./db.js");

function savedGuide(number: number): PullRequestGuide {
  return {
    repository: "example/repo", number, provider: "codex", model: "gpt-5.4", effort: "low",
    createdAt: 1_700_000_000_000, commitShas: ["a".repeat(40)],
    commits: [{ sha: "a".repeat(40), title: "Add example", author: "example", committedAt: "2026-08-30" }],
    hunks: [{ id: "H1", path: "example.ts", header: "@@ -0,0 +1 @@", lines: [{ kind: "add", text: "example", oldLine: null, newLine: 1 }] }],
    steps: [{ id: "step1", title: "Read the example", summary: "This adds an example.", hunkIds: ["H1"] }],
    uncoveredHunkIds: [], questions: [],
  };
}

test("reuses durable local guides without GitHub or a model", async () => {
  const guide = savedGuide(101);
  db.prepare("insert into pull_request_guides (repository, number, json, updated_at) values (?, ?, ?, ?)")
    .run(guide.repository, guide.number, JSON.stringify(guide), Date.now());

  assert.deepEqual(readSavedPullRequestGuide(guide.repository, guide.number), guide);
  assert.deepEqual(await discoverPullRequestGuide(guide.repository, guide.number), { guide });
  assert.deepEqual((await pullRequestGuideContext(guide.repository, guide.number)).guide, guide);
  assert.deepEqual(await generatePullRequestGuide({ repository: guide.repository, number: guide.number }), guide);
});

test("a pull request without a saved guide on this computer has none", async () => {
  assert.deepEqual(await discoverPullRequestGuide("example/repo", 102), {});
});

test("keeps each guided-review hunk in one model-authored step", () => {
  const steps = parseGuideSteps(JSON.stringify({
    steps: [
      { title: "Start with storage", summary: "Read the durable shape first.", hunks: ["H2", "H1", "H1"] },
      { title: "Then read the UI", summary: "See how the interface consumes it.", hunks: ["H1", "H3"] },
    ],
  }), ["H1", "H2", "H3"]);

  assert.deepEqual(steps.map((step) => ({ title: step.title, hunkIds: step.hunkIds })), [
    { title: "Start with storage", hunkIds: ["H2", "H1"] },
    { title: "Then read the UI", hunkIds: ["H3"] },
  ]);
  assert.deepEqual(uncoveredGuideHunkIds(steps, ["H1", "H2", "H3"]), []);
});

test("reports omitted hunks without asking the model to repair coverage", () => {
  const steps = parseGuideSteps("```json\n{\"steps\":[{\"title\":\"Core change\",\"summary\":\"Read this first.\",\"hunks\":[\"H1\"]}]}\n```", ["H1", "H2"]);

  assert.equal(steps.length, 1);
  assert.deepEqual(uncoveredGuideHunkIds(steps, ["H1", "H2"]), ["H2"]);
});

test("reports every hunk when the model returns invalid JSON", () => {
  const steps = parseGuideSteps("I could not format this.", ["H1", "H2"]);

  assert.equal(steps.length, 0);
  assert.deepEqual(uncoveredGuideHunkIds(steps, ["H1", "H2"]), ["H1", "H2"]);
});

test("compact guide input excludes context and bounds changed-line excerpts", () => {
  const input = compactGuideHunks([{
    id: "H1",
    path: "src/example.ts",
    header: "@@ -1,100 +1,100 @@",
    lines: [
      { kind: "ctx", text: "unchanged context", oldLine: 1, newLine: 1 },
      ...Array.from({ length: 100 }, (_, index) => ({
        kind: "add" as const,
        text: `added line ${index}`,
        oldLine: null,
        newLine: index + 2,
      })),
    ],
  }]);

  assert.ok(input.includes("### H1 src/example.ts"));
  assert.ok(input.includes("(+100 -0)"));
  assert.ok(!input.includes("unchanged context"));
  assert.ok(input.includes("76 more changed lines"));
  assert.ok(input.length < 2_000);
});

test("the prompt cap never removes a hunk from deterministic coverage", () => {
  const hunks = Array.from({ length: 100 }, (_, index) => ({
    id: `H${index + 1}`,
    path: `src/file-${index}.ts`,
    header: "@@ -1,24 +1,24 @@",
    lines: Array.from({ length: 24 }, (_, line) => ({
      kind: "add" as const,
      text: "a".repeat(80),
      oldLine: null,
      newLine: line + 1,
    })),
  }));
  const input = compactGuideHunks(hunks);
  const uncovered = uncoveredGuideHunkIds([], hunks.map((hunk) => hunk.id));

  assert.ok(input.length <= 80_000);
  assert.ok(!input.includes("### H100 "));
  assert.equal(uncovered.length, 100);
  assert.equal(uncovered.at(-1), "H100");
});

test("coverage includes binary and rename-only files without text hunks", () => {
  const hunks = flattenGuideHunks([
    { path: "image.png", hunks: [] },
    { path: "new-name.ts", previousPath: "old-name.ts", hunks: [] },
  ]);

  assert.equal(hunks[0]?.header, "No text preview");
  assert.equal(hunks[1]?.header, "Renamed from old-name.ts");
  assert.deepEqual(uncoveredGuideHunkIds([], hunks.map((hunk) => hunk.id)), ["H1", "H2"]);
});

test("guide hunks retain exact revisions and file metadata outside the model prompt", () => {
  const revision = { head: "a".repeat(40), base: "b".repeat(40) };
  const hunks = flattenGuideHunks([
    { path: "new.ts", previousPath: "old.ts", hunks: [] },
    { path: "deleted.ts", deleted: true, hunks: [{ header: "@@ -1 +0,0 @@", lines: [{ kind: "del", oldLine: 1, newLine: null, text: "removed" }] }] },
  ], revision);
  assert.deepEqual(hunks[0].revision, { ...revision, previousPath: "old.ts", deleted: undefined });
  assert.deepEqual(hunks[1].revision, { ...revision, previousPath: undefined, deleted: true });
  assert.ok(!compactGuideHunks(hunks).includes(revision.head));
});

test("persists revisions and rejects malformed revision metadata from storage", async () => {
  const guide = savedGuide(106);
  guide.hunks[0].revision = { head: "a".repeat(40), base: "b".repeat(40), deleted: true };
  const save = (value: unknown) => db.prepare("insert or replace into pull_request_guides (repository, number, json, updated_at) values (?, ?, ?, ?)")
    .run(guide.repository, guide.number, JSON.stringify(value), Date.now());
  save(guide);
  assert.deepEqual(readSavedPullRequestGuide(guide.repository, guide.number), guide);
  assert.deepEqual(await discoverPullRequestGuide(guide.repository, guide.number), { guide });
  for (const revision of [null, { head: "main" }, { head: "a".repeat(40), deleted: "true" }]) {
    const invalid = { ...guide, hunks: [{ ...guide.hunks[0], revision }] };
    save(invalid);
    assert.equal(readSavedPullRequestGuide(guide.repository, guide.number), undefined);
  }
  guide.hunks[0].revision.head = "main";
  assert.deepEqual(await discoverPullRequestGuide(guide.repository, guide.number), {});
});
