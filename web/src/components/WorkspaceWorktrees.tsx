import { GitBranch, RefreshCw, X } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { deviceIcon } from "@/lib/devices";
import { displayPath } from "@/lib/path";
import { worktreeCopyKey } from "@/lib/worktree-selection";
import type { WorkspaceWorktreeState } from "@/hooks/use-workspace-worktrees";

export function WorktreeSelectionToolbar({ state }: { state: WorkspaceWorktreeState }) {
  return (
    <div role="group" aria-label="Worktree selection" className="flex w-full min-w-0 flex-wrap items-center gap-3">
      <Checkbox aria-label="Select all available worktrees" checked={state.allSelected ? true : state.selectedTargets.length ? "indeterminate" : false} disabled={state.busy || !state.selectable.length} onCheckedChange={(checked) => state.selectAll(checked === true)} />
      <span role="status" className="min-w-0 flex-1 text-sm font-medium">{state.selectedTargets.length} selected</span>
      <Button size="sm" disabled={state.busy || !state.selectionReady} onClick={() => state.confirm(state.selectedTargets)}>
        {state.busy && <Spinner data-icon="inline-start" />}Clean up selected
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Clear worktree selection" disabled={state.busy} onClick={state.clear}><X /></Button>
    </div>
  );
}

export function WorkspaceWorktrees({ state }: { state: WorkspaceWorktreeState }) {
  const dirtyCount = state.confirmation?.filter((target) => target.tree.dirty).length ?? 0;
  return (
    <FieldSet className="min-w-0 gap-3">
      <FieldLegend variant="label">Worktrees</FieldLegend>
      <FieldGroup className="gap-4">
        <Field orientation="horizontal">
          <Checkbox id="select-all-worktrees" checked={state.allSelected ? true : state.selectedTargets.length ? "indeterminate" : false} disabled={state.busy || !state.selectable.length} onCheckedChange={(checked) => state.selectAll(checked === true)} />
          <FieldLabel htmlFor="select-all-worktrees">Select all available worktrees</FieldLabel>
        </Field>
        {state.groups.map(({ copy, server, snapshot, online, ready, targets }) => {
          const DeviceIcon = deviceIcon(server?.icon);
          return (
            <section key={worktreeCopyKey(copy)} aria-label={`Worktrees on ${server?.name ?? "unavailable device"}`} className="flex min-w-0 flex-col gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button asChild variant="ghost" size="sm" className="min-w-0 max-w-full"><a href="#/settings/devices"><DeviceIcon data-icon="inline-start" /><span className="truncate">{server?.name ?? "Unavailable device"}</span></a></Button>
                <Badge variant={online ? "secondary" : "outline"}>{online ? `${targets.length} ${targets.length === 1 ? "worktree" : "worktrees"}` : "Offline · last known"}</Badge>
                <Button size="icon-sm" variant="ghost" className="ml-auto" disabled={!online || snapshot?.loading || state.busy} aria-label={`Refresh worktrees on ${server?.name ?? "device"}`} onClick={() => void state.load(copy)}>
                  {snapshot?.loading ? <Spinner /> : <RefreshCw />}
                </Button>
              </div>
              {online && snapshot?.error && <p role="alert" className="text-sm text-destructive">{snapshot.error}</p>}
              {!online && <p className="text-xs text-muted-foreground">Reconnect this device before cleaning up its worktrees.</p>}
              {!snapshot?.trees && online && !snapshot?.error ? <Skeleton className="h-16 w-full" /> : null}
              {targets.length === 0 && snapshot?.trees && <p className="text-sm text-muted-foreground">This folder has no Git worktrees.</p>}
              <ItemGroup className="gap-2">
                {targets.map((target) => {
                  const { tree, key } = target;
                  const name = tree.branch ?? "Detached worktree";
                  return (
                    <Item key={key} variant="outline" size="sm" data-worktree-path={tree.path} data-device-id={copy.serverId} className="min-w-0 flex-nowrap items-start gap-3">
                      <Checkbox className="mt-1" aria-label={`Select ${name} on ${target.deviceName}`} checked={state.selected.has(key)} disabled={tree.isMain || state.busy || (!ready && !state.selected.has(key))} onCheckedChange={(checked) => state.toggle(key, checked === true)} />
                      <ItemContent className="min-w-0 gap-1">
                        <ItemTitle className="w-full min-w-0"><GitBranch className="shrink-0" /><span className="truncate" title={name}>{name}</span></ItemTitle>
                        <ItemDescription className="line-clamp-none break-words font-mono text-xs [overflow-wrap:anywhere]" title={tree.path}>{displayPath(tree.path)}</ItemDescription>
                        <div className="flex flex-wrap items-center gap-2">
                          {tree.isMain && <Badge variant="secondary">Main checkout</Badge>}
                          <Badge variant={!ready ? "outline" : tree.dirty ? "warning" : "success"}>{!ready ? "Status unavailable" : tree.dirty ? "Uncommitted changes" : "Clean"}</Badge>
                          {!tree.isMain && <Button size="sm" variant="ghost" disabled={!ready || state.busy} onClick={() => state.confirm([target])}>Clean up</Button>}
                        </div>
                        {state.errors[key] && <p role="alert" className="break-words text-sm text-destructive">{state.errors[key]}</p>}
                      </ItemContent>
                    </Item>
                  );
                })}
              </ItemGroup>
            </section>
          );
        })}
      </FieldGroup>
      <AlertDialog open={Boolean(state.confirmation)} onOpenChange={(open) => { if (!open) state.dismiss(); }}>
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Clean up {state.confirmation?.length} {state.confirmation?.length === 1 ? "worktree" : "worktrees"}?</AlertDialogTitle>
            <AlertDialogDescription>Remove these folders and stop their threads and shell sessions; branches and main checkouts are kept.</AlertDialogDescription>
          </AlertDialogHeader>
          <ItemGroup className="max-h-60 overflow-y-auto">
            {state.confirmation?.map((target) => (
              <Item key={target.key} size="sm" className="min-w-0">
                <ItemMedia><GitBranch /></ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full break-words">{target.tree.branch ?? "Detached worktree"}</ItemTitle>
                  <ItemDescription className="line-clamp-none break-words [overflow-wrap:anywhere]">{target.deviceName} · {target.tree.path}</ItemDescription>
                  {target.tree.dirty && <Badge variant="warning">Uncommitted changes</Badge>}
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
          {dirtyCount > 0 && <FieldGroup><Field orientation="horizontal">
            <Checkbox id="discard-worktree-changes" checked={state.discardChanges} disabled={state.busy} onCheckedChange={(checked) => state.setDiscardChanges(checked === true)} />
            <FieldLabel htmlFor="discard-worktree-changes" className="min-w-0">Permanently discard uncommitted changes in {dirtyCount} {dirtyCount === 1 ? "worktree" : "worktrees"}.</FieldLabel>
          </Field></FieldGroup>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={state.busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={state.busy || (dirtyCount > 0 && !state.discardChanges)} onClick={(event) => { event.preventDefault(); void state.clean(); }}>
              {state.busy && <Spinner data-icon="inline-start" />}{state.busy ? "Cleaning up…" : "Clean up worktrees"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FieldSet>
  );
}
