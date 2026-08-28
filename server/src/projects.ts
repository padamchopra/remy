import { randomUUID } from "node:crypto";
import { append, applyFields, entityIds, eventsFor } from "./board-log.js";
import { db, runTransaction } from "./db.js";
import {
  listWorkspaces,
  normalizeWorkspaceIcon,
  normalizeWorkspaceTint,
  type Workspace,
} from "./workspaces.js";

/// What a ticket belongs to.
///
/// A workspace is a path on one disk, so its id means nothing on another
/// machine and a ticket cannot point at one. A project is the repository
/// itself, keyed on the origin remote — which `workspaces.ts` already
/// normalises to `host/owner/repo`, collapsing the `git@` and `https://` forms
/// to the same string. Adding the same repo on a second machine therefore binds
/// it to the project that already exists, with nothing to set up.
///
/// The binding lives in `project_workspaces` and is deliberately *not* part of
/// the log: which folder holds a repo is this machine's business.

export interface Project {
  id: string;
  name: string;
  /// The letters in front of a ticket key. Changing it re-keys every ticket in
  /// the project at once, because a key is derived rather than stored.
  keyPrefix: string;
  origin?: string;
  icon: string | null;
  tint: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectView extends Project {
  /// Workspaces on this machine that are this project. Empty means the repo is
  /// not cloned here, which is a normal thing for a synced board to say.
  workspaceIds: string[];
}

const EDITABLE = ["name", "keyPrefix", "origin", "icon", "tint"] as const;

/// A slug someone typed, held to what reads as a ticket key: letters and
/// digits, upper case, short enough to sit in front of a number.
export function ticketSlug(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 6);
  return cleaned || undefined;
}

/// Five letters at most, from the words of a name: "Remy" → REMY, "mission
/// control" → MC. Falls back to a readable constant rather than an empty tag.
export function keyPrefixFor(name: string): string {
  const words = name
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "TASK";
  const initials = words.length > 1 ? words.map((word) => word[0]).join("") : words[0];
  return initials.slice(0, 5) || "TASK";
}

