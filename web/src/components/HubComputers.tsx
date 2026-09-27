import { HubModelDefault } from "./HubModelDefault";
import { HubComputerModelKeys } from "./HubComputerModelKeys";
import { HubComputerAccounts } from "./HubComputerAccounts";
import { HubComputerConnect } from "./HubComputerConnect";
import { computerModels } from "@/lib/hub-models";
import { EmptyState } from "@/components/EmptyState";
import { HubPersonalContext, usePersonalHub } from "@/lib/hub-scope";
import { Deferred } from "./Deferred";
import { Cloud, Laptop, Plus } from "lucide-react";
import { apiError } from "@/lib/api-error";
import { lazy, useEffect, useState } from "react";
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
import { currentLocation, listenToLocationChanges, navigateLocation, parseLocation } from "@/lib/route";

const HostedComputers = lazy(() => import("./HubHostedComputers").then((m) => ({ default: m.HubHostedComputers })));
const computerPane = () => {
  const route = parseLocation(currentLocation()).route;
  return route.name === "settings" && route.tab === "devices" ? route.deviceId ?? "cloud" : "cloud";
};

type Options = {
  role: string;
  members: ThreadMember[];
  teams: OrganizationTeam[];
};
export function HubComputers({ organizationId }: { organizationId?: string }) {
  const personalContext = usePersonalHub();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [org, setOrg] = useState(organizationId ?? "");
  const isPersonal =
    personalContext ||
    organizations.find((item) => item.id === org)?.personal === true ||
    !org;
  const [computersLoaded, setComputersLoaded] = useState(false);
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
  const [removing, setRemoving] = useState<ComputerSummary>();
  const [busy, setBusy] = useState(false);
  const [pane, setPane] = useState(computerPane);
  useEffect(() => {
    const changed = () => setPane(computerPane());
    return listenToLocationChanges(changed);
  }, []);
  const choosePane = (deviceId: string) => {
    setPane(deviceId);
    navigateLocation({ route: { name: "settings", tab: "devices", organizationId: org, deviceId } });
  };
  useEffect(() => {
    if (organizationId) setOrg(organizationId);
  }, [organizationId]);
  useEffect(() => {
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
  }, []);
  useEffect(() => {
    if (!org) return;
    setError("");
    setComputers([]);
    setComputersLoaded(false);
    setThreads([]);
    const off = watchHubComputers(
      org,
      (items, outdated) => {
        setComputers(items);
        setComputersLoaded(true);
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
  }, [org]);
  const openThread = (thread: HubThread) => {
    navigateLocation({
      route: {
        name: "threads",
        organizationId: org,
        threadId: thread.id,
      },
    });
  };
  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      if (removing)
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
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {!organizationId && organizations.length > 0 && (
            <Select
              value={org}
              onValueChange={(value) => {
                setOrg(value);
                navigateLocation({
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
        </div>
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
        <div className="flex min-w-0 flex-col gap-6">
          <nav aria-label="Computer settings" className="flex min-w-0 flex-wrap items-center gap-1 border-b pb-3">
            <Button size="sm" variant={pane === "cloud" ? "secondary" : "ghost"} data-link aria-current={pane === "cloud" ? "page" : undefined} onClick={() => choosePane("cloud")}><Cloud />Cloud</Button>
            <Button size="sm" variant={pane !== "cloud" ? "secondary" : "ghost"} data-link aria-current={pane !== "cloud" ? "page" : undefined} onClick={() => choosePane("computers")}><Laptop />Connected</Button>
          </nav>
          <div className="min-w-0">
            {pane === "general" && <section aria-label="General computer settings" className="flex max-w-xl flex-col gap-6">
              <Field>
                <FieldLabel>Connect a computer</FieldLabel>
                <FieldDescription>Add a Mac or Linux machine to run threads using its workspaces and providers.</FieldDescription>
              </Field>
              <HubComputerConnect organizationId={org} ownership={isPersonal || options.role === "member" ? "personal" : "organization"} />
              <Field>
                <FieldDescription>The setup guide covers installing the CLI and the providers it runs.</FieldDescription>
                <Button asChild variant="outline" className="max-w-sm" data-link><a href="https://tryremy.dev/docs/#installation" target="_blank" rel="noreferrer">Read the setup guide</a></Button>
              </Field>
              <FieldDescription>Your computer appears in Computers after you sign it in.</FieldDescription>
            </section>}
            {org && <div className={pane === "cloud" ? "" : "hidden"}>
              <Deferred open={pane === "cloud"}>
                <HostedComputers key={org} organizationId={org} admin={options.role !== "member"} />
              </Deferred>
            </div>}
            {computersLoaded && !["computers", "general", "cloud"].includes(pane) && !computers.some((c) => c.computerId === pane) && <EmptyState title="Computer unavailable" description="Choose another computer or connect one.">
              <Button variant="outline" data-link onClick={() => choosePane("computers")}>View computers</Button>
            </EmptyState>}
        {pane === "computers" && !computersLoaded && !error && <p role="status" className="text-sm text-muted-foreground">Reading computers…</p>}
        {pane === "computers" && computersLoaded && computers.length === 0 && !error && !stale && <Empty className="py-12">
          <EmptyHeader>
            <EmptyTitle>No computers connected</EmptyTitle>
            <EmptyDescription>Sign a Mac or Linux machine in to run threads using its workspaces and providers.</EmptyDescription>
          </EmptyHeader>
          <Button data-link onClick={() => choosePane("general")}>Connect a computer</Button>
        </Empty>}
        {pane === "computers" && computersLoaded && computers.length > 0 && <div className="mb-4 flex justify-end">
          <Button size="sm" variant="outline" data-link onClick={() => choosePane("general")}><Plus />Add computer</Button>
        </div>}
        <ItemGroup className="gap-3">
          {computers.filter((computer) => pane === "computers" || pane === computer.computerId).map((computer) => {
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
                    {pane === "computers" ? <Button variant="link" data-link className="h-auto min-w-0 justify-start whitespace-normal p-0 text-left text-foreground" onClick={() => choosePane(computer.computerId)}>{computer.name}</Button> : computer.name}
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
                  {pane === computer.computerId && computer.canUse && <HubModelDefault organizationId={org} computerId={computer.computerId} catalogue={computerModels(computer.capabilities.providers ?? [])} />}
                  {pane === computer.computerId && computer.canManage && computer.ownership !== "hosted" && <HubComputerAccounts organizationId={org} computerId={computer.computerId} />}
                  {pane === computer.computerId && computer.canManage && computer.ownership !== "hosted" && <HubComputerModelKeys organizationId={org} computerId={computer.computerId} />}
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
          </div>
        </div>
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
        <AlertDialog
          open={!!removing}
          onOpenChange={(open) => {
            if (!open && !busy) setRemoving(undefined);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this computer?</AlertDialogTitle>
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
