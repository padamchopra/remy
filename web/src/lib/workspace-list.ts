import type { ComputerSummary, HubThread } from "@remy/contract";

type WorkspaceRef = { id: string; origin?: string | null };

/// One spelling of a remote, so ssh, https and host/owner/repo forms compare equal.
export const normalizeRepositoryOrigin = (value: string) => value.trim().replace(/^\w+:\/\//, "").replace(/^git@/, "").replace(/:([^/])/, "/$1").replace(/\.git\/?$/, "").replace(/\/$/, "").toLowerCase();

/// The workspace a hub thread runs in. A thread that names its workspace is
/// taken at its word; otherwise its folder on the computer running it is
/// matched against that computer's workspaces, by id and then by origin.
export function hubThreadWorkspace<W extends WorkspaceRef>(
  thread: HubThread,
  computers: ComputerSummary[] | undefined,
  workspaces: W[] | undefined,
): W | undefined {
  if (!workspaces?.length) return undefined;
  const detail = thread.detail;
  if (typeof detail.workspaceId === "string") {
    const named = workspaces.find((entry) => entry.id === detail.workspaceId);
    if (named) return named;
  }
  const computer = computers?.find((entry) => entry.computerId === thread.computerId);
  const cwd = typeof detail.cwd === "string" ? detail.cwd : undefined;
  const local = cwd === undefined ? undefined : computer?.capabilities.workspaces.find((entry) =>
    cwd === entry.path || cwd.startsWith(`${entry.path}/`));
  if (!local) return undefined;
  return workspaces.find((entry) =>
    entry.id === local.id
    || (!!entry.origin && !!local.origin && normalizeRepositoryOrigin(entry.origin) === normalizeRepositoryOrigin(local.origin)));
}

/// When a thread last moved, for ordering the workspaces it ran in.
export function hubThreadActivity(thread: HubThread): number {
  const updated = thread.detail.updatedAt;
  if (typeof updated === "number") return updated;
  const created = thread.detail.createdAt;
  return typeof created === "number" ? created : thread.observedAt;
}

/// A repository origin the way a row names it: owner/repo on GitHub, and
/// host/path anywhere else, without the scheme, user or `.git`.
export function workspaceOriginLabel(origin: string): string {
  const path = origin.trim()
    .replace(/^\w[\w+.-]*:\/\//, "")
    .replace(/^[^@/]+@/, "")
    .replace(/^([^/:]+):(?!\d+\/)/, "$1/")
    .replace(/\.git\/?$/, "")
    .replace(/\/+$/, "");
  return /^(www\.)?github\.com\//i.test(path) ? path.replace(/^(www\.)?github\.com\//i, "") : path;
}

/// Whether a row answers a search: its name, its repository or its owner.
export function workspaceMatches(query: string, row: { name: string; origin: string; owner: string }): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [row.name, row.origin, workspaceOriginLabel(row.origin), row.owner]
    .some((value) => value.toLowerCase().includes(needle));
}

/// Newest thread first; workspaces with no thread after them, by name.
export function compareWorkspaces(
  left: { name: string; lastThreadAt?: number },
  right: { name: string; lastThreadAt?: number },
): number {
  if (left.lastThreadAt !== undefined || right.lastThreadAt !== undefined) {
    if (left.lastThreadAt === undefined) return 1;
    if (right.lastThreadAt === undefined) return -1;
    if (left.lastThreadAt !== right.lastThreadAt) return right.lastThreadAt - left.lastThreadAt;
  }
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}
