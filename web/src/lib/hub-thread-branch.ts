import { useEffect, useState } from "react";
import type { ComputerSummary, HubThread } from "@remy/contract";
import type { GitBranch } from "@/state/types";
import { hubRequest, hubThreadBase } from "./hub-threads";

/// Older computers expose the main checkout through the branch catalogue.
/// Never use that branch for a thread in a different worktree.
export function useHubThreadBranch(organizationId: string, thread: HubThread | undefined, computer: ComputerSummary | undefined) {
  const workspace = computer?.capabilities.workspaces.find(w => w.path === thread?.detail.cwd);
  const path = thread && workspace ? `${hubThreadBase(organizationId)}/computers/${encodeURIComponent(thread.computerId)}/workspaces/${encodeURIComponent(workspace.id)}/branches` : undefined;
  const [result, setResult] = useState<{path: string; branch: string | undefined}>();
  const reported = typeof thread?.detail.branch === "string" ? thread.detail.branch : undefined;
  const lastTool = [...(thread?.detail.entries ?? [])].reverse().find(entry => entry.kind === "tool");
  const toolFinished = !!lastTool?.output;
  useEffect(() => {
    if (reported !== undefined || !path || thread?.stale || computer?.availability === "offline") return;
    let cancelled = false;
    void hubRequest<{branches: GitBranch[]}>(path).then(({branches}) => {
      if (!cancelled) setResult({path, branch: branches.find(branch => branch.current)?.name ?? (branches.length ? "detached" : undefined)});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [path, reported, thread?.stale, thread?.detail.state, computer?.availability, lastTool?.id, toolFinished]);
  return reported ?? (result?.path === path ? result?.branch : undefined);
}
