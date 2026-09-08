import {
  createSdkMcpServer,
  query,
  tool,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  applyAnswers,
  applyNotes,
  applyToolOutput,
  buildDiff,
  buildQuestions,
  clip,
  countDiff,
  describeTool,
  extractTodos,
  resultText,
  MAX_OUTPUT,
  MAX_TEXT,
  MAX_THINK,
  type ConvEntry,
} from "../transcript.js";
import { ThreadActivityTracker } from "./activity.js";
import { discoverClaudeModels } from "./discovery.js";
import type {
  ProviderAdapter,
  ProviderApprovalDecision,
  ProviderAnswerOptions,
  ProviderHandlers,
  ProviderRun,
  ProviderSession,
  ProviderSessionOptions,
  ProviderTurn,
} from "./types.js";

export { createSdkMcpServer, query as runClaudeQuery, tool };
export type { Options as ClaudeOptions, Query as ClaudeQuery, SDKMessage as ClaudeMessage };

type QueryFactory = typeof query;

class PromptQueue implements AsyncIterable<SDKUserMessage> {
  private queued: SDKUserMessage[] = [];
  private waiting: ((result: IteratorResult<SDKUserMessage>) => void)[] = [];
  private closed = false;

  push(message: SDKUserMessage): void {
    if (this.closed) return;
    const waiter = this.waiting.shift();
    if (waiter) waiter({ value: message, done: false });
    else this.queued.push(message);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiting.splice(0)) waiter({ value: undefined as never, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => new Promise((resolve) => {
        const message = this.queued.shift();
        if (message) resolve({ value: message, done: false });
        else if (this.closed) resolve({ value: undefined as never, done: true });
        else this.waiting.push(resolve);
      }),
      return: async () => {
        this.close();
        return { value: undefined as never, done: true };
      },
    };
  }
}

class ClaudeAdapterSession implements ProviderSession {
  private readonly queue = new PromptQueue();
  private readonly query: Query;
  private readonly activity: ThreadActivityTracker;
  private readonly entries = new Map<string, ConvEntry>();
  private readonly byToolUseId = new Map<string, ConvEntry>();
  private readonly openBlocks = new Map<string, ConvEntry>();
  private readonly streamedMessages = new Set<string>();
  private currentMessageId?: string;
  private passiveTurn = false;
  private active?: {
    interrupted: boolean;
    resolve(): void;
    reject(error: Error): void;
  };
  private closed = false;

