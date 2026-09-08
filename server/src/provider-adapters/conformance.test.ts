import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createClaudeAdapter, type ClaudeMessage, type ClaudeOptions, type ClaudeQuery } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { cursorAdapter } from "./cursor.js";
import type { ProviderAdapter, ProviderEvent, ProviderSessionOptions } from "./types.js";

const artifact = 'Created WRK-8.\n<remy-artifact>{"kind":"ticket","key":"WRK-8","title":"Provider interface"}</remy-artifact>';

interface Fixture {
  adapter: ProviderAdapter;
  options: ProviderSessionOptions;
}

for (const fixture of [claudeFixture(), codexFixture(), cursorFixture()]) {
  test(`${fixture.adapter.id} conforms to the provider session contract`, async (t) => {
    const events: ProviderEvent[] = [];
    let approvals = 0;
    let questions = 0;
    const handlers = {
      event: (event: ProviderEvent) => events.push(event),
      approve: async () => {
        approvals += 1;
        return "allowAlways" as const;
      },
      answer: async () => {
        questions += 1;
        return { "Which mode?": "Agent" };
      },
    };
    const first = fixture.adapter.createSession(fixture.options, handlers);
    t.after(() => first.close());
    await within("approval", first.turn({ prompt: "approval", images: [], permissionMode: "default" }).done);
    await within("question", first.turn({ prompt: "question", images: [], permissionMode: "default" }).done);
    const interrupted = first.turn({ prompt: "hang", images: [], permissionMode: "default" });
    interrupted.interrupt();
    await within("interrupt", interrupted.done);

    assert.equal(approvals, 1);
    assert.equal(questions, 1);
    assert.ok(events.some((event) => event.type === "entry.updated" && event.entry.artifacts?.[0]?.key === "WRK-8"));
    assert.ok(events.some((event) => event.type === "usage.updated" && event.tokens > 0));
    const sessionId = events.find((event): event is Extract<ProviderEvent, { type: "session.started" }> => event.type === "session.started")?.sessionId;
    assert.ok(sessionId);
    first.close();

    const resumed: ProviderEvent[] = [];
    const second = fixture.adapter.createSession({ ...fixture.options, sessionId }, {
      ...handlers,
      event: (event) => resumed.push(event),
    });
    t.after(() => second.close());
    await within("resume", second.turn({ prompt: "resume", images: [], permissionMode: "default" }).done);
    second.close();
    assert.ok(resumed.some((event) => event.type === "session.started" && event.sessionId === sessionId));
  });
}

