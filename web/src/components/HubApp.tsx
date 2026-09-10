import { lazy, useEffect, useState } from "react";
import {
  Folder,
  Laptop,
  MessagesSquare,
  Plus,
  SquareKanban,
  Users,
  User,
  LogOut,
  ChevronsUpDown,
  ChevronDown,
  Check,
  Building2,
  SquarePen,
  Network,
  Plug,
} from "lucide-react";
import type { HubThread, Organization } from "@remy/contract";
import type { HubRuntime } from "@/lib/hub-session";
import {
  hubRequest,
  HubRequestError,
  hubThreadBase,
  watchHubThreads,
} from "@/lib/hub-threads";
import { watchHubResource } from "@/lib/hub-computers";
import { parseLocation, formatLocation, type Route } from "@/lib/route";
import { apiError } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
import { HubPersonalContext } from "@/lib/hub-scope";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLoading } from "@/components/AppLoading";
import { Spinner } from "@/components/ui/spinner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Deferred } from "@/components/Deferred";
import { HubSignIn } from "./HubSignIn";
const Threads = lazy(() => import("./HubThreads"));
const Board = lazy(() => import("./HubBoard"));
const Computers = lazy(() =>
  import("./HubComputers").then((m) => ({ default: m.HubComputers })),
);
const Environments = lazy(() => import("./EnvironmentsSettings").then(m=>({default:m.EnvironmentsSettings})));
const OrganizationSettings = lazy(() => import("./HubOrganizationSettings"));
const Connections = lazy(() =>
  import("./HubConnections").then((m) => ({ default: m.HubConnections })),
);
const Inbox = lazy(() =>
  import("./HubInbox").then((m) => ({ default: m.HubInbox })),
);
const Routing = lazy(() =>
  import("./HubRouting").then((m) => ({ default: m.HubRouting })),
);

