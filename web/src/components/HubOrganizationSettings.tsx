import { WorkspaceIcon, WorkspaceMark } from "./WorkspaceIcon";
import { IconPicker } from "./IconPicker";
import { HubWorkspaceComputers } from "./HubWorkspaceComputers";
import { PROJECT_ICON_IDS, projectIcon } from "@/lib/projects";
import type { ComputerSummary } from "@remy/contract";
import { HubAddWorkspace } from "./HubAddWorkspace";
import { EmptyState } from "@/components/EmptyState";
import { AvatarFrom } from "@/components/UserAvatar";
import { usePersonalHub } from "@/lib/hub-scope";
import { useEffect, useState } from "react";
import { Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Item,
  ItemGroup,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemMedia,
  ItemActions,
} from "@/components/ui/item";
import { toast } from "sonner";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { apiError } from "@/lib/api-error";
import {
  useHubResource,
  type HubMember,
  type HubWorkspace,
} from "@/lib/hub-organization";
import { cacheHubWorkspaces, cachedHubWorkspaces } from "@/lib/hub-workspace-cache";
import type { OrganizationTeam } from "@remy/contract";
import { HubWorkspaceAccess, type WorkspaceAccess } from "./HubWorkspaceAccess";

type Edit = {
  id?: string;
  name: string;
  origin: string;
  restricted: boolean;
  icon?: string;
  tint?: string;
  access: WorkspaceAccess;
};
export default function HubOrganizationSettings({
  organizationId,
  kind,
  role,
  onOpenWorkspace,
  workspaceListOnly = false,
  workspaceOwnerLabel,
}: {
  organizationId: string;
  kind: "members" | "teams" | "workspaces";
  role: string;
  onOpenWorkspace: (workspaceId: string) => void;
  workspaceListOnly?: boolean;
  workspaceOwnerLabel?: string;
}) {
  const isPersonal = usePersonalHub();
  const members = useHubResource<{ members: HubMember[] }>(
    organizationId,
    kind === "workspaces" ? null : "/members",
  );
  const teams = useHubResource<{ teams: OrganizationTeam[] }>(
    organizationId,
    kind === "workspaces" ? null : "/teams",
  );
  const workspaces = useHubResource<{ workspaces: HubWorkspace[] }>(
    organizationId,
    "/workspaces",
  );
  useEffect(() => {
    if (workspaces.value) cacheHubWorkspaces(organizationId, workspaces.value.workspaces);
  }, [organizationId, workspaces.value]);
  const computers = useHubResource<{computers:ComputerSummary[]}>(organizationId, kind === "workspaces" ? "/computers" : null);
  const cloud = useHubResource<{enabledProviders?:string[]}>(organizationId, kind === "workspaces" ? "/hosted" : null);
  const people = {
    members: members.value?.members ?? [],
    teams: teams.value?.teams ?? [],
  };
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const [edit, setEdit] = useState<Edit>();
  const [remove, setRemove] = useState<{ id: string; name: string }>();
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  const base = hubThreadBase(organizationId);
  const admin = role !== "member";
  useEffect(() => {
    setEdit(undefined);
    setInvite("");
  }, [organizationId, kind]);
  const perform = async (work: () => Promise<void>, failure: string) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      toast.error(failure, { description: apiError(e) });
    } finally {
      setBusy(false);
    }
  };
  const open = async (item?: HubWorkspace | OrganizationTeam, manual = false) => {
    if (!item && kind === "workspaces" && !manual) { setAddingWorkspace(true); return; }
    if (!item) {
      setTeamMembers([]);
      setInvite("");
      setEdit({
        name: "",
        origin: "",
        restricted: false,
        access: { userIds: [], teamIds: [] },
      });
      return;
    }
    try {
      if (kind === "teams") {
        const result = await hubRequest<{ userIds: string[] }>(
          `${base}/teams/${item.id}/members`,
        );
        const ids = result.userIds;
        setTeamMembers(ids);
        setEdit({
          id: item.id,
          name: item.name,
          origin: "",
          restricted: false,
          access: { userIds: ids, teamIds: [] },
        });
      } else {
        const value = await hubRequest<HubWorkspace>(
          `${base}/workspaces/${item.id}`,
        );
        setEdit({
          id: value.id,
          name: value.name,
          icon: value.icon,
          tint: value.tint,
          origin: value.origin,
          restricted: value.restricted,
          access: value.access ?? { userIds: [], teamIds: [] },
        });
      }
    } catch (e) {
      toast.error("Couldn't open that", { description: apiError(e) });
    }
  };
  const save = () =>
    perform(async () => {
      if (!edit) return;
      if (kind === "members") {
        const result = await hubRequest<{ token?: string }>(
          `${base}/invites`,
          "POST",
          { ...(edit.name ? { email: edit.name } : {}), role: inviteRole },
        );
        setInvite(
          result.token
            ? `${window.location.origin}/?invite=${encodeURIComponent(result.token)}`
            : "",
        );
        toast.success(
          result.token
            ? "Your invitation link is ready."
            : "Your invitation is sent.",
        );
      } else if (kind === "workspaces") {
        await hubRequest(
          `${base}/workspaces${edit.id ? `/${edit.id}` : ""}`,
          edit.id ? "PATCH" : "POST",
          {
            name: edit.name,
            ...(edit.id ? { icon: edit.icon, tint: edit.tint } : {}),
            ...(!edit.id ? { origin: edit.origin } : {}),
            ...(edit.restricted
              ? { access: edit.access }
              : edit.id
                ? { access: null }
                : {}),
          },
        );
      } else {
        const result = await hubRequest<{ id: string }>(
          `${base}/teams${edit.id ? `/${edit.id}` : ""}`,
          edit.id ? "PATCH" : "POST",
          { name: edit.name },
        );
        const id = edit.id ?? result.id;
        setEdit({ ...edit, id });
        for (const userId of edit.access.userIds)
          if (!edit.id || !teamMembers.includes(userId))
            await hubRequest(`${base}/teams/${id}/members/${userId}`, "PUT");
        for (const userId of teamMembers)
          if (edit.id && !edit.access.userIds.includes(userId))
            await hubRequest(`${base}/teams/${id}/members/${userId}`, "DELETE");
      }
      setEdit(undefined);
    }, kind === "members" ? "Couldn't send that invitation" : "Couldn't save those changes");
  const title =
    kind === "members" ? "Members" : kind === "teams" ? "Teams" : "Workspaces";
  const workspaceItems = workspaces.value?.workspaces
    ?? cachedHubWorkspaces(organizationId) as HubWorkspace[];
  const items =
    kind === "members"
      ? people.members.map((m) => ({ ...m, id: m.userId }))
      : kind === "teams"
        ? people.teams
        : workspaceItems;
  const emptyWorkspace = kind === "workspaces" && !!workspaces.value && items.length === 0;
  return (
    <section className={`flex min-w-0 flex-col gap-4 ${workspaceListOnly ? "" : emptyWorkspace ? "p-4" : "p-6"}`} aria-label={title}>
      {kind !== "workspaces" && <Field>
        <FieldLabel>{title}</FieldLabel>
        <FieldDescription>
          Manage the people you work with.
        </FieldDescription>
      </Field>}
      {emptyWorkspace && !workspaceListOnly && <EmptyState
        title={admin ? "Add your first workspace" : "No workspaces available"}
        description={admin ? "Choose a repository for your first thread." : "Ask an organization administrator to add a workspace or give you access."}
      >
        {admin && <Button disabled={busy} onClick={() => void open()}>Add a workspace</Button>}
      </EmptyState>}
      {(members.error || teams.error || workspaces.error) && (
        <p role="alert">
          {members.error || teams.error || workspaces.error}
        </p>
      )}
      {(members.stale || teams.stale || workspaces.stale) && (
        <p role="status">You’re reading the last saved settings.</p>
      )}
      {admin && !emptyWorkspace && !workspaceListOnly && (
        <Button
          className="self-start"
          disabled={busy}
          onClick={() => void open()}
        >
          {kind === "members"
            ? "Invite member"
            : kind === "teams"
              ? "Create team"
              : "Add workspace"}
        </Button>
      )}
      {invite && (
        <Field>
          <FieldLabel htmlFor="invite-link">Invitation link</FieldLabel>
          <Input
            id="invite-link"
            readOnly
            value={invite}
            onFocus={(e) => e.currentTarget.select()}
          />
          <FieldDescription>
            Share this link with the person you want to invite.
          </FieldDescription>
        </Field>
      )}
      <ItemGroup>
        {items.map((item) => {
          const member = item as HubMember;
          const workspace = item as HubWorkspace;
          return (
          <Item key={item.id} variant="outline" className="relative">
            {kind === "workspaces" && <Button variant="ghost" className="absolute inset-0 h-full w-full" data-link aria-label={`Open ${item.name} workspace details`} onClick={() => onOpenWorkspace(workspace.id)} />}
            <ItemMedia className={kind === "workspaces" ? "pointer-events-none" : undefined}>
              {kind === "members" ? (
                <AvatarFrom
                  avatar={member.image ?? ""}
                  label={item.name}
                  className="size-8"
                />
              ) : kind === "teams" ? (
                <Users />
              ) : (
                <WorkspaceMark home={false} workspace={workspace} size="md" organizationId={organizationId} />
              )}
            </ItemMedia>
            <ItemContent className={`min-w-0 ${kind === "workspaces" ? "pointer-events-none" : ""}`}>
              <ItemTitle className="break-words">{item.name}</ItemTitle>
              {"origin" in item && (
                <ItemDescription className="break-words">
                  {workspaceOwnerLabel ? `${workspaceOwnerLabel} · ` : ""}{String(item.origin)}
                </ItemDescription>
              )}
            </ItemContent>
            <ItemActions className="relative">
              {kind === "workspaces" && <HubWorkspaceComputers origin={workspace.origin} computers={computers.value?.computers ?? []} cloudEnabled={!!cloud.value?.enabledProviders?.length} />}
              {kind === "members" && "role" in item ? (
                <Select
                  value={item.role as string}
                  disabled={busy || role !== "owner" || item.role === "owner"}
                  onValueChange={(v) =>
                    void perform(async () => {
                      await hubRequest(`${base}/members/${item.id}`, "PATCH", {
                        role: v,
                      });
                    }, "Couldn't change that role")
                  }
                >
                  <SelectTrigger
                    aria-label={`Role for ${item.name}`}
                    className="w-28"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {["owner", "admin", "member"].map((r) => (
                        <SelectItem key={r} value={r} disabled={r === "owner"}>
                          {r === "owner"
                            ? "Owner"
                            : r === "admin"
                              ? "Admin"
                              : "Member"}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : (
                admin && kind !== "workspaces" && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      void open(item as HubWorkspace | OrganizationTeam)
                    }
                  >
                    Edit
                  </Button>
                )
              )}
              {admin && !("role" in item && item.role === "owner") && (
                <Button variant="ghost" size={kind === "workspaces" ? "icon" : "default"} aria-label={`Remove ${item.name}`} title={`Remove ${item.name}`} onClick={() => setRemove(item)}>
                  {kind === "workspaces" ? <Trash2 className="size-4" /> : "Remove"}
                </Button>
              )}
            </ItemActions>
          </Item>
          );
        })}
      </ItemGroup>
      <HubAddWorkspace organizationId={organizationId} open={addingWorkspace} onOpenChange={setAddingWorkspace} onManual={() => {setAddingWorkspace(false);void open(undefined, true);}} />
      <Dialog
        open={!!edit}
        onOpenChange={(v) => {
          if (!v) setEdit(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader className={kind === "workspaces" ? "text-center sm:text-center" : undefined}>
            <DialogTitle>
              {kind === "members"
                ? "Invite member"
                : kind === "teams"
                  ? "Edit team"
                  : edit?.id ? "Workspace details" : "Add a workspace"}
            </DialogTitle>
            <DialogDescription className={kind === "workspaces" && edit?.id ? "sr-only" : undefined}>
              {kind === "members"
                ? "Send an invitation to your organization."
                : kind === "workspaces" && edit?.id
                  ? edit.origin
                : isPersonal
                  ? "Choose a name and repository for your workspace."
                  : "Choose a name and who can use it."}
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <FieldGroup>
              <fieldset className="flex flex-col gap-6" disabled={kind === "workspaces" && !admin}>
                {kind === "workspaces" && edit.id && <div className="flex justify-center"><IconPicker label="Change workspace icon" icon={edit.icon ?? "folder"} tint={edit.tint} icons={PROJECT_ICON_IDS} renderIcon={projectIcon} preview={<WorkspaceIcon organizationId={organizationId} workspaceId={edit.id} icon={edit.icon} className="size-4" fileClassName="size-full object-cover" />} onChange={patch => setEdit({ ...edit, ...patch })} /></div>}
                <Field>
                  <FieldLabel htmlFor="entity-name">
                    {kind === "members" ? "Email (optional)" : "Name"}
                  </FieldLabel>
                  <Input
                    id="entity-name"
                    type={kind === "members" ? "email" : "text"}
                    required={kind !== "members"}
                    maxLength={120}
                    value={edit.name}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  />
                </Field>
                {kind === "members" && (
                  <Field>
                    <FieldLabel>Role</FieldLabel>
                    <Select value={inviteRole} onValueChange={setInviteRole}>
                      <SelectTrigger aria-label="Invitation role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="member">Member</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                {kind === "workspaces" && (
                  <>
                    <Field>
                      <FieldLabel htmlFor="origin">
                        Repository origin
                      </FieldLabel>
                      <Input
                        id="origin"
                        disabled={!!edit.id}
                        required
                        value={edit.origin}
                        onChange={(e) =>
                          setEdit({ ...edit, origin: e.target.value })
                        }
                      />
                    </Field>
                    {!isPersonal && (
                      <Field orientation="horizontal">
                        <Checkbox
                          id="restrict-workspace"
                          checked={edit.restricted}
                          onCheckedChange={(v) =>
                            setEdit({ ...edit, restricted: v === true })
                          }
                        />
                        <FieldLabel htmlFor="restrict-workspace">
                          Restrict to selected members and teams
                        </FieldLabel>
                      </Field>
                    )}
                  </>
                )}
                {(kind === "teams" ||
                  (kind === "workspaces" && edit.restricted)) && (
                  <HubWorkspaceAccess
                    people={
                      kind === "teams" ? { ...people, teams: [] } : people
                    }
                    value={edit.access}
                    onChange={(access) => setEdit({ ...edit, access })}
                  />
                )}
              </fieldset>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEdit(undefined)}
                  >
                    Cancel
                  </Button>
                  <Button disabled={busy || (kind === "workspaces" && !admin)} type="submit">
                    {kind === "members" ? (edit.name.trim() ? "Send invitation" : "Create invitation link") : kind === "workspaces" && !edit?.id ? "Add workspace" : "Save changes"}
                  </Button>
                </DialogFooter>
              </FieldGroup>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!remove}
        onOpenChange={(v) => {
          if (!v) setRemove(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {remove?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {kind === "members"
                ? "This person loses access to your organization."
                : "This removes it from your account."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void perform(async () => {
                  await hubRequest(`${base}/${kind}/${remove!.id}`, "DELETE");
                  setRemove(undefined);
                }, "Couldn't remove that");
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
