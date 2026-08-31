import type { GitWorktree, Workspace } from "../state/types";

export interface WorktreeTarget {
  key: string;
  workspaceId: string;
  serverId: string;
  deviceName: string;
  tree: GitWorktree;
}

export function worktreeKey(serverId: string, path: string): string {
  return JSON.stringify([serverId, path]);
}

export function worktreeCopyKey(workspace: Pick<Workspace, "id" | "serverId">): string {
  return JSON.stringify([workspace.serverId, workspace.id]);
}

/// Only the exact dirty folders shown in the confirmation may be forced.
export async function cleanWorktreeSelection(
  targets: WorktreeTarget[],
  discardChanges: boolean,
  clean: (target: WorktreeTarget, force: boolean) => Promise<unknown>,
  onResult: (target: WorktreeTarget, error?: unknown) => void,
): Promise<void> {
  const devices = [...new Set(targets.map((target) => target.serverId))];
  await Promise.all(devices.map(async (serverId) => {
    for (const target of targets.filter((entry) => entry.serverId === serverId)) {
      try {
        if (target.tree.isMain) throw new Error("Main checkouts cannot be cleaned up.");
        if (target.tree.dirty && !discardChanges) throw new Error("Confirm discarding uncommitted changes first.");
        await clean(target, target.tree.dirty && discardChanges);
        onResult(target);
      } catch (error) {
        onResult(target, error);
      }
    }
  }));
}
