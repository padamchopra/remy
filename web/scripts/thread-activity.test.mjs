import assert from "node:assert/strict";
import test from "node:test";
import { threadActivities } from "../src/lib/thread-activity.ts";

const row = { id: "agent", kind: "subagent", provider: "claude", title: "Review", status: "running", startedAt: 1, updatedAt: 2 };

test("native activity replaces legacy tools rather than duplicating work", () => {
  const entries = [{ id: "tool", kind: "tool", tool: "Agent" }, { id: "activity:agent", kind: "tool", activity: row }];
  assert.deepEqual(threadActivities(entries, "claude", true, true), [row]);
});

test("offline activity stops claiming liveness without mutating cached state", () => {
  const entries = [{ id: "activity:agent", kind: "tool", activity: row }];
  assert.equal(threadActivities(entries, "claude", true, false)[0].status, "unknown");
  assert.equal(row.status, "running");
  assert.equal(threadActivities(entries, "claude", true, true)[0].status, "running");
});

test("legacy fallback only infers running tools in the current active turn", () => {
  const entries = [
    { id: "old", kind: "tool", tool: "Bash" },
    { id: "user", kind: "user" },
    { id: "read", kind: "tool", tool: "Read" },
    { id: "command", kind: "tool", tool: "command_execution", arg: "npm test" },
    { id: "agent", kind: "tool", tool: "Agent", status: "ok" },
  ];
  assert.deepEqual(threadActivities(entries, "codex", true, true).map((row) => row.status), ["unknown", "running", "completed"]);
  assert.deepEqual(threadActivities(entries, "codex", false, true).map((row) => row.status), ["unknown", "unknown", "completed"]);
});
