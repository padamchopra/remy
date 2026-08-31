import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import test, { after } from "node:test";
import type { Options, Query, SDKMessage, query } from "@anthropic-ai/claude-agent-sdk";

const directory = mkdtempSync(join(tmpdir(), "remy-chat-status-"));
process.env.MC_CONFIG_DIR = directory;
const command = join(directory, "claude");
writeFileSync(command, "#!/bin/sh\nexit 1\n");
chmodSync(command, 0o755);
process.env.PATH = `${directory}:${process.env.PATH}`;
const { Chat } = await import("./chat.js");
const { patchSettings } = await import("./config.js");
patchSettings({ notifySelf: false });
after(() => rmSync(directory, { recursive: true, force: true }));

class Session {
  private waiter?: { resolve: (value: IteratorResult<SDKMessage>) => void; reject: (error: Error) => void };
  private items: IteratorResult<SDKMessage>[] = [];
  options?: Options;
  query = {
    [Symbol.asyncIterator]: () => this.query,
    next: () => this.items.length ? Promise.resolve(this.items.shift()!)
      : new Promise<IteratorResult<SDKMessage>>((resolve, reject) => { this.waiter = { resolve, reject }; }),
    return: async () => ({ done: true, value: undefined }),
    interrupt: async () => {},
  } as unknown as Query;

  emit(message: Record<string, unknown>) { this.deliver({ done: false, value: message as SDKMessage }); }
  end() { this.deliver({ done: true, value: undefined }); }
  fail() { this.waiter?.reject(new Error("Retired session failed")); this.waiter = undefined; }
  private deliver(item: IteratorResult<SDKMessage>) {
    if (this.waiter) { this.waiter.resolve(item); this.waiter = undefined; }
    else this.items.push(item);
  }
}

function fixture(t: { after: (cleanup: () => Promise<void>) => void }) {
  const sessions: Session[] = [];
  const factory: typeof query = (input) => {
    const session = new Session();
    session.options = input.options;
    sessions.push(session);
    return session.query;
  };
  const chat = new Chat({ id: randomUUID(), title: "Status test", cwd: directory, provider: "claude",
    permissionMode: "default", entries: [], todos: [], turns: 0, createdAt: Date.now(), updatedAt: Date.now() }, factory);
  chat.persist();
  t.after(async () => { chat.stop(); sessions.forEach((session) => session.end()); await tick(); });
  return { chat, sessions };
}

const result = { type: "result", subtype: "success", num_turns: 1 };
const started = { type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { id: "message-1" } } };
const tool = { type: "assistant", parent_tool_use_id: null, message: { id: "message-2", content: [
  { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "true" } },
] } };

test("fresh Claude activity restores working, while a warm idle session stays done", async (t) => {
  const { chat, sessions } = fixture(t);
  await chat.send("Read the change.");
  sessions[0].emit(result);
  await tick();
  assert.equal(chat.summary().state, "idle");
  assert.equal(chat.summary().live, true);
  assert.equal(chat.summary().workingSince, undefined);
  sessions[0].emit(started);
  await tick();
  assert.equal(chat.summary().state, "working");
  const since = chat.summary().workingSince;
  assert.ok(since);
  sessions[0].emit(tool);
  await tick();
  assert.equal(chat.summary().workingSince, since);
  sessions[0].emit(result);
  await tick();
  assert.equal(chat.summary().state, "idle");
  sessions[0].emit(tool);
  await tick();
  assert.equal(chat.summary().state, "working");
});

for (const ending of ["result", "exit", "error"] as const) {
  test(`a retired session's ${ending} cannot mark its replacement done`, async (t) => {
    const { chat, sessions } = fixture(t);
    await chat.send("First turn.");
    chat.stop();
    await chat.send("Second turn.");
    const since = chat.summary().workingSince;
    if (ending === "result") sessions[0].emit(result);
    else if (ending === "exit") sessions[0].end();
    else sessions[0].fail();
    await tick();
    assert.equal(chat.summary().state, "working");
    assert.equal(chat.summary().live, true);
    assert.equal(chat.summary().workingSince, since);
    assert.equal(chat.summary().error, undefined);
  });
}

test("activity preserves a pending approval and its working timer", async (t) => {
  const { chat, sessions } = fixture(t);
  await chat.send("Check the change.");
  const since = chat.summary().workingSince;
  const pending = sessions[0].options!.canUseTool!("Bash", { command: "true" }, { signal: new AbortController().signal, toolUseID: "tool-1", requestId: "approval-1" });
  assert.equal(chat.summary().state, "needs_input");
  sessions[0].emit(started);
  sessions[0].emit(tool);
  await tick();
  assert.equal(chat.summary().state, "needs_input");
  assert.equal(chat.summary().workingSince, since);
  chat.respondApproval(chat.approval!.requestId, "deny");
  assert.equal((await pending)?.behavior, "deny");
});

test("late activity cannot undo an explicit interrupt", async (t) => {
  const { chat, sessions } = fixture(t);
  await chat.send("First turn.");
  await chat.interrupt();
  sessions[0].emit(started);
  sessions[0].emit(tool);
  await tick();
  assert.equal(chat.summary().state, "idle");
  await chat.send("Continue.");
  sessions[0].emit(started);
  await tick();
  assert.equal(chat.summary().state, "working");
});

test("subagent output does not restart an idle parent", async (t) => {
  const { chat, sessions } = fixture(t);
  await chat.send("Check the change.");
  sessions[0].emit(result);
  sessions[0].emit({ ...started, parent_tool_use_id: "subagent" });
  sessions[0].emit({ ...tool, parent_tool_use_id: "subagent" });
  await tick();
  assert.equal(chat.summary().state, "idle");
});
