import { closeSync, existsSync, openSync, readFileSync, readdirSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "./agent.js";
import type { PendingMessage } from "./registry.js";
import { takeArtifacts, type ConvArtifact } from "./remy-artifacts.js";

export type { ConvArtifact };

export interface ChatImageAttachment {
  /// Opaque id minted by the device that owns the thread. A client never sends
  /// a filesystem path, because the browser may be on another machine.
  id: string;
  name: string;
  mimeType: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
}

// A single rendered item in the conversation feed. `kind` picks the renderer on
// the client; the other fields are populated per kind.
export interface ConvEntry {
  id: string;
  kind: "user" | "assistant" | "thinking" | "tool";
  /// When Remy first saw this item. Older entries may not carry timing data.
  at?: number;
  /// When a streamed message or tool finished.
  completedAt?: number;
  text?: string;
  tool?: string;
  verb?: string;
  arg?: string;
  status?: "ok" | "error" | "stopped";
  output?: string;
  file?: string;
  skill?: string;
  diff?: ConvDiffLine[];
  adds?: number;
  dels?: number;
  questions?: ConvQuestion[];
  /// What a Remy tool made on this call — a ticket, a thread, a workspace —
  /// shown as a card under the tool row rather than left in its output.
  artifacts?: ConvArtifact[];
  /// Images sent with a user message, retained so every client renders the
  /// same inline references after a refresh.
  attachments?: ChatImageAttachment[];
}

/// Records a tool's result on its feed entry, lifting out anything a Remy tool
/// said it made. Every provider's transcript goes through here, so a card looks
/// the same whichever one wrote it.
export function applyToolOutput(entry: ConvEntry, output: string, max: number): void {
  const { text, artifacts } = takeArtifacts(output);
  if (artifacts.length) entry.artifacts = artifacts;
  if (text) entry.output = clip(text, max);
}

export interface ConvDiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
}

// One AskUserQuestion prompt. `answer` holds a free-text ("Other") response that
// matched no listed option; a chosen option is marked via its `selected` flag.
export interface ConvQuestion {
  header?: string;
  question: string;
  multiSelect?: boolean;
  options: ConvQuestionOption[];
  answer?: string;
  // Free-text the user attached to their pick, alongside choosing an option.
  notes?: string;
}

export interface ConvQuestionOption {
  label: string;
  description?: string;
  // The option's worked example — often a draft of the thing being decided, and
  // so the only part that actually settles the question. Dropping it left the
  // card showing three labels and none of the substance.
  preview?: string;
  selected?: boolean;
}

export interface ConvTodo {
  content: string;
  status: string; // pending | in_progress | completed
}

export interface Conversation {
  available: boolean;
  agent?: AgentKind;
  title?: string;
  model?: string;
  todos: ConvTodo[];
  entries: ConvEntry[];
  // The session's live hook state, merged in by the endpoint so the feed can show
  // a "working" indicator. `action` is the current step label (e.g. "Reading x").
  state?: string; // working | needs_input | idle | unknown
  action?: string;
  context?: ContextUsage;
  // Prompts queued behind the current turn, merged in by the endpoint. Not in
  // the transcript — Claude Code's queue never reaches disk — so these come
  // from what the server itself sent.
  pending?: PendingMessage[];
  info?: SessionInfo;
  // The pane as it stands, attached only when the session is waiting on you and
  // the transcript has nothing to show for it. Claude Code's question dialogs
  // are interactive UI: the assistant record carrying an AskUserQuestion isn't
  // written until the question is answered, so while it's open there is nothing
  // on disk to parse. The terminal is the source of truth in this app, so fall
  // back to it rather than leaving the feed looking idle mid-question.
  prompt?: string;
  // The same pane, parsed into a question when it reads like a choice — so the
  // client can render its normal card, with the highlighted option marked.
  promptQuestion?: ConvQuestion;
  // A live AskUserQuestion intercepted by the blocking PreToolUse hook. Unlike
  // `promptQuestion`, this is the provider's exact structured input and carries
  // the request id needed to answer without driving the terminal cursor.
  activeQuestion?: {
    requestId: string;
    questions: ConvQuestion[];
  };
}

