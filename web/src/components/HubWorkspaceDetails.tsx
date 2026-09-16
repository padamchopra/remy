import { HubModelDefault } from "./HubModelDefault";
import { HubWorkspaceIcon, loadHubWorkspaceImage } from "./HubWorkspaceIcon";
import { useCallback, useState } from "react";
import type { ComputerSummary, OrganizationTeam } from "@remy/contract";
import { PaneHeader } from "./PaneHeader";
import { PaneLoading } from "./PaneLoading";
import { EditableName } from "./EditableName";
import { IconPicker } from "./IconPicker";
import { HubWorkspaceComputers } from "./HubWorkspaceComputers";
import { HubWorkspaceAccess } from "./HubWorkspaceAccess";
import { Button } from "./ui/button";
import { useHubResource, type HubWorkspace, type HubMember } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { PROJECT_ICON_IDS, projectIcon, isProjectIconFile } from "@/lib/projects";
import { apiError } from "@/lib/api-error";
import { usePersonalHub } from "@/lib/hub-scope";

export default function HubWorkspaceDetails({ organizationId, workspaceId, role, onBack }: { organizationId: string; workspaceId: string; role: string; onBack: () => void }) {
  const personal = usePersonalHub();
  const workspace = useHubResource<HubWorkspace>(organizationId, `/workspaces/${workspaceId}`);
  const computers = useHubResource<{ computers: ComputerSummary[] }>(organizationId, "/computers");
  const cloud = useHubResource<{ enabledProviders?: string[] }>(organizationId, "/hosted");
  const members = useHubResource<{ members: HubMember[] }>(organizationId, personal ? null : "/members");
  const teams = useHubResource<{ teams: OrganizationTeam[] }>(organizationId, personal ? null : "/teams");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const admin = role !== "member";
  const value = workspace.value;
  const searchImages = useCallback(async (id: string, query: string) => {
    const result = await hubRequest<{ images: { path: string }[]; truncated: boolean }>(`${hubThreadBase(organizationId)}/github/workspace-images?${new URLSearchParams({ workspace: id, q: query })}`);
    return result.images.map(image => ({ ...image, name: image.path.split("/").pop()! }));
  }, [organizationId]);
  const loadPreview = useCallback((path: string) => loadHubWorkspaceImage(organizationId, workspaceId, path), [organizationId, workspaceId]);
  const update = async (patch: object) => {
    setBusy(true);
    setError("");
    try { await hubRequest(`${hubThreadBase(organizationId)}/workspaces/${workspaceId}`, "PATCH", patch); }
    catch (cause) { setError(apiError(cause)); }
    finally { setBusy(false); }
  };
  return <main className="flex min-w-0 flex-1 flex-col">
    <PaneHeader crumbs={[{ label: "Workspaces", onClick: onBack }, { label: value?.name ?? "Workspace" }]} />
    {!value ? workspace.error ? <p role="alert" className="p-6">{workspace.error}</p> : <PaneLoading /> :
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-6">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3">
          <fieldset disabled={!admin || busy}>
            <IconPicker label={`Change icon for ${value.name}`} icon={value.icon ?? "folder"} tint={value.tint} icons={PROJECT_ICON_IDS} renderIcon={projectIcon}
              preview={isProjectIconFile(value.icon) ? <HubWorkspaceIcon organizationId={organizationId} workspaceId={workspaceId} icon={value.icon} /> : undefined}
              files={{ workspaceId, search: searchImages, loadPreview, onPick: icon => void update({ icon }) }} onChange={patch => void update(patch)} />
          </fieldset>
          <div className="min-w-0 flex-1">{admin ? <EditableName value={value.name} label="workspace name" onCommit={name => void update({ name })} /> : value.name}</div>
        </div>
        <div className="flex flex-col gap-2"><p className="text-sm font-medium">Repository</p><p className="break-words text-sm text-muted-foreground">{value.origin}</p></div>
        <div className="flex flex-col gap-2"><p className="text-sm font-medium">Computers</p><HubWorkspaceComputers origin={value.origin} computers={computers.value?.computers ?? []} cloudEnabled={!!cloud.value?.enabledProviders?.length} /></div>
        <HubModelDefault organizationId={organizationId} workspaceId={workspaceId} />
        {!personal && <fieldset disabled={!admin || busy} className="flex flex-col gap-3">
          <p className="text-sm font-medium">Access</p>
          <Button variant="outline" className="self-start" onClick={() => void update({ access: value.restricted ? null : { userIds: [], teamIds: [] } })}>{value.restricted ? "Allow all members" : "Restrict access"}</Button>
          {value.restricted && <HubWorkspaceAccess people={{ members: members.value?.members ?? [], teams: teams.value?.teams ?? [] }} value={value.access ?? { userIds: [], teamIds: [] }} onChange={access => void update({ access })} />}
        </fieldset>}
        {(error || workspace.error) && <p role="alert">{error || workspace.error}</p>}
      </div>}
  </main>;
}
