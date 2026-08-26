import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ChatSummary } from "./chat.js";
import type { AuthoredPullRequest } from "./pull-requests.js";

process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "remy-pr-monitor-test-"));

const { activePullRequestThread, pullRequestFingerprint, pullRequestIssue } = await import("./pull-request-monitor.js");

const pullRequest: AuthoredPullRequest = {
  url: "https://github.com/acme/control/pull/42",
  number: 42,
  title: "Keep the flight deck moving",
  body: "",
  repository: "acme/control",
  headRefName: "feature/flight-deck",
  baseRefName: "main",
  isDraft: false,
  reviewDecision: "CHANGES_REQUESTED",
  authorLogin: "author",
  updatedAt: "2026-08-26T10:00:00Z",
  additions: 20,
  deletions: 4,
  changedFiles: 3,
  checks: [{ name: "build", state: "fail" }],
  comments: [],
  unreadComments: [{ author: "reviewer", body: "Cover this case.", createdAt: "2026-08-26T09:00:00Z" }],
  unreadSince: null,
  latestCommentAt: "2026-08-26T09:00:00Z",
  hasUnreadActivity: true,
  workspaceId: "workspace-1",
  workspaceName: "Control",
  workspacePath: "/code/control",
  worktreePath: "/code/control/.remy/feature/flight-deck",
};

function chat(id: string, cwd: string, state: ChatSummary["state"], updatedAt: number): ChatSummary {
  return { id, title: id, cwd, state, provider: "claude", updatedAt } as ChatSummary;
}

test("summarizes only pull request state that needs work", () => {
  assert.equal(
    pullRequestIssue(pullRequest),
    "Failed checks: build. A reviewer requested changes. 1 unread review comment needs attention.",
  );
  assert.equal(pullRequestIssue({
    ...pullRequest,
    reviewDecision: "APPROVED",
    checks: [{ name: "build", state: "pass" }],
    unreadComments: [],
    hasUnreadActivity: false,
  }), undefined);
});

test("the monitor fingerprint changes when GitHub state changes", () => {
  assert.notEqual(
    pullRequestFingerprint(pullRequest),
    pullRequestFingerprint({ ...pullRequest, checks: [{ name: "build", state: "pass" }] }),
  );
});

test("routes work to the newest active thread in the pull request worktree", () => {
  const selected = activePullRequestThread(pullRequest, [
    chat("workspace", "/code/control", "working", 50),
    chat("old", "/code/control/.remy/feature/flight-deck", "working", 10),
    chat("new", "/code/control/.remy/feature/flight-deck/Sources", "needs_input", 20),
    chat("idle", "/code/control/.remy/feature/flight-deck", "idle", 30),
  ]);
  assert.equal(selected?.id, "new");
});