/// How the session is configured, recorded by Claude Code on its own records as
/// it goes. This is most of what `/status` and `/model` would print, except read
/// straight from the transcript rather than by sending a command whose output
/// only ever renders inside the TUI.
export interface SessionInfo {
  model?: string;
  effort?: string; // reasoning effort: low | medium | high | xhigh | max
  permissionMode?: string; // auto | plan | acceptEdits | bypassPermissions | …
  mode?: string;
  version?: string; // the Claude Code build running this session
  gitBranch?: string;
  slug?: string; // Claude Code's own generated name for the session
}

// How full the session's context window is, and how much history it has already
// burned through. Read from the token accounting Claude Code records on every
// assistant message — the only place this exists, since nothing reports it live.
export interface ContextUsage {
  tokens: number; // context size of the most recent request
  peakTokens?: number; // largest live context report retained for this session
  limit: number;
  // True when `limit` is a guess rather than a number this session proved (by
  // auto-compacting) or the operator declared. The client says so.
  limitEstimated: boolean;
  model?: string;
  compactions: number;
  droppedTokens: number; // history discarded by compaction, cumulative
}

/// One provider transcript reduced to the facts Analytics needs. The result is
/// cached by path and size below, so opening Settings again only stats files
/// whose provider has written more data since the last read.
export interface TranscriptAnalytics {
  usage: TranscriptUsageSample[];
  tools: TranscriptToolCall[];
  cost: Array<{ at: number; costUsd: number }>;
}

