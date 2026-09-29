import assert from "node:assert/strict";
import test from "node:test";
import { pullRequestStatus } from "../src/lib/pull-request-status.ts";

const pr = (overrides = {}) => ({ isDraft: false, reviewDecision: "", checks: [], ...overrides });
const kind = (overrides, yours = true) => pullRequestStatus(pr(overrides), yours).kind;

test("each row says the one thing its pull request is waiting on, first match wins", () => {
  assert.equal(kind({ isDraft: true, checks: [{ state: "fail" }], reviewDecision: "CHANGES_REQUESTED" }), "draft");
  assert.equal(kind({ checks: [{ state: "pass" }, { state: "fail" }, { state: "pending" }], reviewDecision: "CHANGES_REQUESTED" }), "checks-failing");
  assert.equal(kind({ checks: [{ state: "pending" }], reviewDecision: "CHANGES_REQUESTED" }), "changes-requested");
  assert.equal(kind({ checks: [{ state: "pass" }, { state: "pending" }], reviewDecision: "REVIEW_REQUIRED" }), "checks-running");
  assert.equal(kind({ checks: [{ state: "pass" }], reviewDecision: "REVIEW_REQUIRED" }), "waiting-for-review");
  assert.equal(kind({ checks: [{ state: "pass" }], reviewDecision: "REVIEW_REQUIRED" }, false), "your-review");
  assert.equal(kind({ checks: [{ state: "pass" }, { state: "skipping" }], reviewDecision: "APPROVED" }), "ready");
  assert.equal(kind({}), "ready");
});

test("the status carries its words and a colour, never the colour alone", () => {
  assert.deepEqual(pullRequestStatus(pr({ checks: [{ state: "fail" }] }), true), { kind: "checks-failing", label: "Checks failing", tone: "error" });
  assert.deepEqual(pullRequestStatus(pr({ isDraft: true }), true), { kind: "draft", label: "Draft", tone: "muted" });
  assert.deepEqual(pullRequestStatus(pr({ reviewDecision: "APPROVED" }), false), { kind: "ready", label: "Ready to merge", tone: "success" });
});
