import { useCallback, useEffect, useState } from "react";
import { Building2, GitBranch, PenLine, User } from "lucide-react";
import { toast } from "sonner";
import type { GitBranch as Branch } from "@/state/types";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { PaneHeader } from "./PaneHeader";
import { WorkspaceEnvironment } from "./WorkspaceEnvironment";
import { PaneLoading } from "./PaneLoading";
import { EditableName } from "./EditableName";
import { IconPicker } from "./IconPicker";
import { Button } from "./ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "./ui/item";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog-base";
import { useHubResource, type HubWorkspace } from "@/lib/hub-organization";
import { loadHubWorkspaceImage } from "@/lib/hub-workspace-image";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { PROJECT_ICON_IDS, projectIcon } from "@/lib/projects";
import { apiError } from "@/lib/api-error";

/// Who owns a workspace: the organization, or your personal account.
export type WorkspaceOwner = { name: string; role: string; personal?: boolean };

/// The default branch, when the hub can read it from GitHub. Anything else
/// leaves it off rather than guessing.
function useDefaultBranch(organizationId: string, workspace?: HubWorkspace) {
  const [branch, setBranch] = useState<string>();
  const id = workspace?.id;
  const github = !!workspace?.origin && /^github\.com\/[^/]+\/[^/]+$/.test(workspace.origin);
  useEffect(() => {
    setBranch(undefined);
    if (!id || !github) return;
    let live = true;
    hubRequest<{ branches: Branch[] }>(`${hubThreadBase(organizationId)}/github/workspace-branches?${new URLSearchParams({ workspace: id })}`)
      .then(result => { if (live) setBranch(result.branches.find(entry => entry.current)?.name); })
      .catch(() => {});
    return () => { live = false; };
  }, [organizationId, id, github]);
  return branch;
}

