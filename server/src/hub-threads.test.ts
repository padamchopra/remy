import { execFileSync } from "node:child_process";
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
const { shareHubThread, hubThreadSnapshot, handleHubThreadRequest } =
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
  deleteChat(chat.id);
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
  const input={workspaceId:workspace.id,branch:"feature/selected",hubTaskId:"branch-qa",permissionMode:"plan",visibility:"open"};
  const response=await handleHubThreadRequest("org",owner,"POST","/hub/threads",input,noAttachment);
  assert.equal(response.status,201);
  assert.equal(git("branch","--show-current"),"feature/selected");
  const thread=await response.json() as {id:string;access:{visibility:string}};
  assert.equal(thread.access.visibility,"open");
  const {getChat}=await import("./chat.js");
  assert.equal(getChat(thread.id)?.permissionMode,"plan");
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
