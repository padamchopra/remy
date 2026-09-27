import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../test/sqlite-d1.js";
import { GitHubConnection } from "./github-connection.js";
import { activityItems, hasThreadMarker, markFromThread, readThreadMarker } from "./github-activity.js";
import { githubRoute } from "./github-routes.js";
import type { Connections } from "./connections.js";
import type { Env } from "./worker.js";

const THREAD = "11111111-2222-4333-8444-555555555555";
const SECRET = "hub-secret";

function fixture() {
  const folder = new URL("../migrations/", import.meta.url);
  const { db, sqlite } = sqliteD1(readdirSync(folder).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(new URL(f, folder), "utf8")).join("\n"));
  sqlite.exec(
    "INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('ada','Ada Lovelace','ada@example.test',1,1),('grace','Grace','grace@example.test',1,1); INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('studio','Studio',1,1); INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('m1','studio','ada','owner',1,1),('m2','studio','grace','member',1,1); INSERT INTO organization_git_installations(organization_id,installation_id,account) VALUES('studio',20,'release');",
  );
  const graphql: { timeline: unknown[] } = { timeline: [] };
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path === "/graphql" && String(body?.query).includes("PullRequestActivity"))
      return Response.json({ data: { viewer: { login: "ada" }, repository: { pullRequest: { timelineItems: { nodes: graphql.timeline } } } } });
    if (path === "/repos/release/remy/pulls/7") return Response.json({ number: 7, node_id: "PR_7", state: "open", head: { sha: "a".repeat(40), ref: "padam/remy-214-search" }, title: "Search repositories", html_url: "https://github.com/release/remy/pull/7" });
    if (path.endsWith("/comments") || path.endsWith("/reviews")) return Response.json({ id: 1, body: body?.body });
    return Response.json({});
  }) as typeof fetch;
  let clock = 1_000_000;
  const service = new GitHubConnection(db, { token: async (_o: string, _p: string, user: string) => `member-${user}` } as Connections, "12", async () => {}, send, {
    secret: async () => SECRET,
    now: () => clock,
  });
  return {
    db, sqlite, service, graphql,
    tick: (ms: number) => { clock += ms; },
    now: () => clock,
    async workspace() {
      const made = await service.organizations.createWorkspace("studio", "ada", { name: "Remy", origin: "git@github.com:release/remy.git" });
      sqlite.prepare("INSERT INTO github_repositories(organization_id,workspace_id,repository_id,full_name,installation_id) VALUES('studio',?,101,'release/remy',20)").run(made.id);
      return made.id;
    },
  };
}

test("what a thread posts through the hub carries its signed marker; a person's does not", async () => {
  const { service, workspace } = fixture();
  const id = await workspace();
  const fromThread = await service.action("studio", "ada", id, "comment", { number: 7, body: "Fixed." }, { computerId: "mac", threadId: THREAD }) as { body: string };
  assert.match(fromThread.body, /^Fixed\.\n\n<!-- remy-thread:mac:11111111-2222-4333-8444-555555555555:[0-9a-f]{32} -->$/);
  assert.deepEqual((await readThreadMarker(fromThread.body, SECRET, "studio")), { body: "Fixed.", from: { computerId: "mac", threadId: THREAD } });
  // Signed for another account, it names no thread.
  assert.equal((await readThreadMarker(fromThread.body, SECRET, "elsewhere")).from, null);
  const review = await service.action("studio", "ada", id, "review", { number: 7, body: "Looks right.", event: "COMMENT" }, { computerId: "mac", threadId: THREAD }) as { body: string };
  assert.equal(hasThreadMarker(review.body), true);
  const person = await service.action("studio", "ada", id, "comment", { number: 7, body: "Fixed." }) as { body: string };
  assert.equal(person.body, "Fixed.");
});

