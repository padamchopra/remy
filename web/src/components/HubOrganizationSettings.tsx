import { useEffect, useState } from "react";
import { User, Users, Folder } from "lucide-react";
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
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { apiError } from "@/lib/api-error";
import {
  useHubResource,
  type HubMember,
  type HubWorkspace,
} from "@/lib/hub-organization";
import type { OrganizationTeam } from "@remy/contract";
import { HubWorkspaceAccess, type WorkspaceAccess } from "./HubWorkspaceAccess";

type Edit = {
  id?: string;
  name: string;
  origin: string;
  restricted: boolean;
  access: WorkspaceAccess;
};
export default function HubOrganizationSettings({
  organizationId,
  kind,
  role,
}: {
  organizationId: string;
  kind: "members" | "teams" | "workspaces";
  role: string;
}) {
  const members = useHubResource<{ members: HubMember[] }>(
    organizationId,
    "/members",
  );
  const teams = useHubResource<{ teams: OrganizationTeam[] }>(
    organizationId,
    "/teams",
  );
  const workspaces = useHubResource<{ workspaces: HubWorkspace[] }>(
    organizationId,
    "/workspaces",
  );
  const people = {
    members: members.value?.members ?? [],
    teams: teams.value?.teams ?? [],
  };
  const [edit, setEdit] = useState<Edit>();
  const [remove, setRemove] = useState<{ id: string; name: string }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState("");
  const [invited, setInvited] = useState(false);
  const [inviteRole, setInviteRole] = useState("member");
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  const base = hubThreadBase(organizationId);
  const admin = role !== "member";
  useEffect(() => {
    setEdit(undefined);
    setInvite("");
    setError("");
  }, [organizationId, kind]);
  const perform = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };
  const open = async (item?: HubWorkspace | OrganizationTeam) => {
    if (!item) {
      setTeamMembers([]);
      setInvited(false);
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
          origin: value.origin,
          restricted: value.restricted,
          access: value.access ?? { userIds: [], teamIds: [] },
        });
      }
    } catch (e) {
      setError(apiError(e));
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
        setInvite(result.token ? `${window.location.origin}/?invite=${encodeURIComponent(result.token)}` : "");
        setInvited(true);
      } else if (kind === "workspaces") {
        await hubRequest(
          `${base}/workspaces${edit.id ? `/${edit.id}` : ""}`,
          edit.id ? "PATCH" : "POST",
          {
            name: edit.name,
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
    });
  const title =
    kind === "members" ? "Members" : kind === "teams" ? "Teams" : "Workspaces";
  const items =
    kind === "members"
      ? people.members.map((m) => ({ ...m, id: m.userId }))
      : kind === "teams"
        ? people.teams
        : (workspaces.value?.workspaces ?? []);
  return (
    <section className="flex min-w-0 flex-col gap-4 p-6" aria-label={title}>
      <Field>
        <FieldLabel>{title}</FieldLabel>
        <FieldDescription>
          {kind === "workspaces"
            ? "Choose who can work in each workspace."
            : "Manage the people you work with."}
        </FieldDescription>
      </Field>
      {(error || members.error || teams.error || workspaces.error) && (
        <p role="alert">
          {error || members.error || teams.error || workspaces.error}
        </p>
      )}
      {(members.stale || teams.stale || workspaces.stale) && (
        <p role="status">You’re reading the last saved settings.</p>
      )}
      {admin && (
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
      {invited && <p role="status">{invite ? "Your invitation link is ready." : "Your invitation is sent."}</p>}
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
        {items.map((item) => (
          <Item key={item.id} variant="outline">
            <ItemMedia>
              {kind === "members" ? (
                <User />
              ) : kind === "teams" ? (
                <Users />
              ) : (
                <Folder />
              )}
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="break-words">{item.name}</ItemTitle>
              {"origin" in item && (
                <ItemDescription className="break-words">
                  {String(item.origin)}
                </ItemDescription>
              )}
            </ItemContent>
            <ItemActions>
              {kind === "members" && "role" in item ? (
                <Select
                  value={item.role as string}
                  disabled={busy || role !== "owner" || item.role === "owner"}
                  onValueChange={(v) =>
                    void perform(async () => {
                      await hubRequest(`${base}/members/${item.id}`, "PATCH", {
                        role: v,
                      });
                    })
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
                admin && (
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
                <Button variant="ghost" onClick={() => setRemove(item)}>
                  Remove
                </Button>
              )}
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      <Dialog
        open={!!edit}
        onOpenChange={(v) => {
          if (!v) setEdit(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {kind === "members"
                ? "Invite member"
                : kind === "teams"
                  ? "Edit team"
                  : "Edit workspace"}
            </DialogTitle>
            <DialogDescription>
              {kind === "members"
                ? "Send an invitation to your organization."
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
                {error && <p role="alert">{error}</p>}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEdit(undefined)}
                  >
                    Cancel
                  </Button>
                  <Button disabled={busy} type="submit">
                    {kind === "members" ? "Create invitation" : "Save changes"}
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
                : "This removes it from your organization."}
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
                });
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
