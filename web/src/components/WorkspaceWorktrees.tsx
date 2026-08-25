import { useCallback, useEffect, useState } from "react";
import { GitBranch, LoaderCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { apiError } from "@/lib/api-error";
import { displayPath } from "@/lib/path";
import { useStore } from "@/state/store";
import type { GitWorktree, Workspace } from "@/state/types";
import { toast } from "sonner";

function worktreeName(worktree: GitWorktree): string {
  return worktree.branch ?? "Detached worktree";
}

function CleanupDialog({
  worktree,
  force,
  busy,
  onConfirm,
}: {
  worktree: GitWorktree;
  force: boolean;
  busy: boolean;
  onConfirm: () => void;
}) {
  const name = worktreeName(worktree);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={force ? "destructive" : "outline"}
          disabled={busy}
        >
          {busy ? <LoaderCircle className="animate-spin" /> : null}
          {force ? "Force clean up" : "Clean up"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{force ? "Force clean up" : "Clean up"} {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {force
              ? "Remy permanently discards uncommitted changes and stops threads running in this worktree."
              : "Remy removes this worktree and stops threads running in it. Uncommitted changes block the cleanup."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={force ? "destructive" : "default"} onClick={onConfirm}>
            {force ? "Force clean up" : "Clean up worktree"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function WorkspaceWorktrees({ workspace }: { workspace: Workspace }) {
  const loadWorkspaceWorktrees = useStore((state) => state.loadWorkspaceWorktrees);
  const cleanWorkspaceWorktree = useStore((state) => state.cleanWorkspaceWorktree);
  const [worktrees, setWorktrees] = useState<GitWorktree[] | null>(null);
  const [error, setError] = useState<string>();
  const [busyPath, setBusyPath] = useState<string>();

  const load = useCallback(async () => {
    setWorktrees(null);
    setError(undefined);
    try {
      setWorktrees(await loadWorkspaceWorktrees(workspace.id));
    } catch (cause) {
      setError(apiError(cause));
    }
  }, [loadWorkspaceWorktrees, workspace.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const clean = async (worktree: GitWorktree, force: boolean) => {
    setBusyPath(worktree.path);
    try {
      setWorktrees(await cleanWorkspaceWorktree(workspace.id, worktree.path, force));
      toast.success(`Cleaned up ${worktreeName(worktree)}.`);
    } catch (cause) {
      toast.error("Couldn't clean up the worktree", { description: apiError(cause) });
      void load();
    } finally {
      setBusyPath(undefined);
    }
  };

  return (
    <section className="flex flex-col gap-2" aria-labelledby="workspace-worktrees-heading">
      <p id="workspace-worktrees-heading" className="px-1 text-xs font-medium text-muted-foreground">
        Worktrees
      </p>
      {worktrees === null && !error ? (
        <div className="flex flex-col gap-2" aria-label="Loading worktrees">
          <Skeleton className="h-[66px] w-full" />
          <Skeleton className="h-[66px] w-full" />
        </div>
      ) : error ? (
        <Item variant="outline" size="sm">
          <ItemContent>
            <ItemTitle>Couldn't load worktrees</ItemTitle>
            <ItemDescription>{error}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </ItemActions>
        </Item>
      ) : worktrees?.length === 0 ? (
        <Item variant="outline" size="sm">
          <ItemMedia variant="icon"><GitBranch /></ItemMedia>
          <ItemContent>
            <ItemTitle>No worktrees</ItemTitle>
            <ItemDescription>This folder isn't a Git checkout.</ItemDescription>
          </ItemContent>
        </Item>
      ) : (
        <ItemGroup className="gap-2">
          {worktrees?.map((worktree) => {
            const busy = busyPath === worktree.path;
            return (
              <Item key={worktree.path} variant="outline" size="sm" className="gap-3">
                <ItemMedia variant="icon"><GitBranch /></ItemMedia>
                <ItemContent className="min-w-0 gap-1">
                  <ItemTitle className="max-w-full flex-wrap">
                    <span className="truncate">{worktreeName(worktree)}</span>
                    {worktree.isMain ? <Badge variant="secondary">Main checkout</Badge> : null}
                    <Badge variant={worktree.dirty ? "warning" : "success"}>
                      {worktree.dirty ? "Uncommitted changes" : "Clean"}
                    </Badge>
                  </ItemTitle>
                  <ItemDescription className="truncate text-left font-mono text-xs [text-wrap:nowrap]">
                    {displayPath(worktree.path)}
                  </ItemDescription>
                </ItemContent>
                {!worktree.isMain ? (
                  <ItemActions className="ml-auto shrink-0">
                    <CleanupDialog
                      worktree={worktree}
                      force={worktree.dirty}
                      busy={busy}
                      onConfirm={() => void clean(worktree, worktree.dirty)}
                    />
                  </ItemActions>
                ) : null}
              </Item>
            );
          })}
        </ItemGroup>
      )}
    </section>
  );
}
