import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
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
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EditableName } from "@/components/EditableName";
import { IconPicker } from "@/components/IconPicker";
import { ModelPickerButton, REMY_DEFAULT } from "@/components/ModelPicker";
import { WorkspaceFileIcon } from "@/components/WorkspaceIcon";
import { WorkspaceEnvironmentSettings } from "@/components/WorkspaceEnvironmentSettings";
import { WorkspaceWorktrees } from "@/components/WorkspaceWorktrees";
import { ScopedPullRequestMonitoring } from "@/components/PullRequestMonitoring";
import { apiError } from "@/lib/api-error";
import { deviceIcon } from "@/lib/devices";
import { displayPath } from "@/lib/path";
import { devicesForWorkspace, PROJECT_ICON_IDS, isProjectIcon, isProjectIconFile, projectIcon, workspaceCopies } from "@/lib/projects";
import { tintOf } from "@/lib/tints";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PaneHeader } from "@/components/PaneHeader";
import { useStore } from "@/state/store";
import type { Workspace } from "@/state/types";

/// The letters in front of this workspace's ticket keys.
///
/// Changing it re-keys every ticket the workspace already has, because a key is
/// the ticket's number behind this slug rather than a string written down when
/// the ticket was made.
function TicketSlugField({ workspace }: { workspace: Workspace }) {
  const projects = useStore((s) => s.projects);
  const loadBoard = useStore((s) => s.loadBoard);
  const saveProject = useStore((s) => s.saveProject);

  useEffect(() => {
    void loadBoard().catch(() => {
      // The board is a nicety on this pane; the rest of it works without one.
    });
  }, [loadBoard]);

  const project = projects.find((entry) =>
    entry.workspaceIds.includes(workspace.id)
      || Boolean(workspace.origin && entry.origin === workspace.origin));
  const [draft, setDraft] = useState("");
  useEffect(() => setDraft(project?.keyPrefix ?? ""), [project?.keyPrefix]);

  if (!project) return null;
  const commit = () => {
    const next = draft.trim().toUpperCase();
    if (!next || next === project.keyPrefix) {
      setDraft(project.keyPrefix);
      return;
    }
    void saveProject(project.id, { keyPrefix: next }).catch((error) => {
      setDraft(project.keyPrefix);
      toast.error("Couldn't change the slug", { description: apiError(error) });
    });
  };

  return (
    <Field orientation="horizontal" className="items-center">
      <FieldLabel htmlFor="ticket-slug">Ticket slug</FieldLabel>
      <Input
        id="ticket-slug"
        value={draft}
        maxLength={6}
        aria-label="Ticket slug"
        className="w-72 shrink-0 font-mono uppercase"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(project.keyPrefix);
            event.currentTarget.blur();
          }
        }}
      />
    </Field>
  );
}

/// The provider and model a thread started in this workspace uses.
///
/// The machine has a default and most workspaces want it, so the choice here is
/// really "follow Remy, or not" — a repository that reads better on one provider
/// says so once, here, instead of at the top of every thread. Remy default is
/// stored as inheritance rather than as today's answer, so changing the machine
/// default reaches this workspace without anyone coming back to it.
function ModelField({ workspace }: { workspace: Workspace }) {
  const settings = useStore((s) => s.settings);
  const updateWorkspace = useStore((s) => s.updateWorkspace);
  const inherited = {
    provider: settings?.defaultProvider ?? "claude",
    model: settings?.defaultModel ?? "",
    effort: settings?.defaultEffort ?? "",
  };

  const pick = (choice: { provider: string; model: string; effort?: string }) => {
    const patch = choice.provider === REMY_DEFAULT
      ? { provider: null, model: null, effort: null }
      : { provider: choice.provider, model: choice.model, effort: choice.effort ?? "" };
    void updateWorkspace(workspace.id, patch).catch((error) => {
      toast.error("Couldn't change what this workspace runs on", { description: apiError(error) });
    });
  };

  return (
    <Field orientation="horizontal" className="items-center">
      <FieldContent>
        <FieldLabel htmlFor="workspace-model">Default provider</FieldLabel>
        <FieldDescription className="text-xs">You can still change this per thread.</FieldDescription>
      </FieldContent>
      <ModelPickerButton
        id="workspace-model"
        allowDefault
        defaultChoice={inherited}
        value={
          workspace.provider
            ? { provider: workspace.provider, model: workspace.model ?? "", effort: workspace.effort ?? "" }
            : { provider: REMY_DEFAULT, model: "", effort: "" }
        }
        onPick={pick}
      />
    </Field>
  );
}

