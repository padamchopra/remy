import { createReadStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { configDir } from "./paths.js";
import type { ProviderId } from "./providers.js";

export interface ProviderUsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface ProviderUsageRecord {
  provider: "claude" | "codex";
  at: number;
  model: string;
  sessionId: string;
  totals: ProviderUsageTotals;
  costUsd: number;
  priced: boolean;
}

export interface ProviderUsageSource {
  provider: ProviderId;
  status: "ok" | "missing" | "unsupported" | "partial";
  scannedFiles: number;
  skippedFiles: number;
  sessions: number;
  message?: string;
}

export interface ProviderUsagePricing {
  status: "fresh" | "cached" | "unavailable";
  knownModels: number;
  fetchedAt?: number;
}

export interface MachineUsage {
  records: ProviderUsageRecord[];
  sources: ProviderUsageSource[];
  pricing: ProviderUsagePricing;
  scanDurationMs: number;
}

export interface MachineUsageOptions {
  home?: string;
  ratesDocument?: unknown;
  skipRateFetch?: boolean;
}

interface RawUsageRecord {
  provider: "claude" | "codex";
  at: number;
  model: string;
  sessionId: string;
  totals: ProviderUsageTotals;
  reportedCostUsd?: number;
  dedupeKey?: string;
}

interface TranscriptFile {
  path: string;
  size: number;
  mtimeMs: number;
}

interface ModelRate {
  input: number;
  cachedInput: number;
  cacheCreation: number;
  output: number;
}

interface RateState {
  table: Map<string, ModelRate>;
  status: ProviderUsagePricing["status"];
  fetchedAt?: number;
}

interface CodexState {
  model: string;
  sessionId: string;
  lastUsage: string;
  sawSessionMeta: boolean;
  suppressingForkCopies: boolean;
  forkCopyAt: number;
}

const RATE_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const RATE_CACHE = join(configDir, "usage-model-rates.json");
const RATE_TTL = 24 * 60 * 60_000;
const MTIME_SLACK = 90 * 24 * 60 * 60_000;
const FORK_COPY_GAP = 1_000;
const fileCache = new Map<string, { size: number; mtimeMs: number; provider: RawUsageRecord["provider"]; records: RawUsageRecord[] }>();
let rateState: RateState | undefined;

/// Reads every provider-owned transcript on this machine, including sessions
/// that Remy did not create. Provider files remain local; only reduced totals
/// leave this device.
export async function machineUsage(
  from: number,
  to: number,
  options: MachineUsageOptions = {},
): Promise<MachineUsage> {
  const startedAt = Date.now();
  const home = options.home ?? homedir();
  const ratePromise = loadRates(options);
  const roots: Array<{ provider: RawUsageRecord["provider"]; path: string }> = [
    { provider: "claude", path: join(home, ".claude", "projects") },
    { provider: "codex", path: join(home, ".codex", "sessions") },
  ];
  const records: RawUsageRecord[] = [];
  const sources: ProviderUsageSource[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    const files = await listTranscriptFiles(root.path, from - MTIME_SLACK);
    if (files === undefined) {
      sources.push({ provider: root.provider, status: "missing", scannedFiles: 0, skippedFiles: 0, sessions: 0 });
      continue;
    }
    let scannedFiles = 0;
    let skippedFiles = 0;
    const sessions = new Set<string>();
    for (const file of files) {
      const parsed = await readUsageFile(file, root.provider);
      if (!parsed || parsed.length === 0) {
        skippedFiles += 1;
        continue;
      }
      scannedFiles += 1;
      for (const record of parsed) {
        if (record.at < from || record.at > to) continue;
        if (record.dedupeKey) {
          const key = `${record.provider}:${record.dedupeKey}`;
          if (seen.has(key)) continue;
          seen.add(key);
        }
        records.push(record);
        if (record.sessionId) sessions.add(record.sessionId);
      }
    }
    sources.push({
      provider: root.provider,
      status: "ok",
      scannedFiles,
      skippedFiles,
      sessions: sessions.size,
    });
  }

  sources.push({
    provider: "cursor",
    status: "unsupported",
    scannedFiles: 0,
    skippedFiles: 0,
    sessions: 0,
    message: "Cursor does not expose token usage in its local session history.",
  });

  const rates = await ratePromise;
  return {
    records: records.map((record) => {
      const price = priceRecord(record, rates.table);
      return { ...record, costUsd: price.costUsd, priced: price.priced };
    }),
    sources,
    pricing: {
      status: rates.status,
      knownModels: rates.table.size,
      ...(rates.fetchedAt ? { fetchedAt: rates.fetchedAt } : {}),
    },
    scanDurationMs: Date.now() - startedAt,
  };
}

async function listTranscriptFiles(root: string, since: number): Promise<TranscriptFile[] | undefined> {
  try {
    if (!(await stat(root)).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  const found: TranscriptFile[] = [];
  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.name.endsWith(".jsonl")) continue;
      try {
        const details = await stat(path);
        if (details.mtimeMs >= since) found.push({ path, size: details.size, mtimeMs: details.mtimeMs });
      } catch {
        // A provider can rotate a transcript while the directory is being read.
      }
    }
  };
  await walk(root);
  return found;
}

