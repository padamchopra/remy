import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  codexAppServerArgs,
  codexEntry,
  codexPermissions,
  codexTodos,
  codexTokens,
  createCodexSession,
  type CodexEvent,
  type CodexItem,
} from "./codex.js";

const base = { command: "/usr/local/bin/codex", cwd: "/repo", permissionMode: "default" };

test("app-server receives MCP environment names without their values", () => {
  const args = codexAppServerArgs({
    ...base,
    mcpServer: {
      command: "/usr/local/bin/node",
      args: ["/app/ticket-mcp.js"],
      env: { REMY_CHAT_ID: "chat-1", REMY_API_TOKEN: "secret" },
    },
  });
  assert.deepEqual(args.slice(0, 2), ["app-server", "--stdio"]);
  assert.ok(args.includes('mcp_servers.remy.command="/usr/local/bin/node"'));
  assert.ok(args.includes('mcp_servers.remy.args=["/app/ticket-mcp.js"]'));
  assert.ok(args.includes('mcp_servers.remy.env_vars=["REMY_CHAT_ID","REMY_API_TOKEN"]'));
  assert.ok(!args.some((arg) => arg.includes("secret")));
});

test("Ask can stop for approval while the other modes keep their boundaries", () => {
  const ask = codexPermissions("default", ["/repo"]);
  assert.equal(ask.sandbox, "workspace-write");
  assert.equal(ask.approvalPolicy, "on-request");
  assert.deepEqual(ask.sandboxPolicy, {
    type: "workspaceWrite",
    writableRoots: ["/repo"],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  });

  const edits = codexPermissions("acceptEdits", ["/repo"]);
  assert.equal(edits.approvalPolicy, "on-request");
  assert.equal(edits.sandboxPolicy.type, "workspaceWrite");
  assert.equal("networkAccess" in edits.sandboxPolicy && edits.sandboxPolicy.networkAccess, true);

  assert.equal(codexPermissions("auto", ["/repo"]).approvalPolicy, "never");
  assert.equal(codexPermissions("plan", ["/repo"]).sandboxPolicy.type, "readOnly");
  assert.equal(codexPermissions("bypassPermissions", ["/repo"]).sandboxPolicy.type, "dangerFullAccess");
});

test("each turn's items remain distinct in Remy's feed", () => {
  const item: CodexItem = { id: "item_0", type: "agent_message", text: "Done." };
  assert.equal(codexEntry(item, "aaaa-")?.id, "aaaa-item_0");
  assert.notEqual(codexEntry(item, "aaaa-")?.id, codexEntry(item, "bbbb-")?.id);
});

test("an answer and its reasoning land as their own kinds", () => {
  assert.deepEqual(codexEntry({ id: "i1", type: "agent_message", text: "Done." }), {
    id: "i1",
    kind: "assistant",
    text: "Done.",
  });
  assert.equal(codexEntry({ id: "i2", type: "reasoning", text: "Thinking" })?.kind, "thinking");
});

test("a command reads as one tool line that gains its output", () => {
  const running: CodexItem = {
    id: "c1",
    type: "command_execution",
    command: "npm test",
    status: "in_progress",
  };
  const started = codexEntry(running);
  assert.equal(started?.verb, "Ran");
  assert.equal(started?.arg, "npm test");
  assert.equal(started?.status, undefined);

  const done = codexEntry({ ...running, status: "completed", exit_code: 0, aggregated_output: "111 passing" });
  assert.equal(done?.status, "ok");
  assert.equal(done?.output, "111 passing");

  const failed = codexEntry({ ...running, status: "completed", exit_code: 1, aggregated_output: "1 failing" });
  assert.equal(failed?.status, "error");
});

test("a patch says which file, or how many", () => {
  const one = codexEntry({
    id: "f1",
    type: "file_change",
    status: "completed",
    changes: [{ path: "/repo/web/src/App.tsx", kind: "update" }],
  });
  assert.equal(one?.verb, "Edited");
  assert.equal(one?.arg, "App.tsx");
  assert.equal(one?.file, "/repo/web/src/App.tsx");

  const many = codexEntry({
    id: "f2",
    type: "file_change",
    status: "completed",
    changes: [
      { path: "a.ts", kind: "add" },
      { path: "b.ts", kind: "delete" },
    ],
  });
  assert.equal(many?.arg, "2 files");
  assert.equal(many?.file, undefined);
});

test("the plan is the thread's plan, not a line in its feed", () => {
  const item: CodexItem = {
    id: "t1",
    type: "todo_list",
    items: [
      { text: "Read the tests", completed: true },
      { text: "Fix the bug", completed: false },
    ],
  };
  assert.equal(codexEntry(item), undefined);
  assert.deepEqual(codexTodos(item), [
    { content: "Read the tests", status: "completed" },
    { content: "Fix the bug", status: "pending" },
  ]);
});

test("both halves of the prompt occupy the context window", () => {
  assert.equal(codexTokens({ input_tokens: 1_000, cached_input_tokens: 9_000, output_tokens: 200 }), 10_000);
  assert.equal(codexTokens(undefined), 0);
});

