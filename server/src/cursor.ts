import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { basename } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type {
  PermissionOption,
  PlanEntry,
  PromptResponse,
  RequestPermissionRequest,
  SessionConfigOption,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import type { ChatPermissionMode } from "./chat.js";
import { buildDiff, clip, describeTool, MAX_OUTPUT, type ConvEntry, type ConvTodo } from "./transcript.js";
import { takeArtifacts } from "./remy-artifacts.js";

export interface CursorMcpServer {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface CursorSessionOptions {
  command: string;
  cwd: string;
  model?: string;
  effort?: string;
  permissionMode: ChatPermissionMode;
  sessionId?: string;
  additionalDirectories?: string[];
  developerInstructions?: string;
  mcpServer?: CursorMcpServer;
  env?: NodeJS.ProcessEnv;
}

export type CursorApprovalDecision = "accept" | "acceptForSession" | "decline";

export interface CursorApprovalRequest {
  toolCall: CursorToolCall;
  allowAlways: boolean;
  signal: AbortSignal;
}

export interface CursorQuestionRequest {
  title?: string;
  questions: Array<{
    id: string;
    prompt: string;
    allowMultiple: boolean;
    options: Array<{ id: string; label: string }>;
  }>;
  signal: AbortSignal;
}

export interface CursorPlanRequest {
  name?: string;
  overview?: string;
  plan: string;
  todos: Array<{ id: string; content: string; status: string }>;
  signal: AbortSignal;
}

export interface CursorToolCall {
  toolCallId: string;
  title: string;
  name?: string | null;
  kind?: ToolCall["kind"] | null;
  status?: ToolCall["status"] | null;
  content?: ToolCall["content"] | null;
  locations?: ToolCall["locations"] | null;
  rawInput?: unknown;
  rawOutput?: unknown;
}

export type CursorEvent =
  | { type: "session.closed" }
  | { type: "session.started"; sessionId: string; configOptions: SessionConfigOption[] }
  | { type: "turn.started" }
  | { type: "turn.completed"; response: PromptResponse }
  | { type: "turn.failed"; error: string }
  | { type: "message.delta"; kind: "assistant" | "thinking"; messageId?: string; text: string }
  | { type: "tool.updated"; toolCall: CursorToolCall }
  | { type: "plan.updated"; todos: ConvTodo[] }
  | { type: "usage.updated"; used: number; size: number; costUsd?: number }
  | { type: "compacted" };

export interface CursorRun {
  done: Promise<void>;
  stop(): void;
}

export interface CursorSession {
  run(prompt: string, images?: Array<{ base64: string; mimeType: string }>): CursorRun;
  close(): void;
}

interface CursorAskQuestionRequest {
  title?: string;
  questions?: Array<{
    id?: string;
    prompt?: string;
    allowMultiple?: boolean;
    options?: Array<{ id?: string; label?: string }>;
  }>;
}

interface CursorCreatePlanRequest {
  name?: string;
  overview?: string;
  plan?: string;
  todos?: Array<{ id?: string; content?: string; status?: string }>;
}

interface CursorUpdateTodosRequest {
  todos?: Array<{ content?: string; status?: string }>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function identity<T>(value: unknown): T {
  return value as T;
}

/// Cursor's ACP executable flags. The model aliases come from `agent
/// --list-models`; ACP remains the transport rather than the older print-mode
/// JSON stream.
export function cursorModel(model: string | undefined, effort: string | undefined): string | undefined {
  if (!effort) return model;
  const base = model || "auto";
  const match = /^(.*)\[([^\]]*)\]$/.exec(base);
  if (!match) return `${base}[effort=${effort}]`;
  const values = match[2].split(",").map((value) => value.trim()).filter((value) => value && !value.startsWith("effort="));
  return `${match[1]}[${[...values, `effort=${effort}`].join(",")}]`;
}

export function cursorAcpArgs(options: Pick<CursorSessionOptions, "model" | "effort" | "permissionMode">): string[] {
  const args: string[] = [];
  const model = cursorModel(options.model, options.effort);
  if (model) args.push("--model", model);
  if (options.permissionMode === "auto") args.push("--auto-review");
  if (options.permissionMode === "bypassPermissions") args.push("--force");
  // Remy supplies one capability-scoped MCP server. Its tools still keep their
  // own permission boundary; this only avoids a second prompt to connect it.
  args.push("--approve-mcps", "acp");
  return args;
}

class AcpCursorSession implements CursorSession {
  private child: ChildProcessWithoutNullStreams;
  private connection: acp.ClientConnection;
  private ready: Promise<void>;
  private sessionId?: string;
  private active?: { stop: () => void };
  private closed = false;
  private needsInstructions: boolean;
  private tools = new Map<string, CursorToolCall>();

  constructor(
    private options: CursorSessionOptions,
    private onEvent: (event: CursorEvent) => void,
    private onApproval?: (request: CursorApprovalRequest) => Promise<CursorApprovalDecision>,
    private onQuestion?: (request: CursorQuestionRequest) => Promise<Record<string, string[]>>,
    private onPlan?: (request: CursorPlanRequest) => Promise<boolean>,
  ) {
    this.needsInstructions = !options.sessionId && Boolean(options.developerInstructions?.trim());
    this.child = spawn(options.command, cursorAcpArgs(options), {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const app = acp.client({ name: "remy" })
      .onRequest(acp.methods.client.session.requestPermission, ({ params, signal }) =>
        this.permission(params, signal))
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        if (!this.sessionId || params.sessionId === this.sessionId) this.update(params.update);
      })
      .onRequest("cursor/ask_question", identity<CursorAskQuestionRequest>, ({ params, signal }) =>
        this.question(params, signal))
      .onRequest("cursor/create_plan", identity<CursorCreatePlanRequest>, ({ params, signal }) =>
        this.plan(params, signal))
      .onNotification("cursor/update_todos", identity<CursorUpdateTodosRequest>, ({ params }) => {
        this.onEvent({ type: "plan.updated", todos: extensionTodos(params) });
      })
      // Cursor documents these as notifications. Core ACP tool-call updates
      // already carry what Remy's feed needs, so acknowledging them requires no
      // duplicate row.
      .onNotification("cursor/task", identity<Record<string, unknown>>, () => {})
      .onNotification("cursor/generate_image", identity<Record<string, unknown>>, () => {});

    const input = Writable.toWeb(this.child.stdin) as WritableStream<Uint8Array>;
    const output = Readable.toWeb(this.child.stdout) as ReadableStream<Uint8Array>;
    this.connection = app.connect(acp.ndJsonStream(input, output));
    this.ready = this.initialize();

    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      const message = chunk.trim();
      if (message) console.error(`Cursor ACP: ${message}`);
    });
    this.child.on("error", (error) => {
      this.connection.close(error);
      this.close();
    });
    this.child.on("exit", (code, signal) => {
      if (this.closed) return;
      this.connection.close(new Error(`Cursor ACP exited ${signal ?? code ?? "before the turn completed"}.`));
      this.close();
    });
  }

  run(prompt: string, images: Array<{ base64: string; mimeType: string }> = []): CursorRun {
    if (this.active) throw new Error("a Cursor turn is already running");
    const controller = new AbortController();
    const active = {
      stop: () => {
        controller.abort();
        if (this.sessionId) {
          void this.connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.sessionId });
        }
      },
    };
    this.active = active;
    const done = (async () => {
      try {
        await this.ready;
        if (!this.sessionId) throw new Error("Cursor did not create a session");
        this.onEvent({ type: "turn.started" });
        let sent = prompt;
        if (this.needsInstructions && this.options.developerInstructions?.trim()) {
          sent = [
            "Follow these Remy and agent-specific instructions in addition to the workspace rules:",
            this.options.developerInstructions.trim(),
            "User request:",
            prompt,
          ].join("\n\n");
          this.needsInstructions = false;
        }
        const response = await this.connection.agent.request(
          acp.methods.agent.session.prompt,
          {
            sessionId: this.sessionId,
            prompt: [
              { type: "text", text: sent },
              ...images.map((image) => ({ type: "image" as const, data: image.base64, mimeType: image.mimeType })),
            ],
          },
          { cancellationSignal: controller.signal },
        ) as PromptResponse;
        this.onEvent({ type: "turn.completed", response });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!controller.signal.aborted && !/cancel/i.test(message)) {
          this.onEvent({ type: "turn.failed", error: message });
          throw error;
        }
      } finally {
        if (this.active === active) this.active = undefined;
      }
    })();
    return { done, stop: active.stop };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onEvent({ type: "session.closed" });
    this.active?.stop();
    this.connection.close();
    this.child.kill();
  }

  private async initialize(): Promise<void> {
    const initialized = await this.connection.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "remy", title: "Remy", version: "0.1.0" },
    });
    if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
      throw new Error(`Cursor speaks ACP ${initialized.protocolVersion}, but Remy supports ${acp.PROTOCOL_VERSION}.`);
    }
    await this.connection.agent.request(acp.methods.agent.authenticate, { methodId: "cursor_login" });

    const mcpServers = this.options.mcpServer ? [cursorMcpServer(this.options.mcpServer)] : [];
    let configOptions: SessionConfigOption[] = [];
    if (this.options.sessionId) {
      if (initialized.agentCapabilities?.loadSession !== true) {
        throw new Error("this version of Cursor cannot resume ACP sessions");
      }
      const loaded = await this.connection.agent.request(acp.methods.agent.session.load, {
        sessionId: this.options.sessionId,
        cwd: this.options.cwd,
        additionalDirectories: this.options.additionalDirectories ?? [],
        mcpServers,
      });
      this.sessionId = this.options.sessionId;
      configOptions = loaded?.configOptions ?? [];
    } else {
      const created = await this.connection.agent.request(acp.methods.agent.session.new, {
        cwd: this.options.cwd,
        additionalDirectories: this.options.additionalDirectories ?? [],
        mcpServers,
      });
      this.sessionId = created.sessionId;
      configOptions = created.configOptions ?? [];
    }

    const modeId = this.options.permissionMode === "plan" ? "plan" : "agent";
    await this.connection.agent.request(acp.methods.agent.session.setMode, {
      sessionId: this.sessionId,
      modeId,
    });
    this.onEvent({ type: "session.started", sessionId: this.sessionId, configOptions });
  }

  private update(update: SessionUpdate): void {
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
      case "agent_thought_chunk":
        if (update.content.type === "text" && update.content.text) {
          this.onEvent({
            type: "message.delta",
            kind: update.sessionUpdate === "agent_message_chunk" ? "assistant" : "thinking",
            ...(update.messageId ? { messageId: update.messageId } : {}),
            text: update.content.text,
          });
        }
        return;
      case "tool_call": {
        const call: CursorToolCall = { ...update };
        this.tools.set(update.toolCallId, call);
        this.onEvent({ type: "tool.updated", toolCall: call });
        return;
      }
      case "tool_call_update": {
        const before = this.tools.get(update.toolCallId) ?? {
          toolCallId: update.toolCallId,
          title: update.title ?? update.name ?? "Tool",
        };
        const call = mergeToolCall(before, update);
        this.tools.set(update.toolCallId, call);
        this.onEvent({ type: "tool.updated", toolCall: call });
        return;
      }
      case "plan":
        this.onEvent({ type: "plan.updated", todos: cursorTodos(update.entries) });
        return;
      case "plan_update":
        if (update.plan.type === "items") {
          this.onEvent({ type: "plan.updated", todos: cursorTodos(update.plan.entries) });
        }
        return;
      case "usage_update":
        this.onEvent({
          type: "usage.updated",
          used: update.used,
          size: update.size,
          ...(update.cost?.currency === "USD" ? { costUsd: update.cost.amount } : {}),
        });
        return;
      case "compaction_update":
        if (update.status === "completed") this.onEvent({ type: "compacted" });
        return;
      default:
        return;
    }
  }

  private async permission(params: RequestPermissionRequest, signal: AbortSignal) {
    const toolCall = mergeToolCall(
      this.tools.get(params.toolCall.toolCallId) ?? {
        toolCallId: params.toolCall.toolCallId,
        title: params.toolCall.title ?? params.toolCall.name ?? "Tool",
      },
      params.toolCall,
    );
    this.tools.set(toolCall.toolCallId, toolCall);
    if (!this.onApproval) return { outcome: { outcome: "cancelled" as const } };
    const decision = await this.onApproval({
      toolCall,
      allowAlways: params.options.some((option) => option.kind === "allow_always"),
      signal,
    });
    const option = permissionOption(params.options, decision);
    return option
      ? { outcome: { outcome: "selected" as const, optionId: option.optionId } }
      : { outcome: { outcome: "cancelled" as const } };
  }

  private async question(params: CursorAskQuestionRequest, signal: AbortSignal) {
    const questions = (params.questions ?? []).flatMap((question, index) => {
      const prompt = text(question.prompt);
      if (!prompt) return [];
      return [{
        id: text(question.id) ?? `question-${index + 1}`,
        prompt,
        allowMultiple: question.allowMultiple === true,
        options: (question.options ?? []).flatMap((option, optionIndex) => {
          const label = text(option.label);
          if (!label) return [];
          return [{ id: text(option.id) ?? `option-${optionIndex + 1}`, label }];
        }),
      }];
    });
    if (!this.onQuestion || questions.length === 0) return { outcome: { outcome: "cancelled" as const } };
    const answers = await this.onQuestion({ title: text(params.title), questions, signal });
    return {
      outcome: {
        outcome: "answered" as const,
        answers: questions.map((question) => ({
          questionId: question.id,
          selectedOptionIds: answers[question.id] ?? [],
        })),
      },
    };
  }

  private async plan(params: CursorCreatePlanRequest, signal: AbortSignal) {
    const plan = text(params.plan) ?? "";
    if (!this.onPlan || !plan) return { outcome: { outcome: "cancelled" as const } };
    const accepted = await this.onPlan({
      name: text(params.name),
      overview: text(params.overview),
      plan,
      todos: (params.todos ?? []).map((todo, index) => ({
        id: text(todo.id) ?? `todo-${index + 1}`,
        content: text(todo.content) ?? "Task",
        status: text(todo.status) ?? "pending",
      })),
      signal,
    });
    return { outcome: { outcome: accepted ? "accepted" as const : "rejected" as const } };
  }
}

