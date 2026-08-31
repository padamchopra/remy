import { loadChat, type StoredChat } from "./chat-storage.js";
import type { ProviderId } from "./providers.js";
import type { ContextUsage, ConvEntry, TranscriptUsageSample } from "./transcript.js";
import {
  readTranscriptAnalytics,
  resolveCodexTranscriptPath,
  resolveTranscriptPath,
} from "./transcript.js";

const ENTRY_LIMIT = 2_000;

export interface ThreadUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface ThreadAnalyticsReport {
  chatId: string;
  provider: ProviderId;
  model?: string;
  usage: ThreadUsage;
  turns: number;
  toolCalls: number;
  skillInvocations: number;
  skills: Array<{ name: string; count: number }>;
  sessionSpanMs: number;
  measuredActiveMs: number;
  currentRunMs: number;
  measuredTurns: number;
  context?: ContextUsage;
  models: Array<ThreadUsage & { provider: ProviderId; model: string }>;
}

export interface TimingSummary {
  samples: number;
  medianMs: number;
  p95Ms: number;
  latestMs: number;
}

export interface ThreadPerformanceReport {
  chatId: string;
  state: "idle" | "working" | "needs_input" | "error";
  live: boolean;
  sessionSpanMs: number;
  measuredActiveMs: number;
  currentRunMs: number;
  turns: number;
  measuredTurns: number;
  firstOutput: TimingSummary;
  turnDuration: TimingSummary;
  toolDuration: TimingSummary;
  tools: {
    total: number;
    succeeded: number;
    failed: number;
    stopped: number;
    running: number;
  };
  failures: number;
  context?: ContextUsage;
  slowestTools: Array<{
    id: string;
    label: string;
    durationMs: number;
    status: "ok" | "error" | "stopped";
  }>;
}

export interface ThreadRuntime {
  state?: "idle" | "working" | "needs_input" | "error";
  workingSince?: number;
  live?: boolean;
  error?: string;
  context?: ContextUsage;
}

interface ProviderTranscript {
  provider: ProviderId;
  usage: TranscriptUsageSample[];
  tools: Array<{ at: number; tool: string; skill?: string }>;
  cost: Array<{ at: number; costUsd: number }>;
}

interface MeasuredTurns {
  firstOutputMs: number[];
  durationMs: number[];
  activeMs: number;
}

const EMPTY_USAGE: ThreadUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  costUsd: 0,
};

/// Usage reported by the provider sessions belonging to one Remy thread.
export function threadAnalytics(chatId: string, runtime: ThreadRuntime = {}, now = Date.now()): ThreadAnalyticsReport | undefined {
  const chat = loadChat(chatId, ENTRY_LIMIT);
  if (!chat) return undefined;
  const transcripts = providerTranscripts(chat);
  const usage = { ...EMPTY_USAGE };
  const models = new Map<string, ThreadUsage & { provider: ProviderId; model: string }>();

  for (const transcript of transcripts) {
    for (const sample of transcript.usage) {
      addSample(usage, sample);
      const modelName = sample.model ?? chat.model ?? "Default";
      const key = `${transcript.provider}:${modelName}`;
      const model = models.get(key) ?? { ...EMPTY_USAGE, provider: transcript.provider, model: modelName };
      addSample(model, sample);
      models.set(key, model);
    }
  }

  const transcriptCost = transcripts.flatMap((transcript) => transcript.cost).reduce((total, entry) => total + entry.costUsd, 0);
  usage.costUsd = Math.max(transcriptCost, chat.costUsd ?? 0);
  const measured = measureTurns(chat.entries.filter((entry) => !entry.activity), runtime.state === "working" || runtime.state === "needs_input", now);
  const currentRunMs = runtime.workingSince ? Math.max(0, now - runtime.workingSince) : 0;
  const transcriptSkills = transcripts.flatMap((transcript) =>
    transcript.tools.flatMap((entry) => entry.skill ? [entry.skill] : []),
  );
  const storedSkills = chat.entries.flatMap((entry) =>
    entry.kind === "tool" && entry.skill ? [entry.skill] : [],
  );
  const skills = ranked(transcriptSkills.length > 0 ? transcriptSkills : storedSkills);

  return {
    chatId,
    provider: chat.provider,
    ...(chat.model ? { model: chat.model } : {}),
    usage,
    turns: chat.turns,
    toolCalls: transcripts.reduce((total, transcript) => total + transcript.tools.length, 0)
      || chat.entries.filter((entry) => entry.kind === "tool" && !entry.activity).length,
    skillInvocations: skills.reduce((total, skill) => total + skill.count, 0),
    skills,
    sessionSpanMs: sessionSpan(chat, runtime, now),
    measuredActiveMs: measured.activeMs,
    currentRunMs,
    measuredTurns: measured.durationMs.length,
    ...((runtime.context ?? chat.context) ? { context: runtime.context ?? chat.context } : {}),
    models: [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens),
  };
}

