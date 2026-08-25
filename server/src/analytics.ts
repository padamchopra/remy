import { loadChats } from "./chat-storage.js";
import { listArchivedChats } from "./archives.js";
import {
  machineUsage,
  type MachineUsageOptions,
  type ProviderUsagePricing,
  type ProviderUsageRecord,
  type ProviderUsageSource,
} from "./provider-usage.js";
import { providerId, type ProviderId } from "./providers.js";
import type { ConvEntry } from "./transcript.js";
import type { ContextUsage } from "./transcript.js";
import {
  readTranscriptAnalytics,
  resolveCodexTranscriptPath,
  resolveTranscriptPath,
} from "./transcript.js";

export interface AnalyticsUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  pricedTokens: number;
  costUsd: number;
  currentContextTokens: number;
  peakContextTokens: number;
  contextLimitTokens: number;
  contextSessions: number;
}

export interface AnalyticsReport {
  from: number;
  to: number;
  timeZone: string;
  totals: AnalyticsUsage & {
    threads: number;
    turns: number;
    toolCalls: number;
    skillInvocations: number;
    usageSessions: number;
  };
  daily: Array<AnalyticsUsage & { date: string; toolCalls: number; skillInvocations: number }>;
  tools: Array<{ name: string; count: number }>;
  skills: Array<{ name: string; count: number }>;
  providers: Array<AnalyticsUsage & { provider: ProviderId; sessions: number }>;
  models: Array<AnalyticsUsage & { provider: ProviderId; model: string; sessions: number }>;
  sources: ProviderUsageSource[];
  pricing: ProviderUsagePricing;
  scanDurationMs: number;
}

interface UsageBucket extends AnalyticsUsage {
  sessions: Set<string>;
}

interface AnalyticsChat {
  id: string;
  cwd: string;
  provider: ProviderId;
  model?: string;
  updatedAt: number;
  claudeSessionId?: string;
  codexThreadId?: string;
  cursorSessionId?: string;
  costUsd?: number;
  context?: ContextUsage;
  turns: number;
  entries: ConvEntry[];
}

const EMPTY_USAGE = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  pricedTokens: 0,
  costUsd: 0,
  currentContextTokens: 0,
  peakContextTokens: 0,
  contextLimitTokens: 0,
  contextSessions: 0,
};