function cursorMcpServer(server: CursorMcpServer): acp.McpServer {
  return {
    name: "remy",
    command: server.command,
    args: server.args,
    env: Object.entries(server.env).map(([name, value]) => ({ name, value })),
  };
}

function mergeToolCall(before: CursorToolCall, update: ToolCallUpdate): CursorToolCall {
  return {
    ...before,
    ...(update.title !== undefined && update.title !== null ? { title: update.title } : {}),
    ...(update.name !== undefined ? { name: update.name } : {}),
    ...(update.kind !== undefined ? { kind: update.kind } : {}),
    ...(update.status !== undefined ? { status: update.status } : {}),
    ...(update.content !== undefined ? { content: update.content } : {}),
    ...(update.locations !== undefined ? { locations: update.locations } : {}),
    ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
    ...(update.rawOutput !== undefined ? { rawOutput: update.rawOutput } : {}),
  };
}

function permissionOption(options: PermissionOption[], decision: CursorApprovalDecision): PermissionOption | undefined {
  const kinds = decision === "acceptForSession"
    ? ["allow_always", "allow_once"]
    : decision === "accept"
      ? ["allow_once", "allow_always"]
      : ["reject_once", "reject_always"];
  return kinds.flatMap((kind) => options.filter((option) => option.kind === kind))[0];
}