export interface TranscriptUsageSample {
  at: number;
  model?: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface TranscriptToolCall {
  at: number;
  tool: string;
  skill?: string;
}

// Transcripts grow without bound (tens of MB for long sessions), so we only ever
// read a window from the end. Recent turns — the only thing the feed shows — live
// there, and tool_use/tool_result pairs are adjacent so pairing survives the cut.
const MAX_TAIL = 1_500_000;
// The context meter only needs the newest token accounting, so it reads a much
// smaller window than the feed does — it runs for every session on the fleet
// poll, not just the one on screen.
const USAGE_TAIL = 400_000;
export const MAX_TEXT = 4000;
export const MAX_THINK = 1200;
export const MAX_ARG = 200;
export const MAX_OUTPUT = 400;
// Option previews are code or prose drafts, so they need real room — but they're
// rendered collapsed, so this is a ceiling rather than a target.
const MAX_PREVIEW = 2500;
const MAX_DIFF_SIDE = 30;

const UNAVAILABLE: Conversation = { available: false, todos: [], entries: [] };

// The registry stores the exact transcript path a hook reported. When it hasn't
// (older entries, sessions that predate the hook), reconstruct Claude Code's
// own path scheme from the cwd + session id as a best-effort fallback.
export function resolveTranscriptPath(cwd?: string, sessionId?: string): string | undefined {
  if (!cwd || !sessionId) return undefined;
  const encoded = cwd.replace(/[/.]/g, "-");
  const path = join(homedir(), ".claude", "projects", encoded, `${sessionId}.jsonl`);
  return existsSync(path) ? path : undefined;
}

export function discoverClaudeTranscript(cwd?: string): { path: string; sessionId: string } | undefined {
  if (!cwd) return undefined;
  const encoded = cwd.replace(/[/.]/g, "-");
  const directory = join(homedir(), ".claude", "projects", encoded);
  try {
    const latest = readdirSync(directory)
      .filter((file) => file.endsWith(".jsonl"))
      .map((file) => {
        const path = join(directory, file);
        return { path, file, modifiedAt: statSync(path).mtimeMs };
      })
      .sort((a, b) => b.modifiedAt - a.modifiedAt)[0];
    if (!latest) return undefined;
    return { path: latest.path, sessionId: latest.file.slice(0, -".jsonl".length) };
  } catch {
    return undefined;
  }
}

let codexTranscriptIndex = new Map<string, string>();
let codexTranscriptIndexedAt = 0;
const CODEX_TRANSCRIPT_INDEX_TTL = 30_000;

/// Finds the rollout Codex writes for a thread without opening every rollout.
/// Its filenames end in the thread id, so a directory-name index is enough.
export function resolveCodexTranscriptPath(threadId?: string): string | undefined {
  if (!threadId) return undefined;
  if (Date.now() - codexTranscriptIndexedAt > CODEX_TRANSCRIPT_INDEX_TTL || !codexTranscriptIndex.has(threadId)) {
    const next = new Map<string, string>();
    for (const root of [join(homedir(), ".codex", "sessions"), join(homedir(), ".codex", "archived_sessions")]) {
      try {
        const files = readdirSync(root, { recursive: true, encoding: "utf8" });
        for (const relative of files) {
          if (!relative.endsWith(".jsonl")) continue;
          const match = relative.match(/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i);
          if (match?.[1]) next.set(match[1], join(root, relative));
        }
      } catch {
        // Codex has not run here yet.
      }
    }
    codexTranscriptIndex = next;
    codexTranscriptIndexedAt = Date.now();
  }
  return codexTranscriptIndex.get(threadId);
}

export function readConversation(path: string | undefined, limit = 120): Conversation {
  if (!path || !existsSync(path)) return UNAVAILABLE;

  const lines = tailLines(path);
  if (isCodexTranscript(path, lines)) return readCodexConversation(lines, limit);
  const entries: ConvEntry[] = [];
  const toolIndexById = new Map<string, number>();
  let todos: ConvTodo[] = [];
  let title: string | undefined;
  let model: string | undefined;
  const info: SessionInfo = {};
  let seq = 0;

  for (const o of lines) {
    // Configuration records ride alongside the conversation, and every record
    // carries the build/branch it was written under. Latest wins throughout —
    // these can change mid-session (a /model switch, a branch checkout).
    if (typeof o?.version === "string") info.version = o.version;
    if (typeof o?.gitBranch === "string" && o.gitBranch) info.gitBranch = o.gitBranch;
    if (typeof o?.slug === "string" && o.slug) info.slug = o.slug;
    if (o?.type === "mode" && typeof o.mode === "string") {
      info.mode = o.mode;
      continue;
    }
    if (o?.type === "permission-mode" && typeof o.permissionMode === "string") {
      info.permissionMode = o.permissionMode;
      continue;
    }

    if (o?.type === "ai-title") {
      if (typeof o.aiTitle === "string" && o.aiTitle.trim()) title = o.aiTitle.trim();
      continue;
    }

    if (o?.type === "assistant") {
      const msg = o.message;
      if (typeof msg?.model === "string") model = msg.model;
      if (typeof o.effort === "string") info.effort = o.effort;
      const content = Array.isArray(msg?.content) ? msg.content : [];
      for (const b of content) {
        if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) {
          entries.push({ id: `e${seq++}`, kind: "assistant", text: clip(b.text, MAX_TEXT) });
        } else if (b?.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim()) {
          entries.push({ id: `e${seq++}`, kind: "thinking", text: clip(b.thinking, MAX_THINK) });
        } else if (b?.type === "tool_use") {
          if (b.name === "TodoWrite") {
            const parsed = extractTodos(b.input);
            if (parsed.length) todos = parsed; // latest plan wins
            continue;
          }
          const desc = describeTool(b.name, b.input);
          const entry: ConvEntry = { id: `e${seq++}`, kind: "tool", tool: b.name, verb: desc.verb, arg: desc.arg };
          if (desc.file) entry.file = desc.file;
          if (desc.skill) entry.skill = desc.skill;
          const diff = buildDiff(b.name, b.input);
          if (diff.length) entry.diff = diff;
          const counts = countDiff(b.name, b.input);
          if (counts.adds || counts.dels) {
            entry.adds = counts.adds;
            entry.dels = counts.dels;
          }
          if (b.name === "AskUserQuestion") {
            const questions = buildQuestions(b.input);
            if (questions.length) entry.questions = questions;
          }
          if (typeof b.id === "string") toolIndexById.set(b.id, entries.length);
          entries.push(entry);
        }
      }
      continue;
    }

    if (o?.type === "user") {
      const content = o.message?.content;
      // A tool_result is Claude's own turn reporting an output — attach it to the
      // originating tool chip rather than showing it as a user message.
      if (Array.isArray(content)) {
        const tr = content.find((c: any) => c?.type === "tool_result");
        if (tr) {
          const idx = toolIndexById.get(tr.tool_use_id);
          if (idx != null && entries[idx]) {
            const entry = entries[idx];
            entry.status = tr.is_error ? "error" : "ok";
            if (entry.questions) {
              // The answers are rendered inline on the chips, so skip the
              // redundant "Your questions have been answered: …" text output.
              const result = o.toolUseResult as any;
              applyAnswers(entry.questions, result?.answers);
              applyNotes(entry.questions, result?.annotations);
            } else {
              const out = resultText(tr.content) ?? resultText(o.toolUseResult);
              if (out) applyToolOutput(entry, out, MAX_OUTPUT);
            }
          }
          continue;
        }
      }
      if (o.isMeta) continue;
      const isHuman = o.origin?.kind === "human" || o.promptSource === "typed";
      const text = userText(content);
      if (isHuman && text && text.trim()) {
        entries.push({ id: `e${seq++}`, kind: "user", text: clip(text, MAX_TEXT) });
      }
    }
  }

