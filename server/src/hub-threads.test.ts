import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const state = mkdtempSync(join(tmpdir(), "remy-hub-threads-"));
process.env.MC_CONFIG_DIR = state;
const binDir = mkdtempSync(join(tmpdir(), "remy-hub-threads-bin-"));
for (const command of ["claude", "codex", "agent"]) {
  const path = join(binDir, command);
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
}
process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
const { createChat, deleteChat, getChat } = await import("./chat.js");
const { shareHubThread, hubThreadSnapshot, handleHubThreadRequest, fitHubMirror, transcriptPage } =
  await import("./hub-threads.js");
const owner = { id: "ada", label: "Ada" };
const teammate = { id: "grace", label: "Grace" };
const noAttachment = async () => {
  throw new Error("Unexpected image transfer");
};
test.after(() => {
  rmSync(state, { recursive: true, force: true });
  rmSync(binDir, { recursive: true, force: true });
});

test("manual starts are private; trusted automatic and external starts default open", () => {
  for (const source of ["manual", "automatic", "external"] as const) {
    const chat = createChat({ cwd: state });
    shareHubThread(chat.id, "org", owner, source);
    assert.equal(
      hubThreadSnapshot(chat.id, "org")?.access.visibility,
      source === "manual" ? "private" : "open",
    );
    assert.equal(hubThreadSnapshot(chat.id, "other-org"), undefined);
    deleteChat(chat.id);
  }
});

