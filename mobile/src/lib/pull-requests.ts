import type { AuthoredPullRequest } from "../state/types";

function updatedAt(pullRequest: AuthoredPullRequest): number {
  const value = Date.parse(pullRequest.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

/// Collapses the same GitHub pull request reported by several computers while
/// retaining every route that can still answer for it.
export function mergePullRequests(pullRequests: readonly AuthoredPullRequest[]): AuthoredPullRequest[] {
  const merged = new Map<string, AuthoredPullRequest>();
  for (const pullRequest of pullRequests) {
    const previous = merged.get(pullRequest.url);
    if (!previous) {
      merged.set(pullRequest.url, { ...pullRequest, sourceServerIds: [pullRequest.serverId] });
      continue;
    }
    const preferred = !previous.worktreePath && pullRequest.worktreePath ? pullRequest : previous;
    merged.set(pullRequest.url, {
      ...preferred,
      stack: preferred.stack !== undefined ? preferred.stack : previous.stack ?? pullRequest.stack,
      sourceServerIds: [...new Set([
        ...(previous.sourceServerIds ?? [previous.serverId]),
        ...(pullRequest.sourceServerIds ?? [pullRequest.serverId]),
      ])],
    });
  }
  const groups = new Map<string, AuthoredPullRequest[]>();
  for (const pullRequest of merged.values()) {
    const key = pullRequest.stack
      ? `${pullRequest.repository.toLowerCase()}:${pullRequest.stack.number}`
      : pullRequest.url;
    groups.set(key, [...(groups.get(key) ?? []), pullRequest]);
  }
  return [...groups.entries()]
    .map(([key, members]) => ({ key, members, newest: Math.max(...members.map(updatedAt)) }))
    .sort((left, right) => right.newest - left.newest || left.key.localeCompare(right.key))
    .flatMap(({ members }) => members.sort((left, right) =>
      (right.stack?.position ?? 0) - (left.stack?.position ?? 0)
      || updatedAt(right) - updatedAt(left)
      || left.url.localeCompare(right.url)));
}

export function pullRequestAttention(pullRequest: AuthoredPullRequest): "failing" | "waiting" | "open" {
  if (pullRequest.checks.some((check) => check.state === "fail")) return "failing";
  if (pullRequest.hasUnreadActivity || pullRequest.reviewDecision === "CHANGES_REQUESTED") return "waiting";
  return "open";
}
