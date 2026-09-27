import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function load(entry) {
  const bundled = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
}
const detail = await load("src/lib/pull-request-detail.ts");
const linked = await load("src/lib/pull-request-linked-thread.ts");

test("check durations read like CI", () => {
  assert.equal(detail.checkDuration("2026-09-23T09:00:00Z", "2026-09-23T09:00:48Z"), "48s");
  assert.equal(detail.checkDuration("2026-09-23T09:00:00Z", "2026-09-23T09:01:04Z"), "1m 04s");
  assert.equal(detail.checkDuration("2026-09-23T09:00:00Z", "2026-09-23T09:06:12Z"), "6m 12s");
  assert.equal(detail.checkDuration("2026-09-23T09:00:00Z", "2026-09-23T10:02:00Z"), "1h 02m");
  assert.equal(detail.checkDuration("2026-09-23T09:00:00Z", null), "");
  assert.equal(detail.checkDuration("2026-09-23T09:01:00Z", "2026-09-23T09:00:00Z"), "");
});

test("the opened line says who and how long ago", () => {
  const now = Date.parse("2026-09-23T12:00:00Z");
  const pullRequest = { authorLogin: "ada", createdAt: "2026-09-23T08:00:00Z", updatedAt: "2026-09-23T11:00:00Z", worktreePath: "hosted" };
  assert.equal(detail.openedLine(pullRequest, undefined, now), "You opened this 4 hours ago");
  assert.equal(detail.openedLine({ ...pullRequest, worktreePath: null }, undefined, now), "ada opened this 4 hours ago");
  assert.equal(detail.openedLine({ ...pullRequest, worktreePath: null }, { viewer: "Ada" }, now), "You opened this 4 hours ago");
  assert.equal(detail.openedLine({ ...pullRequest, createdAt: "" }, { createdAt: "2026-09-23T11:59:00Z" }, now), "You opened this a minute ago");
  assert.equal(detail.openedLine({ ...pullRequest, createdAt: "" }, undefined, now), "Updated an hour ago");
});

test("stack rows mark here, conflicts, drafts and finished members", () => {
  const open = { number: 1, state: "OPEN", isDraft: false };
  assert.deepEqual(detail.stackEntryStatus(open, true, "CONFLICTING"), { label: "You are here", tone: "muted" });
  assert.deepEqual(detail.stackEntryStatus(open, false, "CONFLICTING"), { label: "Conflicts", tone: "destructive" });
  assert.deepEqual(detail.stackEntryStatus({ ...open, isDraft: true }, false), { label: "Draft", tone: "muted" });
  assert.deepEqual(detail.stackEntryStatus({ ...open, state: "MERGED" }, false, "CONFLICTING"), { label: "Merged", tone: "muted" });
  assert.deepEqual(detail.stackEntryStatus({ ...open, state: "CLOSED" }, false), { label: "Closed", tone: "muted" });
  assert.equal(detail.stackEntryStatus(open, false, "MERGEABLE"), undefined);
});

test("squash and merge is off until GitHub says it can merge", () => {
  const pr = { isDraft: false, state: "OPEN" };
  const ready = { mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", checks: [{ name: "a", state: "pass" }] };
  assert.equal(detail.mergeBlocker(pr, undefined), "Open this on GitHub to merge it.");
  assert.equal(detail.mergeBlocker(pr, ready), "");
  assert.match(detail.mergeBlocker({ ...pr, isDraft: true }, ready), /ready for review/);
  assert.match(detail.mergeBlocker(pr, { ...ready, mergeable: "CONFLICTING" }), /conflicts/);
  assert.match(detail.mergeBlocker(pr, { ...ready, mergeable: "UNKNOWN" }), /still checking/);
  assert.match(detail.mergeBlocker(pr, { ...ready, mergeStateStatus: "BLOCKED" }), /Branch protection/);
  assert.match(detail.mergeBlocker(pr, { ...ready, checks: [{ name: "a", state: "fail" }] }), /failing checks/);
  assert.match(detail.mergeBlocker(pr, { ...ready, squashMergeAllowed: false }), /squash/);
});

test("the fix request names each failing check with its first line and link", () => {
  const text = detail.failingChecksMessage(
    { repository: "release/remy", number: 7, title: "Ship it", url: "https://github.com/release/remy/pull/7" },
    [
      { name: "typecheck", state: "fail", summary: "\n2 errors\nmore", url: "https://github.com/x" },
      { name: "bundle", state: "pass" },
      { name: "server tests", state: "fail" },
    ],
  );
  assert.equal(text, [
    "These checks are failing on release/remy#7 (Ship it):",
    "https://github.com/release/remy/pull/7",
    "",
    "- typecheck: 2 errors (https://github.com/x)",
    "- server tests",
    "",
    "Fix them on this branch and push. Do not open another pull request.",
  ].join("\n"));
});

test("initials take two words or the start of a login", () => {
  assert.equal(detail.initials("Dee Rahman"), "DR");
  assert.equal(detail.initials("padamchopra"), "PA");
});

const computers = [
  { computerId: "mac", capabilities: { workspaces: [{ id: "local-1", path: "/Users/ada/remy", origin: "git@github.com:Release/Remy.git" }] } },
];
const thread = (id, patch = {}) => ({
  id, computerId: "mac", observedAt: 1, access: { organizationId: "studio" },
  detail: { cwd: "/Users/ada/remy/.remy/feature", branch: "feature/next", updatedAt: 10, state: "idle", title: id, ...patch },
});
const pullRequest = { repository: "release/remy", headRefName: "feature/next", workspaceId: "hub-ws" };

test("the linked thread is the most recently active one on the head branch in that workspace", () => {
  const threads = [
    thread("older", { updatedAt: 5 }),
    thread("newer", { updatedAt: 20 }),
    thread("other-branch", { branch: "main", updatedAt: 99 }),
    thread("other-repo", { cwd: "/Users/ada/elsewhere", updatedAt: 99 }),
    { ...thread("pending", { updatedAt: 99 }), computerId: "pending" },
  ];
  assert.equal(linked.linkedPullRequestThread(pullRequest, threads, computers)?.id, "newer");
  assert.equal(linked.linkedPullRequestThread(pullRequest, threads, computers, (t) => t.id === "newer")?.id, "older");
  assert.equal(linked.linkedPullRequestThread({ ...pullRequest, headRefName: "" }, threads, computers), undefined);
  assert.equal(linked.linkedPullRequestThread(pullRequest, [thread("x", { branch: undefined })], computers), undefined);
});

test("a thread matches by workspace id when its folder has no origin", () => {
  const bare = [{ computerId: "mac", capabilities: { workspaces: [{ id: "hub-ws", path: "/Users/ada/remy/", origin: null }] } }];
  assert.equal(linked.threadInPullRequestWorkspace(thread("a"), pullRequest, bare), true);
  assert.equal(linked.threadInPullRequestWorkspace(thread("a", { cwd: "/Users/ada/remy-other" }), pullRequest, bare), false);
  assert.equal(linked.linkedThreadTone("working"), "working");
  assert.equal(linked.linkedThreadTone("needs_input"), "needs_input");
  assert.equal(linked.linkedThreadTone("error"), "done");
});
