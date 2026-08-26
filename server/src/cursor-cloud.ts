import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Agent, Cursor, type Run, type SDKAgent, type SDKMessage } from "@cursor/sdk";
import { deviceId } from "./board-log.js";
import { config } from "./config.js";
import { db, getKv, setKv } from "./db.js";
import { redactExact, redactForCwd, redactKnownSecrets } from "./environments.js";
import { broadcast } from "./notify.js";
import { MAX_ARG, MAX_OUTPUT, MAX_TEXT, type ConvEntry } from "./transcript.js";

const KEYCHAIN_SERVICE = "me.padamchopra.Remy.cursor-cloud";
const API_KEY_KV = "cursorCloudApiKey";
const ACCOUNT_KV = "cursorCloudAccount";

export const CURSOR_CLOUD_DEVICE_ID = "cursor-cloud";

type CloudState = "idle" | "working" | "error";

interface CloudChatRecord {
  id: string;
  title: string;
  cwd: string;
  origin: string;
  startingRef: string;
  model?: string;
  permissionMode: string;
  cursorAgentId?: string;
  cursorRunId?: string;
  state: CloudState;
  action?: string;
  workingSince?: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  archivedAt?: number;
  entries: ConvEntry[];
}

export interface CursorCloudStatus {
  configured: boolean;
  visible: boolean;
  enabled: boolean;
  account?: string;
  keyName?: string;
}

interface CursorCloudAccount {
  account?: string;
  keyName?: string;
}

export interface CursorCloudSdk {
  me(apiKey: string): Promise<{ apiKeyName: string; userEmail?: string; userFirstName?: string; userLastName?: string }>;
  create(options: Parameters<typeof Agent.create>[0]): Promise<SDKAgent>;
  resume(agentId: string, options: Parameters<typeof Agent.resume>[1]): Promise<SDKAgent>;
  getRun(runId: string, agentId: string, apiKey: string): Promise<Run>;
  cancel(runId: string, agentId: string, apiKey: string): Promise<void>;
  archive(agentId: string, apiKey: string): Promise<void>;
}

let sdk: CursorCloudSdk = {
  me: (apiKey) => Cursor.me({ apiKey }),
  create: (options) => Agent.create(options),
  resume: (agentId, options) => Agent.resume(agentId, options),
  getRun: (runId, agentId, apiKey) => Agent.getRun(runId, { runtime: "cloud", agentId, apiKey }),
  cancel: (runId, agentId, apiKey) => Agent.cancelRun(runId, { runtime: "cloud", agentId, apiKey }),
  archive: (agentId, apiKey) => Agent.archive(agentId, { apiKey }),
};

