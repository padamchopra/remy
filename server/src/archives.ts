import { randomUUID } from "node:crypto";
import { type AgentKind } from "./agent.js";
import type { ArchivedConversation } from "./chat.js";
import { db } from "./db.js";

export interface ArchivedChat {
  id: string;
  chatId?: string;
  session: string;
  archivedAt: number;
  agent: AgentKind;
  cwd: string | null;
  conversation: ArchivedConversation;
  summary?: boolean;
}

interface ArchiveRow {
  id: string;
  chat_id: string | null;
  session: string;
  archived_at: number;
  agent: string;
  cwd: string | null;
  conversation_json: string;
}

function fromRow(row: ArchiveRow): ArchivedChat {
  return {
    id: row.id,
    ...(row.chat_id ? { chatId: row.chat_id } : {}),
    session: row.session,
    archivedAt: row.archived_at,
    agent: row.agent as AgentKind,
    cwd: row.cwd,
    conversation: parseConversation(row.conversation_json),
  };
}

export function listArchivedChats(): ArchivedChat[] {
  const rows = db
    .prepare("select id, chat_id, session, archived_at, agent, cwd, conversation_json from archives order by archived_at desc")
    .all() as unknown as ArchiveRow[];
  return rows.map(fromRow);
}

export function listArchivedChatSummaries(): ArchivedChat[] {
  return listArchivedChats().map((archive) => {
    const preview = [...archive.conversation.entries].reverse().find(
      (entry) => (entry.kind === "assistant" || entry.kind === "user") && entry.text?.trim(),
    );
    const { entries: _entries, todos: _todos, context: _context, ...conversation } = archive.conversation;
    return {
      ...archive,
      summary: true,
      conversation: {
        ...conversation,
        entries: preview ? [preview] : [],
        todos: [],
      },
    };
  });
}

export function getArchivedChat(id: string): ArchivedChat | undefined {
  const row = db.prepare(
    "select id, chat_id, session, archived_at, agent, cwd, conversation_json from archives where id = ?",
  ).get(id) as ArchiveRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function archiveChat(input: Omit<ArchivedChat, "id" | "archivedAt">): ArchivedChat {
  const archive: ArchivedChat = {
    ...input,
    id: randomUUID(),
    archivedAt: Date.now(),
  };
  db.prepare(
    "insert into archives (id, chat_id, session, archived_at, agent, cwd, conversation_json) values (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    archive.id,
    archive.chatId ?? null,
    archive.session,
    archive.archivedAt,
    archive.agent,
    archive.cwd,
    JSON.stringify(archive.conversation),
  );
  return archive;
}

export function deleteArchivedChat(id: string): void {
  const result = db.prepare("delete from archives where id = ?").run(id);
  if (result.changes === 0) throw new Error("archived chat not found");
}

function parseConversation(raw: string): ArchivedConversation {
  try {
    return JSON.parse(raw) as ArchivedConversation;
  } catch {
    return { available: false, todos: [], entries: [] };
  }
}
