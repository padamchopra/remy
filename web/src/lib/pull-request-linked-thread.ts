import { normalizeRepositoryOrigin } from "./workspace-list";

/// The parts of a hub thread this decision reads.
export interface LinkedThreadCandidate {
  id: string;
  computerId: string;
  observedAt: number;
  access: { organizationId: string };
  detail: { cwd?: unknown; branch?: unknown; updatedAt?: unknown; state?: unknown; title?: string } & Record<string, unknown>;
}

/// The parts of a computer this decision reads: which folders it holds.
export interface LinkedThreadComputer {
  computerId: string;
  capabilities: { workspaces: readonly { id: string; path: string; origin: string | null }[] };
}

/// The pull request the thread would be linked to.
export interface LinkedThreadPullRequest {
  repository: string;
  headRefName: string;
  workspaceId: string;
}

/// Whether a thread's folder is a copy of the pull request's repository: the
/// workspace it runs in is that workspace, or has that repository as origin.
export function threadInPullRequestWorkspace(
  thread: LinkedThreadCandidate,
  pullRequest: LinkedThreadPullRequest,
  computers: readonly LinkedThreadComputer[],
): boolean {
  const cwd = typeof thread.detail.cwd === "string" ? thread.detail.cwd : "";
  if (!cwd) return false;
  const computer = computers.find((entry) => entry.computerId === thread.computerId);
  const folder = computer?.capabilities.workspaces.find((entry) =>
    cwd === entry.path || cwd.startsWith(`${entry.path.replace(/\/+$/, "")}/`));
  if (!folder) return false;
  if (folder.id === pullRequest.workspaceId) return true;
  return !!folder.origin
    && normalizeRepositoryOrigin(folder.origin) === `github.com/${pullRequest.repository}`.toLowerCase();
}

function activeAt(thread: LinkedThreadCandidate): number {
  return typeof thread.detail.updatedAt === "number" ? thread.detail.updatedAt : thread.observedAt;
}

/// The Remy thread working on a pull request, derived rather than chosen: of
/// the threads you can read, the most recently active one in the pull
/// request's workspace whose branch is the pull request's head branch.
/// `exclude` leaves out threads that watch a pull request without working on
/// it, such as a review agent's.
export function linkedPullRequestThread<T extends LinkedThreadCandidate>(
  pullRequest: LinkedThreadPullRequest,
  threads: readonly T[],
  computers: readonly LinkedThreadComputer[],
  exclude: (thread: T) => boolean = () => false,
): T | undefined {
  if (!pullRequest.headRefName) return undefined;
  return threads
    .filter((thread) =>
      thread.computerId !== "pending"
      && thread.detail.branch === pullRequest.headRefName
      && !exclude(thread)
      && threadInPullRequestWorkspace(thread, pullRequest, computers))
    .sort((left, right) => activeAt(right) - activeAt(left))[0];
}

/// A linked thread's dot: blue while it works, amber when it needs you, grey
/// otherwise.
export function linkedThreadTone(state: unknown): "working" | "needs_input" | "done" {
  return state === "working" ? "working" : state === "needs_input" ? "needs_input" : "done";
}
