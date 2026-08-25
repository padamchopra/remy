import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const home = mkdtempSync(join(tmpdir(), "remy-analytics-test-"));
process.env.HOME = home;
process.env.MC_CONFIG_DIR = join(home, "state");

const storage = await import("./chat-storage.js");
const { archiveChat } = await import("./archives.js");
const { localAnalytics } = await import("./analytics.js");
const { threadAnalytics, threadPerformance } = await import("./thread-metrics.js");

const ratesDocument = {
  "claude-opus-4-1": {
    input_cost_per_token: 0.000001,
    cache_read_input_token_cost: 0.0000005,
    cache_creation_input_token_cost: 0.00000125,
    output_cost_per_token: 0.000002,
  },
  "gpt-5.6-sol": {
    input_cost_per_token: 0.000001,
    cache_read_input_token_cost: 0.0000005,
    output_cost_per_token: 0.000002,
  },
};

test("keeps General Remy-specific while Usage scans the whole machine", async () => {
  const now = Date.parse("2026-08-25T12:00:00.000Z");
  const cwd = "/code/remy";
  const sessionId = "claude-session";
  const directory = join(home, ".claude", "projects", cwd.replace(/[/.]/g, "-"));
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${sessionId}.jsonl`), [
    JSON.stringify({
      timestamp: "2026-08-24T10:00:00.000Z",
      type: "assistant",
      sessionId,
      requestId: "request-1",
      costUSD: 0.25,
      message: {
        id: "message-1",
        model: "claude-opus-4-1",
        usage: {
          input_tokens: 100,
          cache_read_input_tokens: 60,
          cache_creation_input_tokens: 20,
          output_tokens: 10,
        },
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "/code/remy/file.ts" } },
          { type: "tool_use", name: "Skill", input: { skill: "qa" } },
        ],
      },
    }),
    JSON.stringify({ timestamp: "2026-08-24T10:01:00.000Z", type: "result", total_cost_usd: 0.25 }),
  ].join("\n"));
  storage.saveChat({
    id: "thread-1",
    title: "Analytics",
    cwd,
    provider: "claude",
    model: "claude-opus-4-1",
    permissionMode: "default",
    createdAt: now - 2 * 24 * 60 * 60_000,
    updatedAt: now - 24 * 60 * 60_000,
    claudeSessionId: sessionId,
    turns: 2,
    todos: [],
  });

  const outsideDirectory = join(home, ".claude", "projects", "outside-remy");
  mkdirSync(outsideDirectory, { recursive: true });
  writeFileSync(join(outsideDirectory, "outside-session.jsonl"), [
    JSON.stringify({
      timestamp: "2026-08-24T10:00:00.000Z",
      type: "assistant",
      sessionId: "outside-session",
      requestId: "request-1",
      costUSD: 0.25,
      message: {
        id: "message-1",
        model: "claude-opus-4-1",
        usage: { input_tokens: 100, cache_read_input_tokens: 60, cache_creation_input_tokens: 20, output_tokens: 10 },
        content: [],
      },
    }),
    JSON.stringify({
      timestamp: "2026-08-24T11:00:00.000Z",
      type: "assistant",
      sessionId: "outside-session",
      requestId: "outside-request",
      message: {
        id: "outside-message",
        model: "claude-opus-4-1",
        usage: { input_tokens: 40, output_tokens: 10 },
        content: [],
      },
    }),
  ].join("\n"));

  const report = await localAnalytics(7, "UTC", now, { home, ratesDocument });
  assert.equal(report.totals.threads, 1);
  assert.equal(report.totals.turns, 2);
  assert.equal(report.totals.toolCalls, 2);
  assert.equal(report.totals.skillInvocations, 1);
  assert.equal(report.totals.totalTokens, 240);
  assert.equal(report.totals.usageSessions, 2);
  assert.ok(report.totals.costUsd > 0.25);
  assert.deepEqual(report.tools, [{ name: "Read", count: 1 }, { name: "Skill", count: 1 }]);
  assert.deepEqual(report.skills, [{ name: "qa", count: 1 }]);
  assert.equal(report.daily.find((day) => day.date === "2026-08-24")?.toolCalls, 2);
  assert.equal(report.providers[0]?.provider, "claude");
  assert.equal(report.models[0]?.model, "claude-opus-4-1");
  assert.equal(report.sources.find((source) => source.provider === "claude")?.sessions, 2);
});

test("scans Codex history and includes Cursor live usage without inventing token totals", async () => {
  const now = Date.parse("2026-08-25T12:00:00.000Z");
  const codexId = "019fffff-1111-7222-8333-444444444444";
  const directory = join(home, ".codex", "sessions", "2026", "08", "24");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `rollout-2026-08-24T10-00-00-${codexId}.jsonl`), [
    JSON.stringify({ timestamp: "2026-08-24T09:59:00.000Z", type: "session_meta", payload: { id: codexId } }),
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
      timestamp: "2026-08-24T10:01:01.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 20, reasoning_output_tokens: 5 } },
      },
    }),
  ].join("\n"));
  archiveChat({
    chatId: "archived-codex",
    session: "Codex archive",
    agent: "codex",
    cwd: "/code/remy",
    conversation: {
      available: true,
      agent: "codex",
      title: "Codex archive",
      model: "gpt-5.6-sol",
      codexThreadId: codexId,
      turns: 1,
      todos: [],
      entries: [],
    },
  });
  storage.saveChat({
    id: "cursor-live-usage",
    title: "Cursor usage",
    cwd: "/code/remy",
    provider: "cursor",
    model: "composer-1.5",
    permissionMode: "default",
    createdAt: now - 60_000,
    updatedAt: now - 30_000,
    cursorSessionId: "cursor-session-live",
    turns: 1,
    costUsd: 0.42,
    context: {
      tokens: 18_000,
      peakTokens: 24_000,
      limit: 200_000,
      limitEstimated: false,
      model: "composer-1.5",
      compactions: 0,
      droppedTokens: 0,
    },
    todos: [],
  });
  const report = await localAnalytics(7, "UTC", now, { home, ratesDocument });
  const codex = report.providers.find((provider) => provider.provider === "codex");
  const cursor = report.providers.find((provider) => provider.provider === "cursor");
  assert.equal(codex?.totalTokens, 120);
  assert.equal(codex?.sessions, 1);
  assert.ok((codex?.costUsd ?? 0) > 0);
  assert.equal(cursor?.totalTokens, 0);
  assert.equal(cursor?.currentContextTokens, 18_000);
  assert.equal(cursor?.peakContextTokens, 24_000);
  assert.equal(cursor?.contextLimitTokens, 200_000);
  assert.equal(cursor?.costUsd, 0.42);
  assert.equal(report.sources.find((source) => source.provider === "cursor")?.status, "partial");
});

test("reports usage and measured performance for one thread only", () => {
  const createdAt = Date.parse("2026-08-25T10:00:00.000Z");
  const entries = [
    { id: "user-1", kind: "user" as const, text: "Build it", at: createdAt + 1_000 },
    { id: "assistant-1", kind: "assistant" as const, text: "I am on it", at: createdAt + 1_300, completedAt: createdAt + 1_500 },
    {
      id: "tool-1",
      kind: "tool" as const,
      tool: "Bash",
      verb: "Ran",
      arg: "npm test",
      status: "ok" as const,
      skill: "qa",
      at: createdAt + 1_600,
      completedAt: createdAt + 2_600,
    },
    { id: "assistant-2", kind: "assistant" as const, text: "Done", at: createdAt + 2_700, completedAt: createdAt + 3_000 },
  ];
  storage.saveChat({
    id: "thread-metrics",
    title: "Thread metrics",
    cwd: "/code/remy",
    provider: "cursor",
    model: "composer-1.5",
    permissionMode: "default",
    createdAt,
    updatedAt: createdAt + 4_000,
    turns: 1,
    costUsd: 0.12,
    context: {
      tokens: 2_000,
      peakTokens: 3_000,
      limit: 200_000,
      limitEstimated: true,
      model: "composer-1.5",
      compactions: 0,
      droppedTokens: 0,
    },
    todos: [],
  });
  for (const entry of entries) storage.saveEntry("thread-metrics", entry);

  const analytics = threadAnalytics("thread-metrics", { state: "idle" }, createdAt + 5_000);
  assert.equal(analytics?.usage.totalTokens, 0);
  assert.equal(analytics?.usage.costUsd, 0.12);
  assert.equal(analytics?.context?.tokens, 2_000);
  assert.equal(analytics?.context?.peakTokens, 3_000);
  assert.equal(analytics?.toolCalls, 1);
  assert.equal(analytics?.skillInvocations, 1);
  assert.equal(analytics?.measuredActiveMs, 2_000);

  const performance = threadPerformance("thread-metrics", { state: "idle", live: true }, createdAt + 5_000);
  assert.equal(performance?.firstOutput.medianMs, 300);
  assert.equal(performance?.turnDuration.medianMs, 2_000);
  assert.equal(performance?.toolDuration.p95Ms, 1_000);
  assert.equal(performance?.tools.succeeded, 1);
  assert.equal(performance?.live, true);
});
