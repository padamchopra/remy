import { PersonAvatar } from "@/components/UserAvatar";
import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  ItemMedia,
  ItemActions,
} from "@/components/ui/item";
import { toast } from "sonner";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { apiError } from "@/lib/api-error";
import {
  useHubResource,
  type HubMember,
} from "@/lib/hub-organization";
import type { OrganizationTeam } from "@remy/contract";
import { HubWorkspaceAccess, type WorkspaceAccess } from "./HubWorkspaceAccess";

type Edit = {
  id?: string;
  name: string;
  access: WorkspaceAccess;
};
/// Members and teams of an organization.
export default function HubOrganizationSettings({
  organizationId,
  kind,
  role,
}: {
  organizationId: string;
  kind: "members" | "teams";
  role: string;
}) {
  const members = useHubResource<{ members: HubMember[] }>(organizationId, "/members");
  const teams = useHubResource<{ teams: OrganizationTeam[] }>(organizationId, "/teams");
  const people = {
    members: members.value?.members ?? [],
    teams: teams.value?.teams ?? [],
  };
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
  const open = async (item?: OrganizationTeam) => {
    if (!item) {
      setTeamMembers([]);
      setInvite("");
      setEdit({ name: "", access: { userIds: [], teamIds: [] } });
      return;
    }
    try {
      const result = await hubRequest<{ userIds: string[] }>(`${base}/teams/${item.id}/members`);
      setTeamMembers(result.userIds);
      setEdit({ id: item.id, name: item.name, access: { userIds: result.userIds, teamIds: [] } });
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
  const title = kind === "members" ? "Members" : "Teams";
  const items: (OrganizationTeam | (HubMember & { id: string }))[] =
    kind === "members"
      ? people.members.map((m) => ({ ...m, id: m.userId }))
      : people.teams;
  return (
    <section className="flex min-w-0 flex-col gap-4 p-6" aria-label={title}>
      <Field>
        <FieldLabel>{title}</FieldLabel>
        <FieldDescription>
          Manage the people you work with.
        </FieldDescription>
      </Field>
      {(members.error || teams.error) && (
        <p role="alert">
          {members.error || teams.error}
        </p>
      )}
      {(members.stale || teams.stale) && (
        <p role="status">You’re reading the last saved settings.</p>
      )}
      {admin && (
        <Button
          className="self-start"
          disabled={busy}
          onClick={() => void open()}
        >
          {kind === "members" ? "Invite member" : "Create team"}
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
          return (
          <Item key={item.id} variant="outline">
            <ItemMedia>
              {kind === "members" ? (
                <PersonAvatar
                  avatar={member.image ?? ""}
                  name={item.name}
                  className="size-8"
                />
              ) : (
                <Users />
              )}
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="break-words">{item.name}</ItemTitle>
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
                admin && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      void open(item as OrganizationTeam)
                    }
                  >
                    Edit
                  </Button>
                )
              )}
              {admin && !("role" in item && item.role === "owner") && (
                <Button variant="ghost" aria-label={`Remove ${item.name}`} onClick={() => setRemove(item)}>
                  Remove
                </Button>
              )}
            </ItemActions>
          </Item>
          );
        })}
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
              {kind === "members" ? "Invite member" : "Edit team"}
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
              <fieldset className="flex flex-col gap-6">
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
                {kind === "teams" && (
                  <HubWorkspaceAccess
                    people={{ ...people, teams: [] }}
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
                  <Button disabled={busy} type="submit">
                    {kind === "members" ? (edit.name.trim() ? "Send invitation" : "Create invitation link") : "Save changes"}
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
