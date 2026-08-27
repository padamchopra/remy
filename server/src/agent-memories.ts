import { randomUUID } from "node:crypto";
import { append, entityIds, eventsFor } from "./board-log.js";
import { db } from "./db.js";
import { getAgent } from "./agents.js";
import { getProject, projectForWorkspace } from "./projects.js";
import { listWorkspaces } from "./workspaces.js";

export type AgentMemoryScope = "global" | "workspace";

export interface AgentMemory {
  id: string;
  agentId: string;
  scope: AgentMemoryScope;
  projectId?: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

function scope(value: unknown): AgentMemoryScope {
  return value === "workspace" ? "workspace" : "global";
}

function content(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 4000) : "";
}

function fold(id: string): AgentMemory | undefined {
  const events = eventsFor("memory", id);
  let memory: AgentMemory | undefined;
  for (const event of events) {
    if (event.kind === "tombstone") return undefined;
    if (event.kind === "create") {
      const agentId = typeof event.payload.agentId === "string" ? event.payload.agentId : "";
      const text = content(event.payload.content);
      if (!agentId || !text) continue;
      const memoryScope = scope(event.payload.scope);
      const projectId = memoryScope === "workspace" && typeof event.payload.projectId === "string"
        ? event.payload.projectId
        : undefined;
      if (memoryScope === "workspace" && !projectId) continue;
      memory = {
        id,
        agentId,
        scope: memoryScope,
        ...(projectId ? { projectId } : {}),
        content: text,
        createdAt: event.at,
        updatedAt: event.at,
      };
      continue;
    }
    if (!memory || event.kind !== "field") continue;
    const text = content(event.payload.content);
    if (text) memory = { ...memory, content: text, updatedAt: event.at };
  }
  return memory;
}

function write(memory: AgentMemory): void {
  db.prepare(
    `insert into agent_memories (id, agent_id, scope, project_id, content, created_at, updated_at, deleted)
     values (?, ?, ?, ?, ?, ?, ?, 0)
     on conflict(id) do update set
       agent_id = excluded.agent_id, scope = excluded.scope, project_id = excluded.project_id,
       content = excluded.content, updated_at = excluded.updated_at, deleted = 0`,
  ).run(
    memory.id,
    memory.agentId,
    memory.scope,
    memory.projectId ?? null,
    memory.content,
    memory.createdAt,
    memory.updatedAt,
  );
}

export function reproject(id: string): AgentMemory | undefined {
  const memory = fold(id);
  if (!memory) {
    db.prepare("update agent_memories set deleted = 1 where id = ?").run(id);
    return undefined;
  }
  write(memory);
  return memory;
}

export function reprojectAll(): void {
  for (const id of entityIds("memory")) reproject(id);
}

function toMemory(row: Record<string, unknown>): AgentMemory {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    scope: scope(row.scope),
    ...(row.project_id ? { projectId: String(row.project_id) } : {}),
    content: String(row.content),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function getMemory(id: string): AgentMemory | undefined {
  const row = db.prepare("select * from agent_memories where id = ? and deleted = 0").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? toMemory(row) : undefined;
}

export function listMemories(
  agentId: string,
  options: { projectId?: string; query?: string; limit?: number } = {},
): AgentMemory[] {
  const rows = db.prepare(
    `select * from agent_memories
      where agent_id = ? and deleted = 0
        and (scope = 'global' or project_id = ?)
      order by updated_at desc, id asc`,
  ).all(agentId, options.projectId ?? "") as Record<string, unknown>[];
  const query = options.query?.trim().toLowerCase();
  const filtered = query
    ? rows.filter((row) => String(row.content).toLowerCase().includes(query))
    : rows;
  return filtered.slice(0, Math.min(Math.max(options.limit ?? 50, 1), 100)).map(toMemory);
}

export function saveMemory(input: {
  agentId: string;
  content: unknown;
  scope?: unknown;
  projectId?: unknown;
  id?: string;
}): AgentMemory {
  if (!getAgent(input.agentId)) throw new Error("no such agent");
  const text = content(input.content);
  if (!text) throw new Error("a memory needs something worth remembering");
  const memoryScope = scope(input.scope);
  const projectId = memoryScope === "workspace" && typeof input.projectId === "string"
    ? input.projectId
    : undefined;
  if (memoryScope === "workspace" && (!projectId || !getProject(projectId))) {
    throw new Error("choose a workspace for this memory");
  }
  const existing = input.id ? getMemory(input.id) : undefined;
  if (input.id && (!existing || existing.agentId !== input.agentId)) throw new Error("no such memory");
  const id = existing?.id ?? randomUUID();
  append("memory", id, existing ? "field" : "create", existing
    ? { content: text }
    : {
        agentId: input.agentId,
        scope: memoryScope,
        ...(projectId ? { projectId } : {}),
        content: text,
      });
  const saved = reproject(id);
  if (!saved) throw new Error("could not save that memory");
  return saved;
}

export function forgetMemory(agentId: string, id: string): void {
  const existing = getMemory(id);
  if (!existing || existing.agentId !== agentId) throw new Error("no such memory");
  append("memory", id, "tombstone");
  reproject(id);
}

export async function projectIdForCwd(cwd: string): Promise<string | undefined> {
  const workspaces = await listWorkspaces().catch(() => []);
  const workspace = workspaces
    .flatMap((entry) => [entry, ...entry.worktrees.map((tree) => ({ ...entry, path: tree.path }))])
    .sort((a, b) => b.path.length - a.path.length)
    .find((entry) => cwd === entry.path || cwd.startsWith(`${entry.path}/`));
  return workspace ? projectForWorkspace(workspace.id)?.id : undefined;
}

export async function memoryPrompt(agentId: string, cwd: string): Promise<string | undefined> {
  const memories = listMemories(agentId, { projectId: await projectIdForCwd(cwd), limit: 40 });
  if (memories.length === 0) return undefined;
  let used = 0;
  const lines: string[] = [];
  for (const memory of memories) {
    const line = `- [${memory.id}] ${memory.content}`;
    if (used + line.length > 12_000) break;
    lines.push(line);
    used += line.length;
  }
  return `<remy_agent_memory>\nThese are durable memories you saved in earlier runs. Use them as context, and update them with the Remy memory tools when a durable fact changes. Never save credentials, environment values, or private tool output.\n${lines.join("\n")}\n</remy_agent_memory>`;
}
