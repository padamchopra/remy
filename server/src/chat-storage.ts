import type { StatementSync } from "node:sqlite";
import { db } from "./db.js";
import { providerId, type ProviderId } from "./providers.js";
import type { ConvEntry, ConvTodo, ContextUsage } from "./transcript.js";
import type { ChatPermissionMode } from "./chat.js";

/// The columns of one chat. Its feed and plan live in their own rows.
export interface ChatRow {
  id: string;
  title: string;
  cwd: string;
  /// Which agent this thread thinks with, and so which of the two resume ids
  /// below carries it across turns.
  provider: ProviderId;
  model?: string;
  effort?: string;
  permissionMode: ChatPermissionMode;
  agentId?: string;
  /// True when this thread is an agent's inbox conversation rather than work in
  /// a repository. There is one per agent and it is never listed with threads.
  dm?: boolean;
  /// When this conversation was last read, so an inbox row knows to be bold.
  readAt?: number;
  /// Pinned threads lead the sidebar until you unpin them.
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
  claudeSessionId?: string;
  codexThreadId?: string;
  cursorSessionId?: string;
  turns: number;
  costUsd?: number;
  context?: ContextUsage;
  todos: ConvTodo[];
  error?: string;
}

export interface StoredChat extends ChatRow {
  entries: ConvEntry[];
}

export const chatStorageAvailable = (): boolean => true;
export const chatStorageError = (): string | undefined => undefined;

/// Throws the reason chats cannot be used, for endpoints that need to say so.
export function assertChatStorage(): void {
  // The shared database is opened at boot; if that failed, this module never loaded.
}

function writeChat(row: ChatRow): void {
  db.prepare(
    `insert into chats (
       id, title, cwd, provider, model, effort, permission_mode, created_at, updated_at,
       claude_session_id, codex_thread_id, cursor_session_id, turns, cost_usd, context_json, todos_json, error, agent_id, dm, read_at, pinned
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set
       title = excluded.title,
       agent_id = excluded.agent_id,
       dm = excluded.dm,
       read_at = excluded.read_at,
       pinned = excluded.pinned,
       cwd = excluded.cwd,
       provider = excluded.provider,
       model = excluded.model,
       effort = excluded.effort,
       permission_mode = excluded.permission_mode,
       updated_at = excluded.updated_at,
       claude_session_id = excluded.claude_session_id,
       codex_thread_id = excluded.codex_thread_id,
       cursor_session_id = excluded.cursor_session_id,
       turns = excluded.turns,
       cost_usd = excluded.cost_usd,
       context_json = excluded.context_json,
       todos_json = excluded.todos_json,
       error = excluded.error`,
  ).run(
    row.id,
    row.title,
    row.cwd,
    row.provider,
    row.model ?? null,
    row.effort ?? null,
    row.permissionMode,
    row.createdAt,
    row.updatedAt,
    row.claudeSessionId ?? null,
    row.codexThreadId ?? null,
    row.cursorSessionId ?? null,
    row.turns,
    row.costUsd ?? null,
    row.context ? JSON.stringify(row.context) : null,
    row.todos.length ? JSON.stringify(row.todos) : null,
    row.error ?? null,
    row.agentId ?? null,
    row.dm ? 1 : 0,
    row.readAt ?? null,
    row.pinned ? 1 : 0,
  );
}

/// Metadata only. A turn touches this on every state change, so it stays a
/// single small row rather than the feed it belongs to.
export function saveChat(row: ChatRow): void {
  writeChat(row);
}

/// Upserts one feed entry. `seq` is assigned on first insert and preserved on
/// update, so a streaming entry keeps its place while its text grows.
export function saveEntry(chatId: string, entry: ConvEntry): void {
  db.prepare(
    `insert into chat_entries (chat_id, seq, entry_id, json)
     values (?, (select coalesce(max(seq), 0) + 1 from chat_entries where chat_id = ?), ?, ?)
     on conflict(chat_id, entry_id) do update set json = excluded.json`,
  ).run(chatId, chatId, entry.id, JSON.stringify(entry));
}

export function deleteEntries(chatId: string, entryIds: string[]): void {
  if (entryIds.length === 0) return;
  const statement = db.prepare("delete from chat_entries where chat_id = ? and entry_id = ?");
  for (const id of entryIds) statement.run(chatId, id);
}

/// Keeps the newest `max` entries. Older turns stay in Claude's transcript.
export function trimEntries(chatId: string, max: number): void {
  db.prepare(
    `delete from chat_entries
      where chat_id = ?
        and entry_id not in (
          select entry_id from chat_entries where chat_id = ? order by seq desc limit ?
        )`,
  ).run(chatId, chatId, max);
}

export function removeChat(id: string): void {
  db.prepare("delete from chat_entries where chat_id = ?").run(id);
  db.prepare("delete from chats where id = ?").run(id);
}

/// Every chat with the tail of its feed, newest chat first.
export function loadChats(entryLimit: number): StoredChat[] {
  const rows = db.prepare("select * from chats order by updated_at desc").all() as Record<string, unknown>[];
  const entries = db.prepare("select json from chat_entries where chat_id = ? order by seq desc limit ?");
  return rows.map((row) => ({
    ...toChatRow(row),
    entries: readEntries(entries, String(row.id), entryLimit),
  }));
}

function readEntries(statement: StatementSync, chatId: string, limit: number): ConvEntry[] {
  const rows = statement.all(chatId, limit) as { json: string }[];
  const parsed: ConvEntry[] = [];
  // Selected newest-first so the limit takes the tail; the feed reads oldest-first.
  for (const row of rows.reverse()) {
    try {
      parsed.push(JSON.parse(row.json) as ConvEntry);
    } catch {
      // Skip an unreadable entry rather than losing the whole conversation.
    }
  }
  return parsed;
}

function toChatRow(row: Record<string, unknown>): ChatRow {
  return {
    id: String(row.id),
    title: String(row.title),
    cwd: String(row.cwd),
    provider: providerId(row.provider),
    ...(row.model ? { model: String(row.model) } : {}),
    ...(row.effort ? { effort: String(row.effort) } : {}),
    permissionMode: String(row.permission_mode) as ChatPermissionMode,
    ...(row.agent_id ? { agentId: String(row.agent_id) } : {}),
    ...(Number(row.dm) === 1 ? { dm: true } : {}),
    ...(typeof row.read_at === "number" ? { readAt: row.read_at } : {}),
    ...(Number(row.pinned) === 1 ? { pinned: true } : {}),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    ...(row.claude_session_id ? { claudeSessionId: String(row.claude_session_id) } : {}),
    ...(row.codex_thread_id ? { codexThreadId: String(row.codex_thread_id) } : {}),
    ...(row.cursor_session_id ? { cursorSessionId: String(row.cursor_session_id) } : {}),
    turns: Number(row.turns ?? 0),
    ...(typeof row.cost_usd === "number" ? { costUsd: row.cost_usd } : {}),
    ...(row.context_json ? { context: parse<ContextUsage>(String(row.context_json)) } : {}),
    todos: row.todos_json ? parse<ConvTodo[]>(String(row.todos_json)) ?? [] : [],
    ...(row.error ? { error: String(row.error) } : {}),
  };
}

function parse<T>(json: string): T | undefined {
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}
