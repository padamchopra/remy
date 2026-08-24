import { randomUUID } from "node:crypto";
import { type AgentKind } from "./agent.js";
import { db } from "./db.js";
import { type Conversation } from "./transcript.js";

export interface ArchivedChat {
  id: string;
  chatId?: string;
  session: string;
  archivedAt: number;
  agent: AgentKind;
  cwd: string | null;
  conversation: Conversation;
}

export function listArchivedChats(): ArchivedChat[] {
  const rows = db
    .prepare("select id, chat_id, session, archived_at, agent, cwd, conversation_json from archives order by archived_at desc")
    .all() as {
    id: string;
    chat_id: string | null;
    session: string;
    archived_at: number;
    agent: string;
    cwd: string | null;
    conversation_json: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    ...(row.chat_id ? { chatId: row.chat_id } : {}),
    session: row.session,
    archivedAt: row.archived_at,
    agent: row.agent as AgentKind,
    cwd: row.cwd,
    conversation: parseConversation(row.conversation_json),
  }));
}

export function getArchivedChat(id: string): ArchivedChat | undefined {
  return listArchivedChats().find((archive) => archive.id === id);
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

function parseConversation(raw: string): Conversation {
  try {
    return JSON.parse(raw) as Conversation;
  } catch {
    return { available: false, todos: [], entries: [] };
  }
}