  if (model) info.model = model;
  return { available: true, title, model, todos, entries: entries.slice(-limit), info };
}

function readCodexConversation(lines: any[], limit: number): Conversation {
  const entries: ConvEntry[] = [];
  const toolIndexById = new Map<string, number>();
  const info: SessionInfo = {};
  let todos: ConvTodo[] = [];
  let title: string | undefined;
  let model: string | undefined;
  let seq = 0;

  for (const record of lines) {
    const payload = record?.payload;
    if (record?.type === "session_meta") {
      if (typeof payload?.cli_version === "string") info.version = payload.cli_version;
      if (typeof payload?.git?.branch === "string") info.gitBranch = payload.git.branch;
      continue;
    }
    if (record?.type === "turn_context") {
      if (typeof payload?.model === "string") model = payload.model;
      if (typeof payload?.effort === "string") info.effort = payload.effort;
      if (typeof payload?.approval_policy === "string") info.permissionMode = payload.approval_policy;
      const mode = payload?.collaboration_mode;
      if (typeof mode === "string") info.mode = mode;
      else if (typeof mode?.mode === "string") info.mode = mode.mode;
      continue;
    }
    if (record?.type === "event_msg") {
      if (payload?.type === "user_message" && typeof payload.message === "string" && payload.message.trim()) {
        const text = clip(payload.message, MAX_TEXT);
        if (!title) title = clip(text.split("\n")[0], 80);
        entries.push({ id: `e${seq++}`, kind: "user", text });
      } else if (payload?.type === "agent_message" && typeof payload.message === "string" && payload.message.trim()) {
        entries.push({ id: `e${seq++}`, kind: "assistant", text: clip(payload.message, MAX_TEXT) });
      }
      continue;
    }
    if (record?.type !== "response_item") continue;

    if (payload?.type === "reasoning" && Array.isArray(payload.summary)) {
      const text = payload.summary
        .map((item: any) => str(item?.text))
        .filter(Boolean)
        .join("\n");
      if (text) entries.push({ id: `e${seq++}`, kind: "thinking", text: clip(text, MAX_THINK) });
      continue;
    }

    if (payload?.type === "function_call" || payload?.type === "custom_tool_call") {
      const input = codexToolInput(payload);
      const name = str(payload.name) ?? "tool";
      if (name === "update_plan") {
        const parsed = extractTodos(input);
        if (parsed.length) todos = parsed;
        continue;
      }
      const desc = describeTool(name, input);
      const entry: ConvEntry = {
        id: `e${seq++}`,
        kind: "tool",
        tool: name,
        verb: desc.verb,
        arg: desc.arg,
      };
      if (desc.file) entry.file = desc.file;
      if (desc.skill) entry.skill = desc.skill;
      const callId = str(payload.call_id);
      if (callId) toolIndexById.set(callId, entries.length);
      entries.push(entry);
      continue;
    }

    if (payload?.type === "function_call_output" || payload?.type === "custom_tool_call_output") {
      const callId = str(payload.call_id);
      const index = callId ? toolIndexById.get(callId) : undefined;
      if (index == null || !entries[index]) continue;
      const entry = entries[index];
      entry.status = "ok";
      const output = resultText(payload.output) ?? codexOutputText(payload.output);
      if (output) applyToolOutput(entry, output, MAX_OUTPUT);
    }
  }

  if (model) info.model = model;
  return {
    available: true,
    agent: "codex",
    title,
    model,
    todos,
    entries: entries.slice(-limit),
    info,
  };
}

