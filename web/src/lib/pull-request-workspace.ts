/// Enough of a workspace for a pull-request tile to wear the same mark
/// the rest of the app uses. The list payload carries a snapshot; a live
/// workspace row wins when this window already has one.
export interface PullRequestWorkspaceFields {
  serverId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceIcon?: string | null;
  workspaceTint?: string | null;
}

export interface PullRequestTileWorkspace {
  id: string;
  name?: string;
  icon?: string | null;
  tint?: string | null;
  serverId?: string;
  organizationId?: string;
}

export function hostedOrganizationId(serverId: string): string | undefined {
  return serverId.startsWith("github:") ? serverId.slice("github:".length) : undefined;
}

export function pullRequestTileWorkspace(
  pullRequest: PullRequestWorkspaceFields,
  workspaces: readonly PullRequestTileWorkspace[] = [],
  hostedWorkspaces: readonly PullRequestTileWorkspace[] = [],
): { workspace: PullRequestTileWorkspace; name: string; organizationId?: string } {
  const organizationId = hostedOrganizationId(pullRequest.serverId);
  const local = workspaces.find((entry) =>
    entry.id === pullRequest.workspaceId
    && (entry.serverId === undefined || entry.serverId === pullRequest.serverId),
  );
  if (local) {
    return { workspace: local, name: local.name ?? pullRequest.workspaceName, organizationId };
  }
  const hosted = organizationId
    ? hostedWorkspaces.find((entry) =>
      entry.id === pullRequest.workspaceId
      && (entry.organizationId === undefined || entry.organizationId === organizationId))
    : undefined;
  if (hosted) {
    return { workspace: hosted, name: hosted.name ?? pullRequest.workspaceName, organizationId };
  }
  return {
    workspace: {
      id: pullRequest.workspaceId,
      icon: pullRequest.workspaceIcon,
      tint: pullRequest.workspaceTint,
    },
    name: pullRequest.workspaceName,
    organizationId,
  };
}
