import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../test/sqlite-d1.js";
import { ConnectionError, type Connections } from "./connections.js";
import { GitHubConnection } from "./github-connection.js";
import { diffAnchors, ReviewAgent } from "./review-agent.js";
import { reviewRequest, reviewRulesRoute, type ReviewCoordinator } from "./review-routes.js";
import { createRouteHandler, HubCoordinator, type Env } from "./worker.js";

const THREAD = "11111111-2222-4333-8444-555555555555";
const HEAD = "a".repeat(40);
const PATCH = "@@ -1,3 +1,4 @@\n import x\n-old\n+new\n+more\n context\n@@ -40,2 +41,6 @@ fn\n a\n+b";

function fixture() {
  const folder = new URL("../migrations/", import.meta.url);
  const { db, sqlite } = sqliteD1(readdirSync(folder).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(new URL(f, folder), "utf8")).join("\n"));
  sqlite.exec(
    "INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('ada','Ada','ada@example.test',1,1),('grace','Grace','grace@example.test',1,1); INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('studio','Studio',1,1); INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('m1','studio','ada','owner',1,1),('m2','studio','grace','member',1,1); INSERT INTO organization_workspaces(id,organization_id,name,origin,created_at,updated_at) VALUES('ws','studio','Remy','github.com/release/remy',1,1);",
  );
  let clock = 1_000;
  let ids = 0;
  const reviews = new ReviewAgent(db, () => ++clock, () => `id-${++ids}`);
  return { db, sqlite, reviews };
}

async function recorded(reviews: ReviewAgent, user = "ada", thread = THREAD) {
  await reviews.record({ organization_id: "studio", computer_id: "mac", thread_id: thread, user_id: user, workspace_id: "ws", repository: "Release/Remy", pull_number: 7, title: "Search repositories", base_ref: "main", head_ref: "padam/search", started_sha: HEAD, provider: "claude", model: "opus", rules_applied: 0 });
  return (await reviews.review("studio", "mac", thread))!;
}

const files = [{ path: "web/search.ts", patch: PATCH }, { path: "logo.png" }];
const finding = (extra: Record<string, unknown> = {}) => ({ path: "web/search.ts", startLine: 2, endLine: 3, side: "RIGHT", severity: "must", title: "Searches on every keystroke", body: "Debounce it.", ...extra });

test("diff anchors are each hunk's lines on each side", () => {
  assert.deepEqual(diffAnchors(PATCH), { LEFT: [[1, 3], [40, 41]], RIGHT: [[1, 4], [41, 46]] });
  assert.deepEqual(diffAnchors("@@ -0,0 +1 @@\n+only"), { LEFT: [], RIGHT: [[1, 1]] });
});

test("rules are personal: nobody else lists, changes or deletes them, and 100 can be on", async () => {
  const { reviews, sqlite } = fixture();
  const general = await reviews.createRule("ada", { text: "Labels say workspace and thread, never project or chat.", repository: null });
  const scoped = await reviews.createRule("ada", { text: "Flag any command string.", repository: "Release/Remy" });
  assert.equal(scoped.repository, "release/remy");
  assert.equal(scoped.source, null);
  await reviews.createRule("ada", { text: "Elsewhere only.", repository: "release/other" });
  assert.deepEqual((await reviews.rules("ada", "release/remy")).map((rule) => rule.id).sort(), [general.id, scoped.id].sort());
  assert.equal((await reviews.rules("ada")).length, 3);
  assert.deepEqual(await reviews.rules("grace"), []);
  await assert.rejects(reviews.updateRule("grace", general.id, { enabled: false }), /no longer available/);
  await assert.rejects(reviews.deleteRule("grace", general.id), /no longer available/);
  const off = await reviews.updateRule("ada", general.id, { enabled: false });
  assert.equal(off.enabled, false);
  assert.deepEqual((await reviews.enabledRules("ada", "release/remy")).map((rule) => [rule.id, rule.scope]), [[scoped.id, "repository"]]);
  await assert.rejects(reviews.createRule("ada", { text: "x".repeat(501), repository: null }), (error: unknown) => error instanceof ConnectionError && error.status === 400);
  for (let index = 0; index < 98; index++) sqlite.prepare("INSERT INTO review_rules(id,user_id,repository,text,enabled,created_at,updated_at) VALUES(?,?,NULL,'r',1,1,1)").run(`bulk-${index}`, "ada");
  await assert.rejects(reviews.createRule("ada", { text: "One more", repository: null }), (error: unknown) => error instanceof ConnectionError && error.status === 409);
  await assert.rejects(reviews.updateRule("ada", general.id, { enabled: true }), /100 rules on/);
  assert.equal((await reviews.createRule("ada", { text: "Kept off", repository: null, enabled: false })).enabled, false);
  await reviews.deleteRule("ada", scoped.id);
  assert.equal(await reviews.rule("ada", scoped.id), undefined);
});