export function cursorTodos(entries: PlanEntry[]): ConvTodo[] {
  return entries.map((entry) => ({ content: entry.content, status: entry.status }));
}

function extensionTodos(input: CursorUpdateTodosRequest): ConvTodo[] {
  return (input.todos ?? []).flatMap((todo) => {
    const content = text(todo.content);
    if (!content) return [];
    const status = todo.status === "completed" ? "completed" : todo.status === "in_progress" ? "in_progress" : "pending";
    return [{ content, status }];
  });
}

function cursorVerb(kind: CursorToolCall["kind"]): string {
  if (kind === "read") return "Read";
  if (kind === "edit") return "Edited";
  if (kind === "delete") return "Deleted";
  if (kind === "move") return "Moved";
  if (kind === "search") return "Searched";
  if (kind === "execute") return "Ran";
  if (kind === "fetch") return "Fetched";
  if (kind === "think") return "Thought";
  return "Used";
}

function toolOutput(call: CursorToolCall): string | undefined {
  if (typeof call.rawOutput === "string") return call.rawOutput;
  if (call.rawOutput !== undefined) {
    try {
      return JSON.stringify(call.rawOutput, null, 2);
    } catch {
      return String(call.rawOutput);
    }
  }
  const chunks = (call.content ?? []).flatMap((item) => {
    if (item.type !== "content" || item.content.type !== "text") return [];
    return [item.content.text];
  });
  return chunks.length ? chunks.join("\n") : undefined;
}