async function within(label: string, promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle`)), 2_000);
  });
  try {
    await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function claudeFixture(): Fixture {
  return {
    adapter: createClaudeAdapter(fakeClaudeQuery()),
    options: baseOptions("claude"),
  };
}

function fakeClaudeQuery() {
  return ((input: { prompt: AsyncIterable<unknown>; options: ClaudeOptions }) => {
    const output = new AsyncOutput<ClaudeMessage>();
    let release = () => {};
    let interrupted = false;
    let closed = false;
    void (async () => {
      output.push({ type: "system", subtype: "init", session_id: input.options.resume ?? "claude-session" } as ClaudeMessage);
      for await (const value of input.prompt) {
        if (closed) break;
        const prompt = String((value as any).message.content[0].text);
        if (prompt === "approval") {
          output.push({ type: "assistant", message: { id: "message-approval", model: "test", usage: { input_tokens: 7 }, content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "true" } }] } } as ClaudeMessage);
          await input.options.canUseTool!("Bash", { command: "true" }, { signal: new AbortController().signal, toolUseID: "tool-1", requestId: "approval-1" });
          output.push({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: artifact }] }, tool_use_result: {} } as ClaudeMessage);
        } else if (prompt === "question") {
          await input.options.canUseTool!("AskUserQuestion", { questions: [{ question: "Which mode?", options: [{ label: "Agent" }] }] }, { signal: new AbortController().signal, toolUseID: "question-1", requestId: "question-1" });
        } else if (prompt === "hang") {
          if (!interrupted) await new Promise<void>((resolve) => { release = resolve; });
          interrupted = false;
        }
        output.push({ type: "result", subtype: "success", num_turns: 1 } as ClaudeMessage);
      }
      output.end();
    })();
    return {
      [Symbol.asyncIterator]: () => output,
      next: () => output.next(),
      return: () => output.return(),
      interrupt: async () => { interrupted = true; release(); },
      close: () => { closed = true; release(); output.end(); },
    } as unknown as ClaudeQuery;
  }) as Parameters<typeof createClaudeAdapter>[0];
}

class AsyncOutput<T> implements AsyncIterator<T>, AsyncIterable<T> {
  private values: IteratorResult<T>[] = [];
  private waiting?: (value: IteratorResult<T>) => void;

  push(value: T): void {
    this.deliver({ done: false, value });
  }

  end(): void {
    this.deliver({ done: true, value: undefined as never });
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    return value ? Promise.resolve(value) : new Promise((resolve) => { this.waiting = resolve; });
  }

  async return(): Promise<IteratorResult<T>> {
    this.end();
    return { done: true, value: undefined as never };
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }

  private deliver(value: IteratorResult<T>): void {
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = undefined;
      resolve(value);
    } else this.values.push(value);
  }
}

function codexFixture(): Fixture {
  const file = executable("codex", `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
let active;
const complete = () => send({ method: "turn/completed", params: { threadId: "codex-session", turn: { id: active, status: "completed", items: [] } } });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") return send({ id: message.id, result: {} });
  if (message.method === "initialized") return;
  if (message.method === "thread/start" || message.method === "thread/resume") return send({ id: message.id, result: { thread: { id: message.params.threadId || "codex-session" } } });
  if (message.method === "turn/start") {
    active = "turn-1";
    const prompt = message.params.input[0].text;
    send({ id: message.id, result: { turn: { id: active } } });
    send({ method: "turn/started", params: { threadId: "codex-session", turn: { id: active } } });
    send({ method: "thread/tokenUsage/updated", params: { threadId: "codex-session", tokenUsage: { last: { inputTokens: 7, cachedInputTokens: 0, outputTokens: 1 }, modelContextWindow: 200000 } } });
    if (prompt === "approval") return send({ id: "approval", method: "item/commandExecution/requestApproval", params: { itemId: "command", command: "true", availableDecisions: ["accept", "acceptForSession", "decline"] } });
    if (prompt === "question") return send({ id: "question", method: "item/tool/requestUserInput", params: { questions: [{ id: "mode", question: "Which mode?", options: [{ label: "Agent" }] }] } });
    if (prompt !== "hang") complete();
    return;
  }
  if (message.id === "approval") {
    send({ method: "item/completed", params: { item: { id: "artifact", type: "mcpToolCall", server: "remy", tool: "create_ticket", status: "completed", result: { output: ${JSON.stringify(artifact)} } } } });
    return complete();
  }
  if (message.id === "question") return complete();
  if (message.method === "turn/interrupt") { send({ id: message.id, result: {} }); return complete(); }
});`);
  return { adapter: codexAdapter, options: baseOptions(file) };
}

function cursorFixture(): Fixture {
  const file = executable("agent", `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\\n");
const update = (value) => send({ method: "session/update", params: { sessionId: "cursor-session", update: value } });
let pending;
let kind;
let requestId = 100;
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") return send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
  if (message.method === "authenticate" || message.method === "session/set_mode") return send({ id: message.id, result: {} });
  if (message.method === "session/new") return send({ id: message.id, result: { sessionId: "cursor-session", configOptions: [] } });
  if (message.method === "session/load") return send({ id: message.id, result: { configOptions: [] } });
  if (message.method === "session/prompt") {
    const prompt = message.params.prompt[0].text;
    pending = message.id;
    update({ sessionUpdate: "usage_update", used: 7, size: 200000 });
    if (prompt === "approval") {
      kind = "approval";
      const toolCall = { toolCallId: "tool-1", title: "Run", name: "Bash", kind: "execute", status: "pending", rawInput: { command: "true" }, content: [], locations: [] };
      update({ sessionUpdate: "tool_call", ...toolCall });
      return send({ id: ++requestId, method: "session/request_permission", params: { sessionId: "cursor-session", toolCall, options: [{ optionId: "always", name: "Always", kind: "allow_always" }, { optionId: "reject", name: "Reject", kind: "reject_once" }] } });
    }
    if (prompt === "question") {
      kind = "question";
      return send({ id: ++requestId, method: "cursor/ask_question", params: { questions: [{ id: "mode", prompt: "Which mode?", options: [{ id: "agent", label: "Agent" }] }] } });
    }
    if (prompt !== "hang") send({ id: message.id, result: { stopReason: "end_turn" } });
    return;
  }
  if (typeof message.id === "number" && message.id > 100) {
    if (kind === "approval") update({ sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed", rawOutput: ${JSON.stringify(artifact)} });
    return send({ id: pending, result: { stopReason: "end_turn" } });
  }
  if (message.method === "session/cancel") return send({ id: pending, result: { stopReason: "cancelled" } });
});`);
  return { adapter: cursorAdapter, options: baseOptions(file) };
}

function baseOptions(command: string): ProviderSessionOptions {
  return { command, cwd: process.cwd(), permissionMode: "default", entries: [] };
}

function executable(name: string, body: string): string {
  const directory = mkdtempSync(join(tmpdir(), `remy-${name}-conformance-`));
  const file = join(directory, name);
  writeFileSync(file, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  return file;
}