export function WorkspaceSettings({
  workspace,
  onBack,
}: {
  workspace: Workspace;
  onBack: () => void;
}) {
  const servers = useStore((s) => s.servers);
  const allWorkspaces = useStore((s) => s.workspaces);
  const projects = useStore((s) => s.projects);
  const updateWorkspace = useStore((s) => s.updateWorkspace);
  const saveProject = useStore((s) => s.saveProject);
  const removeWorkspace = useStore((s) => s.removeWorkspace);
  const copies = workspaceCopies(workspace, allWorkspaces);
  const devices = devicesForWorkspace(workspace, copies, servers);
  const project = projects.find((entry) =>
    entry.workspaceIds.includes(workspace.id)
      || Boolean(workspace.origin && entry.origin === workspace.origin));
  const updateIdentity = (patch: { icon?: string; tint?: string }) => {
    if (project) {
      void saveProject(project.id, patch);
      return;
    }
    void updateWorkspace(workspace.id, patch);
  };

  const remove = async () => {
    await removeWorkspace(workspace.id);
    toast.success(`Removed ${workspace.name}.`);
    onBack();
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <PaneHeader
        crumbs={[
          { label: "Workspaces", onClick: onBack },
          { label: workspace.name },
        ]}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-6">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3">
            <IconPicker
              label={`Change icon for ${workspace.name}`}
              icon={isProjectIcon(workspace.icon) ? workspace.icon : "folder"}
              tint={workspace.tint}
              icons={PROJECT_ICON_IDS}
              renderIcon={projectIcon}
              preview={
                isProjectIconFile(workspace.icon) ? (
                  <WorkspaceFileIcon workspaceId={workspace.id} path={workspace.icon} className="size-6" />
                ) : undefined
              }
              files={{
                workspaceId: workspace.id,
                onPick: (path) => updateIdentity({ icon: path }),
              }}
              onChange={updateIdentity}
            />
            <div className="min-w-0 flex-1">
              <EditableName
                value={workspace.name}
                label="workspace name"
                onCommit={(name) => void updateWorkspace(workspace.id, { name })}
              />
            </div>
          </div>

          <ModelField workspace={workspace} />

          <ScopedPullRequestMonitoring serverId={workspace.serverId} workspaceId={workspace.id} />

          <TicketSlugField workspace={workspace} />

          <WorkspaceEnvironmentSettings workspace={workspace} />

          <WorkspaceWorktrees workspace={workspace} />

          <div className="flex flex-col gap-2">
            <p className="px-1 text-xs font-medium text-muted-foreground">Devices</p>
            {devices.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3.5 py-3 text-sm text-muted-foreground">
                This workspace isn't on a connected device.
              </p>
            ) : (
              devices.map((server) => {
                const DeviceIcon = deviceIcon(server.icon);
                const colors = tintOf(server.tint);
                const copy = copies.find((entry) => entry.serverId === server.id);
                return (
                  <div
                    key={server.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3"
                  >
                    <span
                      className={cn(
                        "relative flex size-10 shrink-0 items-center justify-center rounded-lg border border-border",
                        colors.well,
                        colors.fg,
                      )}
                    >
                      <DeviceIcon className="size-4" />
                      <span
                        className={cn(
                          "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-card",
                          server.online ? "bg-success" : "bg-muted-foreground",
                        )}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{server.name}</span>
                        <Badge variant={server.online ? "success" : "secondary"}>
                          {server.online ? "Connected" : "Offline"}
                        </Badge>
                      </span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {copy ? displayPath(copy.path) : "Not on this machine"}
                      </span>
                    </span>
                    {devices.length > 1 && copy ? (
                      <AlertDialog>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AlertDialogTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Remove from ${server.name}`}
                                disabled={!server.online}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 />
                              </Button>
                            </AlertDialogTrigger>
                          </TooltipTrigger>
                          <TooltipContent>{server.online ? `Remove from ${server.name}` : `${server.name} is offline`}</TooltipContent>
                        </Tooltip>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove {workspace.name} from {server.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Remy stops listing this folder on {server.name}. Files and threads stay on disk.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => {
                                void removeWorkspace(copy.id)
                                  .then(() => {
                                    toast.success(`Removed from ${server.name}.`);
                                    if (copy.id === workspace.id) onBack();
                                  })
                                  .catch((error) => toast.error("Couldn't remove the workspace", { description: apiError(error) }));
                              }}
                            >
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          {devices.length <= 1 && <div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Remove workspace</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {workspace.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Chats in this folder stay on disk. Remy stops listing the workspace.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void remove()}>
                    Remove workspace
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>}
        </div>
      </ScrollArea>
    </main>
  );
}
