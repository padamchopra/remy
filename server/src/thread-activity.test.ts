import assert from "node:assert/strict";
import test from "node:test";
import { ThreadActivityTracker, type ThreadActivity } from "./thread-activity.js";
import type { ConvEntry } from "./transcript.js";

function harness(entries: ConvEntry[] = []) {
  let now = 1_000;
  const rows = new Map<string, ThreadActivity>();
  const events: ConvEntry[] = [];
  const tracker = new ThreadActivityTracker(entries, (entry) => {
    events.push(entry);
    rows.set(entry.activity!.id, entry.activity!);
  }, () => now);
  return { tracker, rows, events, tick: () => { now += 1_000; } };
}

test("Claude foreground tools settle, background tools wait for task notification", () => {
  const { tracker, rows } = harness();
  tracker.tool("claude", "foreground", "Agent", { description: "Inspect code" });
  tracker.toolResult("claude", "foreground", "Done", false, { agentId: "sync-agent" });
  assert.equal(rows.get("claude:foreground")?.status, "completed");
  tracker.tool("claude", "shell", "Bash", { command: "npm test", run_in_background: true });
  tracker.toolResult("claude", "shell", "Started", false, { backgroundTaskId: "task-1" });
  assert.equal(rows.get("claude:shell")?.status, "running");
  tracker.claude({ type: "system", subtype: "task_notification", task_id: "task-1", status: "failed", summary: "One test failed", output_file: "/must/not/read" });
  assert.equal(rows.size, 2);
  assert.equal(rows.get("claude:shell")?.status, "failed");
  assert.equal(rows.get("claude:shell")?.output, "One test failed");
  assert.ok(!JSON.stringify([...rows.values()]).includes("/must/not/read"));
});

test("Claude task edges join their launch, retain model and isolate child prose", () => {
  const { tracker, rows, tick } = harness();
  tracker.claude({ type: "assistant", message: { content: [{ type: "tool_use", id: "agent", name: "Agent", input: { description: "Review UI", model: "sonnet", prompt: "Check spacing" } }] } });
  tracker.claude({ type: "system", subtype: "task_started", task_id: "child", tool_use_id: "agent", task_type: "local_agent", description: "Review UI" });
  assert.equal(tracker.claude({ type: "assistant", parent_tool_use_id: "agent", message: { model: "claude-sonnet-exact", content: [{ type: "text", text: "Inspecting styles" }, { type: "tool_use", id: "shell", name: "Bash", input: { command: "npm test" } }] } }), true);
  assert.equal(rows.size, 2);
  assert.equal(rows.get("claude:agent")?.model, "claude-sonnet-exact");
  assert.equal(rows.get("claude:shell")?.parentId, "claude:agent");
  assert.equal(tracker.claude({ type: "stream_event", parent_tool_use_id: "agent" }), true);
  tick();
  tracker.claude({ type: "system", subtype: "task_progress", task_id: "child", summary: "Checking narrow layout", usage: { total_tokens: 200, tool_uses: 3 } });
  assert.equal(rows.get("claude:agent")?.progress, "Checking narrow layout");
  assert.equal(rows.get("claude:agent")?.tokens, 200);
  tracker.claude({ type: "system", subtype: "task_updated", task_id: "child", patch: { is_backgrounded: true, status: "paused" } });
  assert.equal(rows.get("claude:agent")?.status, "waiting");
  assert.equal(rows.get("claude:agent")?.background, true);
});

test("out-of-order task bookends enrich a single finished row without restarting it", () => {
  const { tracker, rows, events, tick } = harness();
  tracker.claude({ type: "system", subtype: "task_notification", task_id: "task", tool_use_id: "launch", status: "completed", summary: "Done" });
  const ended = rows.get("claude:launch")!.completedAt;
  tick();
  tracker.claude({ type: "system", subtype: "task_started", task_id: "task", tool_use_id: "launch", task_type: "local_bash", description: "Build" });
  tracker.tool("claude", "launch", "Bash", { command: "npm run build" });
  assert.equal(rows.size, 1);
  assert.equal(rows.get("claude:launch")?.kind, "shell");
  assert.equal(rows.get("claude:launch")?.status, "completed");
  assert.equal(rows.get("claude:launch")?.completedAt, ended);
  const count = events.length;
  tracker.tool("claude", "launch", "Bash", { command: "npm run build" });
  assert.equal(events.length, count);
});

test("a foreground launch failure cannot become background work", () => {
  const { tracker, rows } = harness();
  tracker.tool("claude", "a", "Agent", { run_in_background: true });
  tracker.toolResult("claude", "a", "Could not start", true);
  assert.equal(rows.get("claude:a")?.status, "failed");
  assert.equal(rows.get("claude:a")?.background, false);
});

