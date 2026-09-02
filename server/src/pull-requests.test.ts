import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Workspace } from "./workspaces.js";

// workspaces.ts loads the server config at module evaluation time. Keep that
// test-only config isolated from the user's real Remy installation.
process.env.HOME = mkdtempSync(join(tmpdir(), "remy-pr-test-"));

const { markPullRequestFileViewedArgs, markPullRequestReadyArgs, parseAuthoredPullRequests, parsePullRequestFileViewPage, parsePullRequestMergeState, parsePullRequestPatch, parsePullRequestTimeline, parsePullRequestView, parseUnreadReviewComments, pullRequestMergeBlocker, squashMergePullRequestArgs } = await import("./pull-requests.js");

const workspace: Workspace = {
  id: "workspace-1",
  name: "Control",
  path: "/code/control",
  origin: "github.com/acme/control",
  icon: null,
  tint: null,
  provider: null,
  model: null,
  effort: null,
  worktrees: [
    { path: "/code/control", branch: "main", isMain: true, dirty: false },
    { path: "/code/control-pr", branch: "feature/flight-deck", isMain: false, dirty: false },
  ],
};

test("marking a pull request ready scopes GitHub CLI to its repository", () => {
  assert.deepEqual(markPullRequestReadyArgs("acme/control", 42), ["pr", "ready", "42", "--repo", "acme/control"]);
});

test("squash merging pins the reviewed head and preserves the edited commit text", () => {
  assert.deepEqual(squashMergePullRequestArgs({
    repository: "acme/control",
    number: 42,
    headRefOid: "a".repeat(40),
    title: "Land the flight deck",
    message: "Keep the reviewer context in the squash commit.",
  }), [
    "pr", "merge", "42",
    "--repo", "acme/control",
    "--squash",
    "--subject", "Land the flight deck",
    "--body", "Keep the reviewer context in the squash commit.",
    "--match-head-commit", "a".repeat(40),
  ]);
});

test("merge readiness keeps GitHub's current head and gate state", () => {
  const ready = parsePullRequestMergeState(JSON.stringify({
    state: "OPEN",
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    headRefOid: "b".repeat(40),
  }));
  assert.deepEqual(ready, {
    state: "OPEN",
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    headRefOid: "b".repeat(40),
  });
  assert.equal(pullRequestMergeBlocker(ready, "b".repeat(40)), "");
  assert.equal(
    pullRequestMergeBlocker({ ...ready, isDraft: true }, "b".repeat(40)),
    "Mark this pull request ready before merging.",
  );
  assert.equal(
    pullRequestMergeBlocker(ready, "c".repeat(40)),
    "This pull request changed. Refresh it before merging.",
  );
  assert.equal(
    pullRequestMergeBlocker({ ...ready, mergeStateStatus: "BLOCKED" }, "b".repeat(40)),
    "This pull request isn't ready to merge. Refresh it and try again.",
  );
});

test("file review state keeps GitHub's viewer progress and pagination", () => {
  const result = parsePullRequestFileViewPage(JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          id: "PR_42",
          files: {
            nodes: [
              { path: "src/alpha.ts", viewerViewedState: "VIEWED" },
              { path: "src/beta.ts", viewerViewedState: "UNVIEWED" },
            ],
            pageInfo: { hasNextPage: true, endCursor: "next-page" },
          },
        },
      },
    },
  }));

  assert.deepEqual(result, {
    pullRequestId: "PR_42",
    files: [
      { path: "src/alpha.ts", viewed: true },
      { path: "src/beta.ts", viewed: false },
    ],
    nextCursor: "next-page",
  });
});

test("viewing and unviewing a file use GitHub's pull request mutations", () => {
  const viewed = markPullRequestFileViewedArgs("PR_42", "src/alpha.ts", true);
  const unviewed = markPullRequestFileViewedArgs("PR_42", "src/alpha.ts", false);
  assert.ok(viewed.includes("pullRequestId=PR_42"));
  assert.ok(viewed.includes("path=src/alpha.ts"));
  assert.match(viewed.join(" "), /markFileAsViewed/);
  assert.match(unviewed.join(" "), /unmarkFileAsViewed/);
});