// Keyed by path + size: a transcript only ever grows, so an unchanged size means
// an unchanged answer. That keeps the fleet poll to one stat() per idle session
// instead of a read, however many clients are watching.
const usageCache = new Map<string, ContextUsage>();
const USAGE_CACHE_MAX = 200;
const analyticsCache = new Map<string, TranscriptAnalytics>();
const ANALYTICS_CACHE_MAX = 300;

export function readContextUsage(path: string | undefined, declaredContextLimit = 200_000): ContextUsage | undefined {
  if (!path || !existsSync(path)) return undefined;
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return undefined;
  }
  const key = `${path}:${size}`;
  const hit = usageCache.get(key);
  if (hit) return hit;

  let tokens = 0;
  let peak = 0;
  let model: string | undefined;
  let compactions = 0;
  let droppedTokens = 0;
  let codexLimit = 0;
  const codex = isCodexTranscript(path);
  // Where this session actually compacts. An automatic compaction is the window
  // announcing itself, so it beats every guess below.
  let autoCompactAt = 0;

  for (const o of tailLines(path, USAGE_TAIL)) {
    if (codex) {
      if (o?.type === "turn_context" && typeof o.payload?.model === "string") model = o.payload.model;
      if (o?.type === "event_msg" && o.payload?.type === "token_count") {
        const used = num(o.payload?.info?.last_token_usage?.total_tokens);
        if (used > 0) tokens = used;
        codexLimit = Math.max(codexLimit, num(o.payload?.info?.model_context_window));
      }
      if (o?.type === "event_msg" && o.payload?.type === "context_compacted") compactions += 1;
      continue;
    }
    if (o?.type === "assistant") {
      const usage = o.message?.usage;
      if (!usage) continue;
      const used =
        num(usage.input_tokens) + num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens);
      if (used > 0) {
        tokens = used; // last one wins — the newest request's context
        if (used > peak) peak = used;
      }
      if (typeof o.message?.model === "string") model = o.message.model;
      continue;
    }
    if (o?.type === "system" && o.subtype === "compact_boundary") {
      compactions += 1;
      const meta = o.compactMetadata;
      if (meta && typeof meta === "object") {
        droppedTokens = Math.max(droppedTokens, num(meta.cumulativeDroppedTokens));
        if (meta.trigger === "auto") autoCompactAt = Math.max(autoCompactAt, num(meta.preTokens));
      }
    }
  }

  if (tokens === 0) return undefined; // a transcript with no completed request yet

  if (codex) {
    const usage: ContextUsage = {
      tokens,
      limit: codexLimit || declaredContextLimit,
      limitEstimated: codexLimit === 0,
      model,
      compactions,
      droppedTokens: 0,
    };
    if (usageCache.size >= USAGE_CACHE_MAX) usageCache.clear();
    usageCache.set(key, usage);
    return usage;
  }

  // Fall back through: proved > declared > inferred from what we've seen fit.
  const declared = declaredContextLimit;
  const inferred = peak > declared ? 1_000_000 : declared;
  const usage: ContextUsage = {
    tokens,
    limit: autoCompactAt > 0 ? autoCompactAt : inferred,
    limitEstimated: autoCompactAt === 0,
    model,
    compactions,
    droppedTokens,
  };
  if (usageCache.size >= USAGE_CACHE_MAX) usageCache.clear();
  usageCache.set(key, usage);
  return usage;
}

