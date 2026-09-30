import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const state = mkdtempSync(join(tmpdir(), "remy-review-agent-"));
process.env.MC_CONFIG_DIR = state;
const binDir = mkdtempSync(join(tmpdir(), "remy-review-agent-bin-"));
for (const command of ["claude", "codex", "agent"]) {
  const path = join(binDir, command);
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
}
process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
const { getChat } = await import("./chat.js");
const { handleHubThreadRequest, hubThreadSnapshot } = await import("./hub-threads.js");
const { reviewInstructions, updatedRulesContext, threadReview } = await import("./review-agent.js");
const { setProviderAdapterForTest } = await import("./provider-adapters/index.js");
const owner = { id: "ada", label: "Ada" };
const noAttachment = async () => { throw new Error("Unexpected image transfer"); };
test.after(() => {
  rmSync(state, { recursive: true, force: true });
  rmSync(binDir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=QA", "-c", "user.email=qa@example.test", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/// An origin with a main branch and a pull request #7 at refs/pull/7/head,
/// as GitHub publishes it, and a workspace cloned from it.
function repository() {
  const origin = mkdtempSync(join(state, "origin-"));
  git(origin, "init", "--bare", "-b", "main");
  const author = mkdtempSync(join(state, "author-"));
  git(author, "clone", origin, ".");
  writeFileSync(join(author, "search.ts"), "export const search = () => [];\n");
  git(author, "add", ".");
  git(author, "commit", "-m", "Initial");
  git(author, "push", "origin", "HEAD:refs/heads/main");
  git(author, "checkout", "-b", "padam/search");
  writeFileSync(join(author, "search.ts"), "export const search = (q: string) => fetch(q);\n");
  git(author, "commit", "-am", "Search on every keystroke");
  git(author, "push", "origin", "HEAD:refs/pull/7/head");
  const workspace = mkdtempSync(join(state, "workspace-"));
  git(workspace, "clone", origin, ".");
  return { origin, author, workspace, head: git(author, "rev-parse", "HEAD") };
}

const rules = [{ id: "rule-1", text: "The server reaches git through execFile. Flag any command string.", scope: "repository" as const }];
function hubReview(headSha: string, extra: Record<string, unknown> = {}) {
  return { repository: "release/remy", number: 7, title: "Search repositories", baseRef: "main", headRef: "padam/search", headSha, stack: [], rules, ...extra };
}

test("a review checks out the pull request's head detached in its own worktree and keeps its name", async () => {
  const { addWorkspace } = await import("./workspaces.js");
  const repo = repository();
  const workspace = await addWorkspace("Review QA", repo.workspace);
  const created = await handleHubThreadRequest("org", owner, "POST", "/hub/threads", {
    workspaceId: workspace.id, hubTaskId: "review-qa", title: "Review #7: Search repositories", hubReview: hubReview(repo.head),
  }, noAttachment);
  assert.equal(created.status, 201);
  const thread = await created.json() as { id: string; detail: { cwd: string; branch?: string; review?: { number: number } } };
  const cwd = getChat(thread.id)!.cwd;
  // Under the workspace's own .remy folder, hidden per clone, never committed.
  assert.match(cwd, new RegExp(`^${realpathSync(repo.workspace).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.remy/review-7-[0-9a-f]{6}$`));
  assert.match(readFileSync(join(repo.workspace, ".git", "info", "exclude"), "utf8"), /^\/\.remy\/$/m);
  assert.equal(git(cwd, "rev-parse", "HEAD"), repo.head);
  assert.throws(() => git(cwd, "symbolic-ref", "-q", "HEAD"));
  // The base is fetched beside it, so the agent compares against it.
  assert.equal(git(repo.workspace, "rev-parse", "refs/remotes/origin/main"), git(repo.author, "rev-parse", "main"));
  assert.equal(thread.detail.review?.number, 7);
  assert.equal(thread.detail.branch, undefined);
  assert.equal(getChat(thread.id)!.title, "Review #7: Search repositories");

  const refused = await handleHubThreadRequest("org", owner, "POST", "/hub/threads", {
    workspaceId: workspace.id, hubReview: hubReview(repo.head), branch: "padam/search",
  }, noAttachment);
  assert.equal(refused.status, 400);
  const unreadable = await handleHubThreadRequest("org", owner, "POST", "/hub/threads", {
    workspaceId: workspace.id, hubReview: hubReview("not-a-sha"),
  }, noAttachment);
  assert.equal(unreadable.status, 409);
  const missing = await handleHubThreadRequest("org", owner, "POST", "/hub/threads", {
    workspaceId: workspace.id, hubReview: { ...hubReview(repo.head), number: 8 },
  }, noAttachment);
  assert.equal(missing.status, 409);

  const removed = await handleHubThreadRequest("org", owner, "DELETE", `/hub/threads/${thread.id}`, {}, noAttachment);
  assert.equal(removed.status, 200);
  assert.equal(existsSync(cwd), false);
  assert.equal(threadReview(thread.id), undefined);
});

test("a review's provider gets the review instructions and its tools; saved rules and new commits reach the next turn", async () => {
  const { addWorkspace } = await import("./workspaces.js");
  const repo = repository();
  const workspace = await addWorkspace("Review turns", repo.workspace);
  const sessions: { developerInstructions?: string; mcpProcess?: { env: Record<string, string> } }[] = [];
  const prompts: string[] = [];
  const restore = setProviderAdapterForTest({
    id: "claude",
    discoverModels: async () => [],
    answer: async () => undefined,
    createSession: (options: { developerInstructions?: string; mcpProcess?: { env: Record<string, string> } }) => {
      sessions.push(options);
      return { close() {}, turn: (input: { prompt: string }) => { prompts.push(input.prompt); return { done: Promise.resolve(), interrupt() {} }; } };
    },
  } as never);
  try {
    const created = await handleHubThreadRequest("org", owner, "POST", "/hub/threads", {
      workspaceId: workspace.id, provider: "claude", title: "Review #7: Search repositories", hubReview: hubReview(repo.head),
    }, noAttachment);
    const { id } = await created.json() as { id: string };
    const send = async (text: string, review: unknown, n: number) => {
      const response = await handleHubThreadRequest("org", owner, "POST", `/hub/threads/${id}/message`, { text, messageId: `u-00000000-0000-4000-8000-00000000000${n}`, hubReview: review }, noAttachment);
      assert.equal(response.status, 200);
      for (let wait = 0; wait < 100 && prompts.length < n; wait++) await new Promise((resolve) => setTimeout(resolve, 10));
      return prompts[n - 1] ?? "";
    };
    const first = await send("Review pull request #7 Search repositories (padam/search → main)", hubReview(repo.head), 1);
    assert.equal(first, "Review pull request #7 Search repositories (padam/search → main)");
    assert.match(sessions[0]!.developerInstructions ?? "", /## You are reviewing a pull request/);
    assert.match(sessions[0]!.developerInstructions ?? "", /\[rule-1\] \(this repository\) The server reaches git through execFile/);
    assert.match(sessions[0]!.developerInstructions ?? "", /Never post to GitHub/);
    assert.match(sessions[0]!.developerInstructions ?? "", /Remy's shared browser/);
    assert.equal(sessions[0]!.mcpProcess?.env.REMY_REVIEW, "1");

    // Saved during the review: the next message says so, once.
    const saved = [...rules, { id: "rule-2", text: "Don't flag inline styles in fixtures.", scope: "all" as const }];
    const second = await send("That fixture is fine.", hubReview(repo.head, { rules: saved }), 2);
    assert.match(second, /Your review rules changed[\s\S]*\[rule-2\] Don't flag inline styles in fixtures\./);
    const third = await send("Thanks.", hubReview(repo.head, { rules: saved }), 3);
    assert.equal(third, "Thanks.");

    // Review new changes: the checkout follows the pull request's new head.
    writeFileSync(join(repo.author, "search.ts"), "export const search = debounce((q: string) => fetch(q));\n");
    git(repo.author, "commit", "-am", "Debounce search");
    git(repo.author, "push", "--force", "origin", "HEAD:refs/pull/7/head");
    const moved = git(repo.author, "rev-parse", "HEAD");
    const fourth = await send(`Review the commits after ${repo.head.slice(0, 12)} up to ${moved.slice(0, 12)}.`, hubReview(moved, { rules: saved }), 4);
    assert.match(fourth, new RegExp(`Your checkout moved from ${repo.head.slice(0, 12)} to ${moved.slice(0, 12)}`));
    assert.equal(git(getChat(id)!.cwd, "rev-parse", "HEAD"), moved);
    assert.equal(hubThreadSnapshot(id, "org")?.detail.review && (hubThreadSnapshot(id, "org")!.detail.review as { headSha: string }).headSha, moved);
    await handleHubThreadRequest("org", owner, "DELETE", `/hub/threads/${id}`, {}, noAttachment);
  } finally {
    restore();
  }
});

test("review instructions say how to review, the stack below, and each rule with its id", () => {
  const stacked = reviewInstructions({
    ...hubReview("a".repeat(40)),
    baseRef: "padam/search-base",
    stack: [
      { number: 6, title: "Search API", headRef: "padam/search-base", baseRef: "main" },
      { number: 7, title: "Search repositories", headRef: "padam/search", baseRef: "padam/search-base" },
      { number: 8, title: "Search results", headRef: "padam/results", baseRef: "padam/search" },
    ],
  });
  assert.match(stacked, /stacked: it merges into padam\/search-base, the branch of #6 "Search API" below it, not the default branch\. Say so in your first message/);
  assert.match(stacked, /git diff origin\/padam\/search-base\.\.\.HEAD/);
  assert.match(stacked, /findings directly in this thread/);
  assert.match(stacked, /propose_review_rule/);
  assert.doesNotMatch(stacked, /#8/);
  const alone = reviewInstructions({ ...hubReview("b".repeat(40)), rules: [] });
  assert.match(alone, /It merges into main\./);
  assert.match(alone, /The person has no rules yet\./);
  assert.equal(updatedRulesContext(rules, [...rules]), undefined);
  assert.match(updatedRulesContext(rules, [])!, /The person has no rules yet\./);
});

/// A stand-in for the hub (in process) or the daemon (over STDIO) that
/// records each review tool call and answers as the hub would.
async function recorder() {
  const calls: { path: string; authorization?: string; body: unknown }[] = [];
  const server = createServer(async (request: IncomingMessage, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ path: request.url ?? "", authorization: request.headers.authorization, body });
    const action = /(report_review_findings|propose_review_rule)/.exec(`${request.url ?? ""} ${String(body.action ?? "")}`)?.[1];
    const answer = action === "propose_review_rule"
      ? { proposal: { id: "proposal-1" }, artifact: { kind: "review-rule", id: "proposal-1", title: "Don't flag inline styles in fixtures." } }
      : { findings: ["finding-1"], resolved: [], commit: "a4f91c2", open: 1, artifact: { kind: "review-findings", id: "thread-1", title: "1 open finding", detail: "1 must fix · 0 should fix · 0 notes" } };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(answer));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { calls, url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const finding = { commit: "a4f91c2", findings: [{ path: "search.ts", startLine: 1, endLine: 1, side: "RIGHT", severity: "must", title: "Searches on every keystroke", body: "Debounce it." }] };

test("the in-process remy server offers review tools only to a review thread, and never github_action there", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { inProcessRemyMcpServer } = await import("./ticket-tools.js");
  const { setKv } = await import("./db.js");
  const { setThreadReview, forgetThreadReview } = await import("./review-agent.js");
  const hub = await recorder();
  setKv("hubComputerRegistration", { organizationId: "org", computerId: "mac", hubUrl: hub.url });
  setKv("hubComputerPrivateKey", generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"));
  const control = { currentCwd: state, list: () => [], read: () => undefined, start: async () => { throw new Error("unused"); }, send: async () => {}, stop: () => {}, runEnvironment: async () => { throw new Error("unused"); } };
  const tools = async (chatId: string) => {
    const server = inProcessRemyMcpServer(chatId, control) as unknown as { instance: { connect(transport: unknown): Promise<void> } };
    const [client, serverSide] = InMemoryTransport.createLinkedPair();
    await server.instance.connect(serverSide);
    const mcp = new Client({ name: "test", version: "1" });
    await mcp.connect(client);
    return mcp;
  };
  try {
    const plain = await tools("thread-plain");
    const plainNames = (await plain.listTools()).tools.map((tool) => tool.name);
    assert.equal(plainNames.includes("github_action"), true);
    assert.equal(plainNames.includes("report_review_findings"), false);
    setKv("hubReviewDelegation:thread-delegated",true);
    const delegated=await tools("thread-delegated");
    const delegatedNames=(await delegated.listTools()).tools.map(t=>t.name);
    assert.equal(delegatedNames.includes("github_action"),false);
    assert.equal(delegatedNames.includes("start_thread"),true);
    await delegated.close();
    setThreadReview("thread-review", { ...hubReview("c".repeat(40)), worktree: state });
    const review = await tools("thread-review");
    const names = (await review.listTools()).tools.map((tool) => tool.name);
    assert.equal(names.includes("github_action"), false);
    assert.equal(names.includes("report_review_findings"), false);
    assert.equal(names.includes("propose_review_rule"), true);
    for (const tool of ["list_threads","read_thread","start_thread","send_to_thread"]) assert.equal(names.includes(tool),true);
    const proposed = await review.callTool({ name: "propose_review_rule", arguments: { text: "Don't flag inline styles in fixtures.", scope: "all", reason: "The person said fixtures are fine." } }) as { content: { text: string }[] };
    assert.match(proposed.content[0]!.text, /Proposed rule proposal-1\. It is not a rule yet/);
    // The computer reaches the hub with its own signed identity, naming the thread.
    assert.deepEqual(hub.calls.map((call) => call.path), ["/api/organizations/org/computers/organization-tools/thread-review"]);
    assert.match(hub.calls[0]!.authorization ?? "", /^RemyComputer /);
    assert.deepEqual((hub.calls[0]!.body as { action: string }).action, "propose_review_rule");
  } finally {
    forgetThreadReview("thread-review");
    await hub.close();
  }
});

test("the STDIO remy server offers review tools with REMY_REVIEW and sends them to the daemon with the thread's capability", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const daemon = await recorder();
  const script = fileURLToPath(new URL("./ticket-mcp.js", import.meta.url));
  const connect = async (review: boolean, reviewDelegation = false) => {
    const mcp = new Client({ name: "test", version: "1" });
    await mcp.connect(new StdioClientTransport({
      command: process.execPath,
      args: [script],
      env: { PATH: process.env.PATH ?? "", MC_CONFIG_DIR: state, REMY_API_URL: daemon.url, REMY_API_TOKEN: "remy.capability.signature", REMY_CHAT_ID: "thread-review", ...(review ? { REMY_REVIEW: "1" } : {}), ...(reviewDelegation ? {REMY_REVIEW_DELEGATION:"1"} : {}) },
    }));
    return mcp;
  };
  const plain = await connect(false);
  const review = await connect(true);
  try {
    const plainNames = (await plain.listTools()).tools.map((tool) => tool.name);
    assert.equal(plainNames.includes("github_action"), true);
    assert.equal(plainNames.includes("propose_review_rule"), false);
    const names = (await review.listTools()).tools.map((tool) => tool.name);
    assert.equal(names.includes("github_action"), false);
    assert.equal(names.includes("report_review_findings"), false);
    for (const tool of ["list_threads","read_thread","start_thread","send_to_thread"]) assert.equal(names.includes(tool),true);
    const proposed = await review.callTool({ name: "propose_review_rule", arguments: { text: "Rule", scope: "repository", reason: "Asked." } }) as { content: { text: string }[] };
    assert.match(proposed.content[0]!.text, /<remy-artifact>\{"kind":"review-rule"/);
    assert.deepEqual(daemon.calls.map((call) => call.path), ["/organization-tools/propose_review_rule"]);
    assert.equal(daemon.calls[0]!.authorization, "Bearer remy.capability.signature");

  } finally {
    await plain.close();
    await review.close();
    await daemon.close();
  }
});