export default function HubWorkspaceDetails({ organizationId, workspaceId, owner, onBack, onNewThread }: {
  organizationId: string;
  workspaceId: string;
  owner: WorkspaceOwner;
  onBack: () => void;
  onNewThread: () => void;
}) {
  const workspace = useHubResource<HubWorkspace>(organizationId, `/workspaces/${workspaceId}`);
  const [busy, setBusy] = useState(false);
  // Only the owner's admins change a workspace; in a personal account that is you.
  const admin = owner.role !== "member";
  const value = workspace.value;
  const branch = useDefaultBranch(organizationId, value);
  const searchImages = useCallback(async (id: string, query: string) => {
    const result = await hubRequest<{ images: { path: string }[]; truncated: boolean }>(`${hubThreadBase(organizationId)}/github/workspace-images?${new URLSearchParams({ workspace: id, q: query })}`);
    return result.images.map(image => ({ ...image, name: image.path.split("/").pop()! }));
  }, [organizationId]);
  const loadPreview = useCallback((path: string) => loadHubWorkspaceImage(organizationId, workspaceId, path), [organizationId, workspaceId]);
  const update = async (patch: object) => {
    setBusy(true);
    try { await hubRequest(`${hubThreadBase(organizationId)}/workspaces/${workspaceId}`, "PATCH", patch); }
    catch (cause) { toast.error("Couldn't save the workspace", { description: apiError(cause) }); }
    finally { setBusy(false); }
  };
  const OwnerIcon = owner.personal ? User : Building2;
  return <main className="flex min-w-0 flex-1 flex-col">
    <PaneHeader sidebar crumbs={[{ label: "Workspaces", onClick: onBack }, { label: value?.name ?? "Workspace" }]}>
      <Button size="sm" className="h-7 gap-1.5 rounded-lg px-2.5 text-xs has-[>svg]:px-2.5 [&_svg:not([class*='size-'])]:size-[13px]" disabled={!value} onClick={onNewThread}>
        <PenLine strokeWidth={2} />
        New thread
      </Button>
    </PaneHeader>
    {!value ? workspace.error ? <p role="alert" className="p-6">{workspace.error}</p> : <PaneLoading /> :
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-9 px-4 pt-9 pb-7 sm:px-10">
        <div className="flex min-w-0 items-center gap-3.5">
          <fieldset disabled={!admin || busy} className="shrink-0">
            <IconPicker label={`Change icon for ${value.name}`} icon={value.icon ?? "folder"} tint={value.tint} icons={PROJECT_ICON_IDS} renderIcon={projectIcon}
              preview={<WorkspaceIcon organizationId={organizationId} workspaceId={workspaceId} icon={value.icon} className="size-5" fileClassName="size-full object-cover" />}
              files={{ workspaceId, search: searchImages, loadPreview, onPick: icon => void update({ icon }) }} onChange={patch => void update(patch)} />
          </fieldset>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {admin
              ? <EditableName value={value.name} label="workspace name" className="text-[22px] leading-7 font-semibold tracking-[-0.02em]" onCommit={name => void update({ name })} />
              : <h1 className="truncate text-[22px] leading-7 font-semibold tracking-[-0.02em]">{value.name}</h1>}
            <p className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
              <GitBranch className="size-[13px] shrink-0" strokeWidth={1.8} aria-hidden />
              <span className="min-w-0 truncate">{value.origin}</span>
              {branch && <><span aria-hidden>·</span><span className="shrink-0"><span className="sr-only">Default branch </span>{branch}</span></>}
            </p>
          </div>
        </div>
        <section aria-labelledby="workspace-owner" className="flex flex-col gap-2.5">
          <h2 id="workspace-owner" className="text-[13px] leading-[18px] font-semibold">Owner</h2>
          <Item variant="outline" className="min-h-14 flex-nowrap gap-3 rounded-[10px] px-3.5 py-2.5">
            <ItemContent className="gap-0.5">
              <ItemTitle className="text-[13px] leading-[18px]">{owner.personal ? "Personal" : owner.name}</ItemTitle>
              <ItemDescription className="text-xs leading-4">
                {owner.personal ? "Only you can start threads here, on any computer you use." : "Everyone in it can start threads here, on any computer they use."}
              </ItemDescription>
            </ItemContent>
            <ItemActions className="h-7.5 gap-1.75 text-xs font-[450] text-muted-foreground">
              <OwnerIcon className="size-[13px]" strokeWidth={1.8} aria-hidden />
              {owner.personal ? "Personal" : "Organization"}
            </ItemActions>
          </Item>
        </section>
        <WorkspaceEnvironment organizationId={organizationId} workspaceId={workspaceId} workspaceName={value.name} organizationName={owner.name} personal={!!owner.personal} />
        {/* Worktrees and branches (phase 4) go here, between Environment and Remove. */}
        {admin && <RemoveWorkspace organizationId={organizationId} workspace={value} onRemoved={onBack} />}
      </div>}
  </main>;
}

/// The last thing on the page, for the people who may change the workspace.
function RemoveWorkspace({ organizationId, workspace, onRemoved }: { organizationId: string; workspace: HubWorkspace; onRemoved: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await hubRequest(`${hubThreadBase(organizationId)}/workspaces/${encodeURIComponent(workspace.id)}`, "DELETE");
      setOpen(false);
      toast.success(`${workspace.name} is removed.`);
      onRemoved();
    } catch (cause) {
      toast.error(`Couldn't remove ${workspace.name}`, { description: apiError(cause) });
    } finally { setBusy(false); }
  };
  return <Item variant="outline" className="min-h-14 flex-nowrap gap-3 rounded-[10px] px-3.5 py-2.5">
    <ItemContent className="gap-0.5">
      <ItemTitle className="text-[13px] leading-[18px]">Remove workspace</ItemTitle>
      <ItemDescription className="text-xs leading-4">You can add the repository again later.</ItemDescription>
    </ItemContent>
    <ItemActions>
      <AlertDialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
        <AlertDialogTrigger render={<Button variant="outline" size="sm" className="h-7 rounded-lg px-2.5 text-xs text-destructive hover:text-destructive" />}>
          Remove workspace
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {workspace.name}?</AlertDialogTitle>
            <AlertDialogDescription>Nobody can start threads in it after this.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} />
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>Remove workspace</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ItemActions>
  </Item>;
}