let cachedApiKey: string | null | undefined;
const activeRuns = new Map<string, Run>();
const draining = new Set<string>();

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function cleartextApiKey(): string | undefined {
  if (cachedApiKey !== undefined) return cachedApiKey || undefined;
  let value = "";
  if (process.platform === "darwin" && !process.env.MC_CONFIG_DIR) {
    try {
      value = execFileSync("/usr/bin/security", [
        "find-generic-password", "-a", deviceId, "-s", KEYCHAIN_SERVICE, "-w",
      ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      value = "";
    }
  } else {
    value = getKv<string>(API_KEY_KV) ?? "";
  }
  cachedApiKey = value || null;
  return value || undefined;
}

function saveApiKey(value: string): void {
  if (process.platform === "darwin" && !process.env.MC_CONFIG_DIR) {
    execFileSync("/usr/bin/security", [
      "add-generic-password", "-U", "-a", deviceId, "-s", KEYCHAIN_SERVICE, "-w", value,
    ], { stdio: "ignore" });
  } else {
    setKv(API_KEY_KV, value);
  }
  cachedApiKey = value;
}

function removeApiKey(): void {
  if (process.platform === "darwin" && !process.env.MC_CONFIG_DIR) {
    try {
      execFileSync("/usr/bin/security", [
        "delete-generic-password", "-a", deviceId, "-s", KEYCHAIN_SERVICE,
      ], { stdio: "ignore" });
    } catch {
      // Already absent.
    }
  } else {
    db.prepare("delete from kv where key = ?").run(API_KEY_KV);
  }
  cachedApiKey = null;
}

function safeError(error: unknown, secret?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = redactExact(redactKnownSecrets(message), secret ? [secret] : []);
  return clip(redacted, 600) || "Cursor Cloud could not finish that run.";
}

function rowToRecord(row: Record<string, unknown>): CloudChatRecord {
  const entries = db.prepare(
    "select json from cursor_cloud_entries where chat_id = ? order by seq",
  ).all(String(row.id)) as { json: string }[];
  return {
    id: String(row.id),
    title: String(row.title),
    cwd: String(row.cwd),
    origin: String(row.origin),
    startingRef: String(row.starting_ref),
    ...(row.model ? { model: String(row.model) } : {}),
    permissionMode: String(row.permission_mode ?? "default"),
    ...(row.cursor_agent_id ? { cursorAgentId: String(row.cursor_agent_id) } : {}),
    ...(row.cursor_run_id ? { cursorRunId: String(row.cursor_run_id) } : {}),
    state: String(row.state ?? "idle") as CloudState,
    ...(row.action ? { action: String(row.action) } : {}),
    ...(row.working_since ? { workingSince: Number(row.working_since) } : {}),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    ...(row.error ? { error: String(row.error) } : {}),
    ...(row.archived_at ? { archivedAt: Number(row.archived_at) } : {}),
    entries: entries.flatMap((entry) => {
      try {
        return [JSON.parse(entry.json) as ConvEntry];
      } catch {
        return [];
      }
    }),
  };
}

function allRecords(): CloudChatRecord[] {
  const rows = db.prepare("select * from cursor_cloud_chats order by updated_at desc").all() as Record<string, unknown>[];
  return rows.map(rowToRecord);
}

function record(id: string): CloudChatRecord {
  const row = db.prepare("select * from cursor_cloud_chats where id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw new Error("no such thread");
  return rowToRecord(row);
}

function saveRecord(chat: CloudChatRecord): void {
  db.prepare(
    `insert into cursor_cloud_chats (
       id, title, cwd, origin, starting_ref, model, permission_mode, cursor_agent_id,
       cursor_run_id, state, action, working_since, created_at, updated_at, error, archived_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set
       title = excluded.title, model = excluded.model, permission_mode = excluded.permission_mode,
       cursor_agent_id = excluded.cursor_agent_id, cursor_run_id = excluded.cursor_run_id,
       state = excluded.state, action = excluded.action, working_since = excluded.working_since,
       updated_at = excluded.updated_at, error = excluded.error, archived_at = excluded.archived_at`,
  ).run(
    chat.id, chat.title, chat.cwd, chat.origin, chat.startingRef, chat.model ?? null,
    chat.permissionMode, chat.cursorAgentId ?? null, chat.cursorRunId ?? null,
    chat.state, chat.action ?? null, chat.workingSince ?? null, chat.createdAt,
    chat.updatedAt, chat.error ?? null, chat.archivedAt ?? null,
  );
}

function saveEntry(chatId: string, entry: ConvEntry): void {
  db.prepare(
    `insert into cursor_cloud_entries (chat_id, seq, entry_id, json)
     values (?, (select coalesce(max(seq), 0) + 1 from cursor_cloud_entries where chat_id = ?), ?, ?)
     on conflict(chat_id, entry_id) do update set json = excluded.json`,
  ).run(chatId, chatId, entry.id, JSON.stringify(entry));
}

function summary(chat: CloudChatRecord): Record<string, unknown> {
  const preview = [...chat.entries].reverse().find((entry) =>
    (entry.kind === "assistant" || entry.kind === "user") && entry.text?.trim())?.text;
  return {
    id: chat.id,
    title: chat.title,
    cwd: chat.cwd,
    provider: "cursor",
    model: chat.model,
    permissionMode: chat.permissionMode,
    state: chat.state,
    action: chat.action,
    preview: preview ? clip(preview, 140) : undefined,
    workingSince: chat.workingSince,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    error: chat.error,
    live: activeRuns.has(chat.id),
  };
}

function detail(chat: CloudChatRecord): Record<string, unknown> {
  return { ...summary(chat), entries: chat.entries, todos: [] };
}

function stateFields(chat: CloudChatRecord): Record<string, unknown> {
  return {
    state: chat.state,
    action: chat.action ?? null,
    workingSince: chat.workingSince ?? null,
    title: chat.title,
    live: activeRuns.has(chat.id),
    error: chat.error ?? null,
    updatedAt: chat.updatedAt,
  };
}

function push(chat: CloudChatRecord, entries?: ConvEntry[]): void {
  broadcast({ type: "chat", chatId: chat.id, ...(entries?.length ? { entries } : {}), ...stateFields(chat) });
}

function append(chat: CloudChatRecord, entry: ConvEntry): void {
  const at = chat.entries.findIndex((existing) => existing.id === entry.id);
  if (at >= 0) chat.entries[at] = entry;
  else chat.entries.push(entry);
  saveEntry(chat.id, entry);
  push(chat, [entry]);
}

function objectText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function safeCloudText(chat: Pick<CloudChatRecord, "cwd">, value: string, max: number): Promise<string> {
  const environmentSafe = await redactForCwd(chat.cwd, value);
  const apiKey = cleartextApiKey();
  return clip(redactExact(environmentSafe, apiKey ? [apiKey] : []), max);
}

export async function applyCursorCloudMessage(chat: CloudChatRecord, message: SDKMessage): Promise<void> {
  if (message.type === "assistant") {
    const text = message.message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("");
    if (!text) return;
    const id = `assistant-${message.run_id}`;
    const current = chat.entries.find((entry) => entry.id === id)?.text ?? "";
    append(chat, { id, kind: "assistant", text: await safeCloudText(chat, `${current}${text}`, MAX_TEXT) });
    return;
  }
  if (message.type === "thinking") {
    const id = `thinking-${message.run_id}`;
    const current = chat.entries.find((entry) => entry.id === id)?.text ?? "";
    append(chat, { id, kind: "thinking", text: await safeCloudText(chat, `${current}${message.text}`, 1200) });
    return;
  }
  if (message.type === "tool_call") {
    const arg = objectText(message.args);
    const output = objectText(message.result);
    append(chat, {
      id: `tool-${message.run_id}-${message.call_id}`,
      kind: "tool",
      tool: message.name,
      verb: message.status === "running" ? "running" : message.status === "error" ? "failed" : "finished",
      ...(arg !== undefined ? { arg: await safeCloudText(chat, arg, MAX_ARG) } : {}),
      ...(output !== undefined ? { output: await safeCloudText(chat, output, MAX_OUTPUT) } : {}),
      ...(message.status === "error" ? { status: "error" as const } : message.status === "completed" ? { status: "ok" as const } : {}),
    });
    chat.action = message.status === "running" ? message.name : undefined;
    return;
  }
  if (message.type === "status") {
    chat.action = message.status === "CREATING"
      ? "Starting Cursor Cloud"
      : message.status === "RUNNING"
        ? "Working in Cursor Cloud"
        : undefined;
    push(chat);
  }
}

async function drain(chat: CloudChatRecord, run: Run, agent?: SDKAgent): Promise<void> {
  if (draining.has(chat.id)) return;
  draining.add(chat.id);
  activeRuns.set(chat.id, run);
  push(chat);
  const apiKey = cleartextApiKey();
  try {
    try {
      for await (const message of run.stream()) await applyCursorCloudMessage(chat, message);
    } catch (streamError) {
      // A cloud run outlives Remy's connection. Once Cursor's replay window has
      // elapsed, the run record is still the authoritative terminal result.
      if (run.status === "running") throw streamError;
    }
    const result = await run.wait();
    if (result.result?.trim()) {
      const id = `assistant-${run.id}`;
      if (!chat.entries.some((entry) => entry.id === id && entry.text?.trim())) {
        append(chat, { id, kind: "assistant", text: await safeCloudText(chat, result.result, MAX_TEXT) });
      }
    }
    const pr = result.git?.branches.find((branch) => branch.prUrl)?.prUrl;
    if (pr) {
      append(chat, {
        id: `result-${run.id}`,
        kind: "tool",
        tool: "Cursor Cloud",
        verb: "opened a pull request",
        arg: await safeCloudText(chat, pr, MAX_ARG),
        status: "ok",
      });
    }
    chat.state = result.status === "finished" ? "idle" : "error";
    chat.error = result.status === "finished" ? undefined : safeError(result.error?.message ?? `Cursor Cloud ${result.status}.`, apiKey);
  } catch (error) {
    chat.state = "error";
    chat.error = safeError(error, apiKey);
  } finally {
    agent?.close();
    activeRuns.delete(chat.id);
    draining.delete(chat.id);
    chat.action = undefined;
    chat.workingSince = undefined;
    chat.updatedAt = Date.now();
    saveRecord(chat);
    push(chat);
    broadcast({ type: "chats" });
  }
}

function requireApiKey(): string {
  const key = cleartextApiKey();
  if (!key) throw new Error("connect Cursor Cloud in Providers first");
  if (!config.enabledProviders.includes("cursor")) throw new Error("turn on Cursor in Providers first");
  return key;
}

export async function connectCursorCloud(value: unknown): Promise<CursorCloudStatus> {
  if (!config.enabledProviders.includes("cursor")) throw new Error("turn on Cursor in Providers first");
  const apiKey = typeof value === "string" ? value.trim() : "";
  if (!apiKey || apiKey.length > 512) throw new Error("enter a Cursor API key");
  const me = await sdk.me(apiKey).catch((error) => {
    throw new Error(safeError(error, apiKey));
  });
  saveApiKey(apiKey);
  const name = [me.userFirstName, me.userLastName].filter(Boolean).join(" ") || me.userEmail;
  setKv(ACCOUNT_KV, {
    ...(name ? { account: clip(redactExact(name, [apiKey]), 160) } : {}),
    keyName: clip(redactExact(me.apiKeyName, [apiKey]), 160),
  } satisfies CursorCloudAccount);
  return cursorCloudStatus();
}

export function disconnectCursorCloud(): CursorCloudStatus {
  removeApiKey();
  return cursorCloudStatus();
}

export function cursorCloudStatus(): CursorCloudStatus {
  const account = getKv<CursorCloudAccount>(ACCOUNT_KV) ?? {};
  const configured = Boolean(cleartextApiKey());
  const saved = db.prepare("select 1 as present from cursor_cloud_chats limit 1").get() as { present?: number } | undefined;
  return {
    configured,
    visible: configured || Boolean(saved?.present),
    enabled: config.enabledProviders.includes("cursor"),
    ...account,
  };
}

export function listCursorCloudChats(): Record<string, unknown>[] {
  const chats = allRecords().filter((chat) => !chat.archivedAt);
  for (const chat of chats) resumeCursorCloudChat(chat);
  return chats.map(summary);
}

export function getCursorCloudChat(id: string): Record<string, unknown> {
  const chat = record(id);
  resumeCursorCloudChat(chat);
  return detail(chat);
}

export async function createCursorCloudChat(input: {
  cwd: string;
  origin: string;
  startingRef: string;
  title?: string;
  permissionMode?: string;
}): Promise<Record<string, unknown>> {
  requireApiKey();
  const now = Date.now();
  const requestedTitle = input.title?.trim() || "New thread";
  const chat: CloudChatRecord = {
    id: randomUUID(),
    title: await safeCloudText({ cwd: input.cwd }, requestedTitle, 120),
    cwd: input.cwd,
    origin: input.origin,
    startingRef: input.startingRef || "main",
    permissionMode: input.permissionMode === "plan" ? "plan" : "default",
    state: "idle",
    createdAt: now,
    updatedAt: now,
    entries: [],
  };
  saveRecord(chat);
  broadcast({ type: "chats" });
  return summary(chat);
}

export async function sendCursorCloudMessage(id: string, value: unknown): Promise<void> {
  const apiKey = requireApiKey();
  const chat = record(id);
  if (chat.archivedAt) throw new Error("that thread is archived");
  if (chat.state === "working" || activeRuns.has(id)) throw new Error("Cursor Cloud is still working on that thread");
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return;
  const safeText = await safeCloudText(chat, text, MAX_TEXT);
  if (chat.entries.length === 0 && chat.title === "New thread") chat.title = clip(safeText.split("\n")[0] || "New thread", 80);
  append(chat, { id: `user-${randomUUID()}`, kind: "user", text: safeText });
  chat.state = "working";
  chat.workingSince = Date.now();
  chat.updatedAt = Date.now();
  chat.error = undefined;
  chat.action = "Starting Cursor Cloud";
  saveRecord(chat);
  push(chat);

  try {
    const mode = chat.permissionMode === "plan" ? "plan" as const : "agent" as const;
    const agent = chat.cursorAgentId
      ? await sdk.resume(chat.cursorAgentId, { apiKey, mode })
      : await sdk.create({
          apiKey,
          name: chat.title,
          mode,
          cloud: {
            repos: [{ url: chat.origin, startingRef: chat.startingRef }],
            autoCreatePR: true,
            metadata: { remy_chat_id: chat.id },
          },
        });
    chat.cursorAgentId = agent.agentId;
    const run = await agent.send(safeText, { mode });
    chat.cursorRunId = run.id;
    saveRecord(chat);
    void drain(chat, run, agent);
  } catch (error) {
    chat.state = "error";
    chat.error = safeError(error, apiKey);
    chat.action = undefined;
    chat.workingSince = undefined;
    chat.updatedAt = Date.now();
    saveRecord(chat);
    push(chat);
  }
}

function resumeCursorCloudChat(chat: CloudChatRecord): void {
  if (chat.state !== "working" || !chat.cursorAgentId || !chat.cursorRunId || draining.has(chat.id)) return;
  const apiKey = cleartextApiKey();
  if (!apiKey) return;
  draining.add(chat.id);
  void sdk.getRun(chat.cursorRunId, chat.cursorAgentId, apiKey)
    .then((run) => {
      draining.delete(chat.id);
      return drain(chat, run);
    })
    .catch((error) => {
      draining.delete(chat.id);
      chat.state = "error";
      chat.error = safeError(error, apiKey);
      chat.action = undefined;
      chat.workingSince = undefined;
      chat.updatedAt = Date.now();
      saveRecord(chat);
      push(chat);
    });
}

export async function interruptCursorCloudChat(id: string): Promise<void> {
  const chat = record(id);
  const run = activeRuns.get(id);
  const apiKey = requireApiKey();
  if (run) await run.cancel();
  else if (chat.cursorAgentId && chat.cursorRunId) await sdk.cancel(chat.cursorRunId, chat.cursorAgentId, apiKey);
  chat.state = "idle";
  chat.action = undefined;
  chat.workingSince = undefined;
  chat.updatedAt = Date.now();
  saveRecord(chat);
  push(chat);
}

export async function updateCursorCloudChat(
  id: string,
  patch: { title?: unknown; permissionMode?: unknown },
): Promise<Record<string, unknown>> {
  const chat = record(id);
  if (typeof patch.title === "string" && patch.title.trim()) {
    chat.title = await safeCloudText(chat, patch.title.trim(), 120);
  }
  if (patch.permissionMode !== undefined) chat.permissionMode = patch.permissionMode === "plan" ? "plan" : "default";
  chat.updatedAt = Date.now();
  saveRecord(chat);
  push(chat);
  broadcast({ type: "chats" });
  return summary(chat);
}

export async function archiveCursorCloudChat(id: string): Promise<void> {
  const chat = record(id);
  if (chat.state === "working") throw new Error("stop that thread before archiving it");
  const apiKey = cleartextApiKey();
  if (apiKey && chat.cursorAgentId) await sdk.archive(chat.cursorAgentId, apiKey).catch(() => {});
  chat.archivedAt = Date.now();
  chat.updatedAt = chat.archivedAt;
  saveRecord(chat);
  broadcast({ type: "chats" });
}

export function listCursorCloudArchives(): Record<string, unknown>[] {
  return allRecords().filter((chat) => chat.archivedAt).map((chat) => ({
    id: chat.id,
    session: chat.cursorAgentId ?? chat.id,
    archivedAt: chat.archivedAt,
    agent: "cursor",
    cwd: chat.cwd,
    conversation: { title: chat.title },
  }));
}

export function deleteCursorCloudChat(id: string): void {
  if (activeRuns.has(id)) throw new Error("stop that thread before deleting it");
  db.prepare("delete from cursor_cloud_entries where chat_id = ?").run(id);
  const result = db.prepare("delete from cursor_cloud_chats where id = ?").run(id);
  if (result.changes === 0) throw new Error("no such thread");
  broadcast({ type: "chats" });
}

export function setCursorCloudSdkForTest(replacement: CursorCloudSdk): void {
  sdk = replacement;
}
