import { Box, Code, Database, Folder, GitBranch, Globe, Sparkles, Terminal, type LucideIcon } from "lucide-react-native";
import type { Project, Server, Workspace } from "../state/types";

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
  id: string;
  workspace: Workspace;
  copies: Workspace[];
}

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

/// One repository across Macs, or one ordinary folder on one Mac.
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
    if (server?.home && server.online) return 0;
    if (server?.online) return 1;
    if (server?.home) return 2;
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