  constructor(options: ProviderSessionOptions, private readonly handlers: ProviderHandlers, queryFactory: QueryFactory) {
    for (const entry of options.entries ?? []) this.entries.set(entry.id, entry);
    this.activity = new ThreadActivityTracker(options.entries ?? [], (entry) => this.emitEntry(entry));
    this.activity.disconnected();
    const sdkOptions: Options = {
      cwd: options.cwd,
      pathToClaudeCodeExecutable: options.command,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: options.developerInstructions ?? "",
      },
      settingSources: ["user", "project", "local"],
      permissionMode: claudePermissionMode(options.permissionMode),
      ...(options.permissionMode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.effort ? { effort: options.effort as NonNullable<Options["effort"]> } : {}),
      ...(options.sessionId ? { resume: options.sessionId } : {}),
      includePartialMessages: true,
      ...(options.inProcessMcp ? { mcpServers: { remy: options.inProcessMcp as NonNullable<Options["mcpServers"]>[string] } } : {}),
      canUseTool: (name, input, callback) => this.permission(name, input, callback),
      ...(options.env ? { env: options.env } : {}),
      ...(options.additionalDirectories ? { additionalDirectories: options.additionalDirectories } : {}),
      stderr: (data) => {
        const message = data.trim();
        if (message) console.error(`Claude SDK: ${message}`);
      },
    };
    this.query = queryFactory({ prompt: this.queue, options: sdkOptions });
    void this.pump();
  }

  turn(input: ProviderTurn): ProviderRun {
    if (this.active) throw new Error("Claude is already running a turn.");
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const done = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const active = { interrupted: false, resolve, reject };
    this.active = active;
    this.handlers.event({ type: "turn.started" });
    this.queue.push(userMessage(input));
    return {
      done,
      interrupt: () => {
        active.interrupted = true;
        void this.query.interrupt().catch(() => {});
      },
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue.close();
    if (this.active) void this.query.interrupt().catch(() => {});
    this.query.close();
  }

  private async pump(): Promise<void> {
    try {
      for await (const message of this.query) this.receive(message);
    } catch (error) {
      if (!this.closed) {
        const failure = error instanceof Error ? error : new Error(String(error));
        this.handlers.event({ type: "turn.failed", error: failure.message });
        this.active?.reject(failure);
      }
    } finally {
      const active = this.active;
      this.active = undefined;
      if (active?.interrupted) active.resolve();
      else if (active) active.reject(new Error("The Claude session ended before the turn completed."));
      this.activity.disconnected();
      this.handlers.event({ type: "session.closed" });
    }
  }

  private receive(message: SDKMessage): void {
    const frame = message as unknown as Record<string, any>;
    const rootActivity = !frame.parent_tool_use_id && (
      message.type === "assistant"
      || message.type === "stream_event" && record(frame.event).type === "message_start"
    );
    if (rootActivity && !this.active && !this.passiveTurn) {
      this.passiveTurn = true;
      this.handlers.event({ type: "turn.started" });
    }
    if (this.activity.claude(frame)) return;
    switch (message.type) {
      case "system":
        this.system(frame);
        return;
      case "stream_event":
        this.stream(frame);
        return;
      case "assistant":
        this.assistant(frame);
        return;
      case "user":
        this.toolResults(frame);
        return;
      case "result":
        this.result(frame);
        return;
      default:
        return;
    }
  }

  private system(message: Record<string, unknown>): void {
    if (message.subtype === "init") {
      const sessionId = stringValue(message.session_id);
      if (sessionId) this.handlers.event({ type: "session.started", sessionId });
    } else if (message.subtype === "compact_boundary") {
      this.handlers.event({ type: "compacted" });
      this.emitEntry({ id: `context-${crypto.randomUUID()}`, kind: "assistant", text: "— context compacted —" });
    }
  }

  private stream(message: Record<string, any>): void {
    const event = record(message.event);
    if (event.type === "message_start") {
      this.currentMessageId = stringValue(record(event.message).id);
      return;
    }
    if (!this.currentMessageId) return;
    const id = `${this.currentMessageId}#${event.index}`;
    if (event.type === "content_block_start") {
      const type = record(event.content_block).type;
      if (type !== "text" && type !== "thinking") return;
      this.streamedMessages.add(this.currentMessageId);
      this.openBlocks.set(id, { id, kind: type === "text" ? "assistant" : "thinking", text: "" });
      return;
    }
    const entry = this.openBlocks.get(id);
    if (!entry) return;
    if (event.type === "content_block_delta") {
      const delta = record(event.delta);
      const chunk = delta.type === "text_delta" ? stringValue(delta.text) : delta.type === "thinking_delta" ? stringValue(delta.thinking) : undefined;
      if (!chunk) return;
      entry.text = `${entry.text ?? ""}${chunk}`;
      this.emitEntry(entry);
      return;
    }
    if (event.type === "content_block_stop") {
      this.openBlocks.delete(id);
      entry.text = clip(entry.text ?? "", entry.kind === "thinking" ? MAX_THINK : MAX_TEXT);
      if (entry.text) {
        entry.completedAt ??= Date.now();
        this.emitEntry(entry);
      }
    }
  }

  private assistant(message: Record<string, any>): void {
    const payload = record(message.message);
    const content = Array.isArray(payload.content) ? payload.content : [];
    const streamed = typeof payload.id === "string" && this.streamedMessages.has(payload.id);
    const usage = record(payload.usage);
    const tokens = numberValue(usage.input_tokens) + numberValue(usage.cache_read_input_tokens) + numberValue(usage.cache_creation_input_tokens);
    if (tokens > 0) this.handlers.event({ type: "usage.updated", tokens, ...(stringValue(payload.model) ? { model: stringValue(payload.model) } : {}) });
    for (const value of content) {
      const block = record(value);
      if (block.type === "text" || block.type === "thinking") {
        if (streamed) continue;
        const text = stringValue(block.type === "text" ? block.text : block.thinking);
        if (text) this.emitEntry({
          id: `${stringValue(payload.id) ?? crypto.randomUUID()}-${this.entries.size}`,
          kind: block.type === "text" ? "assistant" : "thinking",
          text: clip(text, block.type === "text" ? MAX_TEXT : MAX_THINK),
        });
        continue;
      }
      if (block.type !== "tool_use") continue;
      if (block.name === "TodoWrite") {
        const todos = extractTodos(block.input);
        if (todos.length) this.handlers.event({ type: "todos.updated", todos });
        continue;
      }
      const name = stringValue(block.name) ?? "Tool";
      const input = record(block.input);
      const described = describeTool(name, input);
      const entry: ConvEntry = {
        id: stringValue(block.id) ?? `tool-${crypto.randomUUID()}`,
        kind: "tool",
        tool: name,
        verb: described.verb,
        arg: described.arg,
      };
      if (described.file) entry.file = described.file;
      if (described.skill) entry.skill = described.skill;
      const diff = buildDiff(name, input);
      if (diff.length) entry.diff = diff;
      const counts = countDiff(name, input);
      if (counts.adds || counts.dels) {
        entry.adds = counts.adds;
        entry.dels = counts.dels;
      }
      if (name === "AskUserQuestion") entry.questions = buildQuestions(input);
      this.byToolUseId.set(entry.id, entry);
      this.emitEntry(entry);
    }
  }

  private toolResults(message: Record<string, any>): void {
    const content = record(message.message).content;
    if (!Array.isArray(content)) return;
    for (const value of content) {
      const block = record(value);
      if (block.type !== "tool_result") continue;
      const entry = this.byToolUseId.get(String(block.tool_use_id));
      if (!entry) continue;
      entry.status = block.is_error ? "error" : "ok";
      entry.completedAt ??= Date.now();
      const raw = record(message.tool_use_result);
      if (entry.questions) {
        applyAnswers(entry.questions, raw.answers);
        applyNotes(entry.questions, raw.annotations);
      } else {
        const output = resultText(block.content) ?? resultText(raw);
        if (output) applyToolOutput(entry, output, MAX_OUTPUT);
      }
      this.emitEntry(entry);
    }
  }

  private result(message: Record<string, unknown>): void {
    this.passiveTurn = false;
    const failure = message.is_error === true || (typeof message.subtype === "string" && message.subtype !== "success");
    if (failure) {
      const detail = stringValue(message.result) ?? stringValue(message.subtype) ?? "The turn failed.";
      if (!/abort|interrupt|cancel/i.test(detail)) this.handlers.event({ type: "turn.failed", error: detail });
    }
    this.handlers.event({
      type: "turn.completed",
      ...(numberValue(message.num_turns) > 0 ? { turns: numberValue(message.num_turns) } : {}),
      ...(numberValue(message.total_cost_usd) > 0 ? { costUsd: numberValue(message.total_cost_usd) } : {}),
    });
    const active = this.active;
    this.active = undefined;
    active?.resolve();
  }

  private emitEntry(entry: ConvEntry): void {
    const existing = this.entries.get(entry.id);
    if (existing && existing !== entry) Object.assign(existing, entry);
    else if (!existing) this.entries.set(entry.id, entry);
    this.handlers.event({ type: "entry.updated", entry: existing ?? entry });
  }

  private async permission(
    toolName: string,
    input: Record<string, unknown>,
    callback: { signal: AbortSignal; suggestions?: PermissionUpdate[]; title?: string; decisionReason?: string },
  ): Promise<PermissionResult> {
    if (toolName === "AskUserQuestion") {
      if (!this.handlers.answer) return { behavior: "deny", message: "This thread cannot answer questions." };
      const questions = buildQuestions(input);
      const answers = await this.handlers.answer({ questions, signal: callback.signal });
      return { behavior: "allow", updatedInput: { questions: Array.isArray(input.questions) ? input.questions : [], answers } };
    }
    if (!this.handlers.approve) return { behavior: "deny", message: "This thread cannot approve tools." };
    const decision = await this.handlers.approve({
      tool: toolName,
      input,
      signal: callback.signal,
      ...(callback.title ? { title: callback.title } : {}),
      ...(callback.decisionReason ? { reason: callback.decisionReason } : {}),
      allowAlways: toolName !== "ExitPlanMode",
      trusted: toolName.startsWith("mcp__remy__"),
      edit: /^(Edit|Write|NotebookEdit)$/i.test(toolName),
    });
    if (decision === "deny") return { behavior: "deny", message: "The user denied this tool call." };
    return {
      behavior: "allow",
      updatedInput: input,
      ...(decision === "allowAlways" ? { updatedPermissions: sessionAllowRules(toolName) } : {}),
    };
  }
}

