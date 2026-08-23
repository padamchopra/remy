import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { codexSandbox } from "./providers.js";
import { applyToolOutput, clip, MAX_ARG, MAX_OUTPUT, MAX_TEXT, MAX_THINK, type ConvEntry, type ConvTodo } from "./transcript.js";

/// The app-server shapes Remy renders. They stay deliberately smaller than the
/// generated protocol: the installed Codex CLI is the schema authority, while
/// Remy's feed only needs the stable fields below.
export type CodexItem =
  | { id: string; type: "agent_message"; text: string }
  | { id: string; type: "reasoning"; text: string }
  | {
      id: string;
      type: "command_execution";
      command: string;
      aggregated_output?: string;
      exit_code?: number;
      status: "in_progress" | "completed" | "failed";
    }
  | {
      id: string;
      type: "file_change";
      changes: { path: string; kind: "add" | "delete" | "update" }[];
      status: "in_progress" | "completed" | "failed";
    }
  | {
      id: string;
      type: "mcp_tool_call";
      server: string;
      tool: string;
      arguments?: unknown;
      error?: { message: string };
      status: "in_progress" | "completed" | "failed";
    }
  | { id: string; type: "web_search"; query: string }
  | { id: string; type: "todo_list"; items: { text: string; completed: boolean }[] }
  | { id: string; type: "error"; message: string };

export interface CodexUsage {
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens?: number;
  output_tokens: number;
  reasoning_output_tokens?: number;
  context_window?: number;
}

export type CodexEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.started" }
  | { type: "turn.completed" }
  | { type: "turn.failed"; error: { message: string } }
  | { type: "usage.updated"; usage: CodexUsage }
  | { type: "item.started"; item: CodexItem }
  | { type: "item.updated"; item: CodexItem }
  | { type: "item.completed"; item: CodexItem }
  | { type: "error"; message: string };

export interface CodexSessionOptions {
  /// The `codex` executable on this machine, from `agentCommand("codex")`.
  command: string;
  cwd: string;
  model?: string;
  effort?: string;
  permissionMode: string;
  threadId?: string;
  additionalDirectories?: string[];
  developerInstructions?: string;
  mcpServer?: {
    command: string;
    args: string[];
    env: Record<string, string>;
  };
  env?: NodeJS.ProcessEnv;
}

export interface CodexApprovalRequest {
  kind: "command" | "file_change";
  itemId: string;
  command?: string;
  cwd?: string;
  reason?: string;
  allowAlways: boolean;
  signal: AbortSignal;
}

export interface CodexQuestion {
  id: string;
  header: string;
  question: string;
  options?: { label: string; description?: string }[];
}

export interface CodexQuestionRequest {
  questions: CodexQuestion[];
  signal: AbortSignal;
}

export type CodexApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface ActiveTurn {
  id?: string;
  controller: AbortController;
  stopped: boolean;
  resolve(): void;
  reject(error: Error): void;
}

export interface CodexRun {
  /// Ends the active turn but keeps app-server alive for the next message.
  stop(): void;
  done: Promise<void>;
}

export interface CodexSession {
  run(prompt: string, options?: { model?: string; effort?: string; permissionMode?: string }): CodexRun;
  close(): void;
}

/// The app-server command line contains configuration keys and environment
/// variable names, never their values. Those travel only in the child env.
export function codexAppServerArgs(options: CodexSessionOptions): string[] {
  const args = ["app-server", "--stdio"];
  if (options.mcpServer) {
    args.push("--config", `mcp_servers.remy.command=${JSON.stringify(options.mcpServer.command)}`);
    args.push("--config", `mcp_servers.remy.args=${JSON.stringify(options.mcpServer.args)}`);
    args.push("--config", 'mcp_servers.remy.default_tools_approval_mode="approve"');
    args.push("--config", `mcp_servers.remy.env_vars=${JSON.stringify(Object.keys(options.mcpServer.env))}`);
  }
  return args;
}

