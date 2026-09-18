import {
  canWriteThread,
  CURSOR_CLOUD_COMPUTER_ID,
  threadSnapshotSchema,
  type ThreadMember,
  type ThreadSnapshot,
} from "@remy/contract";
import { githubRepository } from "./hosted-git.js";
import type { ThreadStore } from "./thread-store.js";

const CURSOR_API = "https://api.cursor.com";
const META_PREFIX = "cursor-cloud:thread:";
const MAX_TEXT = 32_000;
const MAX_ARG = 8_000;
const MAX_OUTPUT = 16_000;

export type CursorCloudApi = {
  me(apiKey: string): Promise<{ apiKeyName: string; userEmail?: string; userFirstName?: string; userLastName?: string }>;
  create(apiKey: string, input: { name?: string; text: string; origin: string; startingRef: string; mode: "agent" | "plan" }): Promise<{ agentId: string; runId: string }>;
  followUp(apiKey: string, agentId: string, input: { text: string; mode?: "agent" | "plan" }): Promise<{ runId: string }>;
  stream(apiKey: string, agentId: string, runId: string): AsyncIterable<{ type: string; data: Record<string, unknown> }>;
  getRun(apiKey: string, agentId: string, runId: string): Promise<{ status: string; result?: string; error?: { message?: string }; git?: { branches?: { prUrl?: string }[] } }>;
  cancel(apiKey: string, agentId: string, runId: string): Promise<void>;
  archive(apiKey: string, agentId: string): Promise<void>;
};

type CursorCloudMeta = {
  workspaceId: string;
  origin: string;
  startingRef: string;
  cwd: string;
  permissionMode: string;
  cursorAgentId?: string;
  cursorRunId?: string;
};

type Entry = Record<string, unknown> & { id: string; kind: string };

type KeyStore = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<unknown>;
};

let api: CursorCloudApi = defaultCursorCloudApi();

export function setCursorCloudApiForTest(replacement: CursorCloudApi): void {
  api = replacement;
}

export function cursorCloudRepoUrl(origin: string): string | undefined {
  const trimmed = origin.trim();
  if (!trimmed) return;
  if (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/i.test(trimmed)) {
    return trimmed.replace(/\.git$/i, "");
  }
  const github = githubRepository(trimmed);
  if (github) return `https://github.com/${github}`;
  if (/^https:\/\/[^\s]+$/i.test(trimmed)) return trimmed.replace(/\.git$/i, "");
}

export async function verifyCursorCloudKey(apiKey: string): Promise<void> {
  const key = apiKey.trim();
  if (!key || key.length > 8192) throw new Error("Enter a Cursor API key.");
  await api.me(key);
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function safeError(error: unknown, secret?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = secret ? message.split(secret).join("[REDACTED]") : message;
  return clip(redacted, 600) || "Cursor Cloud could not finish that run.";
}

function objectText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function redact(value: string, secret?: string): string {
  return secret ? value.split(secret).join("[REDACTED]") : value;
}

async function cursorRequest(apiKey: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, CURSOR_API), {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
}

async function cursorJson<T>(apiKey: string, path: string, init?: RequestInit): Promise<T> {
  const response = await cursorRequest(apiKey, path, init);
  const body = await response.json().catch(() => ({})) as { error?: unknown; message?: unknown };
  if (!response.ok) {
    const error = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : `Cursor Cloud returned HTTP ${response.status}.`;
    throw new Error(error);
  }
  return body as T;
}

async function* readSse(response: Response): AsyncIterable<{ type: string; data: Record<string, unknown> }> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const chunks = buffer.split("\n\n");
    buffer = done ? "" : chunks.pop() ?? "";
    for (const chunk of chunks) {
      let type = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) type = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      try { yield { type, data: JSON.parse(data) as Record<string, unknown> }; }
      catch { yield { type, data: { text: data } }; }
    }
    if (done) break;
  }
}