function uniquePrefix(name: string, exceptId?: string): string {
  const base = keyPrefixFor(name);
  const taken = new Set(
    (db.prepare("select id, key_prefix from projects where deleted = 0").all() as {
      id: string;
      key_prefix: string;
    }[])
      .filter((row) => row.id !== exceptId)
      .map((row) => row.key_prefix),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base.slice(0, 4)}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 3)}${Date.now() % 1000}`;
}

// ── projection ──────────────────────────────────────────────────────────────

function fold(id: string): Project | undefined {
  const events = eventsFor("project", id);
  if (events.length === 0) return undefined;
  let project: Project | undefined;
  for (const event of events) {
    if (event.kind === "tombstone") return undefined;
    if (event.kind === "create") {
      project = {
        id,
        name: String(event.payload.name ?? "Project"),
        keyPrefix: String(event.payload.keyPrefix ?? "TASK"),
        icon: null,
        tint: null,
        createdAt: event.at,
        updatedAt: event.at,
      };
      project = applyFields(project, event.payload, EDITABLE);
      continue;
    }
    if (!project || event.kind !== "field") continue;
    project = { ...applyFields(project, event.payload, EDITABLE), updatedAt: event.at };
  }
  return project;
}

export function reproject(id: string): Project | undefined {
  const project = fold(id);
  if (!project) {
    db.prepare("update projects set deleted = 1 where id = ?").run(id);
    return undefined;
  }
  db.prepare(
    `insert into projects (id, name, key_prefix, origin, icon, tint, counter, created_at, updated_at, deleted)
     values (?, ?, ?, ?, ?, ?, 0, ?, ?, 0)
     on conflict(id) do update set
       name = excluded.name, key_prefix = excluded.key_prefix,
       origin = excluded.origin, icon = excluded.icon, tint = excluded.tint,
       updated_at = excluded.updated_at, deleted = 0`,
  ).run(
    project.id,
    project.name,
    project.keyPrefix,
    project.origin ?? null,
    project.icon,
    project.tint,
    project.createdAt,
    project.updatedAt,
  );
  return project;
}

export function reprojectAll(): void {
  runTransaction(() => {
    for (const id of entityIds("project")) reproject(id);
  });
}

function toProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    keyPrefix: String(row.key_prefix),
    ...(row.origin ? { origin: String(row.origin) } : {}),
    icon: row.icon ? String(row.icon) : null,
    tint: row.tint ? String(row.tint) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

// ── reading ─────────────────────────────────────────────────────────────────

export function getProject(id: string): Project | undefined {
  const row = db.prepare("select * from projects where id = ? and deleted = 0").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? toProject(row) : undefined;
}

export function projectByOrigin(origin: string): Project | undefined {
  const row = db.prepare("select * from projects where origin = ? and deleted = 0").get(origin) as
    | Record<string, unknown>
    | undefined;
  return row ? toProject(row) : undefined;
}

function bindingsFor(projectId: string): string[] {
  const rows = db
    .prepare("select workspace_id from project_workspaces where project_id = ?")
    .all(projectId) as { workspace_id: string }[];
  return rows.map((row) => row.workspace_id);
}

export function projectForWorkspace(workspaceId: string): Project | undefined {
  const row = db
    .prepare("select project_id from project_workspaces where workspace_id = ?")
    .get(workspaceId) as { project_id?: string } | undefined;
  return row?.project_id ? getProject(row.project_id) : undefined;
}

export function listProjects(): ProjectView[] {
  const rows = db
    .prepare("select * from projects where deleted = 0 order by name asc")
    .all() as Record<string, unknown>[];
  return rows.map((row) => {
    const project = toProject(row);
    return { ...project, workspaceIds: bindingsFor(project.id) };
  });
}

// ── writing ─────────────────────────────────────────────────────────────────

export function createProject(input: {
  name: string;
  origin?: string;
  icon?: string | null;
  tint?: string | null;
}): Project {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new Error("a workspace needs a name");
  const id = randomUUID();
  append("project", id, "create", {
    name,
    keyPrefix: uniquePrefix(name),
    ...(input.origin ? { origin: input.origin } : {}),
    ...(input.icon ? { icon: normalizeWorkspaceIcon(input.icon) } : {}),
    ...(input.tint ? { tint: normalizeWorkspaceTint(input.tint) } : {}),
  });
  const project = reproject(id);
  if (!project) throw new Error("could not track that workspace");
  return project;
}

/// Renames a project, and changes the slug its tickets are keyed by.
///
/// Nothing is rewritten per ticket: a key is the ticket's number behind the
/// project's slug, so changing the slug here changes every key — the ones that
/// already exist and the ones that do not yet.
export function updateProject(
  id: string,
  patch: { name?: unknown; keyPrefix?: unknown; icon?: unknown; tint?: unknown },
): Project {
  const existing = getProject(id);
  if (!existing) throw new Error("no such workspace");
  const fields: Record<string, unknown> = {};

  if (patch.name !== undefined) {
    const name = typeof patch.name === "string" ? patch.name.trim().slice(0, 60) : "";
    if (!name) throw new Error("a workspace needs a name");
    fields.name = name;
  }
  if (patch.keyPrefix !== undefined) {
    const slug = ticketSlug(patch.keyPrefix);
    if (!slug) throw new Error("a slug needs at least one letter or digit");
    const clash = db
      .prepare("select id from projects where key_prefix = ? and id != ? and deleted = 0")
      .get(slug, id) as { id?: string } | undefined;
    if (clash) throw new Error(`another workspace already uses ${slug}`);
    fields.keyPrefix = slug;
  }
  if (patch.icon !== undefined) {
    fields.icon = normalizeWorkspaceIcon(patch.icon === null ? null : String(patch.icon));
  }
  if (patch.tint !== undefined) {
    fields.tint = normalizeWorkspaceTint(patch.tint === null ? null : String(patch.tint));
  }
  if (Object.keys(fields).length === 0) return existing;

  append("project", id, "field", fields);
  const project = reproject(id);
  if (!project) throw new Error("no such workspace");
  // Keys are derived, but the copy kept on each ticket row is what queries read,
  // so the project's tickets are rebuilt when its slug moves.
  if (fields.keyPrefix) onSlugChanged?.(id);
  return project;
}

/// Called when a project's slug changes. Set by `tickets.ts` at import time —
/// projects cannot import tickets, which import projects.
let onSlugChanged: ((projectId: string) => void) | undefined;
export function whenSlugChanges(handler: (projectId: string) => void): void {
  onSlugChanged = handler;
}

export function bindWorkspace(projectId: string, workspaceId: string): void {
  db.prepare(
    "insert or replace into project_workspaces (project_id, workspace_id) values (?, ?)",
  ).run(projectId, workspaceId);
}

export function unbindWorkspace(workspaceId: string): void {
  db.prepare("delete from project_workspaces where workspace_id = ?").run(workspaceId);
}

/// The project a workspace belongs to, creating one the first time. A workspace
/// with an origin joins whatever project already has that origin, which is what
/// makes the second machine's clone find the first machine's tickets.
export function adoptWorkspace(workspace: Workspace): Project {
  const bound = projectForWorkspace(workspace.id);
  if (bound) return seedProjectIdentity(bound, workspace);
  const origin = workspace.origin ?? undefined;
  const existing = origin ? projectByOrigin(origin) : undefined;
  const project = existing ?? createProject({
    name: workspace.name,
    origin,
    icon: workspace.icon,
    tint: workspace.tint,
  });
  bindWorkspace(project.id, workspace.id);
  return seedProjectIdentity(project, workspace);
}

function seedProjectIdentity(project: Project, workspace: Workspace): Project {
  const hasIdentityEvent = eventsFor("project", project.id).some((event) =>
    Object.hasOwn(event.payload, "icon") || Object.hasOwn(event.payload, "tint"));
  if (hasIdentityEvent || (!workspace.icon && !workspace.tint)) return project;
  return updateProject(project.id, { icon: workspace.icon, tint: workspace.tint });
}

/// Binds every workspace this machine knows about. Cheap, and run whenever the
/// board is read, so a repo added from the Workspaces pane appears without
/// anyone having to think about projects at all.
export async function syncProjectBindings(): Promise<void> {
  let workspaces: Workspace[];
  try {
    workspaces = await listWorkspaces();
  } catch {
    return;
  }
  for (const workspace of workspaces) {
    try {
      adoptWorkspace(workspace);
    } catch (error) {
      console.error(`could not bind ${workspace.name} to a project:`, error);
    }
  }
}

/// A folder on this machine to run a project's work in, if it is cloned here.
export async function workspacePathForProject(projectId: string): Promise<string | undefined> {
  return (await workspaceForProject(projectId))?.path;
}

/// The local folder for a project, including the model choice attached to it.
export async function workspaceForProject(projectId: string): Promise<Workspace | undefined> {
  const ids = new Set(bindingsFor(projectId));
  if (ids.size === 0) return undefined;
  const workspaces = await listWorkspaces();
  return workspaces.find((workspace) => ids.has(workspace.id));
}

/// The next ticket number for a project.
///
/// Derived from the numbers that exist rather than a stored counter, so it
/// stays correct when events arrive out of order. Once peers land this gains a
/// per-device block so two machines cannot mint the same number while they
/// cannot see each other.
export function nextTicketNumber(projectId: string): number {
  const row = db
    .prepare("select max(number) as high from tickets where project_id = ?")
    .get(projectId) as { high?: number | null };
  return Number(row?.high ?? 0) + 1;
}

/// What a ticket is called: its number behind its project's slug.
export function ticketKey(projectId: string, number: number): string {
  return `${getProject(projectId)?.keyPrefix ?? "TASK"}-${number}`;
}
