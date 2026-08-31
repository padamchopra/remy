import { clip, resultText, type ConvEntry } from "./transcript.js";

export interface ThreadActivity {
  id: string;
  kind: "subagent" | "shell";
  provider: string;
  title: string;
  status: "running" | "waiting" | "idle" | "completed" | "failed" | "stopped" | "unknown";
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  parentId?: string;
  taskId?: string;
  toolUseId?: string;
  model?: string;
  background?: boolean;
  command?: string;
  progress?: string;
  output?: string;
  tokens?: number;
  toolCount?: number;
}

const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined;
const active = (status: ThreadActivity["status"]) => status === "running" || status === "waiting";
const terminal = (status: ThreadActivity["status"]) => ["completed", "failed", "stopped"].includes(status);
const statusOf = (value: unknown): ThreadActivity["status"] | undefined => {
  if (["running", "active", "inProgress", "in_progress", "busy"].includes(String(value))) return "running";
  if (["pending", "paused", "waiting", "spawning"].includes(String(value))) return "waiting";
  if (value === "idle") return "idle";
  if (["completed", "done", "ok"].includes(String(value))) return "completed";
  if (["failed", "error", "errored"].includes(String(value))) return "failed";
  if (["stopped", "killed", "cancelled", "interrupted", "shutdown"].includes(String(value))) return "stopped";
  return undefined;
};

/// Provider-owned work travels through the thread's durable, resumable entry stream.
export class ThreadActivityTracker {
  private rows = new Map<string, ThreadActivity>();
  private children = new Set<string>();

  constructor(entries: readonly ConvEntry[], private publish: (entry: ConvEntry) => void, private now = Date.now) {
    for (const entry of entries) if (entry.activity) this.rows.set(entry.activity.id, entry.activity);
  }