export function codexPermissions(permissionMode: string, roots: string[]): {
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy: "on-request" | "never";
  sandboxPolicy:
    | { type: "readOnly"; networkAccess: false }
    | { type: "workspaceWrite"; writableRoots: string[]; networkAccess: boolean; excludeTmpdirEnvVar: false; excludeSlashTmp: false }
    | { type: "dangerFullAccess" };
} {
  const { sandbox } = codexSandbox(permissionMode);
  if (sandbox === "danger-full-access") {
    return { sandbox, approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } };
  }
  if (sandbox === "workspace-write") {
    return {
      sandbox,
      approvalPolicy: permissionMode === "acceptEdits" ? "on-request" : "never",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: roots,
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    };
  }
  if (permissionMode === "default") {
    return {
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: roots,
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    };
  }
  return { sandbox, approvalPolicy: "never", sandboxPolicy: { type: "readOnly", networkAccess: false } };
}

/// Opens one long-lived app-server connection for a Remy thread. Turns still
/// finish one at a time, but approvals, interruption, and later steering all
/// share the same bidirectional JSON-RPC channel.
export function createCodexSession(
  options: CodexSessionOptions,
  onEvent: (event: CodexEvent) => void,
  onApproval?: (request: CodexApprovalRequest) => Promise<CodexApprovalDecision>,
  onQuestion?: (request: CodexQuestionRequest) => Promise<Record<string, string[]>>,
): CodexSession {
  return new AppServerSession(options, onEvent, onApproval, onQuestion);
}

class AppServerSession implements CodexSession {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private requests = new Map<number | string, PendingRequest>();
  private items = new Map<string, CodexItem>();
  private active?: ActiveTurn;
  private threadId?: string;
  private closed = false;
  private stderr: string[] = [];
  private ready: Promise<void>;

  constructor(
    private options: CodexSessionOptions,
    private onEvent: (event: CodexEvent) => void,
    private onApproval?: (request: CodexApprovalRequest) => Promise<CodexApprovalDecision>,
    private onQuestion?: (request: CodexQuestionRequest) => Promise<Record<string, string[]>>,
  ) {
    this.child = spawn(options.command, codexAppServerArgs(options), {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, ...options.mcpServer?.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr.push(chunk);
      if (this.stderr.length > 40) this.stderr.splice(0, this.stderr.length - 40);
    });
    const reader = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    reader.on("line", (line) => this.receive(line));
    this.child.once("error", (error) => this.fail(new Error(`Codex could not be started: ${error.message}`)));
    this.child.once("exit", (code, signal) => {
      if (this.closed) return;
      const tail = this.stderr.join("").trim().split("\n").filter(Boolean).pop();
      const detail = tail || (signal ? `Codex stopped with ${signal}.` : `Codex exited with code ${code ?? 1}.`);
      this.fail(new Error(detail));
    });
    this.ready = this.initialize();
    this.ready.catch(() => {});
  }

