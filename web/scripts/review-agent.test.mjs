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

test("the pane's words for severity, state and where rules apply", () => {
  assert.deepEqual(review.SEVERITY_LABEL, { must: "Must fix", should: "Should fix", note: "Note" });
  assert.equal(review.reviewStatus("working"), "Working");
  assert.equal(review.reviewStatus("needs_input"), "Needs you");
  assert.equal(review.reviewStatus("idle"), "Done");
  const rule = (repository, enabled = true) => ({ repository, enabled });
  const rules = [rule("padam/remy"), rule("Padam/Remy"), rule("padam/remy", false), rule(null), rule("other/repo"), rule(null)];
  assert.equal(review.rulesApplyLine(rules, "padam/remy"), "4 rules apply: 2 for remy, 2 for all workspaces");
  assert.equal(review.rulesApplyLine([rule("padam/remy")], "padam/remy", "Remy"), "1 rule applies for Remy");
  assert.equal(review.rulesApplyLine([rule(null), rule(null)], "padam/remy"), "2 rules apply for all workspaces");
  assert.equal(review.rulesApplyLine([], "padam/remy"), "No rules yet. The agent suggests them when you correct it.");
});

test("a rule says where it came from and whether it is on", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  const learned = { source: { repository: "padam/remy", number: 162, findingId: null }, createdAt: now - 10_000, enabled: true };
  assert.equal(review.ruleSourceLine(learned, now), "Learned on #162 · just now");
  assert.equal(review.ruleSourceLine({ source: null, createdAt: Date.parse("2026-08-19T09:00:00Z"), enabled: true }, now), "Added by you · 19 Aug");
  assert.equal(review.ruleSourceLine({ ...learned, createdAt: Date.parse("2026-08-12T09:00:00Z"), enabled: false }, now), "Learned on #162 · 12 Aug · Off");
  assert.equal(review.ruleDate(Date.parse("2025-08-12T09:00:00Z"), now), "12 Aug 2025");
});

test("findings sit under the row their range ends on, or fold with outdated conversations", async () => {
  const { build: bundle } = await import("esbuild");
  const patch = await bundle({ absWorkingDir: root, entryPoints: ["src/lib/pull-request-patch.ts"], bundle: true, write: false, platform: "node", format: "esm" });
  const { parsePullRequestPatch } = await import(`data:text/javascript;base64,${Buffer.from(patch.outputFiles[0].text).toString("base64")}`);
  const hunks = parsePullRequestPatch(["@@ -10,3 +10,4 @@", " a", "-b", "+c", "+d", " e"].join("\n"));
  const finding = (id, extra) => ({ id, path: "x.ts", startLine: 11, endLine: 12, side: "RIGHT", status: "open", ...extra });
  const placed = review.placeFindings([
    finding("f-1"),
    finding("f-2", { side: "LEFT", startLine: 11, endLine: 11 }),
    finding("f-3", { startLine: 40, endLine: 41 }),
    finding("f-4", { status: "dismissed" }),
    finding("f-5", { status: "resolved" }),
    finding("f-6", { path: "y.ts" }),
  ], "x.ts", hunks);
  assert.deepEqual([...placed.atRow.entries()].map(([row, list]) => [row, list.map((entry) => entry.id)]), [["0:3", ["f-1"]], ["0:1", ["f-2"]]]);
  assert.deepEqual(placed.elsewhere.map((entry) => entry.id), ["f-3"]);
  assert.equal(review.findingLines({ startLine: 175, endLine: 175, side: "RIGHT" }), "L175");
  assert.equal(review.findingLines({ startLine: 41, endLine: 44, side: "LEFT" }), "Old L41-44");
  assert.equal(review.referenceChip({ path: "hub/src/github.test.ts", startLine: 12, endLine: 12 }), "github.test.ts L12");
});

test("Remy's own messages and your flags read back as what they are", () => {
  const finding = { id: "f-1", title: "Inline style in a fixture", path: "hub/src/github.test.ts", startLine: 12, endLine: 12 };
  assert.deepEqual(review.parseFlagMessage(review.flagFindingMessage(finding, "Fixtures are allowed inline styles. Don't flag them in tests.")), { findingId: "f-1", words: "Fixtures are allowed inline styles. Don't flag them in tests." });
  assert.deepEqual(review.parseFlagMessage(review.flagFindingMessage(finding)), { findingId: "f-1", words: "" });
  assert.equal(review.parseFlagMessage("Does this re-render every row?"), undefined);
  assert.deepEqual(review.reviewControlMessage(review.reviewStartMessage({ number: 162, title: "Search", headRef: "a", baseRef: "b" })), { kind: "start" });
  assert.deepEqual(review.reviewControlMessage("Review the commits after a4f91c2aaaaa up to c81e0d4bbbbb. Cover only what those commits changed."), { kind: "new-changes", to: "c81e0d4bbbbb" });
  assert.equal(review.reviewControlMessage("Review this again please"), undefined);
});

test("new commits are the ones after the reviewed commit, and stack notes name each lower pull request once", () => {
  const commits = [{ sha: "a4f91c2" + "0".repeat(33) }, { sha: "c81e0d4" + "0".repeat(33) }, { sha: "9b2f7aa" + "0".repeat(33) }];
  assert.deepEqual(review.commitsSince(commits, "a4f91c2").map((commit) => commit.sha.slice(0, 7)), ["c81e0d4", "9b2f7aa"]);
  assert.deepEqual(review.commitsSince(commits, "fffffff").length, 3);
  assert.deepEqual(review.commitsSince(commits, null), []);
  const finding = (id, dependsOn, status = "open") => ({ id, dependsOn, status });
  assert.deepEqual(review.stackDependencies([finding("a", 159), finding("b", 159), finding("c", null), finding("d", 158, "dismissed")]).map((entry) => [entry.number, entry.finding.id]), [[159, "a"]]);
});