function fakeAppServer(): string {
  const directory = mkdtempSync(join(tmpdir(), "remy-codex-app-server-"));
  const file = join(directory, "codex");
  writeFileSync(file, `#!/usr/bin/env node
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
let turn = 0;
let active;
let threadEffort;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const item = (id, text) => ({ type: "agentMessage", id, text, phase: null, memoryCitation: null, delivery: null });
const complete = (text, status = "completed") => {
  const id = "message-" + active;
  send({ method: "item/started", params: { threadId: "thread-1", turnId: active, item: item(id, "") } });
  send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: active, itemId: id, delta: text } });
  send({ method: "item/completed", params: { threadId: "thread-1", turnId: active, item: item(id, text) } });
  send({ method: "thread/tokenUsage/updated", params: { threadId: "thread-1", turnId: active, tokenUsage: { last: { inputTokens: 7, cachedInputTokens: 3, cacheWriteInputTokens: 0, outputTokens: 1, reasoningOutputTokens: 0 }, total: {}, modelContextWindow: 200000 } } });
  send({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: active, status, error: null, items: [] } } });
};
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") return send({ id: message.id, result: { userAgent: "fake" } });
  if (message.method === "initialized") return;
  if (message.method === "thread/start" || message.method === "thread/resume") {
    threadEffort = message.params.modelReasoningEffort;
    return send({ id: message.id, result: { thread: { id: "thread-1" } } });
  }
  if (message.method === "turn/start") {
    active = "turn-" + (++turn);
    const prompt = message.params.input[0].text;
    send({ id: message.id, result: { turn: { id: active, status: "inProgress", items: [] } } });
    send({ method: "turn/started", params: { threadId: "thread-1", turn: { id: active, status: "inProgress", items: [] } } });
    if (prompt === "approval") {
      send({ method: "item/started", params: { threadId: "thread-1", turnId: active, item: { type: "commandExecution", id: "command-1", command: "npm test", cwd: process.cwd(), processId: null, source: "agent", status: "inProgress", commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null, pluginId: null, scriptPath: null } } });
      return send({ id: "approval-1", method: "item/commandExecution/requestApproval", params: { threadId: "thread-1", turnId: active, itemId: "command-1", command: "npm test", cwd: process.cwd(), availableDecisions: ["accept", "acceptForSession", "decline"] } });
    }
    if (prompt === "question") {
      return send({ id: "question-1", method: "item/tool/requestUserInput", params: { threadId: "thread-1", turnId: active, itemId: "question", isBlocking: true, questions: [{ id: "target", header: "Target", question: "Where should this run?", options: [{ label: "Local", description: "This machine." }] }] } });
    }
    if (prompt === "effort") {
      complete("effort:" + threadEffort + ":" + message.params.modelReasoningEffort);
      return;
    }
    if (prompt !== "hang") complete(prompt);
    return;
  }
  if (message.id === "approval-1") return complete("approval:" + message.result.decision);
  if (message.id === "question-1") return complete("answer:" + message.result.answers.target.answers.join(","));
  if (message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    return complete("stopped", "interrupted");
  }
});
`, { mode: 0o755 });
  return file;
}

test("one app-server connection carries multiple streamed turns", async () => {
  const events: CodexEvent[] = [];
  const session = createCodexSession(
    { command: fakeAppServer(), cwd: process.cwd(), permissionMode: "plan" },
    (event) => events.push(event),
  );
  await session.run("first").done;
  await session.run("second").done;
  session.close();

  assert.equal(events.filter((event) => event.type === "thread.started").length, 1);
  assert.equal(events.filter((event) => event.type === "turn.started").length, 2);
  assert.deepEqual(
    events.flatMap((event) => event.type === "item.completed" && event.item.type === "agent_message" ? [event.item.text] : []),
    ["first", "second"],
  );
  const usage = events.find((event) => event.type === "usage.updated");
  assert.equal(usage?.type === "usage.updated" && usage.usage.context_window, 200_000);
});

test("app-server receives the selected model effort", async () => {
  const events: CodexEvent[] = [];
  const session = createCodexSession(
    { command: fakeAppServer(), cwd: process.cwd(), model: "gpt-5.6-sol", effort: "high", permissionMode: "plan" },
    (event) => events.push(event),
  );
  await session.run("effort", { effort: "xhigh" }).done;
  session.close();

  assert.ok(events.some((event) => event.type === "item.completed"
    && event.item.type === "agent_message"
    && event.item.text === "effort:high:xhigh"));
});

test("app-server approvals stop in Remy's existing approval path", async () => {
  const events: CodexEvent[] = [];
  const session = createCodexSession(
    { command: fakeAppServer(), cwd: process.cwd(), permissionMode: "default" },
    (event) => events.push(event),
    async (request) => {
      assert.equal(request.command, "npm test");
      assert.equal(request.allowAlways, true);
      return "acceptForSession";
    },
  );
  await session.run("approval").done;
  session.close();
  assert.ok(events.some((event) => event.type === "item.completed"
    && event.item.type === "agent_message"
    && event.item.text === "approval:acceptForSession"));
});

test("app-server questions return answers by their protocol ids", async () => {
  const events: CodexEvent[] = [];
  const session = createCodexSession(
    { command: fakeAppServer(), cwd: process.cwd(), permissionMode: "default" },
    (event) => events.push(event),
    undefined,
    async (request) => {
      assert.equal(request.questions[0]?.question, "Where should this run?");
      return { target: ["Local"] };
    },
  );
  await session.run("question").done;
  session.close();
  assert.ok(events.some((event) => event.type === "item.completed"
    && event.item.type === "agent_message"
    && event.item.text === "answer:Local"));
});

test("interrupting a turn settles it without killing app-server", async () => {
  const session = createCodexSession(
    { command: fakeAppServer(), cwd: process.cwd(), permissionMode: "plan" },
    () => {},
  );
  const first = session.run("hang");
  setTimeout(() => first.stop(), 100);
  await first.done;
  await session.run("after stop").done;
  session.close();
});

test("a missing Codex is a message rather than a hang", async () => {
  const session = createCodexSession(
    { command: join(tmpdir(), "definitely-not-codex"), cwd: process.cwd(), permissionMode: "plan" },
    () => {},
  );
  await assert.rejects(session.run("hi").done, /could not be started|ENOENT/);
  session.close();
});