/// Reads cumulative usage and invocation history from one provider transcript.
///
/// This intentionally does not aggregate across threads. A transcript is the
/// unit whose size tells us whether anything changed; `analytics.ts` combines
/// these already-reduced answers without reopening an unchanged file.
export function readTranscriptAnalytics(path: string | undefined): TranscriptAnalytics | undefined {
  if (!path || !existsSync(path)) return undefined;
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return undefined;
  }
  const key = `${path}:${size}`;
  const hit = analyticsCache.get(key);
  if (hit) return hit;

  const usage: TranscriptUsageSample[] = [];
  const tools: TranscriptToolCall[] = [];
  const cost: Array<{ at: number; costUsd: number }> = [];
  let codexModel: string | undefined;

  for (const record of allLines(path)) {
    const at = timestamp(record?.timestamp);
    if (record?.type === "turn_context" && typeof record.payload?.model === "string") {
      codexModel = record.payload.model;
      continue;
    }

    if (record?.type === "event_msg" && record.payload?.type === "token_count") {
      const tokens = record.payload?.info?.last_token_usage;
      if (!tokens) continue;
      const input = num(tokens.input_tokens);
      const cached = Math.min(input, num(tokens.cached_input_tokens));
      usage.push({
        at,
        ...(codexModel ? { model: codexModel } : {}),
        inputTokens: Math.max(0, input - cached),
        cachedInputTokens: cached,
        cacheCreationTokens: num(tokens.cache_write_input_tokens),
        outputTokens: num(tokens.output_tokens),
        reasoningTokens: num(tokens.reasoning_output_tokens),
      });
      continue;
    }

    if (record?.type === "response_item") {
      const payload = record.payload;
      if (payload?.type !== "function_call" && payload?.type !== "custom_tool_call") continue;
      const tool = str(payload.name) ?? "tool";
      const described = describeTool(tool, codexToolInput(payload));
      tools.push({ at, tool, ...(described.skill ? { skill: described.skill } : {}) });
      continue;
    }

    if (record?.type === "assistant") {
      const message = record.message;
      const tokens = message?.usage;
      if (tokens) {
        usage.push({
          at,
          ...(typeof message?.model === "string" ? { model: message.model } : {}),
          inputTokens: num(tokens.input_tokens),
          cachedInputTokens: num(tokens.cache_read_input_tokens),
          cacheCreationTokens: num(tokens.cache_creation_input_tokens),
          outputTokens: num(tokens.output_tokens),
          reasoningTokens: 0,
        });
      }
      for (const block of Array.isArray(message?.content) ? message.content : []) {
        if (block?.type !== "tool_use") continue;
        const tool = str(block.name) ?? "tool";
        const described = describeTool(tool, block.input);
        tools.push({ at, tool, ...(described.skill ? { skill: described.skill } : {}) });
      }
      continue;
    }

    if (record?.type === "result") {
      const costUsd = num(record.total_cost_usd);
      if (costUsd > 0) cost.push({ at, costUsd });
    }
  }

  const answer = { usage, tools, cost };
  if (analyticsCache.size >= ANALYTICS_CACHE_MAX) analyticsCache.clear();
  analyticsCache.set(key, answer);
  return answer;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function timestamp(value: unknown): number {
  if (typeof value !== "string") return 0;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : 0;
}

function allLines(path: string): any[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: any[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A provider may still be writing the final line.
    }
  }
  return out;
}

function tailLines(path: string, maxBytes = MAX_TAIL): any[] {
  const size = statSync(path).size;
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  const fd = openSync(path, "r");
  let text: string;
  try {
    const buf = Buffer.allocUnsafe(length);
    readSync(fd, buf, 0, length, start);
    text = buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
  // Drop the partial first line when we didn't start at the file head.
  if (start > 0) {
    const nl = text.indexOf("\n");
    text = nl >= 0 ? text.slice(nl + 1) : "";
  }
  const out: any[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // partial/corrupt line — skip
    }
  }
  return out;
}

function isCodexTranscript(path: string, lines: any[] = []): boolean {
  return path.includes("/.codex/sessions/")
    || lines.some((record) => record?.type === "session_meta" && record?.payload?.model_provider);
}

function codexToolInput(payload: any): Record<string, unknown> {
  if (payload?.type === "function_call" && typeof payload.arguments === "string") {
    try {
      const parsed = JSON.parse(payload.arguments);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      return { input: payload.arguments };
    }
  }
  if (payload?.input && typeof payload.input === "object" && !Array.isArray(payload.input)) {
    return payload.input as Record<string, unknown>;
  }
  return typeof payload?.input === "string" ? { input: payload.input } : {};
}

function codexOutputText(output: unknown): string | undefined {
  if (!Array.isArray(output)) return undefined;
  const parts = output.map((item: any) =>
    str(item?.text) ?? str(item?.content) ?? str(item?.output),
  ).filter(Boolean);
  return parts.length ? parts.join("\n") : undefined;
}