async function readUsageFile(file: TranscriptFile, provider: RawUsageRecord["provider"]): Promise<RawUsageRecord[] | undefined> {
  const cached = fileCache.get(file.path);
  if (cached && cached.size === file.size && cached.mtimeMs === file.mtimeMs && cached.provider === provider) {
    return cached.records;
  }
  const records: RawUsageRecord[] = [];
  const fallbackSession = basename(file.path, ".jsonl").match(/([0-9a-f]{8}-[0-9a-f-]{27})$/i)?.[1] ?? basename(file.path, ".jsonl");
  const codex: CodexState = {
    model: "",
    sessionId: fallbackSession,
    lastUsage: "",
    sawSessionMeta: false,
    suppressingForkCopies: false,
    forkCopyAt: 0,
  };
  try {
    const lines = createInterface({ input: createReadStream(file.path, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (provider === "claude") {
        if (!line.includes('"usage"')) continue;
        const record = claudeRecord(line, fallbackSession);
        if (record) records.push(record);
      } else {
        if (!line.includes('"token_count"') && !line.includes('"turn_context"') && !line.includes('"session_meta"')) continue;
        const record = codexRecord(line, codex);
        if (record) records.push(record);
      }
    }
  } catch {
    return undefined;
  }
  fileCache.set(file.path, { size: file.size, mtimeMs: file.mtimeMs, provider, records });
  return records;
}

function claudeRecord(line: string, fallbackSession: string): RawUsageRecord | undefined {
  const record = jsonRecord(line);
  if (!record || record.type !== "assistant" || !isRecord(record.message) || !isRecord(record.message.usage)) return undefined;
  const at = timestamp(record.timestamp);
  const model = string(record.message.model);
  if (!at || !model) return undefined;
  const messageId = string(record.message.id);
  const requestId = string(record.requestId);
  const reportedCostUsd = finite(record.costUSD);
  return {
    provider: "claude",
    at,
    model,
    sessionId: string(record.sessionId) ?? fallbackSession,
    totals: {
      inputTokens: integer(record.message.usage.input_tokens),
      cachedInputTokens: integer(record.message.usage.cache_read_input_tokens),
      cacheCreationTokens: integer(record.message.usage.cache_creation_input_tokens),
      outputTokens: integer(record.message.usage.output_tokens),
      reasoningTokens: 0,
    },
    ...(reportedCostUsd !== undefined ? { reportedCostUsd } : {}),
    ...((messageId || requestId) ? { dedupeKey: `${messageId ?? ""}:${requestId ?? ""}` } : {}),
  };
}

function codexRecord(line: string, state: CodexState): RawUsageRecord | undefined {
  const record = jsonRecord(line);
  if (!record || !isRecord(record.payload)) return undefined;
  const payload = record.payload;
  if (record.type === "session_meta") {
    if (state.sawSessionMeta) return undefined;
    state.sawSessionMeta = true;
    state.sessionId = string(payload.id) ?? string(payload.session_id) ?? state.sessionId;
    const at = timestamp(record.timestamp);
    if (at && forkedCodexSession(payload)) {
      state.suppressingForkCopies = true;
      state.forkCopyAt = at;
    }
    return undefined;
  }
  if (record.type === "turn_context") {
    state.model = string(payload.model) ?? state.model;
    return undefined;
  }
  if (payload.type !== "token_count" || !isRecord(payload.info) || !isRecord(payload.info.last_token_usage)) return undefined;
  const at = timestamp(record.timestamp);
  if (!at || !state.model) return undefined;
  const signature = JSON.stringify(payload.info.last_token_usage);
  if (signature === state.lastUsage) return undefined;
  state.lastUsage = signature;
  if (state.suppressingForkCopies) {
    if (at - state.forkCopyAt < FORK_COPY_GAP) {
      state.forkCopyAt = at;
      return undefined;
    }
    state.suppressingForkCopies = false;
  }
  const usage = payload.info.last_token_usage;
  const input = integer(usage.input_tokens);
  const cached = integer(usage.cached_input_tokens);
  const cacheCreation = integer(usage.cache_write_input_tokens);
  const output = integer(usage.output_tokens);
  const totals = {
    inputTokens: Math.max(0, input - cached - cacheCreation),
    cachedInputTokens: cached,
    cacheCreationTokens: cacheCreation,
    outputTokens: output,
    reasoningTokens: Math.min(output, integer(usage.reasoning_output_tokens)),
  };
  if (usageTotal(totals) === 0) return undefined;
  return { provider: "codex", at, model: state.model, sessionId: state.sessionId, totals };
}

function forkedCodexSession(payload: Record<string, unknown>): boolean {
  if (string(payload.forked_from_id)) return true;
  if (!isRecord(payload.source) || !isRecord(payload.source.subagent) || !isRecord(payload.source.subagent.thread_spawn)) return false;
  return Boolean(string(payload.source.subagent.thread_spawn.parent_thread_id));
}

async function loadRates(options: MachineUsageOptions): Promise<RateState> {
  if (options.ratesDocument !== undefined) {
    return { table: parseRateTable(options.ratesDocument), status: "cached" };
  }
  if (rateState && rateState.fetchedAt && Date.now() - rateState.fetchedAt < RATE_TTL) return rateState;

  let disk: { fetchedAt: number; document: unknown } | undefined;
  try {
    const parsed = JSON.parse(await readFile(RATE_CACHE, "utf8"));
    if (isRecord(parsed) && typeof parsed.fetchedAt === "number" && parsed.document !== undefined) {
      disk = { fetchedAt: parsed.fetchedAt, document: parsed.document };
      if (Date.now() - disk.fetchedAt < RATE_TTL) {
        rateState = { table: parseRateTable(disk.document), status: "cached", fetchedAt: disk.fetchedAt };
        return rateState;
      }
    }
  } catch {
    // The first usage read has no rate cache yet.
  }

  if (!options.skipRateFetch) {
    try {
      const response = await fetch(RATE_URL, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        const document = await response.json();
        const table = parseRateTable(document);
        if (table.size > 0) {
          const fetchedAt = Date.now();
          rateState = { table, status: "fresh", fetchedAt };
          void writeFile(RATE_CACHE, JSON.stringify({ fetchedAt, document }), "utf8").catch(() => {});
          return rateState;
        }
      }
    } catch {
      // Tokens remain useful when pricing cannot be refreshed.
    }
  }

  if (disk) {
    rateState = { table: parseRateTable(disk.document), status: "cached", fetchedAt: disk.fetchedAt };
    return rateState;
  }
  rateState = { table: new Map(), status: "unavailable" };
  return rateState;
}

function parseRateTable(document: unknown): Map<string, ModelRate> {
  const table = new Map<string, ModelRate>();
  if (!isRecord(document)) return table;
  for (const [name, raw] of Object.entries(document)) {
    if (!isRecord(raw)) continue;
    const input = finite(raw.input_cost_per_token);
    const output = finite(raw.output_cost_per_token);
    if (input === undefined || output === undefined) continue;
    table.set(normalizeModel(name), {
      input,
      output,
      cachedInput: finite(raw.cache_read_input_token_cost) ?? input,
      cacheCreation: finite(raw.cache_creation_input_token_cost) ?? input,
    });
  }
  return table;
}

function priceRecord(record: RawUsageRecord, rates: Map<string, ModelRate>): { costUsd: number; priced: boolean } {
  if (record.reportedCostUsd !== undefined) return { costUsd: record.reportedCostUsd, priced: true };
  const rate = rates.get(normalizeModel(record.model));
  if (!rate) return { costUsd: 0, priced: false };
  return {
    costUsd:
      record.totals.inputTokens * rate.input
      + record.totals.cachedInputTokens * rate.cachedInput
      + record.totals.cacheCreationTokens * rate.cacheCreation
      + record.totals.outputTokens * rate.output,
    priced: true,
  };
}

function normalizeModel(model: string): string {
  const value = model.trim().toLowerCase();
  return value.slice(value.lastIndexOf("/") + 1);
}

function jsonRecord(line: string): Record<string, any> | undefined {
  try {
    const value = JSON.parse(line);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function integer(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function timestamp(value: unknown): number {
  if (typeof value !== "string") return 0;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : 0;
}

function usageTotal(value: ProviderUsageTotals): number {
  return value.inputTokens + value.cachedInputTokens + value.cacheCreationTokens + value.outputTokens;
}
