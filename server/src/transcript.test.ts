import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const home = mkdtempSync(join(tmpdir(), "remy-transcript-test-"));
process.env.HOME = home;

const { discoverClaudeTranscript, readTranscriptAnalytics, resolveCodexTranscriptPath } = await import("./transcript.js");

test("discovers the newest Claude transcript for an exact working directory", () => {
  const cwd = "/code/control/.claude/worktrees/feature/flight-deck";
  const encoded = cwd.replace(/[/.]/g, "-");
  const directory = join(home, ".claude", "projects", encoded);
  mkdirSync(directory, { recursive: true });
  const older = join(directory, "older.jsonl");
  const current = join(directory, "current.jsonl");
  writeFileSync(older, "{}\n");
  writeFileSync(current, "{}\n");
  utimesSync(older, new Date(1_000), new Date(1_000));
  utimesSync(current, new Date(2_000), new Date(2_000));

  assert.deepEqual(discoverClaudeTranscript(cwd), { path: current, sessionId: "current" });
  assert.equal(discoverClaudeTranscript("/code/other"), undefined);
});

test("reduces Claude usage, tools, skills, and reported cost", () => {
  const path = join(home, "claude-analytics.jsonl");
  writeFileSync(path, [
    JSON.stringify({
      timestamp: "2026-08-24T10:00:00.000Z",
      type: "assistant",
      message: {
        model: "claude-opus-4-1",
        usage: {
          input_tokens: 100,
          cache_read_input_tokens: 60,
          cache_creation_input_tokens: 20,
          output_tokens: 10,
        },
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "/code/file.ts" } },
          { type: "tool_use", name: "Skill", input: { skill: "qa" } },
        ],
      },
    }),
    JSON.stringify({ timestamp: "2026-08-24T10:01:00.000Z", type: "result", total_cost_usd: 0.25 }),
  ].join("\n"));

  const analytics = readTranscriptAnalytics(path)!;
  assert.deepEqual(analytics.usage, [{
    at: Date.parse("2026-08-24T10:00:00.000Z"),
    model: "claude-opus-4-1",
    inputTokens: 100,
    cachedInputTokens: 60,
    cacheCreationTokens: 20,
    outputTokens: 10,
    reasoningTokens: 0,
  }]);
  assert.deepEqual(analytics.tools, [
    { at: Date.parse("2026-08-24T10:00:00.000Z"), tool: "Read" },
    { at: Date.parse("2026-08-24T10:00:00.000Z"), tool: "Skill", skill: "qa" },
  ]);
  assert.deepEqual(analytics.cost, [{ at: Date.parse("2026-08-24T10:01:00.000Z"), costUsd: 0.25 }]);
});

test("finds and reduces a Codex rollout by thread id", () => {
  const id = "019fffff-1111-7222-8333-444444444444";
  const directory = join(home, ".codex", "sessions", "2026", "08", "24");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `rollout-2026-08-24T10-00-00-${id}.jsonl`);
  writeFileSync(path, [
    JSON.stringify({ timestamp: "2026-08-24T10:00:00.000Z", type: "turn_context", payload: { model: "gpt-5.6-sol" } }),
    JSON.stringify({
      timestamp: "2026-08-24T10:01:00.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 20, reasoning_output_tokens: 5 } },
      },
    }),
    JSON.stringify({
      timestamp: "2026-08-24T10:02:00.000Z",
      type: "response_item",
      payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ command: "npm test" }) },
    }),
  ].join("\n"));

  assert.equal(resolveCodexTranscriptPath(id), path);
  const analytics = readTranscriptAnalytics(path)!;
  assert.deepEqual(analytics.usage[0], {
    at: Date.parse("2026-08-24T10:01:00.000Z"),
    model: "gpt-5.6-sol",
    inputTokens: 40,
    cachedInputTokens: 60,
    cacheCreationTokens: 0,
    outputTokens: 20,
    reasoningTokens: 5,
  });
  assert.deepEqual(analytics.tools, [
    { at: Date.parse("2026-08-24T10:02:00.000Z"), tool: "exec_command" },
  ]);
});