export function describeTool(name: unknown, input: any): { verb: string; arg: string; file?: string; skill?: string } {
  const n = typeof name === "string" ? name : "tool";
  const inp = input && typeof input === "object" ? input : {};
  switch (n) {
    case "Read":
      return { verb: "Read", arg: base(inp.file_path), file: str(inp.file_path) };
    case "Edit":
    case "MultiEdit":
      return { verb: "Edited", arg: base(inp.file_path), file: str(inp.file_path) };
    case "Write":
      return { verb: "Wrote", arg: base(inp.file_path), file: str(inp.file_path) };
    case "NotebookEdit":
      return { verb: "Edited", arg: base(inp.notebook_path), file: str(inp.notebook_path) };
    case "Bash":
    case "exec":
    case "exec_command":
      return { verb: "Ran", arg: clip(str(inp.command) ?? str(inp.description) ?? "", MAX_ARG) };
    case "Grep":
      return { verb: "Searched", arg: clip(str(inp.pattern) ?? "", MAX_ARG) };
    case "Glob":
      return { verb: "Globbed", arg: clip(str(inp.pattern) ?? "", MAX_ARG) };
    case "LS":
      return { verb: "Listed", arg: base(inp.path) };
    case "Task":
    case "Agent":
    case "spawn_agent":
      return { verb: "Delegated", arg: clip(str(inp.description) ?? str(inp.subagent_type) ?? "", MAX_ARG) };
    case "Skill":
      return { verb: "Skill", arg: clip(str(inp.skill) ?? "", MAX_ARG), skill: str(inp.skill) };
    case "WebFetch":
      return { verb: "Fetched", arg: clip(str(inp.url) ?? "", MAX_ARG) };
    case "WebSearch":
      return { verb: "Searched web", arg: clip(str(inp.query) ?? "", MAX_ARG) };
    case "AskUserQuestion": {
      const qs = Array.isArray(inp.questions) ? inp.questions : [];
      const first = str(qs[0]?.header) ?? str(qs[0]?.question) ?? "";
      const arg = qs.length > 1 ? `${qs.length} questions` : first;
      return { verb: "Asked", arg: clip(arg, MAX_ARG) };
    }
    default:
      return { verb: n, arg: clip(firstString(inp), MAX_ARG) };
  }
}

export function buildDiff(name: unknown, input: any): ConvDiffLine[] {
  const inp = input && typeof input === "object" ? input : {};
  if (name === "Edit") return pairDiff(str(inp.old_string), str(inp.new_string));
  if (name === "MultiEdit" && Array.isArray(inp.edits)) {
    const out: ConvDiffLine[] = [];
    for (const e of inp.edits) {
      for (const l of pairDiff(str(e?.old_string), str(e?.new_string))) out.push(l);
      if (out.length > MAX_DIFF_SIDE * 2) break;
    }
    return out.slice(0, MAX_DIFF_SIDE * 2);
  }
  if (name === "Write" && typeof inp.content === "string") {
    return sideLines(inp.content, "add");
  }
  return [];
}

// Accurate (uncapped) added/removed line counts for the Changes inspector,
// counted the same naive way the diff is built: every old line is a deletion,
// every new line an addition.
export function countDiff(name: unknown, input: any): { adds: number; dels: number } {
  const inp = input && typeof input === "object" ? input : {};
  if (name === "Edit") return { dels: lineCount(str(inp.old_string)), adds: lineCount(str(inp.new_string)) };
  if (name === "MultiEdit" && Array.isArray(inp.edits)) {
    let adds = 0;
    let dels = 0;
    for (const e of inp.edits) {
      dels += lineCount(str(e?.old_string));
      adds += lineCount(str(e?.new_string));
    }
    return { adds, dels };
  }
  if (name === "Write" && typeof inp.content === "string") return { adds: lineCount(inp.content), dels: 0 };
  return { adds: 0, dels: 0 };
}

function lineCount(text?: string): number {
  return text ? text.split("\n").length : 0;
}

function pairDiff(oldStr?: string, newStr?: string): ConvDiffLine[] {
  return [...sideLines(oldStr ?? "", "del"), ...sideLines(newStr ?? "", "add")];
}