test("thread reads, joins and mutations enforce both organization and member access", async () => {
  const chat = createChat({ cwd: state });
  shareHubThread(chat.id, "org", owner, "manual");
  const route = (
    who: typeof owner,
    method: string,
    action = "",
    input = {},
    org = "org",
  ) =>
    handleHubThreadRequest(
      org,
      who,
      method,
      `/hub/threads/${chat.id}${action ? `/${action}` : ""}`,
      input,
      noAttachment,
    );
  assert.equal((await route(teammate, "GET")).status, 404);
  assert.equal((await route(teammate, "POST", "join")).status, 404);
  assert.equal((await route(owner, "GET", "", {}, "wrong")).status, 404);
  assert.equal(
    (await route(owner, "POST", "visibility", { visibility: "open" })).status,
    200,
  );
  assert.equal((await route(teammate, "GET")).status, 200);
  assert.equal((await route(teammate,"POST","options",{permissionMode:"plan"})).status,403);
  assert.equal((await route(owner,"POST","options",{permissionMode:"plan"})).status,200);
  assert.equal(getChat(chat.id)?.permissionMode,"plan");
  assert.equal((await route(owner,"POST","options",{permissionMode:"invalid"})).status,400);
  assert.equal((await route(owner,"POST","options",{provider:"codex"})).status,400);

  assert.equal(
    (await route(teammate, "PATCH", "", { title: "Changed" })).status,
    403,
  );
  assert.equal((await route(teammate, "POST", "join")).status, 200);
  assert.equal((await route(teammate, "POST", "join")).status, 200);
  assert.equal(
    hubThreadSnapshot(chat.id, "org")?.access.participants.length,
    2,
  );
  assert.equal(
    (await route(teammate, "PATCH", "", { title: "Changed" })).status,
    200,
  );
  assert.equal(getChat(chat.id)?.title, "Changed");
  assert.equal(
    (await route(teammate, "POST", "visibility", { visibility: "private" }))
      .status,
    403,
  );
  assert.equal(
    (
      await route(teammate, "POST", "approval", {
        requestId: "missing",
        decision: "allow",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await route(teammate, "POST", "question", {
        requestId: "missing",
        answers: {},
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await route(teammate, "POST", "message", {
        text: "Hello",
        messageId: "invalid",
      })
    ).status,
    400,
  );
  assert.equal(
    (await route(owner, "POST", "visibility", { visibility: "private" }))
      .status,
    200,
  );
  assert.equal((await route(teammate, "GET")).status, 200);
  assert.equal((await route(owner, "PATCH", "", { pinned: true })).status, 200);
  assert.equal(getChat(chat.id)?.pinned, true);
  assert.equal((await route(owner, "POST", "archive")).status, 200);
  assert.equal(getChat(chat.id), undefined);
});

test("hosted delete removes the thread and its access record", async () => {
  const chat = createChat({ cwd: state });
  shareHubThread(chat.id, "org", owner, "manual");
  const response = await handleHubThreadRequest(
    "org",
    owner,
    "DELETE",
    `/hub/threads/${chat.id}`,
    {},
    noAttachment,
  );
  assert.equal(response.status, 200);
  assert.equal(getChat(chat.id), undefined);
  assert.equal(hubThreadSnapshot(chat.id, "org"), undefined);
});

test("a retried prompt records its authenticated member once in durable storage", async () => {
  const { setProviderAdapterForTest } = await import(
    "./provider-adapters/index.js"
  );
  const { loadChat } = await import("./chat-storage.js");
  const restore = setProviderAdapterForTest({
    id: "claude",
    discoverModels: async () => [],
    answer: async () => undefined,
    createSession: () => ({
      close() {},
      turn: () => ({ done: Promise.resolve(), interrupt() {} }),
    }),
  });
  const chat = createChat({ cwd: state, provider: "claude" });
  try {
    shareHubThread(chat.id, "org", owner, "manual");
    const input = {
      text: "Check the release notes.",
      messageId: "u-6a6959a7-8997-4e87-99d7-d50771e908e4",
      member: teammate,
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await handleHubThreadRequest(
        "org",
        owner,
        "POST",
        `/hub/threads/${chat.id}/message`,
        input,
        noAttachment,
      );
      assert.equal(response.status, 200);
    }
    const entries = loadChat(chat.id, 50)!.entries.filter(
      (entry) => entry.id === input.messageId,
    );
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0]!.member, owner);
  } finally {
    deleteChat(chat.id);
    restore();
  }
});

test("thread creation checks out the requested branch before creating and deduplicates retries", async () => {
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync } = await import("node:fs");
  const { addWorkspace } = await import("./workspaces.js");
  const cwd = mkdtempSync(join(state,"branch-"));
  const git=(...args: string[]) => execFileSync("git",args,{cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  git("init","-b","main");git("config","user.name","QA");git("config","user.email","qa@example.test");
  writeFileSync(join(cwd,"file"),"main");git("add",".");git("commit","-m","Initial");git("branch","feature/selected");
  const workspace=await addWorkspace("Branch QA",cwd);
  const threadId = randomUUID();
  const input={threadId,workspaceId:workspace.id,branch:"feature/selected",hubTaskId:"branch-qa",permissionMode:"plan",visibility:"open",provider:"codex",model:"gpt-5.6-sol",effort:"medium"};
  const response=await handleHubThreadRequest("org",owner,"POST","/hub/threads",input,noAttachment);
  assert.equal(response.status,201);
  assert.equal(git("branch","--show-current"),"feature/selected");
  const thread=await response.json() as {id:string;access:{visibility:string}};
  assert.equal(thread.id, threadId);
  assert.equal(thread.access.visibility,"open");
  const {getChat}=await import("./chat.js");
  assert.equal(getChat(thread.id)?.permissionMode,"plan");
  assert.equal(getChat(thread.id)?.effort,"medium");
  git("checkout","main");
  const retry=await handleHubThreadRequest("org",owner,"POST","/hub/threads",input,noAttachment);
  assert.equal((await retry.json() as {id:string}).id,thread.id);
  assert.equal(git("branch","--show-current"),"main");
  const invalid=await handleHubThreadRequest("org",owner,"POST","/hub/threads",{workspaceId:workspace.id,branch:"missing"},noAttachment);
  assert.notEqual(invalid.status,201);
  deleteChat(thread.id);
});

test("hosted OpenRouter starts even when the selected model is not in the fetched catalogue", async () => {
  const { addWorkspace } = await import("./workspaces.js");
  const cwd = mkdtempSync(join(state, "gateway-"));
  const workspace = await addWorkspace("Gateway QA", cwd);
  const before = {
    key: process.env.OPENROUTER_API_KEY,
    models: process.env.OPENROUTER_MODELS,
  };
  process.env.OPENROUTER_API_KEY = "private-openrouter";
  process.env.OPENROUTER_MODELS = JSON.stringify(["vendor/model"]);
  try {
    const accepted = await handleHubThreadRequest(
      "org",
      owner,
      "POST",
      "/hub/threads",
      {
        workspaceId: workspace.id,
        provider: "codex",
        model: "remy:openrouter:openrouter/auto",
        hubTaskId: "openrouter-qa",
      },
      noAttachment,
    );
    assert.equal(accepted.status, 201);
    const thread = (await accepted.json()) as { id: string };
    assert.equal(getChat(thread.id)?.model, "remy:openrouter:openrouter/auto");
    deleteChat(thread.id);
    const refused = await handleHubThreadRequest(
      "org",
      owner,
      "POST",
      "/hub/threads",
      {
        workspaceId: workspace.id,
        provider: "claude",
        model: "remy:openrouter:openrouter/auto",
      },
      noAttachment,
    );
    assert.equal(refused.status, 400);
  } finally {
    if (before.key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = before.key;
    if (before.models === undefined) delete process.env.OPENROUTER_MODELS;
    else process.env.OPENROUTER_MODELS = before.models;
  }
});

test("a turn with no remaining user message is mirrored from storage, not the short tail", () => {
  const cwd = mkdtempSync(join(state, "mirror-"));
  const chat = createChat({ cwd });
  shareHubThread(chat.id, "org", owner, "manual");
  const stored = getChat(chat.id);
  assert.ok(stored);
  for (let index = 0; index < 40; index += 1) {
    stored.entries.push({ id: `t${index}`, kind: "tool", verb: "Ran", tool: "Bash", arg: `step ${index}`, output: "ok" });
  }
  stored.entries.push({ id: "done", kind: "assistant", text: "The pull request is up." });
  const snapshot = hubThreadSnapshot(chat.id, "org");
  assert.equal(snapshot?.detail.entries.length, 41);
  assert.equal(snapshot?.detail.entries[0] && (snapshot.detail.entries[0] as { id: string }).id, "t0");
  assert.equal(snapshot?.detail.entries.at(-1) && (snapshot.detail.entries.at(-1) as { id: string }).id, "done");
  deleteChat(chat.id);
});

test("the hub mirror keeps the thread and drops activity heartbeats", () => {
  const activity = (id: string) => ({
    id,
    kind: "shell" as const,
    provider: "codex",
    title: id,
    status: "running" as const,
    startedAt: 1,
    updatedAt: 1,
    output: "beat".repeat(400),
  });
  const detail = {
    id: "thread",
    title: "Work",
    entries: [
      { id: "said", kind: "assistant" as const, text: "The first step is in." },
      { id: "beat", kind: "tool" as const, activity: activity("beat") },
      { id: "ran", kind: "tool" as const, verb: "Ran", tool: "Bash", arg: "ls", output: "ok", activity: activity("ran") },
      { id: "thought", kind: "thinking" as const, text: "weighing".repeat(400) },
      { id: "done", kind: "assistant" as const, text: "The pull request is up." },
    ],
  };
  const fitted = fitHubMirror(structuredClone(detail), 96_000);
  assert.deepEqual(fitted.entries.map((entry) => entry.id), ["said", "ran", "thought", "done"]);
  assert.equal("activity" in fitted.entries[1], false);
  assert.equal(fitted.entries[1].output, "ok");

  const tight = fitHubMirror(structuredClone(detail), 420);
  assert.ok(Buffer.byteLength(JSON.stringify(tight)) <= 420);
  assert.deepEqual(tight.entries.map((entry) => entry.id), ["said", "ran", "done"]);
});

test("a long turn keeps its opening message once heartbeats are out of the mirror", () => {
  const cwd = mkdtempSync(join(state, "heartbeats-"));
  const chat = createChat({ cwd });
  shareHubThread(chat.id, "org", owner, "manual");
  const stored = getChat(chat.id);
  assert.ok(stored);
  stored.entries.push({ id: "u1", kind: "user", text: "Use one person avatar." });
  for (let index = 0; index < 80; index += 1) {
    stored.entries.push({
      id: `b${index}`,
      kind: "tool",
      activity: {
        id: `b${index}`,
        kind: "shell",
        provider: "codex",
        title: "Running",
        status: "running",
        startedAt: 1,
        updatedAt: 1,
        output: "beat".repeat(800),
      },
    });
  }
  stored.entries.push({ id: "done", kind: "assistant", text: "Implemented." });
  const snapshot = hubThreadSnapshot(chat.id, "org");
  const history = snapshot?.detail.history as { hasEarlier?: boolean } | undefined;
  assert.equal(snapshot?.detail.entries[0] && (snapshot.detail.entries[0] as { id: string }).id, "u1");
  assert.equal(snapshot?.detail.entries.at(-1) && (snapshot.detail.entries.at(-1) as { id: string }).id, "done");
  assert.notEqual(history?.hasEarlier, true);
  deleteChat(chat.id);
});

test("earlier pages still hold the opening message when the mirror keeps only the tail", async () => {
  const cwd = mkdtempSync(join(state, "pages-"));
  const chat = createChat({ cwd });
  shareHubThread(chat.id, "org", owner, "manual");
  const stored = getChat(chat.id);
  assert.ok(stored);
  stored.entries.push({ id: "u1", kind: "user", text: "Open the thread." });
  for (let index = 0; index < 30; index += 1) {
    stored.entries.push({ id: `a${index}`, kind: "assistant", text: "word ".repeat(2000) });
  }
  const snapshot = hubThreadSnapshot(chat.id, "org");
  const history = snapshot?.detail.history as { hasEarlier?: boolean; before?: string } | undefined;
  const before = history?.before;
  assert.equal(history?.hasEarlier, true);
  assert.ok(before);
  assert.notEqual((snapshot?.detail.entries[0] as { id: string }).id, "u1");
  const ids: string[] = [];
  let cursor: string | undefined = before;
  for (let page = 0; cursor && page < 10; page += 1) {
    const older = transcriptPage(stored.entries, cursor);
    ids.unshift(...older.entries.map((entry) => entry.id));
    cursor = older.history.hasEarlier ? older.history.before : undefined;
  }
  ids.push(...(snapshot?.detail.entries ?? []).map((entry) => (entry as { id: string }).id));
  assert.equal(ids[0], "u1");
  assert.equal(ids.at(-1), "a29");
  assert.equal(new Set(ids).size, ids.length);
  const response = await handleHubThreadRequest("org", owner, "GET", `/hub/threads/${chat.id}/transcript`, { before }, noAttachment);
  assert.equal(response.status, 200);
  const body = await response.json() as { entries: { id: string }[] };
  assert.ok(body.entries.length > 0);
  assert.equal(body.entries.at(-1)?.id, ids[ids.indexOf(before) - 1]);
  const refused = await handleHubThreadRequest("org", teammate, "GET", `/hub/threads/${chat.id}/transcript`, { before }, noAttachment);
  assert.equal(refused.status, 404);
  const missing = await handleHubThreadRequest("org", owner, "GET", `/hub/threads/${chat.id}/transcript`, { before: "gone" }, noAttachment);
  assert.equal(missing.status, 409);
  const posted = await handleHubThreadRequest("org", owner, "POST", `/hub/threads/${chat.id}/transcript`, {}, noAttachment);
  assert.equal(posted.status, 404);
  deleteChat(chat.id);
});

test("thread snapshots retain the confirmed branch", async () => {
  execFileSync("git", ["init", "-b", "feature/snapshot", state], {stdio: "pipe"});
  execFileSync("git", ["-C", state, "-c", "user.name=QA", "-c", "user.email=qa@example.com", "commit", "--allow-empty", "-m", "Initial"], {stdio: "pipe"});
  const {refreshHubThreadBranch} = await import("./hub-thread-branch.js");
  await refreshHubThreadBranch(state);
  const chat = createChat({cwd: state});
  shareHubThread(chat.id, "org", owner, "manual");
  assert.equal(hubThreadSnapshot(chat.id, "org")?.detail.branch, "feature/snapshot");
  deleteChat(chat.id);
});

test("lines sent from a pull request reach the provider as review context and stay on the message", async () => {
  const { setProviderAdapterForTest } = await import(
    "./provider-adapters/index.js"
  );
  const { loadChat } = await import("./chat-storage.js");
  const prompts: string[] = [];
  const restore = setProviderAdapterForTest({
    id: "claude",
    discoverModels: async () => [],
    answer: async () => undefined,
    createSession: () => ({
      close() {},
      turn: (input: { prompt: string }) => { prompts.push(input.prompt); return { done: Promise.resolve(), interrupt() {} }; },
    }),
  });
  const chat = createChat({ cwd: state, provider: "claude" });
  try {
    shareHubThread(chat.id, "org", owner, "manual");
    const reference = {
      id: "r-1",
      path: "web/src/components/AddWorkspace.tsx",
      startLine: 170,
      endLine: 172,
      comment: "Collapse a group once it passes ten repositories.",
      lines: [
        { kind: "add", oldLine: null, newLine: 170, text: "{rows.map((repository) => (" },
        { kind: "add", oldLine: null, newLine: 171, text: "<RepositoryRow repository={repository} />" },
        { kind: "add", oldLine: null, newLine: 172, text: "))}" },
      ],
    };
    const messageId = "u-0b6f0ad2-5d8a-4c3c-9f4e-1a2b3c4d5e6f";
    const response = await handleHubThreadRequest("org", owner, "POST", `/hub/threads/${chat.id}/message`, {
      text: reference.comment,
      messageId,
      codeReferences: [reference],
    }, noAttachment);
    assert.equal(response.status, 200);
    const entry = loadChat(chat.id, 50)!.entries.find((value) => value.id === messageId)!;
    assert.equal(entry.codeReferences?.[0]?.path, reference.path);
    assert.deepEqual(entry.codeReferences?.[0]?.lines.map((line) => line.newLine), [170, 171, 172]);
    for (let wait = 0; wait < 50 && !prompts.length; wait++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(prompts[0] ?? "", /<review-context>\nFile: web\/src\/components\/AddWorkspace\.tsx \(L170-172\)/);
    // The comment is the reference's own; it is not said twice.
    assert.equal((prompts[0] ?? "").split(reference.comment).length - 1, 1);

    const refused = await handleHubThreadRequest("org", owner, "POST", `/hub/threads/${chat.id}/message`, {
      text: "Look here.",
      messageId: "u-1b6f0ad2-5d8a-4c3c-9f4e-1a2b3c4d5e6f",
      codeReferences: [{ ...reference, lines: [] }],
    }, noAttachment);
    assert.equal(refused.status, 400);
  } finally {
    deleteChat(chat.id);
    restore();
  }
});