function userMessage(input: ProviderTurn): SDKUserMessage {
  return {
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "text", text: input.prompt },
        ...input.images.map((image) => ({
          type: "image" as const,
          source: { type: "base64" as const, media_type: image.mimeType, data: image.base64 },
        })),
      ],
    },
    parent_tool_use_id: null,
    session_id: "",
  } as SDKUserMessage;
}

function claudePermissionMode(mode: ProviderSessionOptions["permissionMode"]): PermissionMode {
  return (mode === "auto" ? "acceptEdits" : mode) as PermissionMode;
}

function sessionAllowRules(toolName: string): PermissionUpdate[] {
  return [{ type: "addRules", rules: [{ toolName }], behavior: "allow", destination: "session" }];
}

async function claudeAnswer(options: ProviderAnswerOptions, queryFactory: QueryFactory = query): Promise<string | undefined> {
  const sdkOptions: Options = {
    cwd: options.cwd,
    pathToClaudeCodeExecutable: options.command,
    systemPrompt: options.systemPrompt ?? options.developerInstructions ?? "You are a helpful coding agent.",
    settingSources: options.developerInstructions ? ["user", "project", "local"] : [],
    maxTurns: 1,
    allowedTools: [],
    ...(options.model ? { model: options.model } : {}),
    ...(options.effort ? { effort: options.effort as NonNullable<Options["effort"]> } : {}),
    ...(options.env ? { env: options.env } : {}),
  };
  const handle = queryFactory({ prompt: options.prompt, options: sdkOptions });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void handle.interrupt().catch(() => {});
  }, options.timeoutMs);
  timer.unref?.();
  try {
    let answer = "";
    for await (const message of handle) {
      if (message.type !== "assistant") continue;
      for (const block of message.message.content) if (block.type === "text") answer += block.text;
    }
    if (timedOut) throw new Error("Claude took too long; choose a faster model and try again.");
    return answer || undefined;
  } finally {
    clearTimeout(timer);
    handle.close();
  }
}

export function createClaudeAdapter(queryFactory: QueryFactory = query): ProviderAdapter {
  return {
    id: "claude",
    createSession: (options, handlers) => new ClaudeAdapterSession(options, handlers, queryFactory),
    answer: (options) => claudeAnswer(options, queryFactory),
    discoverModels: discoverClaudeModels,
  };
}

export const claudeAdapter = createClaudeAdapter();

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