test("pull request parsing resolves its branch worktree and attention state", () => {
  const raw = JSON.stringify([{
    url: "https://github.com/acme/control/pull/42",
    number: 42,
    title: "Add the flight deck",
    body: "## Summary\nAdds the flight deck.",
    headRefName: "feature/flight-deck",
    baseRefName: "main",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    author: { login: "author" },
    updatedAt: "2026-08-02T10:00:00Z",
    additions: 120,
    deletions: 14,
    changedFiles: 8,
    comments: [{ author: { login: "reviewer" }, body: "Please cover this case.", createdAt: "2026-08-02T09:00:00Z" }],
    latestReviews: [{ author: { login: "reviewer" }, body: "One more thought.", submittedAt: "2026-08-02T09:30:00Z" }],
    statusCheckRollup: [
      { name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
      { name: "lint", status: "COMPLETED", conclusion: "FAILURE" },
      { context: "deploy", state: "PENDING" },
    ],
  }]);

  const result = parseAuthoredPullRequests(raw, workspace, new Set(["acme/control#42"]));
  assert.equal(result.length, 1);
  assert.equal(result[0].repository, "acme/control");
  assert.equal(result[0].body, "## Summary\nAdds the flight deck.");
  assert.equal(result[0].worktreePath, "/code/control-pr");
  assert.equal(result[0].authorLogin, "author");
  assert.equal(result[0].hasUnreadActivity, true);
  assert.equal(result[0].latestCommentAt, "2026-08-02T09:30:00Z");
  assert.deepEqual(result[0].checks.map((check) => check.state), ["pass", "fail", "pending"]);
});

test("pull request parsing remains useful without a matching worktree", () => {
  const raw = JSON.stringify([{
    url: "https://github.com/acme/control/pull/7",
    number: 7,
    title: "Draft experiment",
    headRefName: "remote-only",
    baseRefName: "main",
    isDraft: true,
    updatedAt: "2026-08-01T10:00:00Z",
  }]);
  const [result] = parseAuthoredPullRequests(raw, workspace);
  assert.equal(result.worktreePath, null);
  assert.equal(result.isDraft, true);
  assert.deepEqual(result.comments, []);
  assert.deepEqual(result.checks, []);
});

test("unread review comments exclude bots, old activity, and raw markup", () => {
  const raw = JSON.stringify([[
    {
      user: { login: "author", type: "User" },
      body: "My own reply",
      created_at: "2026-08-02T10:04:00Z",
    },
    {
      user: { login: "reviewer", type: "User" },
      body: "<!-- hidden --> **Could we keep this value stable?**",
      created_at: "2026-08-02T10:05:00Z",
      path: "Sources/Inbox.swift",
      line: 42,
    },
    {
      user: { login: "checks[bot]", type: "Bot" },
      body: "Automated report",
      created_at: "2026-08-02T10:06:00Z",
    },
    {
      user: { login: "reviewer", type: "User" },
      body: "Already read",
      created_at: "2026-08-02T09:00:00Z",
    },
  ]]);

  const result = parseUnreadReviewComments(raw, "2026-08-02T10:00:00Z", "2026-08-02T10:06:00Z", "author");
  assert.deepEqual(result, [{
    author: "reviewer",
    body: "Could we keep this value stable?",
    createdAt: "2026-08-02T10:05:00Z",
    path: "Sources/Inbox.swift",
    line: 42,
  }]);
});

test("pull request timeline interleaves commits and GitHub activity", () => {
  const commits = JSON.stringify([[
    {
      sha: "abc123456789",
      html_url: "https://github.com/acme/control/commit/abc123456789",
      author: { login: "author" },
      commit: { author: { date: "2026-08-02T10:00:00Z" }, message: "Add timeline\n\nShow every event." },
    },
  ]]);
  const comments = JSON.stringify([[
    {
      id: 11,
      html_url: "https://github.com/acme/control/pull/42#issuecomment-11",
      user: { login: "reviewer" },
      body: "Could we clarify this?",
      created_at: "2026-08-02T10:10:00Z",
    },
  ]]);
  const reviews = JSON.stringify([[
    {
      id: 12,
      html_url: "https://github.com/acme/control/pull/42#pullrequestreview-12",
      user: { login: "reviewer" },
      body: "",
      state: "APPROVED",
      commit_id: "abc123456789",
      submitted_at: "2026-08-02T10:20:00Z",
    },
  ]]);
  const reviewComments = JSON.stringify([[
    {
      id: 13,
      html_url: "https://github.com/acme/control/pull/42#discussion_r13",
      user: { login: "reviewer" },
      body: `<!-- hidden --> **Keep this stable.**\n\n${"Full review context. ".repeat(20)}`,
      created_at: "2026-08-02T10:15:00Z",
      commit_id: "abc123456789",
      path: "Sources/Timeline.swift",
      line: 42,
    },
  ]]);

  const result = parsePullRequestTimeline(commits, comments, reviews, reviewComments);
  assert.deepEqual(result.map((item) => item.kind), ["review", "review_comment", "comment", "commit"]);
  assert.equal(result[0].state, "APPROVED");
  assert.equal(result[1].body, `**Keep this stable.**\n\n${"Full review context. ".repeat(20).trim()}`);
  assert.ok(result[1].body.length > 240);
  assert.equal(result[1].path, "Sources/Timeline.swift");
  assert.equal(result[3].sha, "abc123456789");
});

test("pull request patches retain file paths and both line-number spaces", () => {
  const result = parsePullRequestPatch([
    "diff --git a/src/old.ts b/src/new.ts",
    "similarity index 90%",
    "rename from src/old.ts",
    "rename to src/new.ts",
    "--- a/src/old.ts",
    "+++ b/src/new.ts",
    "@@ -13,3 +14,4 @@ export function greet() {",
    " const name = getName();",
    "-return `Hi ${name}`;",
    "+return `Hello ${name}`;",
    "+return name;",
    " }",
  ].join("\n"));

  assert.equal(result.length, 1);
  assert.equal(result[0].path, "src/new.ts");
  assert.equal(result[0].previousPath, "src/old.ts");
  assert.equal(result[0].hunks[0].header, "@@ -13,3 +14,4 @@ export function greet() {");
  assert.deepEqual(result[0].hunks[0].lines.map((line) => [line.kind, line.oldLine, line.newLine]), [
    ["ctx", 13, 14],
    ["del", 14, null],
    ["add", null, 15],
    ["add", null, 16],
    ["ctx", 15, 17],
  ]);
});

test("pull request view combines review state, checks, and files", () => {
  const result = parsePullRequestView(JSON.stringify({
    url: "https://github.com/acme/control/pull/42",
    title: "Add the flight deck",
    body: "## Summary\nAdds the flight deck.",
    baseRefName: "main",
    headRefName: "feature/flight-deck",
    headRefOid: "a".repeat(40),
    baseRefOid: "b".repeat(40),
    state: "OPEN",
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "CHANGES_REQUESTED",
    additions: 12,
    deletions: 3,
    changedFiles: 1,
    statusCheckRollup: [
      { name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
      { name: "lint", status: "COMPLETED", conclusion: "FAILURE" },
    ],
  }), [
    "diff --git a/src/old.ts b/src/new.ts",
    "--- a/src/old.ts",
    "+++ b/src/new.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
  ].join("\n"), "acme/control", 42);

  assert.equal(result.url, "https://github.com/acme/control/pull/42");
  assert.equal(result.body, "## Summary\nAdds the flight deck.");
  assert.equal(result.reviewDecision, "CHANGES_REQUESTED");
  assert.equal(result.mergeable, "MERGEABLE");
  assert.equal(result.mergeStateStatus, "CLEAN");
  assert.deepEqual(result.checks.map((check) => check.state), ["pass", "fail"]);
  assert.equal(result.files[0].path, "src/new.ts");
  assert.equal(result.headRefOid, "a".repeat(40));
  assert.equal(result.baseRefOid, "b".repeat(40));
});

test("deleted files retain their original path and side for full-file reads", () => {
  const [file] = parsePullRequestPatch("diff --git a/src/old.ts b/src/old.ts\ndeleted file mode 100644\n--- a/src/old.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-one\n-two\n");
  assert.equal(file.path, "src/old.ts");
  assert.equal(file.deleted, true);
  assert.deepEqual(file.hunks[0].lines.map((line) => line.oldLine), [1, 2]);
});