export default function HubApp({ runtime }: { runtime: HubRuntime }) {
  const [route, setRoute] = useState<Route>(
    parseLocation(window.location.hash).route,
  );
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [personal, setPersonal] = useState<Organization>();
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [profile, setProfile] = useState<{ id: string; name: string }>();
  const [loaded, setLoaded] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");
  const [threads, setThreads] = useState<HubThread[]>([]);
  const [create, setCreate] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState(
    new URLSearchParams(window.location.search).get("invite") ??
      (window.location.pathname.startsWith("/invite/")
        ? decodeURIComponent(window.location.pathname.slice(8))
        : null),
  );
  const navigate = (next: Route) => {
    window.location.hash = formatLocation({ route: next });
  };
  const reload = async () => {
    try {
      const [result, person, own] = await Promise.all([
        hubRequest<{ organizations: Organization[] }>("/api/organizations"),
        hubRequest<{ id: string; name: string }>("/api/profile"),
        hubRequest<{ personal: Organization }>("/api/personal"),
      ]);
      setError("");
      setPersonal(own.personal);
      setOrganizations(result.organizations);
      setProfile(person);
      setSignedOut(false);
    } catch (e) {
      if (e instanceof HubRequestError && e.status === 401) setSignedOut(true);
      else setError(apiError(e));
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    const changed = () => setRoute(parseLocation(window.location.hash).route);
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    void (async () => {
      if (
        new URLSearchParams(window.location.search).get("signin") === "complete"
      ) {
        try {
          await hubRequest("/api/sessions/web", "POST");
          const url = new URL(window.location.href);
          url.searchParams.delete("signin");
          window.history.replaceState(null, "", url);
        } catch (e) {
          setError(apiError(e));
        }
      }
      await reload();
    })();
  }, []);
  const contexts = personal ? [personal, ...organizations] : organizations;
  const remembered = profile
    ? localStorage.getItem(`remy.organization:${profile.id}`)
    : null;
  const organizationId =
    route.organizationId ??
    contexts.find((o) => o.id === remembered)?.id ??
    personal?.id;
  const organization = contexts.find((o) => o.id === organizationId);
  const isPersonal = organization?.personal === true;
  useEffect(() => {
    setThreads([]);
    setThreadsLoaded(false);
    if (!organization) return;
    localStorage.setItem(`remy.organization:${profile?.id}`, organization.id);
    if (!route.organizationId)
      navigate({ ...route, organizationId: organization.id });
    const offThreads = watchHubThreads(
      organization.id,
      (value) => {
        setThreads(value);
        setThreadsLoaded(true);
      },
      setError,
    );
    const offOrganization = watchHubResource<{ organization: Organization }>(
      hubThreadBase(organization.id),
      (value) => {
        if (value?.organization.personal) setPersonal(value.organization);
        else if (value)
          setOrganizations((all) =>
            all.map((o) =>
              o.id === value.organization.id ? value.organization : o,
            ),
          );
      },
      () => {
        void reload();
      },
    );
    return () => {
      offThreads();
      offOrganization();
    };
  }, [organization?.id, profile?.id]);
  if (!loaded) return <AppLoading />;
  if (signedOut) return <HubSignIn runtime={runtime} />;
  const requestedSection =
    route.name === "board" || route.name === "ticket"
      ? "tasks"
      : route.name === "settings"
        ? route.tab
        : route.name;
  const section =
    isPersonal && ["members", "teams"].includes(requestedSection ?? "")
      ? "threads"
      : requestedSection;
  const links: {
    label: string;
    icon: typeof Users;
    route: Route;
    selected: boolean;
  }[] = organization
    ? [
        {
          label: "Threads",
          icon: MessagesSquare,
          route: { name: "threads", organizationId },
          selected: section === "threads",
        },
        {
          label: "Inbox",
          icon: User,
          route: { name: "inbox", organizationId },
          selected: section === "inbox",
        },
        {
          label: "Tasks",
          icon: SquareKanban,
          route: { name: "board", organizationId },
          selected: section === "tasks",
        },
        {
          label: "Workspaces",
          icon: Folder,
          route: { name: "workspaces", organizationId },
          selected: section === "workspaces",
        },
        {
          label: "Computers",
          icon: Laptop,
          route: { name: "settings", tab: "devices", organizationId },
          selected: section === "devices",
        },
        { label:"Environments", icon:Plug, route:{name:"settings",tab:"environments",organizationId}, selected:section==="environments" },
        {
          label: "Routing",
          icon: Network,
          route: { name: "settings", tab: "routing", organizationId },
          selected: section === "routing",
        },
        {
          label: "Connections",
          icon: Plug,
          route: { name: "settings", tab: "connections", organizationId },
          selected: section === "connections",
        },
        {
          label: "Members",
          icon: User,
          route: { name: "settings", tab: "members", organizationId },
          selected: section === "members",
        },
        {
          label: "Teams",
          icon: Users,
          route: { name: "settings", tab: "teams", organizationId },
          selected: section === "teams",
        },
      ]
    : [];
  return (
    <HubPersonalContext value={isPersonal}>
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader className="flex-row items-center gap-1 px-3 py-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  aria-label="Choose personal or organization"
                  className="min-w-0 flex-1"
                >
                  {isPersonal ? <User /> : <Building2 />}
                  <span className="min-w-0 flex-1 truncate">
                    {organization?.name ?? "Choose account"}
                  </span>
                  <ChevronDown className="text-muted-foreground" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                <DropdownMenuGroup>
                  {personal && (
                    <DropdownMenuItem
                      onSelect={() =>
                        navigate({
                          name: "threads",
                          organizationId: personal.id,
                        })
                      }
                    >
                      <User />
                      <span className="min-w-0 flex-1 truncate">Personal</span>
                      {isPersonal && <Check />}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Organizations</DropdownMenuLabel>
                  {organizations.map((o) => (
                    <DropdownMenuItem
                      key={o.id}
                      onSelect={() =>
                        navigate({ name: "threads", organizationId: o.id })
                      }
                    >
                      <Building2 />
                      <span className="min-w-0 flex-1 truncate">{o.name}</span>
                      {o.id === organizationId && <Check />}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem onSelect={() => setCreate(true)}>
                    <Plus />
                    Create organization
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New thread"
              title="New thread"
              data-link
              onClick={() => navigate({ name: "threads", organizationId })}
            >
              <SquarePen />
            </Button>
          </SidebarHeader>
          <SidebarContent>
            {organization && (
              <>
                {[
                  links.slice(0, 4),
                  links
                    .slice(4)
                    .filter(
                      (link) =>
                        !isPersonal ||
                        !["Members", "Teams"].includes(link.label),
                    ),
                ].map((group, index) => (
                  <SidebarGroup key={index} className="shrink-0 px-3">
                    {index === 1 && (
                      <SidebarGroupLabel>
                        {isPersonal ? "Settings" : "Organization"}
                      </SidebarGroupLabel>
                    )}
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {group.map((link) => (
                          <SidebarMenuItem key={link.label}>
                            <SidebarMenuButton
                              className="text-muted-foreground data-[active=true]:text-foreground"
                              isActive={link.selected}
                              data-link
                              onClick={() => navigate(link.route)}
                            >
                              <link.icon />
                              <span>{link.label}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                ))}
                <SidebarGroup className="shrink-0 px-3">
                  <SidebarGroupLabel>Recent threads</SidebarGroupLabel>
                  <SidebarGroupContent>
                    {!threadsLoaded && (
                      <div
                        className="flex flex-col gap-3 px-2 py-2"
                        role="status"
                        aria-label="Loading threads"
                      >
                        {[1, 2, 3].map((n) => (
                          <Skeleton key={n} className="h-3 w-3/4" />
                        ))}
                      </div>
                    )}
                    {threadsLoaded && !threads.length && (
                      <p className="px-2 py-2 text-xs text-muted-foreground">
                        No threads yet
                      </p>
                    )}
                    <SidebarMenu>
                      {threads.map((thread) => (
                        <SidebarMenuItem
                          key={`${thread.computerId}:${thread.id}`}
                        >
                          <SidebarMenuButton
                            data-link
                            isActive={
                              route.name === "threads" &&
                              route.threadId === thread.id &&
                              route.computerId === thread.computerId
                            }
                            onClick={() =>
                              navigate({
                                name: "threads",
                                organizationId,
                                computerId: thread.computerId,
                                threadId: thread.id,
                              })
                            }
                          >
                            <MessagesSquare />
                            <span>{thread.detail.title}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              </>
            )}
          </SidebarContent>
          <SidebarFooter className="p-3">
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton size="lg" aria-label="Account menu">
                      <Avatar size="sm">
                        <AvatarFallback>
                          {profile?.name.trim().charAt(0).toUpperCase() || (
                            <User />
                          )}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1 truncate">
                        {profile?.name}
                      </span>
                      <ChevronsUpDown className="text-muted-foreground" />
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="top"
                    align="start"
                    className="w-(--radix-dropdown-menu-trigger-width)"
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onSelect={() =>
                          void hubRequest("/api/sessions/current", "DELETE")
                            .then(() => {
                              setPersonal(undefined);
                              setOrganizations([]);
                              setThreads([]);
                              setSignedOut(true);
                            })
                            .catch((e) => setError(apiError(e)))
                        }
                      >
                        <LogOut />
                        Sign out
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="h-svh min-w-0 overflow-hidden">
          <header className="flex shrink-0 items-center gap-2 border-b p-3">
            <SidebarTrigger />
            <span>{organization?.name ?? "Remy"}</span>
          </header>
          {error && (
            <p role="alert" className="px-4 py-2">
              {error}
            </p>
          )}
          {!organization ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {error
                    ? "Your account could not be opened"
                    : "Choose an account"}
                </EmptyTitle>
                <EmptyDescription>
                  {error
                    ? "Try opening your account again."
                    : "Choose Personal or an organization from the sidebar."}
                </EmptyDescription>
              </EmptyHeader>
              {error && (
                <EmptyContent>
                  <Button onClick={() => void reload()}>Try again</Button>
                </EmptyContent>
              )}
            </Empty>
          ) : (
            <div key={organization.id} className="flex min-h-0 flex-1 flex-col">
              <div
                hidden={section !== "threads"}
                className={
                  section === "threads" ? "flex min-h-0 flex-1" : undefined
                }
              >
                <Deferred open={section === "threads"}>
                  <Threads
                    organizationId={organization.id}
                    computerId={
                      route.name === "threads" ? route.computerId : undefined
                    }
                    threadId={
                      route.name === "threads" ? route.threadId : undefined
                    }
                    navigate={navigate}
                  />
                </Deferred>
              </div>
              <div
                hidden={section !== "tasks"}
                className={
                  section === "tasks" ? "flex min-h-0 flex-1" : undefined
                }
              >
                <Deferred open={section === "tasks"}>
                  <Board
                    organizationId={organization.id}
                    ticketId={route.name === "ticket" ? route.key : undefined}
                    navigate={navigate}
                  />
                </Deferred>
              </div>
              <div
                hidden={section !== "devices"}
                className="min-h-0 overflow-auto p-6"
              >
                <Deferred open={section === "devices"}>
                  <Computers organizationId={organization.id} />
                </Deferred>
              </div>
              <div
                hidden={section !== "inbox"}
                className="min-h-0 flex-1 overflow-auto"
              >
                <Deferred open={section === "inbox"}>
                  <Inbox
                    organizationId={organization.id}
                    userId={profile?.id ?? ""}
                    agentId={route.name === "inbox" ? route.agent : undefined}
                    choose={(id) =>
                      navigate({
                        name: "inbox",
                        agent: id,
                        organizationId: organization.id,
                      })
                    }
                  />
                </Deferred>
              </div>
              <div hidden={section !== "environments"} className="min-h-0 flex-1 overflow-auto p-6"><Deferred open={section === "environments"}><Environments organizationId={organization.id} /></Deferred></div>
              <div
                hidden={section !== "connections"}
                className="min-h-0 overflow-auto"
              >
                <Deferred open={section === "connections"}>
                  <Connections organizationId={organization.id} />
                </Deferred>
              </div>
              <div
                hidden={section !== "routing"}
                className="min-h-0 overflow-auto"
              >
                <Deferred open={section === "routing"}>
                  <Routing organizationId={organization.id} />
                </Deferred>
              </div>
              {(["members", "teams", "workspaces"] as const).map((kind) => (
                <div
                  hidden={
                    section !== kind || (isPersonal && kind !== "workspaces")
                  }
                  key={kind}
                  className="min-h-0 overflow-auto"
                >
                  <Deferred
                    open={
                      section === kind && (!isPersonal || kind === "workspaces")
                    }
                  >
                    <OrganizationSettings
                      organizationId={organization.id}
                      kind={kind}
                      role={organization.role}
                    />
                  </Deferred>
                </div>
              ))}
            </div>
          )}
        </SidebarInset>
        <Dialog open={create} onOpenChange={setCreate}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create organization</DialogTitle>
              <DialogDescription>
                Choose a name your teammates recognize.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                void hubRequest<Organization>("/api/organizations", "POST", {
                  name,
                })
                  .then(async (o) => {
                    await reload();
                    navigate({ name: "board", organizationId: o.id });
                    setCreate(false);
                    setName("");
                  })
                  .catch((e) => setError(apiError(e)))
                  .finally(() => setBusy(false));
              }}
            >
              <Field>
                <FieldLabel htmlFor="organization-name">Name</FieldLabel>
                <Input
                  id="organization-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={120}
                />
              </Field>
              {error && <p role="alert">{error}</p>}
              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreate(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || !name.trim()}>
                  {busy && <Spinner data-icon="inline-start" />}
                  Create organization
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!invite}
          onOpenChange={(v) => {
            if (!v) setInvite(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Join your organization</DialogTitle>
              <DialogDescription>
                Accept your invitation to share work with your teammates.
              </DialogDescription>
            </DialogHeader>
            {error && <p role="alert">{error}</p>}
            <DialogFooter>
              <Button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void hubRequest<{ organizationId: string }>(
                    "/api/invitations/accept",
                    "POST",
                    { token: invite },
                  )
                    .then(async (result) => {
                      setInvite(null);
                      window.history.replaceState(null, "", "/");
                      await reload();
                      navigate({
                        name: "board",
                        organizationId: result.organizationId,
                      });
                    })
                    .catch((e) => setError(apiError(e)))
                    .finally(() => setBusy(false));
                }}
              >
                Accept invitation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SidebarProvider>
    </HubPersonalContext>
  );
}
