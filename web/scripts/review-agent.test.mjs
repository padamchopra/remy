import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({ absWorkingDir: root, entryPoints: ["src/lib/review-agent.ts"], bundle: true, write: false, platform: "node", format: "esm", external: ["zod"] });
const review = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

test("a review starts with what to review and what you asked it to look at", () => {
  const pull = { number: 162, title: "Search repositories", headRef: "padam/search", baseRef: "padam/search-base" };
  assert.equal(review.reviewStartMessage(pull), "Review pull request #162 Search repositories (padam/search → padam/search-base)");
  assert.equal(review.reviewStartMessage(pull, "  The empty state.  "), "Review pull request #162 Search repositories (padam/search → padam/search-base)\n\nThe empty state.");
});

test("new commits are the head moving past the reviewed commit", () => {
  const head = "a".repeat(40);
  assert.equal(review.hasNewCommits({ reviewedSha: null, headSha: head }, head), false);
  assert.equal(review.hasNewCommits({ reviewedSha: "aaaaaaa", headSha: head }, head.toUpperCase()), false);
  assert.equal(review.hasNewCommits({ reviewedSha: "aaaaaaa", headSha: head }, "b".repeat(40)), true);
  // Review new changes already moved the review to this head; its turn is running.
  assert.equal(review.hasNewCommits({ reviewedSha: "aaaaaaa", headSha: "b".repeat(40) }, "b".repeat(40)), false);
  assert.equal(review.hasNewCommits({ reviewedSha: null, headSha: head }, undefined), false);
});

test("findings read as a place, and a flag asks the agent for a rule", () => {
  const finding = { id: "f-1", title: "Inline style in a fixture", path: "hub/src/github.test.ts", startLine: 12, endLine: 12 };
  assert.equal(review.findingLocation(finding), "github.test.ts:12");
  assert.equal(review.findingLocation({ ...finding, endLine: 14 }), "github.test.ts:12-14");
  assert.equal(review.flagFindingMessage(finding, "Fixtures are allowed inline styles."), 'I flagged your finding "Inline style in a fixture" at hub/src/github.test.ts:12 (finding f-1). Fixtures are allowed inline styles. If this is how I want reviews done, propose a rule.');
  assert.equal(review.reviewLivePath("org 1"), "/api/organizations/org%201/reviews/live");
});