  run(prompt: string, overrides: { model?: string; effort?: string; permissionMode?: string } = {}): CodexRun {
    if (this.active) throw new Error("Codex is already running a turn.");
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const done = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const active: ActiveTurn = { controller: new AbortController(), stopped: false, resolve, reject };
    this.active = active;
    void this.ready.then(async () => {
      if (active.stopped || this.closed) {
        this.finish(active);
        return;
      }
      const permissionMode = overrides.permissionMode ?? this.options.permissionMode;
      const roots = [this.options.cwd, ...(this.options.additionalDirectories ?? [])];
      const permissions = codexPermissions(permissionMode, [this.options.cwd]);
      const chosenModel = overrides.model ?? this.options.model;
      const chosenEffort = overrides.effort ?? this.options.effort;
      const result = asRecord(await this.request("turn/start", {
        threadId: this.threadId,
        input: [{ type: "text", text: prompt }],
        cwd: this.options.cwd,
        ...(chosenModel ? { model: chosenModel } : {}),
        ...(chosenEffort ? { modelReasoningEffort: chosenEffort } : {}),
        approvalPolicy: permissions.approvalPolicy,
        sandboxPolicy: permissions.sandboxPolicy,
        runtimeWorkspaceRoots: roots,
      }));
      const turn = asRecord(result.turn);
      if (typeof turn.id === "string") active.id = turn.id;
      if (active.stopped && active.id) {
        await this.request("turn/interrupt", { threadId: this.threadId, turnId: active.id }).catch(() => {});
      }
    }).catch((error) => this.failTurn(active, error));
    return {
      stop: () => {
        if (active.stopped) return;
        active.stopped = true;
        active.controller.abort();
        if (!active.id || !this.threadId) return;
        void this.request("turn/interrupt", { threadId: this.threadId, turnId: active.id }).catch(() => {});
      },
      done,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.active?.controller.abort();
    this.active?.resolve();
    this.active = undefined;
    for (const pending of this.requests.values()) pending.reject(new Error("Codex session stopped."));
    this.requests.clear();
    this.child.kill("SIGTERM");
  }

  private async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "remy", title: "Remy", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized", {});
    const roots = [this.options.cwd, ...(this.options.additionalDirectories ?? [])];
    const permissions = codexPermissions(this.options.permissionMode, [this.options.cwd]);
    const common = {
      cwd: this.options.cwd,
      ...(this.options.model ? { model: this.options.model } : {}),
      ...(this.options.effort ? { modelReasoningEffort: this.options.effort } : {}),
      ...(this.options.developerInstructions ? { developerInstructions: this.options.developerInstructions } : {}),
      approvalPolicy: permissions.approvalPolicy,
      sandbox: permissions.sandbox,
      runtimeWorkspaceRoots: roots,
    };
    let result: Record<string, unknown>;
    if (this.options.threadId) {
      try {
        result = asRecord(await this.request("thread/resume", { threadId: this.options.threadId, ...common }));
      } catch {
        result = asRecord(await this.request("thread/start", common));
      }
    } else {
      result = asRecord(await this.request("thread/start", common));
    }
    const thread = asRecord(result.thread);
    if (typeof thread.id !== "string" || !thread.id) throw new Error("Codex did not return a thread id.");
    this.threadId = thread.id;
    this.onEvent({ type: "thread.started", thread_id: thread.id });
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Codex session stopped."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.requests.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.write({ method, params });
  }