/// One ACP tool update as the provider-neutral row Remy's feed renders.
export function cursorEntry(call: CursorToolCall, turn = ""): ConvEntry {
  const input = record(call.rawInput);
  const name = call.name ?? call.kind ?? "Tool";
  const described = describeTool(name, input);
  const location = call.locations?.[0]?.path;
  const diff = buildDiff(name, input);
  const finished = call.status === "completed" || call.status === "failed";
  const output = toolOutput(call);
  const result = output ? takeArtifacts(output) : undefined;
  return {
    id: `${turn}${call.toolCallId}`,
    kind: "tool",
    tool: name,
    verb: described.verb === "Used" ? cursorVerb(call.kind) : described.verb,
    arg: described.arg || (location ? basename(location) : call.title),
    ...(described.file || location ? { file: described.file ?? location } : {}),
    ...(diff.length ? { diff } : {}),
    ...(finished ? { status: call.status === "failed" ? "error" : "ok" } : {}),
    ...(result?.text ? { output: clip(result.text, MAX_OUTPUT) } : {}),
    ...(result?.artifacts.length ? { artifacts: result.artifacts } : {}),
  };
}

export function createCursorSession(
  options: CursorSessionOptions,
  onEvent: (event: CursorEvent) => void,
  onApproval?: (request: CursorApprovalRequest) => Promise<CursorApprovalDecision>,
  onQuestion?: (request: CursorQuestionRequest) => Promise<Record<string, string[]>>,
  onPlan?: (request: CursorPlanRequest) => Promise<boolean>,
): CursorSession {
  return new AcpCursorSession(options, onEvent, onApproval, onQuestion, onPlan);
}

/// A short one-turn ACP conversation for Remy's own small jobs.
export async function cursorAnswer(options: {
  command: string;
  prompt: string;
  cwd: string;
  model?: string;
  effort?: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}): Promise<string | undefined> {
  let answer = "";
  const session = createCursorSession(
    {
      command: options.command,
      cwd: options.cwd,
      model: options.model,
      effort: options.effort,
      permissionMode: "plan",
      env: options.env,
    },
    (event) => {
      if (event.type === "message.delta" && event.kind === "assistant") answer += event.text;
    },
  );
  const run = session.run(options.prompt);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      run.stop();
      reject(new Error("Cursor took too long; choose a faster model and try again."));
    }, options.timeoutMs);
    timer.unref?.();
  });
  try {
    await Promise.race([run.done, timeout]);
    return answer || undefined;
  } finally {
    clearTimeout(timer);
    session.close();
  }
}
