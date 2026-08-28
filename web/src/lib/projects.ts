import {
  Box,
  Code,
  Database,
  Folder,
  GitBranch,
  Globe,
  Sparkles,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import type { Project, Server, Workspace } from "@/state/types";

/// Icons a workspace can wear in the list and in project settings.
export const PROJECT_ICONS = {
  folder: Folder,
  code: Code,
  terminal: Terminal,
  git: GitBranch,
  globe: Globe,
  database: Database,
  box: Box,
  sparkles: Sparkles,
} as const;

export type ProjectIconId = keyof typeof PROJECT_ICONS;

export const PROJECT_ICON_IDS = Object.keys(PROJECT_ICONS) as ProjectIconId[];

export function isProjectIcon(value: unknown): value is ProjectIconId {
  return typeof value === "string" && value in PROJECT_ICONS;
}

const PROJECT_ICON_FILE = /\.(png|jpe?g|svg|webp)$/i;

export function isProjectIconFile(value: unknown): value is string {
  return typeof value === "string" && PROJECT_ICON_FILE.test(value) && !value.includes("..");
}

export function projectIcon(id: ProjectIconId | string | null | undefined): LucideIcon {
  return PROJECT_ICONS[id && isProjectIcon(id) ? id : "folder"];
}

export interface WorkspaceGroup {
  /// Stable across refreshes. Repository copies share their normalised origin;
  /// ordinary folders include the device because their paths are only local.
  id: string;
  workspace: Workspace;
  copies: Workspace[];
}

/// Every device-local checkout represented by one workspace row.
///
/// A Git remote is the repository's cross-device identity. A plain folder has
/// no equivalent identity, so even the same path and name on two machines must
/// remain two workspaces rather than being guessed into one.
export function workspaceCopies(workspace: Workspace, all: Workspace[]): Workspace[] {
  if (workspace.origin) {
    return all.filter((entry) => !entry.virtual && entry.origin === workspace.origin);
  }
  return all.filter(
    (entry) => !entry.virtual && entry.serverId === workspace.serverId && entry.id === workspace.id,
  );
}

/// A repository's mark belongs to its synced project, while its path and model
/// remain choices of the device-local checkout. Projecting the shared fields
/// onto every copy keeps all existing workspace renderers honest.
export function applyProjectIdentity(workspaces: Workspace[], projects: Project[]): Workspace[] {
  const byOrigin = new Map(
    projects.flatMap((project) => project.origin ? [[project.origin, project] as const] : []),
  );
  const byWorkspace = new Map(
    projects.flatMap((project) => project.workspaceIds.map((id) => [id, project] as const)),
  );
  return workspaces.map((workspace) => {
    const project = (workspace.origin ? byOrigin.get(workspace.origin) : undefined) ?? byWorkspace.get(workspace.id);
    if (!project) return workspace;
    return {
      ...workspace,
      ...(Object.hasOwn(project, "icon") ? { icon: project.icon ?? null } : {}),
      ...(Object.hasOwn(project, "tint") ? { tint: project.tint ?? null } : {}),
    };
  });
}

/// One row per repository, or per device-local folder.
///
/// The representative is a real checkout because opening a workspace still
/// needs a concrete machine and path. Prefer this machine, then any connected
/// machine, while the group retains every copy for the device picker.
export function workspaceGroups(all: Workspace[], servers: Server[]): WorkspaceGroup[] {
  const grouped = new Map<string, Workspace[]>();
  for (const workspace of all) {
    if (workspace.virtual) continue;
    const id = workspace.origin
      ? `repository:${workspace.origin}`
      : `folder:${workspace.serverId}:${workspace.id}`;
    grouped.set(id, [...(grouped.get(id) ?? []), workspace]);
  }

  const serverRank = (workspace: Workspace): number => {
    const server = servers.find((entry) => entry.id === workspace.serverId);
    if (server?.local && server.online) return 0;
    if (server?.online) return 1;
    if (server?.local) return 2;
    return 3;
  };

  return [...grouped.entries()]
    .map(([id, copies]) => ({
      id,
      copies,
      workspace: [...copies].sort((a, b) => serverRank(a) - serverRank(b) || a.name.localeCompare(b.name))[0],
    }))
    .sort((a, b) => a.workspace.name.localeCompare(b.workspace.name));
}

/// The machines that hold the same repository as this workspace. A folder
/// without a git origin has no cross-device identity, so it stays on the one
/// machine where it was added rather than matching another folder by name.
export function devicesForWorkspace(workspace: Workspace, all: Workspace[], servers: Server[]): Server[] {
  const related = workspaceCopies(workspace, all);
  const ids = [...new Set(related.map((entry) => entry.serverId))];
  return ids
    .flatMap((id) => {
      const server = servers.find((entry) => entry.id === id);
      return server ? [server] : [];
    })
    .sort((a, b) => Number(Boolean(b.local)) - Number(Boolean(a.local)) || a.name.localeCompare(b.name));
}

/// Where a project is checked out on this machine, if it is at all. A project
/// spans devices; a workspace is one device's copy of it, so this is empty on a
/// machine that has not cloned the repo.
export function localWorkspace<W extends { id: string }>(
  project: { workspaceIds: string[] },
  workspaces: W[],
): W | undefined {
  return workspaces.find((workspace) => project.workspaceIds.includes(workspace.id));
}

/// The workspace a path belongs to. A chat runs in a checkout — the primary one
/// or one of its worktrees — so every known path is considered and the longest
/// match wins, which keeps a worktree from being read as its parent repo.
export function workspaceForPath(
  path: string,
  workspaces: { path: string; worktrees: { path: string }[] }[],
): number {
  let best = -1;
  let bestLength = 0;
  workspaces.forEach((workspace, index) => {
    for (const candidate of [workspace.path, ...workspace.worktrees.map((tree) => tree.path)]) {
      if (!candidate || candidate.length <= bestLength) continue;
      if (path !== candidate && !path.startsWith(`${candidate}/`)) continue;
      best = index;
      bestLength = candidate.length;
    }
  });
  return best;
}