function ranked(names: string[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/// Responsiveness and reliability for one thread, never the rest of the app.
export function threadPerformance(
  chatId: string,
  runtime: ThreadRuntime = {},
  now = Date.now(),
): ThreadPerformanceReport | undefined {
  const chat = loadChat(chatId, ENTRY_LIMIT);
  if (!chat) return undefined;
  const busy = runtime.state === "working" || runtime.state === "needs_input";
  const measured = measureTurns(chat.entries.filter((entry) => !entry.activity), busy, now);
  const tools = chat.entries.filter((entry) => entry.kind === "tool" && !entry.activity);
  const completedTools = tools.flatMap((entry) => {
    if (!entry.at || !entry.completedAt || !entry.status) return [];
    return [{
      id: entry.id,
      label: `${entry.verb ?? "Used"} ${entry.arg ?? entry.tool ?? "tool"}`.trim(),
      durationMs: Math.max(0, entry.completedAt - entry.at),
      status: entry.status,
    }];
  });
  const failedTools = tools.filter((entry) => entry.status === "error").length;

  return {
    chatId,
    state: runtime.state ?? "idle",
    live: runtime.live ?? false,
    sessionSpanMs: sessionSpan(chat, runtime, now),
    measuredActiveMs: measured.activeMs,
    currentRunMs: runtime.workingSince ? Math.max(0, now - runtime.workingSince) : 0,
    turns: chat.turns,
    measuredTurns: measured.durationMs.length,
    firstOutput: timingSummary(measured.firstOutputMs),
    turnDuration: timingSummary(measured.durationMs),
    toolDuration: timingSummary(completedTools.map((entry) => entry.durationMs)),
    tools: {
      total: tools.length,
      succeeded: tools.filter((entry) => entry.status === "ok").length,
      failed: failedTools,
      stopped: tools.filter((entry) => entry.status === "stopped").length,
      running: tools.filter((entry) => !entry.status).length,
    },
    failures: failedTools + (runtime.error || chat.error ? 1 : 0),
    ...((runtime.context ?? chat.context) ? { context: runtime.context ?? chat.context } : {}),
    slowestTools: completedTools.sort((a, b) => b.durationMs - a.durationMs).slice(0, 6),
  };
}

function providerTranscripts(chat: StoredChat): ProviderTranscript[] {
  const sources: Array<{ provider: ProviderId; path?: string }> = [
    {
      provider: "claude",
      path: chat.claudeSessionId ? resolveTranscriptPath(chat.cwd, chat.claudeSessionId) : undefined,
    },
    { provider: "codex", path: resolveCodexTranscriptPath(chat.codexThreadId) },
  ];
  return sources.flatMap(({ provider, path }) => {
    const transcript = readTranscriptAnalytics(path);
    return transcript ? [{ provider, ...transcript }] : [];
  });
}

function addSample(target: ThreadUsage, sample: TranscriptUsageSample): void {
  target.inputTokens += sample.inputTokens;
  target.cachedInputTokens += sample.cachedInputTokens;
  target.cacheCreationTokens += sample.cacheCreationTokens;
  target.outputTokens += sample.outputTokens;
  target.reasoningTokens += sample.reasoningTokens;
  target.totalTokens += sample.inputTokens + sample.cachedInputTokens + sample.cacheCreationTokens + sample.outputTokens;
}

function sessionSpan(chat: StoredChat, runtime: ThreadRuntime, now: number): number {
  const end = runtime.state === "working" || runtime.state === "needs_input" ? now : chat.updatedAt;
  return Math.max(0, end - chat.createdAt);
}

function measureTurns(entries: ConvEntry[], busy: boolean, now: number): MeasuredTurns {
  const firstOutputMs: number[] = [];
  const durationMs: number[] = [];
  let activeMs = 0;
  const userIndexes = entries.flatMap((entry, index) => entry.kind === "user" && entry.at ? [index] : []);

  for (let turnIndex = 0; turnIndex < userIndexes.length; turnIndex += 1) {
    const startIndex = userIndexes[turnIndex]!;
    const endIndex = userIndexes[turnIndex + 1] ?? entries.length;
    const user = entries[startIndex]!;
    const start = user.at!;
    const output = entries.slice(startIndex + 1, endIndex).filter((entry) => entry.at);
    const first = output.find((entry) => entry.kind !== "user");
    if (first?.at) firstOutputMs.push(Math.max(0, first.at - start));

    const recordedEnd = output.reduce((latest, entry) => Math.max(latest, entry.completedAt ?? entry.at ?? start), start);
    const current = turnIndex === userIndexes.length - 1 && busy;
    const end = current ? now : recordedEnd;
    if (end > start) {
      const duration = end - start;
      durationMs.push(duration);
      activeMs += duration;
    }
  }

  return { firstOutputMs, durationMs, activeMs };
}

function timingSummary(values: number[]): TimingSummary {
  if (values.length === 0) return { samples: 0, medianMs: 0, p95Ms: 0, latestMs: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
  return {
    samples: values.length,
    medianMs: at(0.5),
    p95Ms: at(0.95),
    latestMs: values.at(-1) ?? 0,
  };
}
