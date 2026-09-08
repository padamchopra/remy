import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const state = mkdtempSync(join(tmpdir(), "remy-hub-threads-"));
process.env.MC_CONFIG_DIR = state;
const { createChat, deleteChat, getChat } = await import("./chat.js");
const { shareHubThread, hubThreadSnapshot, handleHubThreadRequest } =
  await import("./hub-threads.js");
const owner = { id: "ada", label: "Ada" };
const teammate = { id: "grace", label: "Grace" };
const noAttachment = async () => {
  throw new Error("Unexpected image transfer");
};
test.after(() => rmSync(state, { recursive: true, force: true }));

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
