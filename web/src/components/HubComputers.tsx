import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { HubPersonalContext, usePersonalHub } from "@/lib/hub-scope";
import { HubHostedComputers } from "./HubHostedComputers";
import { HubBoardSync } from "./HubBoardSync";
import { apiError } from "@/lib/api-error";
import { useEffect, useState } from "react";
import type {
  ComputerAccess,
  ComputerSummary,
  HubThread,
  Organization,
  OrganizationTeam,
  ThreadMember,
} from "@remy/contract";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  ItemActions,
} from "@/components/ui/item";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { DEVICE_ICON_IDS, deviceIcon, type DeviceIconId } from "@/lib/devices";
import { hubRequest, hubThreadBase, watchHubThreads } from "@/lib/hub-threads";
import { watchHubComputers } from "@/lib/hub-computers";
import { formatLocation } from "@/lib/route";
import { transport } from "@/lib/transport";
import { useStore } from "@/state/store";

type Registration = {
  computerId: string;
  organizationId: string;
  hubUrl: string;
  name: string;
  icon: string;
};
type Options = {
  role: string;
  members: ThreadMember[];
  teams: OrganizationTeam[];
};
export function HubComputers({ organizationId }: { organizationId?: string }) {
  const personalContext = usePersonalHub();
  const local = useStore((s) => s.servers.find((server) => server.local));
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [org, setOrg] = useState(organizationId ?? "");
  const isPersonal =
    personalContext ||
    organizations.find((item) => item.id === org)?.personal === true ||
    !org;
  const [computers, setComputers] = useState<ComputerSummary[]>([]);
  const [threads, setThreads] = useState<HubThread[]>([]);
  const [options, setOptions] = useState<Options>({
    role: "member",
    members: [],
    teams: [],
  });
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ComputerSummary>();
  const [removing, setRemoving] = useState<ComputerSummary | "local">();
  const [attach, setAttach] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (organizationId) setOrg(organizationId);
  }, [organizationId]);
  useEffect(() => {
    if (!local) return;
    void transport
      .request<{ registration: Registration | null }>(
        local.id,
        "/server/hub/computer",
      )
      .then((value) => {
        setRegistration(value.registration);
        if (!organizationId && value.registration)
          setOrg(value.registration.organizationId);
      })
      .catch((e) => setError(apiError(e)));
  }, [local?.id, organizationId]);
  useEffect(() => {
    if (local) return;
    void Promise.all([
      hubRequest<{ organizations: Organization[] }>("/api/organizations"),
      hubRequest<{ personal: Organization }>("/api/personal"),
    ])
      .then(([value, account]) => {
        setOrganizations([account.personal, ...value.organizations]);
        if (!organizationId)
          setOrg((current) => current || account.personal.id);
      })
      .catch(() => undefined);
  }, [local?.id]);
  useEffect(() => {
    if (!org || local) return;
    setError("");
    setComputers([]);
    setThreads([]);
    const off = watchHubComputers(
      org,
      (items, outdated) => {
        setComputers(items);
        setStale(outdated);
        if (!outdated) {
          setError("");
          void hubRequest<Options>(`${hubThreadBase(org)}/computers/options`)
            .then(setOptions)
            .catch((e) => setError(apiError(e)));
        }
      },
      setError,
    );
    const offThreads = watchHubThreads(org, setThreads, setError);
    return () => {
      off();
      offThreads();
    };
  }, [org, local?.id]);
  const openThread = (thread: HubThread) => {
    window.location.hash = formatLocation({
      route: {
        name: "threads",
        organizationId: org,
        computerId: thread.computerId,
        threadId: thread.id,
      },
    });
  };
  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      if (removing === "local" && local) {
        await transport.request(local.id, "/server/hub/computer", {
          method: "DELETE",
        });
        setRegistration(null);
      } else if (removing && removing !== "local")
        await hubRequest(
          `${hubThreadBase(org)}/computers/${removing.computerId}`,
          "DELETE",
        );
      setRemoving(undefined);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <HubPersonalContext value={isPersonal}>
      <section
        className="@container flex min-w-0 flex-col gap-4"
        aria-label="Computers"
      >
        <Field>
          <FieldLabel>Computers</FieldLabel>
          <FieldDescription>
            {isPersonal
              ? "Connect a computer to run your threads."
              : "Choose who can use each computer."}
          </FieldDescription>
        </Field>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {!organizationId && organizations.length > 0 && (
            <Select
              value={org}
              onValueChange={(value) => {
                setOrg(value);
                window.location.hash = formatLocation({
                  route: {
                    name: "settings",
                    tab: "devices",
                    organizationId: value,
                  },
                });
              }}
            >
              <SelectTrigger aria-label="Account" className="w-full max-w-56">
                <SelectValue placeholder="Choose an account" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {organizations.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          {local && !registration && (
            <Button variant="outline" onClick={() => setAttach(true)}>
              Attach this Mac
            </Button>
          )}
          {registration && (
            <Button variant="outline" onClick={() => setRemoving("local")}>
              Detach this Mac
            </Button>
          )}
        </div>
        {local &&
          registration?.organizationId === org &&
          options.role !== "member" && (
            <HubBoardSync
              organizationId={org}
              computerId={registration.computerId}
              localId={local.id}
            />
          )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {stale && (
          <p role="status" className="text-sm text-muted-foreground">
            You’re reading the last saved computer list.
          </p>
        )}
        {!org && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Connect this Mac</EmptyTitle>
              <EmptyDescription>
                Attach this Mac to use your threads from the web.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {org && !local && !computers.length && !stale && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Connect your Mac</EmptyTitle>
              <EmptyDescription>
                In Remy on your Mac, open Settings → Computers and choose Attach this Mac.
              </EmptyDescription>
            </EmptyHeader>
            {!local && <div className="flex flex-wrap justify-center gap-2">
              <Button asChild><a href="https://github.com/padamchopra/remy/releases/latest" target="_blank" rel="noreferrer">Download for Mac</a></Button>
              <Button asChild variant="outline"><a href="https://tryremy.dev/docs/#web" target="_blank" rel="noreferrer">Read the setup guide</a></Button>
            </div>}
            <p className="text-sm text-muted-foreground">Keep this page open while you connect your Mac.</p>
          </Empty>
        )}
        {org && computers.some((c) => c.canUse && c.availability !== "offline") && <Button data-link onClick={() => { window.location.hash = formatLocation({ route: { name: "threads", organizationId: org } }); }}>Continue to your threads</Button>}
        {local && registration && <Field>
          <FieldDescription>This Mac is connected to Remy on the web.</FieldDescription>
          <Button asChild variant="outline"><a href={registration.hubUrl} target="_blank" rel="noreferrer">Open Remy on the web</a></Button>
        </Field>}
        {org && !local && (
          <HubHostedComputers
            key={org}
            organizationId={org}
            admin={options.role !== "member"}
          />
        )}
        <ItemGroup className="gap-3">
          {computers.map((computer) => {
            const Icon = deviceIcon(computer.icon as DeviceIconId);
            const running = threads.filter(
              (t) =>
                t.computerId === computer.computerId &&
                ["running", "working", "waiting", "needs_input"].includes(
                  String(t.detail.state),
                ),
            );
            return (
              <Item
                key={computer.computerId}
                variant="outline"
                className="min-w-0"
                data-computer-id={computer.computerId}
              >
                <ItemMedia variant="icon">
                  <Icon />
                </ItemMedia>
                <ItemContent className="min-w-0 basis-[calc(100%-3rem)] @min-[30rem]:basis-0">
                  <ItemTitle className="w-full whitespace-normal break-words">
                    {computer.name}
                  </ItemTitle>
                  <ItemDescription>
                    {computer.ownership === "personal"
                      ? "Personal"
                      : computer.ownership === "hosted"
                        ? "Hosted"
                        : "Organization"}{" "}
                    ·{" "}
                    {computer.availability === "offline" ? "Offline" : "Online"}{" "}
                    ·{" "}
                    {isPersonal || computer.access.mode === "owner"
                      ? "Only me"
                      : computer.access.mode === "selected"
                        ? "Selected members and teams"
                        : "Everyone in your organization"}
                  </ItemDescription>
                  {running.map((thread) => (
                    <Button
                      key={thread.id}
                      variant="link"
                      className="h-auto justify-start whitespace-normal p-0 text-left"
                      data-link
                      onClick={() => openThread(thread)}
                    >
                      {String(thread.detail.title)} ·{" "}
                      {thread.access.owner.label}
                    </Button>
                  ))}
                </ItemContent>
                {computer.canManage && (
                  <ItemActions className="min-w-0 shrink-0 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={stale}
                      onClick={() => setEditing(computer)}
                    >
                      Edit computer
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={stale}
                      onClick={() => setRemoving(computer)}
                    >
                      Remove
                    </Button>
                  </ItemActions>
                )}
              </Item>
            );
          })}
        </ItemGroup>
        {editing && (
          <ComputerEditor
            computer={editing}
            options={options}
            close={() => setEditing(undefined)}
            save={async (patch) => {
              await hubRequest(
                `${hubThreadBase(org)}/computers/${editing.computerId}`,
                "PATCH",
                patch,
              );
              setEditing(undefined);
            }}
          />
        )}
        {attach && local && (
          <AttachComputer
            serverId={local.id}
            org={org}
            hubUrl={registration?.hubUrl}
            close={() => setAttach(false)}
            attached={(value) => {
              setRegistration(value);
              setOrg(value.organizationId);
              setAttach(false);
            }}
          />
        )}
        <AlertDialog
          open={!!removing}
          onOpenChange={(open) => {
            if (!open && !busy) setRemoving(undefined);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {removing === "local"
                  ? "Detach this Mac?"
                  : "Remove this computer?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                Its threads keep running on the computer, but you lose access to
                them here.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault();
                  void remove();
                }}
              >
                Remove computer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </HubPersonalContext>
  );
}

function ComputerEditor({
  computer,
  options,
  close,
  save,
}: {
  computer: ComputerSummary;
  options: Options;
  close: () => void;
  save: (patch: {
    name: string;
    icon: string;
    access: ComputerAccess;
  }) => Promise<void>;
}) {
  const isPersonal = usePersonalHub();
  const [name, setName] = useState(computer.name);
  const [icon, setIcon] = useState(computer.icon);
  const [access, setAccess] = useState(computer.access);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const choose = (key: "userIds" | "teamIds", id: string, checked: boolean) =>
    setAccess((old) => ({
      ...old,
      [key]: checked
        ? [...new Set([...old[key], id])]
        : old[key].filter((value) => value !== id),
    }));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Edit computer</DialogTitle>
          <DialogDescription>Update its name and appearance.</DialogDescription>
        </DialogHeader>
        <form
          className="grid min-w-0 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            void save({ name: name.trim(), icon, access })
              .catch((e) => setError(apiError(e)))
              .finally(() => setBusy(false));
          }}
        >
          <Field>
            <FieldLabel htmlFor="computer-name">Name</FieldLabel>
            <Input
              id="computer-name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>Icon</FieldLabel>
            <Select value={icon || "laptop"} onValueChange={setIcon}>
              <SelectTrigger aria-label="Computer icon">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {DEVICE_ICON_IDS.map((id) => {
                    const Icon = deviceIcon(id);
                    return (
                      <SelectItem key={id} value={id}>
                        <Icon />
                        {id[0].toUpperCase() + id.slice(1)}
                      </SelectItem>
                    );
                  })}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {!isPersonal && (
            <Field>
              <FieldLabel>Who can use this computer</FieldLabel>
              <Select
                value={access.mode}
                onValueChange={(mode: ComputerAccess["mode"]) =>
                  setAccess((old) => ({ ...old, mode }))
                }
              >
                <SelectTrigger aria-label="Who can use this computer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {computer.ownerUserId && (
                      <SelectItem value="owner">Only me</SelectItem>
                    )}
                    <SelectItem value="selected">
                      Selected members and teams
                    </SelectItem>
                    <SelectItem value="organization">
                      Everyone in your organization
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
          {!isPersonal && access.mode === "selected" && (
            <>
              <Field>
                <FieldLabel>Members</FieldLabel>
                {options.members
                  .filter((m) => m.id !== computer.ownerUserId)
                  .map((member) => (
                    <Field key={member.id} orientation="horizontal">
                      <Checkbox
                        id={`member-${member.id}`}
                        checked={access.userIds.includes(member.id)}
                        onCheckedChange={(checked) =>
                          choose("userIds", member.id, checked === true)
                        }
                      />
                      <FieldLabel
                        htmlFor={`member-${member.id}`}
                        className="min-w-0 break-words"
                      >
                        {member.label}
                      </FieldLabel>
                    </Field>
                  ))}
              </Field>
              <Field>
                <FieldLabel>Teams</FieldLabel>
                {options.teams.length === 0 && (
                  <FieldDescription>
                    Your organization has no teams.
                  </FieldDescription>
                )}
                {options.teams.map((team) => (
                  <Field key={team.id} orientation="horizontal">
                    <Checkbox
                      id={`team-${team.id}`}
                      checked={access.teamIds.includes(team.id)}
                      onCheckedChange={(checked) =>
                        choose("teamIds", team.id, checked === true)
                      }
                    />
                    <FieldLabel
                      htmlFor={`team-${team.id}`}
                      className="min-w-0 break-words"
                    >
                      {team.name}
                    </FieldLabel>
                  </Field>
                ))}
              </Field>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </Button>
            <Button disabled={busy || !name.trim()}>Save computer</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AttachComputer({
  serverId,
  org,
  hubUrl,
  close,
  attached,
}: {
  serverId: string;
  org: string;
  hubUrl?: string;
  close: () => void;
  attached: (registration: Registration) => void;
}) {
  const [accounts, setAccounts] = useState<Organization[]>();
  const [address, setAddress] = useState(hubUrl ?? "https://app.tryremy.dev");
  const [organization, setOrganization] = useState(org);
  const personalContext = !organization || organization === "personal" || (accounts ?? []).some((account) => account.id === organization && account.personal);
  const selectedAdmin = (accounts ?? []).some((account) => account.id === organization && ["owner", "admin"].includes(account.role));
  const [ownership, setOwnership] = useState("personal");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (!code) {
        const value = await transport.request<{ userCode: string }>(
          serverId,
          "/server/hub/authorize",
          {
            method: "POST",
            body: { hubUrl: address, organizationId: organization === "personal" ? "" : organization, ownership },
          },
        );
        setCode(value.userCode);
      } else if (!accounts) {
        const result = await transport.request<{ accounts: Organization[] }>(serverId, "/server/hub/authorize/accounts", { method: "POST" });
        setAccounts(result.accounts);
        setOrganization(result.accounts.find((account) => account.id === org)?.id ?? result.accounts.find((account) => account.personal)?.id ?? "");
        setOwnership("personal");
      } else {
        const result = await transport.request<{ registration: Registration }>(
          serverId,
          "/server/hub/authorize/complete",
          { method: "POST", body: { organizationId: organization, ownership } },
        );
        attached(result.registration);
      }
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attach this Mac</DialogTitle>
          <DialogDescription>
            {accounts ? "Choose which account can use this Mac." : code
              ? "Approve this code in your browser, then choose your account."
              : "Connect this Mac to your Remy account."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {!code || accounts ? (
            <>
              {accounts && <Field>
                <FieldLabel>Account</FieldLabel>
                <Select value={organization || "personal"} onValueChange={(id) => { setOrganization(id); setOwnership("personal"); }}>
                  <SelectTrigger aria-label="Attach to account"><SelectValue placeholder="Choose an account" /></SelectTrigger>
                  <SelectContent><SelectGroup>
                    {!(accounts ?? []).some((account) => account.personal) && <SelectItem value="personal">Personal</SelectItem>}
                    {(accounts ?? []).map((account) => <SelectItem key={account.id} value={account.id}>{account.personal ? "Personal" : account.name}</SelectItem>)}
                  </SelectGroup></SelectContent>
                </Select>
              </Field>}
              {!accounts && <Collapsible>
                <CollapsibleTrigger asChild><Button type="button" variant="ghost">Advanced connection settings</Button></CollapsibleTrigger>
                <CollapsibleContent className="pt-3"><Field>
                  <FieldLabel htmlFor="hub-address">Remy address</FieldLabel>
                  <Input id="hub-address" type="url" value={address} onChange={(e) => setAddress(e.target.value)} required />
                </Field></CollapsibleContent>
              </Collapsible>}
              {accounts && !personalContext && (
                <Field>
                  <FieldLabel>Owner</FieldLabel>
                  <Select value={ownership} onValueChange={setOwnership}>
                    <SelectTrigger aria-label="Computer owner">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="personal">You</SelectItem>
                        {selectedAdmin && (
                          <>
                            <SelectItem value="organization">
                              Your organization
                            </SelectItem>
                            <SelectItem value="hosted">
                              Hosted by your organization
                            </SelectItem>
                          </>
                        )}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    {ownership === "personal"
                      ? "Only you can use this Mac until you share access."
                      : "Everyone in your organization can use this computer."}
                  </FieldDescription>
                </Field>
              )}
            </>
          ) : (
            <>
            <p
              className="text-center font-mono text-2xl"
              aria-label="Computer authorization code"
            >
              {code}
            </p>
            <Button asChild><a href={`${new URL(address).origin}/?computerCode=${encodeURIComponent(code)}`} target="_blank" rel="noreferrer">Approve in your browser</a></Button>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </Button>
            {code && <Button type="button" variant="outline" disabled={busy} onClick={() => { setCode(""); setAccounts(undefined); setError(""); }}>Start again</Button>}
            <Button
              disabled={
                busy || !address || (ownership !== "personal" && !organization)
              }
            >
              {accounts ? "Finish connecting" : code ? "Choose account" : "Continue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