function sideLines(text: string, kind: "add" | "del"): ConvDiffLine[] {
  if (!text) return [];
  const lines = text.split("\n");
  const shown: ConvDiffLine[] = lines.slice(0, MAX_DIFF_SIDE).map((text) => ({ kind, text }));
  if (lines.length > MAX_DIFF_SIDE) {
    shown.push({ kind: "ctx", text: `… ${lines.length - MAX_DIFF_SIDE} more lines` });
  }
  return shown;
}

export function buildQuestions(input: any): ConvQuestion[] {
  const qs = input && Array.isArray(input.questions) ? input.questions : [];
  const out: ConvQuestion[] = [];
  for (const q of qs) {
    const question = str(q?.question);
    if (!question) continue;
    const options: ConvQuestionOption[] = [];
    if (Array.isArray(q.options)) {
      for (const opt of q.options) {
        const label = str(opt?.label);
        if (!label) continue;
        const o: ConvQuestionOption = { label: clip(label, MAX_ARG) };
        const description = str(opt?.description);
        if (description) o.description = clip(description, MAX_TEXT);
        const preview = str(opt?.preview);
        if (preview) o.preview = clip(preview, MAX_PREVIEW);
        options.push(o);
      }
    }
    const entry: ConvQuestion = { question: clip(question, MAX_TEXT), options };
    const header = str(q.header);
    if (header) entry.header = header;
    if (q.multiSelect === true) entry.multiSelect = true;
    out.push(entry);
  }
  return out;
}

// Mark the option(s) the user picked from `toolUseResult.answers` (question text
// → chosen label, or an array for multiSelect). A pick that matches no listed
// option is an "Other" free-text response, kept on `answer`.
export function applyAnswers(questions: ConvQuestion[], answers: unknown): void {
  if (!answers || typeof answers !== "object") return;
  const map = answers as Record<string, unknown>;
  const byTrimmed = new Map<string, unknown>();
  for (const [k, v] of Object.entries(map)) byTrimmed.set(k.trim(), v);
  for (const q of questions) {
    const raw = q.question in map ? map[q.question] : byTrimmed.get(q.question.trim());
    if (raw == null) continue;
    const picks = (Array.isArray(raw) ? raw : [raw]).map((p) => String(p)).filter((p) => p.length > 0);
    const free: string[] = [];
    for (const pick of picks) {
      const opt = q.options.find((o) => o.label === pick || o.label === pick.trim());
      if (opt) opt.selected = true;
      else free.push(pick);
    }
    if (free.length) q.answer = clip(free.join(", "), MAX_TEXT);
  }
}

// Notes the user typed alongside their pick, keyed by question text the same way
// answers are. Defensive about the shape — this rides on an optional field.
export function applyNotes(questions: ConvQuestion[], annotations: unknown): void {
  if (!annotations || typeof annotations !== "object") return;
  const map = annotations as Record<string, any>;
  const byTrimmed = new Map<string, any>();
  for (const [k, v] of Object.entries(map)) byTrimmed.set(k.trim(), v);
  for (const q of questions) {
    const entry = q.question in map ? map[q.question] : byTrimmed.get(q.question.trim());
    const notes = str(entry?.notes);
    if (notes) q.notes = clip(notes, MAX_TEXT);
  }
}

export function extractTodos(input: any): ConvTodo[] {
  const todos = input && Array.isArray(input.todos)
    ? input.todos
    : input && Array.isArray(input.plan)
      ? input.plan
      : [];
  return todos
    .map((t: any) => ({
      content: str(t?.content) ?? str(t?.activeForm) ?? str(t?.step) ?? "",
      status: str(t?.status) ?? "pending",
    }))
    .filter((t: ConvTodo) => t.content.length > 0);
}

function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c?.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text)
      .join("\n");
  }
  return "";
}

export function resultText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const joined = content
      .filter((c: any) => c?.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text)
      .join("\n");
    return joined || undefined;
  }
  if (content && typeof content === "object") {
    const obj = content as Record<string, unknown>;
    return str(obj.stdout) ?? str(obj.output) ?? undefined;
  }
  return undefined;
}

function firstString(obj: Record<string, unknown>): string {
  for (const v of Object.values(obj)) if (typeof v === "string" && v.trim()) return v;
  return "";
}

function base(path: unknown): string {
  const s = str(path);
  if (!s) return "";
  const parts = s.split("/");
  return parts[parts.length - 1] || s;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}
