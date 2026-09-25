import assert from "node:assert/strict";
import test from "node:test";
import { groupPullRequestChecks, pullRequestChecksSummary } from "../src/lib/pull-request-checks.ts";

const checks = [
  { name: "Android - Dev APK", state: "pass" },
  { name: "Maestro E2E", state: "fail" },
  { name: "Unit", state: "pending" },
  { name: "Lint", state: "skipping" },
  { name: "Typecheck", state: "fail" },
];

test("groups failing, waiting, passing, then skipped, and drops empty groups", () => {
  assert.deepEqual(
    groupPullRequestChecks(checks).map((group) => [group.state, group.label, group.checks.map((check) => check.name)]),
    [
      ["fail", "Failing", ["Maestro E2E", "Typecheck"]],
      ["pending", "Waiting", ["Unit"]],
      ["pass", "Passing", ["Android - Dev APK"]],
      ["skipping", "Skipped", ["Lint"]],
    ],
  );
  assert.deepEqual(groupPullRequestChecks([]), []);
  assert.deepEqual(groupPullRequestChecks([{ name: "ci", state: "pass" }]).map((group) => group.state), ["pass"]);
});

test("summarises checks in product words, not GitHub jargon", () => {
  assert.equal(pullRequestChecksSummary([]), "No checks yet.");
  assert.equal(pullRequestChecksSummary([{ name: "ci", state: "pass" }]), "All passing");
  assert.equal(pullRequestChecksSummary(checks), "2 failing · 1 waiting · 1 passing · 1 skipped");
  assert.equal(
    pullRequestChecksSummary([{ name: "ci", state: "pass" }, { name: "lint", state: "skipping" }]),
    "1 passing · 1 skipped",
  );
});