/// General activity comes from Remy threads; usage comes from every provider
/// transcript on this device, including work started outside Remy.
export async function localAnalytics(
  days = 30,
  askedTimeZone = "UTC",
  now = Date.now(),
  usageOptions: MachineUsageOptions = {},
): Promise<AnalyticsReport> {
  const windowDays = Math.min(Math.max(Math.round(days), 1), 90);
  const timeZone = validTimeZone(askedTimeZone) ? askedTimeZone : "UTC";
  const to = now;
  const from = to - windowDays * 24 * 60 * 60_000;
  const dayKeys = recentDays(windowDays, to, timeZone);
  const daily = new Map(dayKeys.map((date) => [date, { ...EMPTY_USAGE, date, toolCalls: 0, skillInvocations: 0 }]));
  const toolCounts = new Map<string, number>();
  const skillCounts = new Map<string, number>();
  const providers = new Map<ProviderId, UsageBucket>();
  const models = new Map<string, UsageBucket & { provider: ProviderId; model: string }>();
  const seenThreads = new Set<string>();
  const usageSessions = new Set<string>();
  let turns = 0;
  let toolCalls = 0;
  let skillInvocations = 0;

  const chats = analyticsChats();
  for (const chat of chats) {
    if (chat.updatedAt < from) continue;
    seenThreads.add(chat.id);
    turns += chat.turns;

    const path = transcriptPath(chat);
    const transcript = readTranscriptAnalytics(path);
    const transcriptTools = transcript?.tools.filter((entry) => inWindow(entry.at, from, to)) ?? [];
    const tools = transcript
      ? transcriptTools
      : chat.entries
          .filter((entry) => entry.kind === "tool" && entry.tool)
          .map((entry) => ({ at: chat.updatedAt, tool: entry.tool!, ...(entry.skill ? { skill: entry.skill } : {}) }));

    for (const entry of tools) {
      const date = dayKey(entry.at || chat.updatedAt, timeZone);
      const day = daily.get(date);
      if (!day) continue;
      toolCalls += 1;
      day.toolCalls += 1;
      toolCounts.set(entry.tool, (toolCounts.get(entry.tool) ?? 0) + 1);
      if (!entry.skill) continue;
      skillInvocations += 1;
      day.skillInvocations += 1;
      skillCounts.set(entry.skill, (skillCounts.get(entry.skill) ?? 0) + 1);
    }

  }

  const usage = await machineUsage(from, to, usageOptions);
  for (const record of usage.records) {
    const session = record.sessionId || `${record.provider}:${record.model}:${record.at}`;
    usageSessions.add(`${record.provider}:${session}`);
    const provider = bucketFor(providers, record.provider);
    provider.sessions.add(session);
    addRecord(provider, record);
    const model = modelBucketFor(models, record.provider, record.model);
    model.sessions.add(session);
    addRecord(model, record);
    const day = daily.get(dayKey(record.at, timeZone));
    if (day) addRecord(day, record);
  }

  const cursorSnapshots = latestCursorSnapshots(chats, from, to);
  for (const chat of cursorSnapshots) {
    const session = chat.cursorSessionId ?? chat.id;
    usageSessions.add(`cursor:${session}`);
    const provider = bucketFor(providers, "cursor");
    provider.sessions.add(session);
    addCursorSnapshot(provider, chat);
    const modelName = chat.model ?? chat.context?.model ?? "Default";
    const model = modelBucketFor(models, "cursor", modelName);
    model.sessions.add(session);
    addCursorSnapshot(model, chat);
    const day = daily.get(dayKey(chat.updatedAt, timeZone));
    if (day) addCursorSnapshot(day, chat);
  }
  const cursorSource = usage.sources.find((source) => source.provider === "cursor");
  if (cursorSource && cursorSnapshots.length > 0) {
    cursorSource.status = "partial";
    cursorSource.sessions = cursorSnapshots.length;
    cursorSource.message = "Live context and reported spend come from Remy threads; processed token history is unavailable.";
  }

  const providerRows = [...providers.entries()]
    .filter(([, value]) => value.totalTokens > 0 || value.costUsd > 0 || value.contextSessions > 0)
    .map(([provider, value]) => ({
      provider,
      ...withoutSessions(value),
      sessions: value.sessions.size,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.costUsd - a.costUsd || b.peakContextTokens - a.peakContextTokens);
  const modelRows = [...models.values()]
    .filter((value) => value.totalTokens > 0 || value.costUsd > 0 || value.contextSessions > 0)
    .map((value) => ({
      provider: value.provider,
      model: value.model,
      ...withoutSessions(value),
      sessions: value.sessions.size,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.costUsd - a.costUsd || b.peakContextTokens - a.peakContextTokens);
  const totalUsage = providerRows.reduce<AnalyticsUsage>((total, value) => addUsage(total, value), { ...EMPTY_USAGE });

  return {
    from,
    to,
    timeZone,
    totals: {
      ...totalUsage,
      threads: seenThreads.size,
      turns,
      toolCalls,
      skillInvocations,
      usageSessions: usageSessions.size,
    },
    daily: [...daily.values()],
    tools: ranked(toolCounts),
    skills: ranked(skillCounts),
    providers: providerRows,
    models: modelRows,
    sources: usage.sources,
    pricing: usage.pricing,
    scanDurationMs: usage.scanDurationMs,
  };
}

function analyticsChats(): AnalyticsChat[] {
  const active: AnalyticsChat[] = loadChats(500);
  const archived = listArchivedChats().map((archive): AnalyticsChat => {
    const conversation = archive.conversation as typeof archive.conversation & {
      model?: string;
      codexThreadId?: string;
      cursorSessionId?: string;
      claudeSessionId?: string;
      turns?: number;
      costUsd?: number;
    };
    return {
      id: archive.chatId ?? `archive:${archive.id}`,
      cwd: archive.cwd ?? "~",
      provider: providerId(conversation.agent ?? archive.agent),
      updatedAt: archive.archivedAt,
      ...(conversation.claudeSessionId ? { claudeSessionId: conversation.claudeSessionId } : {}),
      ...(conversation.codexThreadId ? { codexThreadId: conversation.codexThreadId } : {}),
      ...(conversation.cursorSessionId ? { cursorSessionId: conversation.cursorSessionId } : {}),
      ...(conversation.model ? { model: conversation.model } : {}),
      ...(typeof conversation.costUsd === "number" ? { costUsd: conversation.costUsd } : {}),
      ...(conversation.context ? { context: conversation.context } : {}),
      turns: conversation.turns ?? conversation.entries.filter((entry) => entry.kind === "user").length,
      entries: conversation.entries,
    };
  });
  return [...active, ...archived];
}

function transcriptPath(chat: AnalyticsChat): string | undefined {
  if (chat.provider === "claude") return resolveTranscriptPath(chat.cwd, chat.claudeSessionId);
  if (chat.provider === "codex") return resolveCodexTranscriptPath(chat.codexThreadId);
  return undefined;
}

function inWindow(at: number, from: number, to: number): boolean {
  return at === 0 || (at >= from && at <= to);
}

function addRecord(target: AnalyticsUsage, record: ProviderUsageRecord): void {
  const total = record.totals.inputTokens
    + record.totals.cachedInputTokens
    + record.totals.cacheCreationTokens
    + record.totals.outputTokens;
  target.inputTokens += record.totals.inputTokens;
  target.cachedInputTokens += record.totals.cachedInputTokens;
  target.cacheCreationTokens += record.totals.cacheCreationTokens;
  target.outputTokens += record.totals.outputTokens;
  target.reasoningTokens += record.totals.reasoningTokens;
  target.totalTokens += total;
  if (record.priced) target.pricedTokens += total;
  target.costUsd += record.costUsd;
}

function addUsage(target: AnalyticsUsage, value: AnalyticsUsage): AnalyticsUsage {
  target.inputTokens += value.inputTokens;
  target.cachedInputTokens += value.cachedInputTokens;
  target.cacheCreationTokens += value.cacheCreationTokens;
  target.outputTokens += value.outputTokens;
  target.reasoningTokens += value.reasoningTokens;
  target.totalTokens += value.totalTokens;
  target.pricedTokens += value.pricedTokens;
  target.costUsd += value.costUsd;
  target.currentContextTokens += value.currentContextTokens;
  target.peakContextTokens += value.peakContextTokens;
  target.contextLimitTokens += value.contextLimitTokens;
  target.contextSessions += value.contextSessions;
  return target;
}

function latestCursorSnapshots(chats: AnalyticsChat[], from: number, to: number): AnalyticsChat[] {
  const latest = new Map<string, AnalyticsChat>();
  for (const chat of chats) {
    if (chat.provider !== "cursor" || !inWindow(chat.updatedAt, from, to)) continue;
    if (!chat.context && !(typeof chat.costUsd === "number" && chat.costUsd > 0)) continue;
    const session = chat.cursorSessionId ?? chat.id;
    const existing = latest.get(session);
    if (!existing || chat.updatedAt > existing.updatedAt) latest.set(session, chat);
  }
  return [...latest.values()];
}

function addCursorSnapshot(target: AnalyticsUsage, chat: AnalyticsChat): void {
  const context = chat.context;
  if (context) {
    target.currentContextTokens += context.tokens;
    target.peakContextTokens += Math.max(context.peakTokens ?? 0, context.tokens);
    target.contextLimitTokens += context.limit;
    target.contextSessions += 1;
  }
  target.costUsd += Math.max(0, chat.costUsd ?? 0);
}

function bucketFor(map: Map<ProviderId, UsageBucket>, provider: ProviderId): UsageBucket {
  const existing = map.get(provider);
  if (existing) return existing;
  const created = { ...EMPTY_USAGE, sessions: new Set<string>() };
  map.set(provider, created);
  return created;
}

function modelBucketFor(
  map: Map<string, UsageBucket & { provider: ProviderId; model: string }>,
  provider: ProviderId,
  model: string,
): UsageBucket & { provider: ProviderId; model: string } {
  const key = `${provider}:${model}`;
  const existing = map.get(key);
  if (existing) return existing;
  const created = { ...EMPTY_USAGE, provider, model, sessions: new Set<string>() };
  map.set(key, created);
  return created;
}

function withoutSessions(value: UsageBucket): AnalyticsUsage {
  return {
    inputTokens: value.inputTokens,
    cachedInputTokens: value.cachedInputTokens,
    cacheCreationTokens: value.cacheCreationTokens,
    outputTokens: value.outputTokens,
    reasoningTokens: value.reasoningTokens,
    totalTokens: value.totalTokens,
    pricedTokens: value.pricedTokens,
    costUsd: value.costUsd,
    currentContextTokens: value.currentContextTokens,
    peakContextTokens: value.peakContextTokens,
    contextLimitTokens: value.contextLimitTokens,
    contextSessions: value.contextSessions,
  };
}

function ranked(counts: Map<string, number>): Array<{ name: string; count: number }> {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function recentDays(count: number, now: number, timeZone: string): string[] {
  const answer: string[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    answer.push(dayKey(now - index * 24 * 60 * 60_000, timeZone));
  }
  return [...new Set(answer)];
}

function dayKey(at: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(at));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