  private write(message: RpcMessage): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      return;
    }
    if (message.id !== undefined && !message.method) {
      const pending = this.requests.get(message.id);
      if (!pending) return;
      this.requests.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "Codex request failed."));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      void this.serverRequest(message);
      return;
    }
    if (message.method) this.notification(message.method, message.params ?? {});
  }

  private async serverRequest(message: RpcMessage): Promise<void> {
    const id = message.id!;
    const params = message.params ?? {};
    try {
      if (message.method === "item/commandExecution/requestApproval") {
        const available = Array.isArray(params.availableDecisions) ? params.availableDecisions : [];
        const decision = await this.onApproval?.({
          kind: "command",
          itemId: String(params.itemId ?? ""),
          command: stringValue(params.command),
          cwd: stringValue(params.cwd),
          reason: stringValue(params.reason),
          allowAlways: available.includes("acceptForSession"),
          signal: this.active?.controller.signal ?? AbortSignal.abort(),
        }) ?? "decline";
        this.write({ id, result: { decision } });
        return;
      }
      if (message.method === "item/fileChange/requestApproval") {
        const decision = await this.onApproval?.({
          kind: "file_change",
          itemId: String(params.itemId ?? ""),
          reason: stringValue(params.reason),
          allowAlways: true,
          signal: this.active?.controller.signal ?? AbortSignal.abort(),
        }) ?? "decline";
        this.write({ id, result: { decision } });
        return;
      }
      if (message.method === "item/tool/requestUserInput") {
        const questions = Array.isArray(params.questions)
          ? params.questions.flatMap((value): CodexQuestion[] => {
              const question = asRecord(value);
              if (typeof question.id !== "string" || typeof question.question !== "string") return [];
              const options = Array.isArray(question.options)
                ? question.options.flatMap((option): { label: string; description?: string }[] => {
                    const row = asRecord(option);
                    return typeof row.label === "string"
                      ? [{ label: row.label, ...(typeof row.description === "string" ? { description: row.description } : {}) }]
                      : [];
                  })
                : undefined;
              return [{
                id: question.id,
                header: stringValue(question.header) ?? "Question",
                question: question.question,
                ...(options?.length ? { options } : {}),
              }];
            })
          : [];
        const answers = await this.onQuestion?.({
          questions,
          signal: this.active?.controller.signal ?? AbortSignal.abort(),
        }) ?? {};
        this.write({
          id,
          result: { answers: Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, { answers: value }])) },
        });
        return;
      }
      this.write({ id, error: { code: -32601, message: `Remy does not handle ${message.method}.` } });
    } catch (error) {
      this.write({ id, error: { code: -32000, message: errorMessage(error) } });
    }
  }

  private notification(method: string, params: Record<string, unknown>): void {
    if (this.threadId && typeof params.threadId === "string" && params.threadId !== this.threadId) return;
    if (method === "turn/started") {
      const turn = asRecord(params.turn);
      if (this.active && typeof turn.id === "string") this.active.id = turn.id;
      this.onEvent({ type: "turn.started" });
      return;
    }
    if (method === "turn/completed") {
      const turn = asRecord(params.turn);
      const active = this.active;
      if (!active) return;
      if (turn.status === "failed") {
        const error = asRecord(turn.error);
        this.onEvent({ type: "turn.failed", error: { message: stringValue(error.message) ?? "the turn failed" } });
      } else {
        this.onEvent({ type: "turn.completed" });
      }
      this.finish(active);
      return;
    }
    if (method === "thread/tokenUsage/updated") {
      const tokenUsage = asRecord(params.tokenUsage);
      const last = asRecord(tokenUsage.last);
      this.onEvent({
        type: "usage.updated",
        usage: {
          input_tokens: numberValue(last.inputTokens),
          cached_input_tokens: numberValue(last.cachedInputTokens),
          cache_write_input_tokens: numberValue(last.cacheWriteInputTokens),
          output_tokens: numberValue(last.outputTokens),
          reasoning_output_tokens: numberValue(last.reasoningOutputTokens),
          ...(typeof tokenUsage.modelContextWindow === "number" ? { context_window: tokenUsage.modelContextWindow } : {}),
        },
      });
      return;
    }
    if (method === "turn/plan/updated") {
      const plan = Array.isArray(params.plan) ? params.plan : [];
      this.onEvent({
        type: "item.updated",
        item: {
          id: `plan-${String(params.turnId ?? "current")}`,
          type: "todo_list",
          items: plan.flatMap((value): { text: string; completed: boolean }[] => {
            const row = asRecord(value);
            return typeof row.step === "string" ? [{ text: row.step, completed: row.status === "completed" }] : [];
          }),
        },
      });
      return;
    }
    if (method === "item/started" || method === "item/completed") {
      const item = toCodexItem(params.item);
      if (!item) return;
      this.items.set(item.id, item);
      this.onEvent({ type: method === "item/started" ? "item.started" : "item.completed", item });
      return;
    }
    if (method === "item/agentMessage/delta") {
      this.appendDelta(String(params.itemId ?? ""), stringValue(params.delta) ?? "", "agent_message");
      return;
    }
    if (method === "item/reasoning/summaryTextDelta") {
      this.appendDelta(String(params.itemId ?? ""), stringValue(params.delta) ?? "", "reasoning");
      return;
    }
    if (method === "item/commandExecution/outputDelta") {
      this.appendDelta(String(params.itemId ?? ""), stringValue(params.delta) ?? "", "command_execution");
      return;
    }
    if (method === "error") {
      if (params.willRetry === true) return;
      const error = asRecord(params.error);
      this.onEvent({ type: "error", message: stringValue(error.message) ?? "Codex failed." });
    }
  }

  private appendDelta(id: string, delta: string, kind: "agent_message" | "reasoning" | "command_execution"): void {
    const existing = this.items.get(id);
    if (!existing || existing.type !== kind || !delta) return;
    let item: CodexItem;
    if (existing.type === "agent_message") item = { ...existing, text: existing.text + delta };
    else if (existing.type === "reasoning") item = { ...existing, text: existing.text + delta };
    else item = { ...existing, aggregated_output: (existing.aggregated_output ?? "") + delta };
    this.items.set(id, item);
    this.onEvent({ type: "item.updated", item });
  }

  private finish(active: ActiveTurn): void {
    if (this.active !== active) return;
    this.active = undefined;
    active.resolve();
  }

  private failTurn(active: ActiveTurn, error: unknown): void {
    if (this.active === active) this.active = undefined;
    active.reject(error instanceof Error ? error : new Error(String(error)));
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.requests.values()) pending.reject(error);
    this.requests.clear();
    if (this.active) {
      this.active.controller.abort();
      this.active.reject(error);
      this.active = undefined;
    }
  }
}

