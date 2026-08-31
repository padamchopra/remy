interface StackablePullRequest {
  url: string;
  repository: string;
  updatedAt: string;
  stack?: { number: number; position: number } | null;
}

function updatedAt(pullRequest: StackablePullRequest): number {
  const timestamp = Date.parse(pullRequest.updatedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/// Preserve the list's order when grouping a filtered selection of stack members.
export function groupPullRequests<T extends StackablePullRequest>(pullRequests: readonly T[]) {
  const groups = new Map<string, { key: string; members: T[] }>();
  for (const pullRequest of pullRequests) {
    const key = pullRequest.stack
      ? `stack:${pullRequest.repository.toLowerCase()}:${pullRequest.stack.number}`
      : `pr:${pullRequest.url}`;
    const group = groups.get(key) ?? { key, members: [] };
    group.members.push(pullRequest);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/// Keep a stack at its newest member's position, with its tip first.
export function orderPullRequests<T extends StackablePullRequest>(pullRequests: readonly T[]): T[] {
  return groupPullRequests(pullRequests)
    .map((group) => ({ ...group, newest: group.members.reduce((newest, member) => Math.max(newest, updatedAt(member)), 0) }))
    .sort((a, b) => b.newest - a.newest || a.key.localeCompare(b.key))
    .flatMap((group) => group.members.sort((a, b) =>
      (b.stack?.position ?? 0) - (a.stack?.position ?? 0)
      || updatedAt(b) - updatedAt(a)
      || a.url.localeCompare(b.url),
    ));
}