  private update(id: string, patch: Partial<ThreadActivity>, reactivate = false): void {
    const before = this.rows.get(id);
    if (!before && (!patch.kind || !patch.provider)) return;
    const at = this.now();
    const next = { id, title: patch.kind === "shell" ? "Shell" : "Subagent", status: "running", startedAt: at, ...before, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)), updatedAt: at } as ThreadActivity;
    if (before && terminal(before.status) && !reactivate) next.status = before.status;
    if (before && !active(before.status) && active(next.status)) {
      next.startedAt = at;
      delete next.completedAt;
      delete next.output;
    }
    if (!active(next.status)) next.completedAt ??= at;
    for (const key of ["title", "command", "progress", "output", "model"] as const) {
      if (next[key]) next[key] = key === "output" ? next[key]!.slice(-12_000) : clip(next[key]!, key === "command" ? 4_000 : 800);
    }
    // Repeated provider heartbeats must not fan out unchanged snapshots.
    if (before && JSON.stringify({ ...before, updatedAt: 0 }) === JSON.stringify({ ...next, updatedAt: 0 })) return;
    this.rows.set(id, next);
    if (this.rows.size > 2_000) {
      for (const [key, row] of this.rows) {
        if (key !== id && !active(row.status)) this.rows.delete(key);
        if (this.rows.size <= 2_000) break;
      }
    }
    this.publish({ id: `activity:${id}`, kind: "tool", at: next.startedAt, activity: next });
  }

  disconnected(): void {
    for (const row of this.rows.values()) if (active(row.status)) this.update(row.id, { status: "unknown" });
  }

  tool(provider: string, id: string, name: string, input: Record<string, any>, parentId?: string): void {
    if (typeof id !== "string" || typeof name !== "string") return;
    const kind = /^(Agent|Task)$/i.test(name) ? "subagent" : /^(Bash|Shell|exec_command|command_execution|execute)$/i.test(name) ? "shell" : undefined;
    if (!kind) return;
    this.update(`${provider}:${id}`, {
      kind, provider, toolUseId: id, parentId,
      title: text(input.description) ?? (kind === "subagent" ? text(input.subagent_type) ?? "Subagent" : text(input.command) ?? "Shell"),
      command: kind === "shell" ? text(input.command) : undefined,
      progress: kind === "subagent" ? text(input.prompt) : undefined,
      model: text(input.model), background: input.run_in_background === true,
    });
  }

  toolResult(provider: string, id: string, output: string | undefined, failed: boolean, raw: unknown = {}): void {
    const row = this.rows.get(`${provider}:${id}`);
    if (!row) return;
    const result = record(raw);
    const taskId = text(result.backgroundTaskId) ?? text(result.background_task_id) ?? text(result.task_id) ?? text(result.agentId);
    const background = !failed && (row.background || Boolean(result.backgroundTaskId || result.background_task_id) || result.status === "async_launched" || result.isAsync === true);
    this.update(row.id, { taskId, output, background, status: background ? "running" : failed ? "failed" : "completed" });
  }

  /// Child messages update their roster row, never the parent's prose or usage.
  claude(message: Record<string, any>): boolean {
    const parent = text(message.parent_tool_use_id);
    if (message.type === "assistant") {
      const payload = record(message.message);
      if (parent) this.update(`claude:${parent}`, { kind: "subagent", provider: "claude", model: text(payload.model) });
      for (const block of Array.isArray(payload.content) ? payload.content : []) {
        if (block.type === "tool_use") this.tool("claude", block.id, block.name, record(block.input), parent ? `claude:${parent}` : undefined);
        if (parent && block.type === "text") this.update(`claude:${parent}`, { progress: text(block.text) });
      }
    }
    if (message.type === "user") {
      for (const block of Array.isArray(message.message?.content) ? message.message.content : []) {
        if (block.type === "tool_result") this.toolResult("claude", block.tool_use_id, resultText(block.content), Boolean(block.is_error), message.tool_use_result);
      }
    }
    if (message.type === "system" && /^task_(started|progress|updated|notification)$/.test(message.subtype ?? "")) {
      const taskId = text(message.task_id);
      if (!taskId) return Boolean(parent);
      const toolId = text(message.tool_use_id);
      const existing = [...this.rows.values()].find((row) => row.provider === "claude" && (row.taskId === taskId || (toolId && row.toolUseId === toolId)));
      const id = existing?.id ?? `claude:${toolId ?? taskId}`;
      const patch = record(message.patch);
      const kind = existing?.kind ?? (/bash|shell|workflow/.test(message.task_type ?? "") ? "shell" : "subagent");
      const usage = record(message.usage);
      this.update(id, {
        kind, provider: "claude", taskId, toolUseId: toolId,
        title: text(patch.description) ?? text(message.description),
        progress: text(patch.error) ?? text(message.summary) ?? text(message.last_tool_name),
        output: message.subtype === "task_notification" ? text(message.summary) : undefined,
        status: statusOf(patch.status ?? message.status) ?? (/^task_(started|progress)$/.test(message.subtype) ? "running" : undefined),
        background: typeof patch.is_backgrounded === "boolean" ? patch.is_backgrounded : undefined,
        tokens: typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
        toolCount: typeof usage.tool_uses === "number" ? usage.tool_uses : undefined,
      });
    }
    if (message.type === "tool_progress") {
      const id = parent ? `claude:${parent}` : [...this.rows.values()].find((row) => row.taskId === message.task_id)?.id ?? `claude:${message.tool_use_id}`;
      this.update(id, { progress: text(message.tool_name) });
    }
    return Boolean(parent);
  }

  codex(method: string, params: Record<string, any>, parentThreadId?: string): void {
    const thread = record(params.thread);
    const source = record(record(thread.source).subagent).thread_spawn;
    const parent = text(record(source).parent_thread_id);
    if (method === "thread/started" && parent && (parent === parentThreadId || this.children.has(parent))) {
      const id = text(thread.id);
      if (!id) return;
      this.children.add(id);
      this.update(`codex:agent:${id}`, { kind: "subagent", provider: "codex", title: text(thread.agentNickname) ?? text(thread.name), parentId: parent === parentThreadId ? undefined : `codex:agent:${parent}`, model: text(thread.model) });
      return;
    }
    const threadId = text(params.threadId);
    const child = threadId && this.children.has(threadId) ? `codex:agent:${threadId}` : undefined;
    if (threadId && parentThreadId && threadId !== parentThreadId && !child) return;
    const item = record(params.item);
    if ((method === "item/started" || method === "item/completed") && item.type === "collabAgentToolCall") {
      const states = record(item.agentsStates);
      const receivers = new Set<string>([...(Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds.filter((id: unknown) => typeof id === "string") : []), ...Object.keys(states)]);
      for (const receiver of receivers) {
        this.children.add(receiver);
        const state = record(states[receiver]);
        const reactivate = method === "item/started" && /spawn|resume|send/i.test(item.tool ?? "");
        this.update(`codex:agent:${receiver}`, {
          kind: "subagent", provider: "codex", parentId: child,
          title: text(state.agentNickname) ?? text(state.nickname), model: text(item.model),
          progress: text(item.prompt), output: text(state.message),
          status: statusOf(state.status) ?? (reactivate ? "running" : /^close_?agent$/i.test(item.tool ?? "") ? "stopped" : undefined),
        }, reactivate);
      }
      return;
    }
    if (child) {
      if (method === "turn/started") this.update(child, { status: "running" }, true);
      if (method === "turn/completed") this.update(child, { status: params.turn?.status === "failed" ? "failed" : params.turn?.status === "interrupted" ? "stopped" : "idle" });
      if (method === "thread/closed") this.update(child, { status: "stopped" });
      if (method === "thread/status/changed") this.update(child, { status: statusOf(params.status?.type ?? params.status) });
      if (method === "thread/tokenUsage/updated") this.update(child, { tokens: params.tokenUsage?.total?.totalTokens });
      if (method === "item/completed" && item.type === "agentMessage") this.update(child, { output: text(item.text), progress: text(item.text) });
      if (method === "error" && !params.willRetry) this.update(child, { status: "failed", output: text(params.error?.message) });
    }
    if ((method === "item/started" || method === "item/completed") && item.type === "commandExecution") {
      if (!text(item.id)) return;
      const id = `codex:shell:${threadId}:${params.turnId ?? ""}:${item.id}`;
      this.update(id, { kind: "shell", provider: "codex", taskId: threadId, toolUseId: item.id, parentId: child, title: text(item.command), command: text(item.command), status: method === "item/completed" && typeof item.exitCode === "number" && item.exitCode !== 0 ? "failed" : statusOf(item.status) ?? (method === "item/completed" ? "completed" : "running"), output: text(item.aggregatedOutput) });
    }
    if (method === "item/commandExecution/outputDelta") {
      const row = this.rows.get(`codex:shell:${threadId}:${params.turnId ?? ""}:${params.itemId}`)
        ?? [...this.rows.values()].reverse().find((row) => row.kind === "shell" && row.taskId === threadId && row.toolUseId === params.itemId);
      if (row) this.update(row.id, { output: `${row.output ?? ""}${typeof params.delta === "string" ? params.delta : ""}`.slice(-12_000) });
    }
  }

  cursor(call: { toolCallId: string; kind?: string | null; name?: string | null; title: string; status?: string | null; rawInput?: unknown }, entry: ConvEntry): void {
    this.tool("cursor", entry.id, call.kind === "execute" ? "execute" : call.name ?? "", { ...record(call.rawInput), description: call.title });
    this.update(`cursor:${entry.id}`, { status: statusOf(call.status), output: entry.output });
  }
}