test("findings must sit on the diff; ids stay stable across reports and your decisions survive them", async () => {
  const { reviews } = fixture();
  const rule = await reviews.createRule("ada", { text: "Debounce searches.", repository: "release/remy" });
  const review = await recorded(reviews);
  await assert.rejects(reviews.report(review, { commit: "a4f91c2", findings: [finding({ startLine: 10, endLine: 12 })] }, files), /not on lines in the pull request's diff: web\/search\.ts:10-12 \(RIGHT\)/);
  await assert.rejects(reviews.report(review, { commit: "a4f91c2", findings: [finding({ path: "missing.ts" })] }, files), /missing\.ts:2-3/);
  await assert.rejects(reviews.report(review, { commit: "a4f91c2", findings: [finding({ startLine: 3, endLine: 42 })] }, files), /not on lines/);
  await assert.rejects(reviews.report(review, { commit: "nope", findings: [] }, files), /commit/);
  const first = await reviews.report(review, {
    commit: "A4F91C2",
    summary: "I read all 3 files and ran the web tests.",
    findings: [finding({ ruleIds: [rule.id, "someone-elses"] }), finding({ path: "logo.png", startLine: 1, endLine: 1, severity: "note", title: "Large image", body: "Compress it." }), finding({ startLine: 40, endLine: 41, side: "LEFT", severity: "should", title: "Removed guard", body: "Keep it." })],
  }, files);
  assert.equal(first.ids.length, 3);
  const [must, note, should] = first.ids as [string, string, string];
  let state = await reviews.state((await reviews.review("studio", "mac", THREAD))!, "ada");
  assert.equal(state.reviewedSha, "a4f91c2");
  assert.equal(state.summary, "I read all 3 files and ran the web tests.");
  assert.deepEqual(state.findings.map((item) => item.id), [must, note, should]);
  assert.deepEqual(state.findings[0]!.rules, [{ id: rule.id, text: "Debounce searches." }]);
  await assert.rejects(reviews.state(review, "grace"), /no longer available/);

  // Your decision on a finding stays when the agent updates it.
  await reviews.setFindingStatus("studio", "ada", note, { status: "dismissed" });
  await assert.rejects(reviews.setFindingStatus("studio", "grace", must, { status: "dismissed" }), /no longer available/);
  await assert.rejects(reviews.setFindingStatus("studio", "ada", must, { status: "added-to-github" }), /pending comment/);
  await assert.rejects(reviews.setFindingStatus("studio", "ada", must, { status: "resolved" }), (error: unknown) => error instanceof ConnectionError && error.status === 400);
  const second = await reviews.report(review, { commit: "b".repeat(40), findings: [finding({ id: note, path: "logo.png", startLine: 1, endLine: 1, title: "Large image, still", severity: "note", body: "Compress it." }), finding({ startLine: 41, endLine: 41, title: "New one", body: "b" })], resolvedIds: [must] }, files);
  assert.deepEqual(second.resolved, [must]);
  await assert.rejects(reviews.report(review, { commit: "b".repeat(40), findings: [finding({ id: "invented" })] }, files), /No earlier finding has id invented/);
  state = await reviews.state((await reviews.review("studio", "mac", THREAD))!, "ada");
  assert.deepEqual(state.findings.map((item) => [item.id, item.status, item.title]), [
    [must, "resolved", "Searches on every keystroke"],
    [note, "dismissed", "Large image, still"],
    [should, "open", "Removed guard"],
    [second.ids[1], "open", "New one"],
  ]);
  const added = await reviews.setFindingStatus("studio", "ada", should, { status: "added-to-github", githubCommentId: "PRRC_1" });
  assert.equal(added.finding.githubCommentId, "PRRC_1");
});

test("a proposed rule is only a proposal until its owner saves it, with their wording and scope", async () => {
  const { reviews } = fixture();
  const review = await recorded(reviews);
  const { ids } = await reviews.report(review, { commit: "a4f91c2", findings: [finding()] }, files);
  await assert.rejects(reviews.propose(review, { text: "Rule", scope: "everywhere", reason: "r" }), /scope/);
  await assert.rejects(reviews.propose(review, { text: "Rule", scope: "all", reason: "r", findingId: "other" }), /No finding in this review/);
  const proposal = await reviews.propose(review, { text: "Don't flag inline styles in fixtures.", scope: "repository", reason: "You said fixtures may.", findingId: ids[0] });
  assert.deepEqual(await reviews.rules("ada"), []);
  assert.equal((await reviews.state(review, "ada")).proposals[0]!.id, proposal.id);
  await assert.rejects(reviews.acceptProposal("studio", "grace", proposal.id, {}), /no longer available/);
  await assert.rejects(reviews.discardProposal("studio", "grace", proposal.id), /no longer available/);
  const saved = await reviews.acceptProposal("studio", "ada", proposal.id, { text: "Don't flag inline styles in test files or fixtures.", scope: "all" });
  assert.equal(saved.rule.repository, null);
  assert.equal(saved.rule.text, "Don't flag inline styles in test files or fixtures.");
  assert.deepEqual(saved.rule.source, { repository: "release/remy", number: 7, findingId: ids[0] });
  await assert.rejects(reviews.acceptProposal("studio", "ada", proposal.id, {}), /already answered/);
  assert.deepEqual((await reviews.state(review, "ada")).proposals, []);
  // Grace never sees Ada's rule, even in the same organization.
  assert.deepEqual(await reviews.rules("grace", "release/remy"), []);
  const other = await reviews.propose(review, { text: "Another", scope: "all", reason: "r" });
  assert.equal((await reviews.discardProposal("studio", "ada", other.id)).proposal.status, "discarded");
});

test("rules routes are yours and refuse a computer session", async () => {
  const { db } = fixture();
  const notified: string[] = [];
  const env = { DB: db, COORDINATOR: { idFromName: (name: string) => name, get: (name: string) => ({ fetch: async (request: Request) => { notified.push(`${name} ${new URL(request.url).pathname} ${request.headers.get("x-user-id")}`); return new Response(null, { status: 204 }); } }) } } as unknown as Env;
  const call = (user: string, path: string, method = "GET", body?: unknown, clientKind = "web") => reviewRulesRoute(new Request(`https://hub.test/api/review-rules${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, user, clientKind);
  assert.equal((await call("ada", "", "POST", { text: "Rule", repository: null }, "computer"))?.status, 403);
  assert.equal((await call("ada", "", "GET", undefined, "computer"))?.status, 403);
  const created = await call("ada", "", "POST", { text: "Flag any command string.", repository: "release/remy" });
  assert.equal(created?.status, 201);
  const { rule } = await created!.json() as { rule: { id: string } };
  assert.deepEqual(notified, ["organization:studio /review-rules/changed ada"]);
  assert.deepEqual(((await (await call("grace", ""))!.json()) as { rules: unknown[] }).rules, []);
  assert.equal((await call("grace", `/${rule.id}`, "PATCH", { enabled: false }))?.status, 404);
  assert.equal((await call("grace", `/${rule.id}`, "DELETE"))?.status, 404);
  assert.equal((await call("ada", `/${rule.id}`, "PATCH", {}))?.status, 400);
  assert.equal((await call("ada", `/${rule.id}`, "PATCH", { enabled: false }))?.status, 200);
  assert.equal(((await (await call("ada", "?repository=release/remy"))!.json()) as { rules: { enabled: boolean }[] }).rules[0]!.enabled, false);
  assert.equal((await call("ada", `/${rule.id}`, "DELETE"))?.status, 204);
  assert.equal(await reviewRulesRoute(new Request("https://hub.test/api/review-rulesx"), env, "ada"), undefined);
});

test("review routes answer only the review's owner; Review new changes names the new commits", async () => {
  const { reviews } = fixture();
  const review = await recorded(reviews);
  const sent: string[] = [];
  const changed: string[] = [];
  let head = HEAD;
  const deps = (user: string): ReviewCoordinator => ({
    org: "studio",
    actor: { id: user, label: user },
    reviews,
    github: { pullRequestHead: async () => head } as unknown as GitHubConnection,
    thread: async (computerId, threadId) => (computerId === "mac" && threadId === THREAD ? ({ id: THREAD } as never) : undefined),
    send: async (_computer, _thread, text) => { sent.push(text); return Response.json({}); },
    changed: (userId, computerId, threadId) => changed.push(`${userId}:${computerId}:${threadId}`),
  });
  const call = (user: string, path: string, method = "GET", body?: unknown) => reviewRequest(new Request(`https://internal${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), deps(user));
  const latest = await (await call("ada", "/reviews?repository=release/remy&number=7"))!.json() as { review: { threadId: string; rulesApplied: number } | null };
  assert.equal(latest.review?.threadId, THREAD);
  assert.deepEqual(await (await call("grace", "/reviews?repository=release/remy&number=7"))!.json(), { review: null });
  assert.equal((await call("grace", `/reviews/mac/${THREAD}`))!.status, 404);
  assert.equal((await call("ada", `/reviews/mac/${THREAD}`))!.status, 200);
  assert.deepEqual(await (await call("ada", "/reviews/last?workspaceId=ws"))!.json(), { last: { computerId: "mac", provider: "claude", model: "opus" } });
  assert.deepEqual(await (await call("grace", "/reviews/last?workspaceId=ws"))!.json(), { last: null });

  const { ids } = await reviews.report(review, { commit: HEAD.slice(0, 7), findings: [finding()] }, files);
  assert.equal((await call("grace", `/reviews/findings/${ids[0]}`, "PATCH", { status: "dismissed" }))!.status, 404);
  assert.equal((await call("ada", `/reviews/findings/${ids[0]}`, "PATCH", { status: "dismissed" }))!.status, 200);
  const proposal = await reviews.propose(review, { text: "Rule", scope: "all", reason: "r" });
  assert.equal((await call("grace", `/reviews/proposals/${proposal.id}/accept`, "POST", {}))!.status, 404);
  const accepted = await (await call("ada", `/reviews/proposals/${proposal.id}/accept`, "POST", {}))!.json() as { rule: { text: string } };
  assert.equal(accepted.rule.text, "Rule");
  assert.deepEqual(changed, [`ada:mac:${THREAD}`, `ada:mac:${THREAD}`]);

  const none = await call("ada", `/reviews/mac/${THREAD}/new-changes`, "POST");
  assert.equal(none!.status, 409);
  head = "c".repeat(40);
  assert.equal((await call("grace", `/reviews/mac/${THREAD}/new-changes`, "POST"))!.status, 404);
  const moved = await (await call("ada", `/reviews/mac/${THREAD}/new-changes`, "POST"))!.json() as { from: string; to: string; review: { headSha: string } };
  assert.deepEqual([moved.from, moved.to, moved.review.headSha], [HEAD.slice(0, 7), head, head]);
  assert.match(sent[0]!, /^Review the commits after aaaaaaa up to cccccccccccc\./);
});

test("a computer session reaches neither your reviews nor your rules", async () => {
  const route = createRouteHandler({
    accountStore: () => ({}) as never,
    accountService: () => ({ authenticate: async () => ({ sessionId: "session", userId: "ada", clientKind: "computer" }) }) as never,
    organizationStore: () => ({ membership: async () => ({ role: "member" }) }) as never,
    organizationService: () => ({ member: async () => ({ role: "owner" }) }) as never,
  });
  let forwarded = 0;
  const env = { DB: {} as D1Database, BETTER_AUTH_URL: "https://hub.example", COORDINATOR: { idFromName: (id: string) => id, get: () => ({ fetch: async () => { forwarded++; return Response.json({}); } }) } } as unknown as Env;
  for (const [path, method] of [["/api/organizations/studio/reviews?repository=release/remy&number=7", "GET"], [`/api/organizations/studio/reviews/findings/one`, "PATCH"], ["/api/organizations/studio/reviews/proposals/one/accept", "POST"], ["/api/review-rules", "GET"], ["/api/review-rules", "POST"]] as const) {
    const response = await route(new Request(`https://hub.example${path}`, { method, headers: { authorization: "Bearer token", "content-type": "application/json" }, ...(method === "GET" ? {} : { body: "{}" }) }), env);
    assert.equal(response.status, 403, `${method} ${path}`);
  }
  assert.equal(forwarded, 0);
});

function coordinator(db: D1Database, values = new Map<string, unknown>([["organizationId", "studio"]])) {
  const storage = { get: async (key: string) => values.get(key), put: async (key: string, value: unknown) => { values.set(key, value); }, delete: async (key: string) => values.delete(key), list: async (options?: { prefix?: string }) => new Map([...values].filter(([key]) => key.startsWith(options?.prefix ?? ""))), getAlarm: async () => null, setAlarm: async () => {}, transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(storage) };
  return new HubCoordinator({ storage, blockConcurrencyWhile: async <T>(work: () => Promise<T>) => work(), getWebSockets: () => [], waitUntil: (work: Promise<unknown>) => { void work; } } as unknown as DurableObjectState, { DB: db, AUTH_SECRET: { get: async () => "test-secret-with-at-least-thirty-two-characters" }, BETTER_AUTH_URL: "https://hub.example" } as never);
}

test("a thread's review tools work only for a review thread on its own computer, and a review never posts to GitHub", async () => {
  const { db, reviews } = fixture();
  const OTHER = "99999999-2222-4333-8444-555555555555";
  const values = new Map<string, unknown>([["organizationId", "studio"], [`thread-run:${THREAD}`, { computerId: "mac", userId: "ada" }], [`thread-run:${OTHER}`, { computerId: "mac", userId: "ada" }]]);
  const hub = coordinator(db, values);
  await recorded(reviews);
  const tool = (thread: string, action: string, input: unknown, computer = "mac") => hub.fetch(new Request(`https://internal/organization-tools/${thread}`, { method: "POST", headers: { "x-organization-id": "studio", "x-computer-id": computer, "content-type": "application/json" }, body: JSON.stringify({ action, input }) }));
  const proposed = await tool(THREAD, "propose_review_rule", { text: "Don't flag inline styles in fixtures.", scope: "all", reason: "The person said so." });
  assert.equal(proposed.status, 200);
  const body = await proposed.json() as { proposal: { id: string; status: string }; artifact: { kind: string; id: string } };
  assert.equal(body.proposal.status, "pending");
  assert.deepEqual([body.artifact.kind, body.artifact.id], ["review-rule", body.proposal.id]);
  assert.equal((await tool(THREAD, "propose_review_rule", { text: "", scope: "all", reason: "r" })).status, 400);
  // Another thread, or the same thread named by another computer, is refused.
  assert.equal((await tool(OTHER, "propose_review_rule", { text: "Rule", scope: "all", reason: "r" })).status, 403);
  assert.equal((await tool(OTHER, "report_review_findings", { commit: "a4f91c2", findings: [] })).status, 403);
  assert.equal((await tool(THREAD, "propose_review_rule", { text: "Rule", scope: "all", reason: "r" }, "other-computer")).status, 403);
  const posted = await tool(THREAD, "github_action", { workspaceId: "ws", action: "comment", number: 7, body: "LGTM" });
  assert.equal(posted.status, 403);
  assert.match((await posted.json() as { error: string }).error, /does not post to GitHub/);
});

test("a review start is checked before anything runs", async () => {
  const { db } = fixture();
  const hub = coordinator(db);
  const start = (input: Record<string, unknown>) => (hub as unknown as { threadRequest(request: Request): Promise<Response> }).threadRequest(new Request("https://internal/threads", {
    method: "POST",
    headers: { "content-type": "application/json", "x-thread-member": encodeURIComponent(JSON.stringify({ id: "ada", label: "Ada" })), "x-organization-id": "studio" },
    body: JSON.stringify({ workspaceId: "ws", requestId: crypto.randomUUID(), message: "Review this pull request.", ...input }),
  }));
  assert.equal((await start({ review: { repository: "release", number: 7 } })).status, 400);
  assert.equal((await start({ review: { repository: "release/remy", number: 7 }, branch: "main" })).status, 400);
  assert.equal((await start({ review: { repository: "release/remy", number: 7 }, computerId: "cloud:cursor-cloud" })).status, 409);
});

test("a review's pull request is read with your connection, must be open and in the workspace's repository", async () => {
  const { db } = fixture();
  let state = "open";
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url.pathname === "/graphql" && String(body?.query).includes("ReviewStack"))
      return Response.json({ data: { repository: { pullRequest: { stack: { entries: { nodes: [
        { pullRequest: { number: 6, title: "Search API", headRefName: "padam/search-base", baseRefName: "main" } },
        { pullRequest: { number: 7, title: "Search repositories", headRefName: "padam/search", baseRefName: "padam/search-base" } },
      ] } } } } } });
    if (url.pathname === "/repos/release/remy/pulls/7") return Response.json({ state, title: "Search repositories", head: { ref: "padam/search", sha: HEAD.toUpperCase() }, base: { ref: "padam/search-base" } });
    return Response.json({}, { status: 404 });
  }) as typeof fetch;
  const github = new GitHubConnection(db, { token: async () => "member-token" } as unknown as Connections, "12", async () => {}, send);
  const target = await github.reviewTarget("studio", "ada", "ws", "release/remy", 7);
  assert.deepEqual({ ...target, stack: target.stack.map((member) => member.number) }, { repository: "release/remy", number: 7, title: "Search repositories", baseRef: "padam/search-base", headRef: "padam/search", headSha: HEAD, stack: [6, 7] });
  await assert.rejects(github.reviewTarget("studio", "ada", "ws", "release/other", 7), /one of your workspaces/);
  state = "closed";
  await assert.rejects(github.reviewTarget("studio", "ada", "ws", "release/remy", 7), /open pull request/);
});