test("the activity timeline reads comments, reviews and one check result per head commit, oldest first", async () => {
  const marked = await markFromThread("Answered all three.", SECRET, "studio", { computerId: "mac", threadId: THREAD });
  const items = await activityItems([
    { __typename: "PullRequestCommit", commit: { oid: "3e91f2a".padEnd(40, "0"), committedDate: "2026-09-27T09:00:00Z", statusCheckRollup: { contexts: { nodes: [
      { name: "typecheck", conclusion: "FAILURE", status: "COMPLETED", completedAt: "2026-09-27T09:05:00Z" },
      { name: "server tests", conclusion: "TIMED_OUT", status: "COMPLETED", completedAt: "2026-09-27T09:06:00Z" },
      { name: "bundle", conclusion: "SUCCESS", status: "COMPLETED", completedAt: "2026-09-27T09:01:00Z" },
    ] } } } },
    { __typename: "PullRequestCommit", commit: { oid: "b".repeat(40), statusCheckRollup: { contexts: { nodes: [{ name: "typecheck", status: "IN_PROGRESS" }] } } } },
    { __typename: "PullRequestReview", id: "R1", state: "APPROVED", body: "", submittedAt: "2026-09-27T07:00:00Z", comments: { totalCount: 0 }, author: { login: "dee", name: "Dee Rahman", avatarUrl: "https://avatars.githubusercontent.com/u/1" } },
    { __typename: "PullRequestReview", id: "R2", state: "PENDING", body: "draft", createdAt: "2026-09-27T07:30:00Z", author: { login: "ada" } },
    { __typename: "PullRequestReview", id: "R3", state: "COMMENTED", body: "", submittedAt: "2026-09-27T07:40:00Z", comments: { totalCount: 1 }, author: { login: "sam" } },
    { __typename: "PullRequestReview", id: "R4", state: "COMMENTED", body: "", submittedAt: "2026-09-27T07:41:00Z", comments: { totalCount: 0 }, author: { login: "sam" } },
    { __typename: "IssueComment", id: "C1", body: "Three notes inline.", createdAt: "2026-09-27T08:00:00Z", url: "https://github.com/release/remy/pull/7#issuecomment-1", author: { login: "sam", name: "Sam Keane" } },
    { __typename: "IssueComment", id: "C2", body: marked, createdAt: "2026-09-27T08:10:00Z", author: { login: "ada", name: "Ada" } },
  ], (body) => readThreadMarker(body, SECRET, "studio"), async (computer) => (computer === "mac" ? "MacBook Pro" : null));
  assert.deepEqual(items.map((item) => item.id), ["R1", "R3", "C1", "C2", `checks:${"3e91f2a".padEnd(40, "0")}`]);
  const checks = items.at(-1)!;
  assert.deepEqual(checks.kind === "checks" && { commit: checks.commit, state: checks.state, failed: checks.failed, total: checks.total, at: checks.at }, { commit: "3e91f2a", state: "fail", failed: ["typecheck", "server tests"], total: 3, at: "2026-09-27T09:06:00Z" });
  const fromThread = items[3]!;
  assert.deepEqual(fromThread.kind === "comment" && { body: fromThread.body, thread: fromThread.thread }, { body: "Answered all three.", thread: { computerId: "mac", threadId: THREAD, computerName: "MacBook Pro" } });
  assert.equal(items[1]!.kind === "review" && items[1]!.comments, 1);
});

test("first opening a pull request counts as seen; later activity is newer than it", async () => {
  const { service, workspace, graphql, sqlite, tick, now } = fixture();
  const id = await workspace();
  graphql.timeline = [{ __typename: "IssueComment", id: "C1", body: "Hi", createdAt: "2026-09-27T08:00:00Z", author: { login: "sam" } }];
  const first = await service.pullRequestActivity("studio", "ada", "release/remy", 7);
  assert.equal(first.seenAt, now());
  assert.equal(first.userId, "ada");
  assert.equal(first.items.length, 1);
  tick(5_000);
  assert.equal((await service.pullRequestActivity("studio", "ada", "release/remy", 7)).seenAt, now() - 5_000);
  assert.equal(await service.markActivitySeen("studio", "ada", "release/remy", 7), now());
  // Seen is per member.
  assert.equal(sqlite.prepare("SELECT count(*) n FROM pull_request_seen WHERE workspace_id=?").get(id)?.n, 1);
  await assert.rejects(service.pullRequestActivity("studio", "ada", "someone/else", 7), /one of your workspaces/);
});

test("read marks are a route a computer cannot use; watching routes are gone", async () => {
  for (const [action, method] of [["pull-request-seen", "PUT"]] as const) {
    const request = new Request(`https://hub.test/api/organizations/studio/github/${action}?repository=release/remy&number=7`, { method, ...(method === "PUT" ? { body: JSON.stringify({ repository: "release/remy", number: 7 }) } : {}) });
    const response = await githubRoute(request, { DB: {} } as unknown as Env, "ada", "computer");
    assert.equal(response?.status, 403, `${method} ${action}`);
  }
  for (const action of ["pull-request-activity", "pull-request-ticket"]) {
    const request = new Request(`https://hub.test/api/organizations/studio/github/${action}?repository=release/remy&number=7`);
    const response = await githubRoute(request, { DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } } as unknown as Env, "ada");
    // No membership in the stub database: the route answers, and refuses.
    assert.equal(response?.status, 403, action);
  }
  for (const [action, method] of [["monitoring", "POST"], ["pull-request-follow", "GET"], ["pull-request-follow", "PUT"], ["pull-request-follow", "DELETE"]] as const) {
    const retired = await githubRoute(new Request(`https://hub.test/api/organizations/studio/github/${action}`, { method, ...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }) }), { DB: {} } as unknown as Env, "ada");
    assert.equal(retired, undefined, `${method} ${action}`);
  }
});
