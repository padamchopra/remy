import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createCursorSession,
  cursorAcpArgs,
  cursorEntry,
  type CursorEvent,
} from "./cursor.js";

test("Cursor uses ACP and maps Remy's broad permission modes to current CLI flags", () => {
  assert.deepEqual(cursorAcpArgs({ permissionMode: "default" }), ["--approve-mcps", "acp"]);
  assert.deepEqual(cursorAcpArgs({ permissionMode: "auto", model: "auto" }), [
    "--model", "auto", "--auto-review", "--approve-mcps", "acp",
  ]);
  assert.deepEqual(cursorAcpArgs({ permissionMode: "auto", model: "grok-4.6[fast=true]", effort: "high" }), [
    "--model", "grok-4.6[fast=true,effort=high]", "--auto-review", "--approve-mcps", "acp",
  ]);
  assert.deepEqual(cursorAcpArgs({ permissionMode: "bypassPermissions" }), [
    "--force", "--approve-mcps", "acp",
  ]);
});

test("an ACP tool update becomes one provider-neutral feed row", () => {
  const entry = cursorEntry({
    toolCallId: "tool-1",
    title: "Run tests",
    name: "Bash",
    kind: "execute",
    status: "completed",
    rawInput: { command: "npm test" },
    rawOutput: "12 passing",
  });
  assert.equal(entry.verb, "Ran");
  assert.equal(entry.arg, "npm test");
  assert.equal(entry.status, "ok");
  assert.equal(entry.output, "12 passing");
});

function fakeCursor(): string {
  const directory = mkdtempSync(join(tmpdir(), "remy-cursor-acp-"));
  const file = join(directory, "agent");
  writeFileSync(file, `#!/usr/bin/env node
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\\n");
let requestId = 100;
let pendingPrompt;
let pendingKind;
const update = (value) => send({ method: "session/update", params: { sessionId: "session-1", update: value } });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") return send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [{ id: "cursor_login", name: "Cursor" }] } });
  if (message.method === "authenticate") return send({ id: message.id, result: {} });
  if (message.method === "session/new") return send({ id: message.id, result: { sessionId: "session-1", configOptions: [] } });
  if (message.method === "session/load") return send({ id: message.id, result: { configOptions: [] } });
  if (message.method === "session/set_mode") return send({ id: message.id, result: {} });
  if (message.method === "session/prompt") {
    const prompt = message.params.prompt[0].text;
    pendingPrompt = message.id;
    update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "reply:" + prompt } });
    if (prompt === "approval") {
      pendingKind = "approval";
      update({ sessionUpdate: "tool_call", toolCallId: "tool-1", title: "Run tests", name: "Bash", kind: "execute", status: "pending", rawInput: { command: "npm test" }, content: [], locations: [] });
      return send({ id: ++requestId, method: "session/request_permission", params: { sessionId: "session-1", toolCall: { toolCallId: "tool-1", title: "Run tests", name: "Bash", kind: "execute", status: "pending", rawInput: { command: "npm test" }, content: [], locations: [] }, options: [{ optionId: "once", name: "Allow", kind: "allow_once" }, { optionId: "always", name: "Always", kind: "allow_always" }, { optionId: "reject", name: "Reject", kind: "reject_once" }] } });
    }
    if (prompt === "question") {
      pendingKind = "question";
      return send({ id: ++requestId, method: "cursor/ask_question", params: { toolCallId: "question-tool", title: "Choose", questions: [{ id: "mode", prompt: "Which mode?", options: [{ id: "agent", label: "Agent" }, { id: "plan", label: "Plan" }], allowMultiple: false }] } });
    }
    if (prompt === "plan") {
      pendingKind = "plan";
      return send({ id: ++requestId, method: "cursor/create_plan", params: { toolCallId: "plan-tool", name: "Build it", plan: "1. Test it", todos: [{ id: "one", content: "Test it", status: "pending" }] } });
    }
    send({ id: message.id, result: { stopReason: "end_turn" } });
    return;
  }
  if (typeof message.id === "number" && message.id >= 101) {
    update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: pendingKind + ":" + JSON.stringify(message.result.outcome) } });
    return send({ id: pendingPrompt, result: { stopReason: "end_turn" } });
  }
});
`, { mode: 0o755 });
  return file;
}

test("one ACP connection carries turns and returns Remy's approval choice", async () => {
  const events: CursorEvent[] = [];
  const session = createCursorSession(
    { command: fakeCursor(), cwd: process.cwd(), permissionMode: "default" },
    (event) => events.push(event),
    async (request) => {
      assert.equal(request.toolCall.rawInput && (request.toolCall.rawInput as { command?: string }).command, "npm test");
      assert.equal(request.allowAlways, true);
      return "acceptForSession";
    },
  );
  await session.run("first").done;
  await session.run("approval").done;
  session.close();

  assert.equal(events.filter((event) => event.type === "session.started").length, 1);
  assert.equal(events.filter((event) => event.type === "turn.started").length, 2);
  assert.ok(events.some((event) => event.type === "tool.updated" && event.toolCall.toolCallId === "tool-1"));
});

test("Cursor's question and plan extensions use Remy's existing input cards", async () => {
  const events: CursorEvent[] = [];
  const session = createCursorSession(
    { command: fakeCursor(), cwd: process.cwd(), permissionMode: "plan" },
    (event) => events.push(event),
    undefined,
    async (request) => {
      assert.equal(request.questions[0]?.prompt, "Which mode?");
      return { mode: ["plan"] };
    },
    async (request) => {
      assert.equal(request.plan, "1. Test it");
      return true;
    },
  );
  await session.run("question").done;
  await session.run("plan").done;
  session.close();

  const text = events.flatMap((event) => event.type === "message.delta" ? [event.text] : []).join("\n");
  assert.match(text, /selectedOptionIds.*plan/);
  assert.match(text, /plan:\{"outcome":"accepted"\}/);
});
