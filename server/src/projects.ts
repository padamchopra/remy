import { randomUUID } from "node:crypto";
import { append, applyFields, eventsFor } from "./board-log.js";
import { db } from "./db.js";
import {
  listWorkspaces,
  normalizeWorkspaceIcon,
  normalizeWorkspaceTint,
  type Workspace,
} from "./workspaces.js";

/// The repository behind a workspace.
///
/// A workspace is a path on one disk, so its id means nothing on another
/// machine. A project is the repository itself, keyed on the origin remote — which `workspaces.ts` already
/// normalises to `host/owner/repo`, collapsing the `git@` and `https://` forms
/// to the same string. Adding the same repo on a second machine therefore binds
/// it to the project that already exists, with nothing to set up.
///
/// The binding lives in `project_workspaces` and is deliberately *not* part of
/// the log: which folder holds a repo is this machine's business.

export interface Project {
  id: string;
  name: string;
  origin?: string;
  icon: string | null;
  tint: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectView extends Project {
  /// Workspaces on this machine that are this project.
  workspaceIds: string[];
}

const EDITABLE = ["name", "origin", "icon", "tint"] as const;

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
    `insert into projects (id, name, origin, icon, tint, created_at, updated_at, deleted)
     values (?, ?, ?, ?, ?, ?, ?, 0)
     on conflict(id) do update set
       name = excluded.name,
       origin = excluded.origin, icon = excluded.icon, tint = excluded.tint,
       updated_at = excluded.updated_at, deleted = 0`,
  ).run(
    project.id,
    project.name,
    project.origin ?? null,
    project.icon,
    project.tint,
    project.createdAt,
    project.updatedAt,
  );
  return project;
}

function toProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    name: String(row.name),
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
    ...(input.origin ? { origin: input.origin } : {}),
    ...(input.icon ? { icon: normalizeWorkspaceIcon(input.icon) } : {}),
    ...(input.tint ? { tint: normalizeWorkspaceTint(input.tint) } : {}),
  });
  const project = reproject(id);
  if (!project) throw new Error("could not track that workspace");
  return project;
}

/// Renames a project, or changes its icon or tint.
export function updateProject(
  id: string,
  patch: { name?: unknown; icon?: unknown; tint?: unknown },
): Project {
  const existing = getProject(id);
  if (!existing) throw new Error("no such workspace");
  const fields: Record<string, unknown> = {};

  if (patch.name !== undefined) {
    const name = typeof patch.name === "string" ? patch.name.trim().slice(0, 60) : "";
    if (!name) throw new Error("a workspace needs a name");
    fields.name = name;
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
  return project;
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
/// with an origin joins whatever project already has that origin.
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

/// Binds every workspace this machine knows about. Cheap, and run whenever
/// projects are read, so a repo added from the Workspaces pane appears without
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