test("Codex discovers child threads, nests shells, streams output and resumes clocks", () => {
  const { tracker, rows, tick } = harness();
  tracker.codex("thread/started", { thread: { id: "child", agentNickname: "Scout", model: "gpt-5.6", source: { subagent: { thread_spawn: { parent_thread_id: "root" } } } } }, "root");
  tracker.codex("item/started", { threadId: "child", turnId: "t1", item: { id: "cmd", type: "commandExecution", command: "npm test", status: "inProgress" } }, "root");
  tracker.codex("item/commandExecution/outputDelta", { threadId: "child", turnId: "t1", itemId: "cmd", delta: "Passing" }, "root");
  tracker.codex("item/commandExecution/outputDelta", { threadId: "child", turnId: "t1", itemId: "cmd", delta: "\n" }, "root");
  assert.equal(rows.get("codex:shell:child:t1:cmd")?.output, "Passing\n");
  assert.equal(rows.get("codex:shell:child:t1:cmd")?.parentId, "codex:agent:child");
  tick();
  tracker.codex("turn/completed", { threadId: "child", turn: { status: "completed" } }, "root");
  assert.equal(rows.get("codex:agent:child")?.status, "idle");
  assert.equal(rows.get("codex:agent:child")?.completedAt, 2_000);
  tick();
  tracker.codex("turn/started", { threadId: "child" }, "root");
  assert.equal(rows.get("codex:agent:child")?.startedAt, 3_000);
  assert.equal(rows.get("codex:agent:child")?.completedAt, undefined);
  tracker.codex("item/completed", { threadId: "child", turnId: "t1", item: { id: "cmd", type: "commandExecution", status: "completed", exitCode: 1 } }, "root");
  assert.equal(rows.get("codex:shell:child:t1:cmd")?.status, "failed");
});

test("Codex collab discovery ignores unrelated threads and preserves settled status", () => {
  const { tracker, rows } = harness();
  tracker.codex("item/started", { threadId: "unrelated", item: { id: "bad", type: "commandExecution" } }, "root");
  assert.equal(rows.size, 0);
  tracker.codex("item/completed", { threadId: "root", item: { type: "collabAgentToolCall", tool: "spawnAgent", receiverThreadIds: ["child"], model: "fast", agentsStates: { child: { status: "running" } } } }, "root");
  tracker.codex("thread/status/changed", { threadId: "child", status: { type: "active" } }, "root");
  assert.equal(rows.get("codex:agent:child")?.status, "running");
  tracker.codex("item/completed", { threadId: "root", item: { type: "collabAgentToolCall", tool: "wait", agentsStates: { child: { status: "completed", message: "Review finished" } } } }, "root");
  tracker.codex("turn/completed", { threadId: "child", turn: { status: "completed" } }, "root");
  assert.equal(rows.get("codex:agent:child")?.status, "completed");
  assert.equal(rows.get("codex:agent:child")?.output, "Review finished");
});

test("Codex commands with reused item ids remain distinct across turns", () => {
  const { tracker, rows } = harness();
  for (const turnId of ["one", "two"]) tracker.codex("item/started", { threadId: "root", turnId, item: { type: "commandExecution", id: "cmd", command: "echo hi" } }, "root");
  assert.equal(rows.size, 2);
});

test("Cursor execute updates retain ongoing output without inventing subagents", () => {
  const { tracker, rows } = harness();
  tracker.cursor({ toolCallId: "exec", kind: "execute", title: "Run a script", status: "in_progress", rawInput: { command: "claude --print hello" } }, { id: "t-exec", kind: "tool", output: "Starting" });
  assert.equal(rows.get("cursor:t-exec")?.kind, "shell");
  assert.equal(rows.get("cursor:t-exec")?.output, "Starting");
  tracker.cursor({ toolCallId: "exec", kind: "execute", title: "Run a script", status: "completed" }, { id: "t-exec", kind: "tool", output: "Finished" });
  assert.equal(rows.get("cursor:t-exec")?.status, "completed");
});

test("restored or disconnected work never claims to still be running", () => {
  const first = harness();
  first.tracker.tool("claude", "a", "Agent", {});
  const restored = harness(first.events);
  restored.tracker.disconnected();
  assert.equal(restored.rows.get("claude:a")?.status, "unknown");
  first.tracker.disconnected();
  assert.equal(first.rows.get("claude:a")?.status, "unknown");
});

test("output is bounded and arbitrary tool payload fields are not persisted", () => {
  const { tracker, rows } = harness();
  tracker.tool("claude", "a", "Bash", { command: "echo hello", unrecognized: "do not retain" });
  tracker.toolResult("claude", "a", "x".repeat(100_000), false);
  assert.ok(rows.get("claude:a")!.output!.length < 12_100);
  assert.ok(!JSON.stringify([...rows.values()]).includes("do not retain"));
});