function defaultCursorCloudApi(): CursorCloudApi {
  return {
    async me(apiKey) {
      return cursorJson(apiKey, "/v1/me");
    },
    async create(apiKey, input) {
      const body = await cursorJson<{ agent?: { id?: string }; run?: { id?: string; agentId?: string } }>(apiKey, "/v1/agents", {
        method: "POST",
        body: JSON.stringify({
          prompt: { text: input.text },
          ...(input.name ? { name: input.name.slice(0, 100) } : {}),
          mode: input.mode,
          autoCreatePR: true,
          repos: [{ url: input.origin, startingRef: input.startingRef }],
        }),
      });
      const agentId = body.agent?.id ?? body.run?.agentId;
      const runId = body.run?.id;
      if (!agentId || !runId) throw new Error("Cursor Cloud did not start that run.");
      return { agentId, runId };
    },
    async followUp(apiKey, agentId, input) {
      const body = await cursorJson<{ run?: { id?: string } }>(apiKey, `/v1/agents/${encodeURIComponent(agentId)}/runs`, {
        method: "POST",
        body: JSON.stringify({ prompt: { text: input.text }, ...(input.mode ? { mode: input.mode } : {}) }),
      });
      if (!body.run?.id) throw new Error("Cursor Cloud did not start that run.");
      return { runId: body.run.id };
    },
    async *stream(apiKey, agentId, runId) {
      const response = await cursorRequest(apiKey, `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/stream`, {
        headers: { accept: "text/event-stream" },
      });
      if (response.status === 410) return;
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: unknown };
        throw new Error(typeof body.error === "string" ? body.error : `Cursor Cloud returned HTTP ${response.status}.`);
      }
      yield* readSse(response);
    },
    async getRun(apiKey, agentId, runId) {
      const body = await cursorJson<{
        status?: string;
        result?: string;
        error?: { message?: string };
        git?: { branches?: { prUrl?: string }[] };
      }>(apiKey, `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`);
      return { status: body.status ?? "UNKNOWN", ...(body.result !== undefined ? { result: body.result } : {}), ...(body.error !== undefined ? { error: body.error } : {}), ...(body.git !== undefined ? { git: body.git } : {}) };
    },
    async cancel(apiKey, agentId, runId) {
      await cursorJson(apiKey, `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
    },
    async archive(apiKey, agentId) {
      await cursorJson(apiKey, `/v1/agents/${encodeURIComponent(agentId)}/archive`, { method: "POST" });
    },
  };
}

function permissionMode(value: unknown): string {
  return value === "plan" ? "plan" : "default";
}

function runMode(value: string): "agent" | "plan" {
  return value === "plan" ? "plan" : "agent";
}

export class CursorCloudThreads {
  private readonly draining = new Set<string>();

  constructor(
    private readonly threads: ThreadStore,
    private readonly storage: KeyStore,
    private readonly waitUntil: (work: Promise<unknown>) => void,
    private readonly now: () => number = Date.now,
  ) {}

  private metaKey(id: string) {
    return `${META_PREFIX}${id}`;
  }

  async create(input: {
    organizationId: string;
    actor: ThreadMember;
    workspaceId: string;
    origin: string;
    startingRef?: string;
    title?: string;
    visibility?: "private" | "open";
    permissionMode?: unknown;
    apiKey: string | undefined;
  }): Promise<ThreadSnapshot> {
    if (!input.apiKey) throw new Error("Connect Cursor Cloud in Computers settings.");
    const origin = cursorCloudRepoUrl(input.origin);
    if (!origin) throw new Error("Cursor Cloud needs a git remote it can clone.");
    const id = crypto.randomUUID();
    const now = this.now();
    const title = clip(redact(input.title?.trim() || "New thread", input.apiKey), 200);
    const snapshot = threadSnapshotSchema.parse({
      id,
      revision: 1,
      access: {
        organizationId: input.organizationId,
        owner: input.actor,
        visibility: input.visibility === "open" ? "open" : "private",
        participants: [input.actor],
      },
      detail: {
        id,
        title,
        cwd: "/workspace",
        provider: "cursor",
        permissionMode: permissionMode(input.permissionMode),
        state: "idle",
        entries: [],
        todos: [],
        createdAt: now,
        updatedAt: now,
      },
    });
    await this.storage.put(this.metaKey(id), {
      workspaceId: input.workspaceId,
      origin,
      startingRef: input.startingRef?.trim() || "main",
      cwd: "/workspace",
      permissionMode: permissionMode(input.permissionMode),
    } satisfies CursorCloudMeta);
    await this.threads.snapshot(CURSOR_CLOUD_COMPUTER_ID, snapshot);
    return snapshot;
  }

  async get(id: string): Promise<ThreadSnapshot | undefined> {
    const thread = await this.threads.get(CURSOR_CLOUD_COMPUTER_ID, id);
    if (!thread) return;
    return threadSnapshotSchema.parse({
      id: thread.id,
      revision: thread.revision,
      access: thread.access,
      detail: thread.detail,
    });
  }

  async handle(
    id: string,
    actor: ThreadMember,
    method: string,
    action: string | undefined,
    input: Record<string, unknown>,
    apiKey: string | undefined,
  ): Promise<Response> {
    const thread = await this.threads.get(CURSOR_CLOUD_COMPUTER_ID, id);
    if (!thread) return Response.json({ error: "This thread is no longer available." }, { status: 404 });
    if (method === "GET" && !action) {
      return Response.json({ ...thread, member: actor });
    }
    if (method === "POST" && action === "join") {
      if (thread.access.participants.some((member) => member.id === actor.id) || thread.access.owner.id === actor.id) {
        return Response.json(await this.get(id));
      }
      const next = {
        ...thread,
        revision: thread.revision + 1,
        access: { ...thread.access, participants: [...thread.access.participants, actor] },
      };
      await this.threads.snapshot(CURSOR_CLOUD_COMPUTER_ID, next);
      return Response.json(await this.get(id));
    }
    if (!canWriteThread(thread.access, actor.id)) return Response.json({ error: "Join this thread before replying." }, { status: 403 });
    if (method === "POST" && action === "message") {
      if (Array.isArray(input.attachmentIds) && input.attachmentIds.length) {
        return Response.json({ error: "Cursor Cloud cannot attach images." }, { status: 400 });
      }
      const text = typeof input.text === "string" ? input.text.trim() : "";
      if (!text) return Response.json({ error: "Enter a message." }, { status: 400 });
      if (!apiKey) return Response.json({ error: "Connect Cursor Cloud in Computers settings." }, { status: 409 });
      await this.send(id, text, apiKey, actor);
      return Response.json({ ok: true }, { status: 202 });
    }
    if (method === "POST" && action === "interrupt") {
      if (!apiKey) return Response.json({ error: "Connect Cursor Cloud in Computers settings." }, { status: 409 });
      await this.interrupt(id, apiKey);
      return Response.json({ ok: true });
    }
    if (method === "POST" && action === "archive") {
      if (!apiKey) return Response.json({ error: "Connect Cursor Cloud in Computers settings." }, { status: 409 });
      await this.archive(id, apiKey);
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && action === "visibility") {
      if (input.visibility !== "private" && input.visibility !== "open") {
        return Response.json({ error: "Choose who can read this thread." }, { status: 400 });
      }
      await this.threads.snapshot(CURSOR_CLOUD_COMPUTER_ID, {
        ...thread,
        revision: thread.revision + 1,
        access: { ...thread.access, visibility: input.visibility },
      });
      return Response.json(await this.get(id));
    }
    if (method === "POST" && action === "options") {
      const meta = await this.storage.get<CursorCloudMeta>(this.metaKey(id));
      if (input.permissionMode !== undefined) {
        const nextMode = permissionMode(input.permissionMode);
        if (meta) await this.storage.put(this.metaKey(id), { ...meta, permissionMode: nextMode });
        await this.threads.snapshot(CURSOR_CLOUD_COMPUTER_ID, {
          ...thread,
          revision: thread.revision + 1,
          detail: { ...thread.detail, permissionMode: nextMode, updatedAt: this.now() },
        });
      }
      return Response.json(await this.get(id));
    }
    if (method === "PATCH") {
      const title = typeof input.title === "string" ? input.title.trim() : "";
      if (!title) return Response.json({ error: "Enter a title." }, { status: 400 });
      await this.threads.snapshot(CURSOR_CLOUD_COMPUTER_ID, {
        ...thread,
        revision: thread.revision + 1,
        detail: { ...thread.detail, title: clip(redact(title, apiKey), 200), updatedAt: this.now() },
      });
      return Response.json(await this.get(id));
    }
    if (method === "DELETE") {
      await this.threads.removeGroup(CURSOR_CLOUD_COMPUTER_ID, id);
      await this.storage.delete(this.metaKey(id));
      return new Response(null, { status: 204 });
    }
    return Response.json({ error: "This action is not available." }, { status: 404 });
  }

  private async send(id: string, text: string, apiKey: string, actor: ThreadMember): Promise<void> {
    const thread = await this.threads.get(CURSOR_CLOUD_COMPUTER_ID, id);
    const meta = await this.storage.get<CursorCloudMeta>(this.metaKey(id));
    if (!thread || !meta) throw new Error("This thread is no longer available.");
    if (thread.detail.state === "working" || this.draining.has(id)) throw new Error("Cursor Cloud is still working on that thread.");
    const safeText = clip(redact(text, apiKey), MAX_TEXT);
    const entries = [...(thread.detail.entries as Entry[]), {
      id: typeof crypto.randomUUID === "function" ? `u-${crypto.randomUUID()}` : `u-${this.now()}`,
      kind: "user",
      text: safeText,
      member: actor,
    }];
    const title = thread.detail.title === "New thread" ? clip(safeText.split("\n")[0] || "New thread", 80) : thread.detail.title;
    await this.threads.snapshot(CURSOR_CLOUD_COMPUTER_ID, {
      ...thread,
      revision: thread.revision + 1,
      detail: {
        ...thread.detail,
        title,
        entries,
        state: "working",
        action: "Starting Cursor Cloud",
        workingSince: this.now(),
        error: undefined,
        live: true,
        updatedAt: this.now(),
      },
    });
    this.waitUntil(this.drain(id, safeText, apiKey).catch(() => undefined));
  }

  private async drain(id: string, text: string, apiKey: string): Promise<void> {
    if (this.draining.has(id)) return;
    this.draining.add(id);
    try {
      const meta = await this.storage.get<CursorCloudMeta>(this.metaKey(id));
      if (!meta) return;
      const mode = runMode(meta.permissionMode);
      const started = meta.cursorAgentId
        ? { agentId: meta.cursorAgentId, ...(await api.followUp(apiKey, meta.cursorAgentId, { text, mode })) }
        : await api.create(apiKey, { name: String((await this.threads.get(CURSOR_CLOUD_COMPUTER_ID, id))?.detail.title ?? ""), text, origin: meta.origin, startingRef: meta.startingRef, mode });
      meta.cursorAgentId = started.agentId;
      meta.cursorRunId = started.runId;
      await this.storage.put(this.metaKey(id), meta);
      const agentId = started.agentId;
      try {
        for await (const event of api.stream(apiKey, agentId, started.runId)) {
          await this.applyEvent(id, event, apiKey);
        }
      } catch {
        // A cloud run outlives Remy's connection. The run record is the terminal result.
      }
      const result = await api.getRun(apiKey, agentId, started.runId);
      const status = result.status.toUpperCase();
      if (result.result?.trim()) await this.append(id, { id: `assistant-${started.runId}`, kind: "assistant", text: clip(redact(result.result, apiKey), MAX_TEXT) });
      const pr = result.git?.branches?.find((branch) => branch.prUrl)?.prUrl;
      if (pr) {
        await this.append(id, {
          id: `result-${started.runId}`,
          kind: "tool",
          tool: "Cursor Cloud",
          verb: "opened a pull request",
          arg: clip(redact(pr, apiKey), MAX_ARG),
          status: "ok",
        });
      }
      await this.finish(id, status === "FINISHED" || status === "COMPLETED" ? undefined : safeError(result.error?.message ?? `Cursor Cloud ${result.status}.`, apiKey));
    } catch (error) {
      await this.finish(id, safeError(error, apiKey));
    } finally {
      this.draining.delete(id);
    }
  }

  private async applyEvent(id: string, event: { type: string; data: Record<string, unknown> }, apiKey: string): Promise<void> {
    if (event.type === "assistant") {
      const text = typeof event.data.text === "string" ? event.data.text : "";
      if (!text) return;
      const thread = await this.threads.get(CURSOR_CLOUD_COMPUTER_ID, id);
      const current = (thread?.detail.entries as Entry[] | undefined)?.find((entry) => entry.id.startsWith("assistant-") && entry.kind === "assistant");
      const entryId = current?.id ?? `assistant-${this.now()}`;
      await this.append(id, { id: entryId, kind: "assistant", text: clip(redact(`${current?.text ?? ""}${text}`, apiKey), MAX_TEXT) });
      return;
    }
    if (event.type === "thinking") {
      const text = typeof event.data.text === "string" ? event.data.text : "";
      if (!text) return;
      const thread = await this.threads.get(CURSOR_CLOUD_COMPUTER_ID, id);
      const current = (thread?.detail.entries as Entry[] | undefined)?.find((entry) => entry.kind === "thinking");
      const entryId = current?.id ?? `thinking-${this.now()}`;
      await this.append(id, { id: entryId, kind: "thinking", text: clip(redact(`${current?.text ?? ""}${text}`, apiKey), 1200) });
      return;
    }
    if (event.type === "tool_call") {
      const callId = String(event.data.callId ?? this.now());
      const status = event.data.status === "completed" || event.data.status === "error" ? event.data.status : "running";
      const arg = objectText(event.data.args);
      const output = objectText(event.data.result);
      await this.append(id, {
        id: `tool-${callId}`,
        kind: "tool",
        tool: String(event.data.name ?? "tool"),
        verb: status === "running" ? "running" : status === "error" ? "failed" : "finished",
        ...(arg !== undefined ? { arg: clip(redact(arg, apiKey), MAX_ARG) } : {}),
        ...(output !== undefined ? { output: clip(redact(output, apiKey), MAX_OUTPUT) } : {}),
        ...(status === "error" ? { status: "error" } : status === "completed" ? { status: "ok" } : {}),
      }, status === "running" ? String(event.data.name ?? "tool") : undefined);
      return;
    }
    if (event.type === "status") {
      const status = String(event.data.status ?? "");
      const action = status === "CREATING" ? "Starting Cursor Cloud" : status === "RUNNING" ? "Working in Cursor Cloud" : undefined;
      const thread = await this.threads.get(CURSOR_CLOUD_COMPUTER_ID, id);
      if (!thread) return;
      await this.threads.snapshot(CURSOR_CLOUD_COMPUTER_ID, {
        ...thread,
        revision: thread.revision + 1,
        detail: { ...thread.detail, action, live: true, updatedAt: this.now() },
      });
    }
  }

  private async append(id: string, entry: Entry, action?: string): Promise<void> {
    const thread = await this.threads.get(CURSOR_CLOUD_COMPUTER_ID, id);
    if (!thread) return;
    const entries = [...(thread.detail.entries as Entry[])];
    const at = entries.findIndex((existing) => existing.id === entry.id);
    if (at >= 0) entries[at] = entry;
    else entries.push(entry);
    await this.threads.snapshot(CURSOR_CLOUD_COMPUTER_ID, {
      ...thread,
      revision: thread.revision + 1,
      detail: { ...thread.detail, entries, action, updatedAt: this.now() },
    });
  }

  private async finish(id: string, error?: string): Promise<void> {
    const thread = await this.threads.get(CURSOR_CLOUD_COMPUTER_ID, id);
    if (!thread) return;
    await this.threads.snapshot(CURSOR_CLOUD_COMPUTER_ID, {
      ...thread,
      revision: thread.revision + 1,
      detail: {
        ...thread.detail,
        state: error ? "error" : "idle",
        action: undefined,
        workingSince: undefined,
        live: false,
        error,
        updatedAt: this.now(),
      },
    });
  }

  private async interrupt(id: string, apiKey: string): Promise<void> {
    const meta = await this.storage.get<CursorCloudMeta>(this.metaKey(id));
    if (meta?.cursorAgentId && meta.cursorRunId) await api.cancel(apiKey, meta.cursorAgentId, meta.cursorRunId);
    await this.finish(id);
  }

  private async archive(id: string, apiKey: string): Promise<void> {
    const thread = await this.threads.get(CURSOR_CLOUD_COMPUTER_ID, id);
    if (thread?.detail.state === "working") throw new Error("Stop that thread before archiving it.");
    const meta = await this.storage.get<CursorCloudMeta>(this.metaKey(id));
    if (apiKey && meta?.cursorAgentId) await api.archive(apiKey, meta.cursorAgentId).catch(() => undefined);
    await this.threads.removeGroup(CURSOR_CLOUD_COMPUTER_ID, id);
    await this.storage.delete(this.metaKey(id));
  }
}