function toCodexItem(value: unknown): CodexItem | undefined {
  const item = asRecord(value);
  const id = stringValue(item.id);
  const type = stringValue(item.type);
  if (!id || !type) return undefined;
  if (type === "agentMessage") return { id, type: "agent_message", text: stringValue(item.text) ?? "" };
  if (type === "plan") return { id, type: "agent_message", text: stringValue(item.text) ?? "" };
  if (type === "reasoning") {
    const summary = Array.isArray(item.summary) ? item.summary.filter((part): part is string => typeof part === "string") : [];
    const content = Array.isArray(item.content) ? item.content.filter((part): part is string => typeof part === "string") : [];
    return { id, type: "reasoning", text: [...summary, ...content].join("\n") };
  }
  if (type === "commandExecution") {
    const status = item.status === "inProgress" ? "in_progress" : item.status === "completed" ? "completed" : "failed";
    return {
      id,
      type: "command_execution",
      command: stringValue(item.command) ?? "",
      status,
      ...(typeof item.aggregatedOutput === "string" ? { aggregated_output: item.aggregatedOutput } : {}),
      ...(typeof item.exitCode === "number" ? { exit_code: item.exitCode } : {}),
    };
  }
  if (type === "fileChange") {
    const status = item.status === "inProgress" ? "in_progress" : item.status === "completed" ? "completed" : "failed";
    const changes = Array.isArray(item.changes)
      ? item.changes.flatMap((value): { path: string; kind: "add" | "delete" | "update" }[] => {
          const change = asRecord(value);
          if (typeof change.path !== "string") return [];
          const kind = change.kind === "add" || change.kind === "delete" ? change.kind : "update";
          return [{ path: change.path, kind }];
        })
      : [];
    return { id, type: "file_change", changes, status };
  }
  if (type === "mcpToolCall" || type === "dynamicToolCall") {
    const status = item.status === "inProgress" ? "in_progress" : item.status === "completed" ? "completed" : "failed";
    const error = asRecord(item.error);
    return {
      id,
      type: "mcp_tool_call",
      server: stringValue(item.server) ?? stringValue(item.namespace) ?? "remy",
      tool: stringValue(item.tool) ?? "tool",
      arguments: item.arguments,
      ...(typeof error.message === "string" ? { error: { message: error.message } } : {}),
      status,
    };
  }
  if (type === "webSearch") return { id, type: "web_search", query: stringValue(item.query) ?? "" };
  return undefined;
}

/// What one Codex item looks like in Remy's provider-neutral feed.
export function codexEntry(item: CodexItem, turn = ""): ConvEntry | undefined {
  const id = `${turn}${item.id}`;
  switch (item.type) {
    case "agent_message":
      return { id, kind: "assistant", text: clip(item.text ?? "", MAX_TEXT) };
    case "reasoning":
      return { id, kind: "thinking", text: clip(item.text ?? "", MAX_THINK) };
    case "command_execution": {
      const entry: ConvEntry = { id, kind: "tool", tool: "Bash", verb: "Ran", arg: clip(item.command ?? "", MAX_ARG) };
      if (item.status !== "in_progress") entry.status = item.status === "failed" || item.exit_code ? "error" : "ok";
      const output = item.aggregated_output?.trim();
      if (output) applyToolOutput(entry, output, MAX_OUTPUT);
      return entry;
    }
    case "file_change": {
      const changes = item.changes ?? [];
      const first = changes[0]?.path;
      const entry: ConvEntry = {
        id,
        kind: "tool",
        tool: "Edit",
        verb: changes.length > 1 ? "Edited" : verbFor(changes[0]?.kind),
        arg: changes.length > 1 ? `${changes.length} files` : base(first),
      };
      if (item.status !== "in_progress") entry.status = item.status === "failed" ? "error" : "ok";
      if (changes.length === 1 && first) entry.file = first;
      return entry;
    }
    case "mcp_tool_call": {
      const entry: ConvEntry = { id, kind: "tool", tool: `${item.server}.${item.tool}`, verb: "Called", arg: clip(item.tool ?? "", MAX_ARG) };
      if (item.status !== "in_progress") entry.status = item.status === "failed" ? "error" : "ok";
      if (item.error?.message) entry.output = clip(item.error.message, MAX_OUTPUT);
      return entry;
    }
    case "web_search":
      return { id, kind: "tool", tool: "WebSearch", verb: "Searched web", arg: clip(item.query, MAX_ARG), status: "ok" };
    case "error":
      return { id, kind: "assistant", text: `⚠️ ${clip(item.message ?? "", MAX_TEXT)}` };
    default:
      return undefined;
  }
}

export function codexTodos(item: CodexItem): ConvTodo[] {
  if (item.type !== "todo_list") return [];
  return (item.items ?? []).map((todo) => ({ content: todo.text, status: todo.completed ? "completed" : "pending" }));
}

export function codexTokens(usage: CodexUsage | undefined): number {
  if (!usage) return 0;
  return num(usage.input_tokens) + num(usage.cached_input_tokens);
}

/// One small read-only answer for Remy's own background work, such as naming a
/// new thread. It still uses app-server, but closes the connection after one
/// turn rather than keeping a chat behind it.
export async function codexAnswer(options: {
  command: string;
  prompt: string;
  cwd: string;
  model?: string;
  effort?: string;
  timeoutMs: number;
}): Promise<string> {
  let answer = "";
  const session = createCodexSession(
    { ...options, permissionMode: "plan" },
    (event) => {
      if (event.type === "item.completed" && event.item.type === "agent_message") {
        answer += event.item.text;
      }
    },
  );
  const run = session.run(options.prompt, { model: options.model, effort: options.effort, permissionMode: "plan" });
  const timer = setTimeout(() => run.stop(), options.timeoutMs);
  timer.unref?.();
  try {
    await run.done;
    return answer;
  } finally {
    clearTimeout(timer);
    session.close();
  }
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function verbFor(kind: string | undefined): string {
  if (kind === "add") return "Wrote";
  if (kind === "delete") return "Deleted";
  return "Edited";
}

function base(path: string | undefined): string {
  if (!path) return "";
  return path.split("/").filter(Boolean).pop() ?? path;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
