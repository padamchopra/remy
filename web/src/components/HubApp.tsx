import { HubThreadSidebar } from "./HubThreadSidebar";
import { PaneHeader } from "./PaneHeader";
import { AvatarFrom } from "./UserAvatar";
import { useHubProfile } from "@/lib/hub-profile";
import { HubModelFavorites } from "./HubModelFavorites";
import { EmptyState } from "@/components/EmptyState";
import { lazy, useEffect, useRef, useState } from "react";
import {
  Layers,
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
  ChevronLeft,
  Settings2,
  Settings as OrganizationSettingsIcon,
  Check,
  Building2,
  SquarePen,
  Network,
  Plug,
  Bell,
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
import { currentLocation, listenToLocationChanges, navigateLocation, normalizeLocation, parseLocation, type Route } from "@/lib/route";
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
  useSidebar,
} from "@/components/ui/sidebar";
import {
  EmptyContent,
} from "@/components/ui/empty";
import { HubPersonalContext } from "@/lib/hub-scope";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLoading } from "@/components/AppLoading";
import { PaneLoading } from "@/components/PaneLoading";
import { Spinner } from "@/components/ui/spinner";
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
import { HubComputerApproval } from "./HubComputerApproval";
import { HubInvitation } from "./HubInvitation";
import { HubSignIn } from "./HubSignIn";
import { HubNotifications } from "./HubNotifications";
const WorkspacesList = lazy(() => import("./HubWorkspaces"));
const OrganizationAdmin = lazy(() => import("./HubOrganizationAdmin"));
const AllView = lazy(() => import("./HubAllView"));
const GeneralSettings = lazy(() => import("./HubGeneralSettings"));
const Threads = lazy(() => import("./HubThreads"));
const Board = lazy(() => import("./HubBoard"));
const Computers = lazy(() =>
  import("./HubComputers").then((m) => ({ default: m.HubComputers })),
);
const Environments = lazy(() => import("./EnvironmentsSettings").then(m=>({default:m.EnvironmentsSettings})));
const WorkspaceDetails = lazy(() => import("./HubWorkspaceDetails"));
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

function NotificationButton({ onClick }: { onClick: () => void }) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuButton tooltip="Notifications" aria-label="Notifications" onClick={() => { setOpenMobile(false); onClick(); }}>
      <Bell /><span>Notifications</span>
    </SidebarMenuButton>
  );
}

function SidebarNavigation({ route }: { route: Route }) {
  const { setOpenMobile } = useSidebar();
  useEffect(() => setOpenMobile(false), [route, setOpenMobile]);
  return null;
}

export default function HubApp({ runtime }: { runtime: HubRuntime }) {
  const [route, setRoute] = useState<Route>(
    normalizeLocation().route,
  );
  const previousSurface = useRef<Route | undefined>(undefined);
  useEffect(() => {
    if (route.name !== "settings") previousSurface.current = route;
  }, [route]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [personal, setPersonal] = useState<Organization>();
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [profile, setProfile] = useState<{ id: string; name: string; image?: string }>();
  const liveProfile = useHubProfile(route.organizationId === "all" ? personal?.id ?? "personal" : route.organizationId ?? "personal").profile;
  const shownProfile = liveProfile ?? profile;
  const [loaded, setLoaded] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");
  const [threads, setThreads] = useState<HubThread[]>([]);
  const [create, setCreate] = useState(false);
  const [notificationsAccount, setNotificationsAccount] = useState<string>();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [computerCode, setComputerCode] = useState(new URLSearchParams(window.location.search).get("computerCode"));
  const [invite, setInvite] = useState(
    new URLSearchParams(window.location.search).get("invite") ??
      (window.location.pathname.startsWith("/invite/")
        ? decodeURIComponent(window.location.pathname.slice(8))
        : null),
  );
  const navigate = (next: Route) => {
    navigateLocation({ route: next });
  };
  const reload = async () => {
    try {
      await Promise.all([
        hubRequest<{ organizations: Organization[] }>("/api/organizations").then(result => setOrganizations(result.organizations)),
        hubRequest<{ id: string; name: string }>("/api/profile").then(setProfile),
        hubRequest<{ personal: Organization }>("/api/personal").then(own => setPersonal(own.personal)),
      ]);
      setError("");
      setSignedOut(false);
    } catch (e) {
      if (e instanceof HubRequestError && e.status === 401) setSignedOut(true);
      else setError(apiError(e));
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    const changed = () => setRoute(parseLocation(currentLocation()).route);
    return listenToLocationChanges(changed);
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
  const organizationId = route.organizationId ?? "all";
  const isAll = organizationId === "all";
  const organization = isAll ? {...personal, id:"all", name:"All", role:"owner", personal:false} as Organization : contexts.find((o) => o.id === organizationId);
  const contextIds = contexts.map(o => o.id).join(",");
  const isPersonal = organization?.personal === true;
  useEffect(() => {
    setThreads([]);
    setThreadsLoaded(false);
    setError("");
    if (!organization) return;
    if (isAll) {
      const values = new Map<string, HubThread[]>();
      const settled = new Set<string>();
      const emit = () => {
        const seen = new Set<string>();
        setThreads(
          [...values.values()]
            .flat()
            .filter((thread) => {
              if (seen.has(thread.id)) return false;
              seen.add(thread.id);
              return true;
            })
            .sort((a,b) => Number(b.detail.updatedAt ?? b.observedAt) - Number(a.detail.updatedAt ?? a.observedAt)),
        );
        setThreadsLoaded(settled.size === contexts.length);
      };
      const off = contexts.map(owner => watchHubThreads(owner.id, value => { values.set(owner.id,value); settled.add(owner.id); emit(); }, message => { settled.add(owner.id); setError(`${owner.name}: ${message}`); emit(); }));
      const offOwners = contexts.map(owner => watchHubResource<{organization:Organization}>(hubThreadBase(owner.id), value => {
        if (!value) return;
        if (value.organization.personal) setPersonal(value.organization);
        else setOrganizations(all => all.map(o => o.id === owner.id ? value.organization : o));
      }, () => { void reload(); }));
      return () => [...off, ...offOwners].forEach(stop => stop());
    }
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
  }, [organization?.id, profile?.id, isAll ? contextIds : ""]);
  if (!loaded && !(profile && organization)) return <AppLoading />;
  if (signedOut) return <HubSignIn runtime={runtime} />;
  const requestedSection =
    route.name === "board" || route.name === "ticket"
      ? "tasks"
      : route.name === "settings"
        ? route.tab
        : route.name;
  const organizationSettings = route.name === "settings" && ["organization", "members", "teams"].includes(route.tab);
  const section = organizationSettings ? "organization" : requestedSection;
  const inSettings = route.name === "settings";
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
          label: "General",
          icon: Settings2,
          route: { name: "settings", tab: "general", organizationId },
          selected: section === "general",
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
          label: "Organization",
          icon: Building2,
          route: { name:"settings", tab:"organization", organizationId },
          selected: organizationSettings,
        },
      ]
    : [];
  const paneLabel = links.find((link) => link.selected)?.label ?? "Remy";
  const showPaneHeader =
    !(route.name === "threads" && route.threadId) &&
    !(route.name === "workspaces" && route.workspaceId);
  const paneCrumbs = route.name === "settings"
    ? [{ label: "Settings" }, { label: paneLabel }]
    : [{ label: paneLabel }];
  return (
    <HubPersonalContext value={isPersonal}>
      <HubModelFavorites key={`${profile?.id}:${organizationId}`} organizationId={isAll ? undefined : organizationId}>
      <SidebarProvider>
        <SidebarNavigation route={route} />
        <Sidebar collapsible="icon">
          {inSettings ? (
            <SidebarHeader className="flex-row items-center px-3 py-3 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-2">
              <SidebarMenu className="min-w-0 flex-1"><SidebarMenuItem>
                <SidebarMenuButton tooltip="Back" aria-label="Back" data-link onClick={() => { const previous = previousSurface.current; navigate(previous && previous.organizationId === organizationId ? previous : { name: "threads", organizationId }); }}>
                  <ChevronLeft /><span>Back</span>
                </SidebarMenuButton>
              </SidebarMenuItem></SidebarMenu>
              <SidebarTrigger className="shrink-0 group-data-[collapsible=icon]:order-first" />
            </SidebarHeader>
          ) : <SidebarHeader className="flex-row items-center gap-1 px-3 py-3 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  tooltip="Choose account view"
                  aria-label="Choose account view"
                  className="min-w-0 flex-1"
                >
                  {isAll ? <Layers /> : isPersonal ? <User /> : <Building2 />}
                  <span className="min-w-0 flex-1 truncate">
                    {organization?.name ?? "Choose account"}
                  </span>
                  <ChevronDown className="text-muted-foreground" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => navigate({name:"threads",organizationId:"all"})}><Layers /><span className="min-w-0 flex-1">All</span>{isAll && <Check />}</DropdownMenuItem>
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
                    <div key={o.id} className="flex items-center gap-1">
                      <DropdownMenuItem className="min-w-0 flex-1" onSelect={() => navigate({ name: "threads", organizationId: o.id })}>
                        <Building2 />
                        <span className="min-w-0 flex-1 truncate">{o.name}</span>
                        {o.id === organizationId && <Check />}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="shrink-0 justify-center" aria-label={`${o.name} settings`} title={`${o.name} settings`} onSelect={() => navigate({name:"settings",tab:"organization",organizationTab:"general",organizationId:o.id})}>
                        <OrganizationSettingsIcon />
                        <span className="sr-only">{o.name} settings</span>
                      </DropdownMenuItem>
                    </div>
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
              onClick={() => {
                navigate({ name: "threads", organizationId });
              }}
            >
              <SquarePen />
            </Button>
            <SidebarTrigger className="shrink-0 group-data-[collapsible=icon]:order-first" />
          </SidebarHeader>}
          <SidebarContent>
            {organization && (
              <>
                {[inSettings
                  ? links.slice(4).filter(link => !isPersonal || !["Members", "Teams"].includes(link.label))
                  : links.slice(0, 4)
                ].map((group, index) => (
                  <SidebarGroup key={index} className="shrink-0 px-3 group-data-[collapsible=icon]:px-2">
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {group.map((link) => (
                          <SidebarMenuItem key={link.label}>
                            <SidebarMenuButton
                              className="text-muted-foreground data-[active=true]:text-foreground"
                              tooltip={link.label}
                              aria-label={link.label}
                              isActive={link.selected}
                              data-link
                              onClick={() => navigate(link.route)}
                            >
                              <link.icon />
                              <span>{link.label}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                        {inSettings && <SidebarMenuItem>
                          <NotificationButton onClick={() => setNotificationsAccount(organization.id)} />
                        </SidebarMenuItem>}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                ))}
                {!inSettings && <SidebarGroup className="shrink-0 px-3 group-data-[collapsible=icon]:px-2">
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
                      <p className="px-2 py-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                        No threads yet
                      </p>
                    )}
                    <SidebarMenu>
                      {isAll ? contexts.map(owner => <HubThreadSidebar key={owner.id} organizationId={owner.id} threads={threads.filter(t => t.access.organizationId === owner.id)} selected={route.name === "threads" ? {id:route.threadId} : undefined} onSelect={thread => navigate({name:"threads",organizationId:"all",threadId:thread.id})} />) : <HubThreadSidebar organizationId={organizationId ?? "personal"} threads={threads}
                        selected={route.name === "threads" ? {id: route.threadId} : undefined}
                        onSelect={thread => navigate({name: "threads", organizationId, threadId: thread.id})} />}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>}
              </>
            )}
          </SidebarContent>
          <SidebarFooter className="p-3 group-data-[collapsible=icon]:px-2">
            <SidebarMenu>
              {organization && (
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Settings" aria-label="Settings" data-link isActive={inSettings} onClick={() => navigate({ name: "settings", tab: "devices", organizationId })}>
                    <Settings2 /><span>Settings</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton size="lg" tooltip="Account menu" aria-label="Account menu">
                      <AvatarFrom avatar={shownProfile?.image ?? ""} className="size-6" />
                      <span className="min-w-0 flex-1 truncate">
                        {shownProfile?.name}
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
          {showPaneHeader && <PaneHeader sidebar crumbs={paneCrumbs} />}
          {error && (
            <p role="alert" className="px-4 py-2">
              {error}
            </p>
          )}
          {!organization ? (
            <EmptyState title={error
                    ? "Your account could not be opened"
                    : "Choose an account"} description={error
                    ? "Try opening your account again."
                    : "Choose Personal or an organization from the sidebar."}>
              {error && (
                <EmptyContent>
                  <Button onClick={() => void reload()}>Try again</Button>
                </EmptyContent>
              )}
            </EmptyState>
          ) : organizationSettings && route.name === "settings" ? (
            <Deferred open><OrganizationAdmin organizations={organizations} selectedId={isAll ? route.ownerOrganizationId : organizationId} tab={route.organizationTab ?? "general"} onSelect={owner => navigate({...route,tab:"organization",organizationId:isAll ? "all" : owner,...(isAll ? {ownerOrganizationId:owner} : {})})} onTab={organizationTab => navigate({...route,tab:"organization",organizationTab,ownerOrganizationId:isAll ? route.ownerOrganizationId ?? organizations[0]?.id : undefined})} /></Deferred>
          ) : route.name === "workspaces" && !route.workspaceId ? (
            <div className="min-h-0 flex-1 overflow-auto"><Deferred open><WorkspacesList organizations={contexts} filter={organizationId ?? "all"} onOpenWorkspace={(owner,id) => navigate({name:"workspaces",workspaceId:id,organizationId:isAll ? "all" : owner,...(isAll ? {ownerOrganizationId:owner} : {})})} onAdded={owner => {if (!isAll && owner !== organizationId) navigate({name:"workspaces",organizationId:owner});}} /></Deferred></div>
          ) : isAll ? (
            <Deferred open><AllView organizations={contexts} route={route} userId={profile?.id ?? ""} navigate={navigate} threads={threads} threadsLoaded={threadsLoaded} /></Deferred>
          ) : (
            <div key={organization.id} className="flex min-h-0 flex-1 flex-col">
              <div hidden={section !== "general"} className="min-h-0 overflow-auto px-5 py-6"><Deferred open={section === "general"}><GeneralSettings organizationId={organization.id} showModelDefault={organization.personal === true} /></Deferred></div>
              <div
                hidden={section !== "threads"}
                className={
                  section === "threads" ? "flex min-h-0 flex-1" : undefined
                }
              >
                <Deferred open={section === "threads"} fallback={<div className="w-full p-4"><PaneLoading label="Loading threads" /></div>}>
                  <Threads
                    showNavigation={false}
                    canManageWorkspaces={organization.role !== "member"}
                    organizationId={organization.id}
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
                    {kind === "workspaces" && route.name === "workspaces" && route.workspaceId ? (
                      <WorkspaceDetails key={`${organization.id}:${route.workspaceId}`} organizationId={organization.id} workspaceId={route.workspaceId} role={organization.role} onBack={() => navigate({ name: "workspaces", organizationId: organization.id })} />
                    ) : (
                      <OrganizationSettings organizationId={organization.id} kind={kind} role={organization.role} onOpenWorkspace={workspaceId => navigate({ name: "workspaces", workspaceId, organizationId: organization.id })} />
                    )}
                  </Deferred>
                </div>
              ))}
            </div>
          )}
        </SidebarInset>
        {organization && (
          <HubNotifications
            key={organization.id}
            organizationId={organization.id}
            organizationIds={isAll ? contexts.map(o => o.id) : undefined}
            showTrigger={false}
            open={notificationsAccount === organization.id}
            onOpenChange={(open) => setNotificationsAccount(open ? organization.id : undefined)}
          />
        )}
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
                    navigate({ name: "threads", organizationId: o.id });
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
        {computerCode && <HubComputerApproval preview={new URLSearchParams(window.location.search).get("preview") === "1"} code={computerCode} accountName={profile?.name ?? "your account"} close={() => {
          setComputerCode(null);
          const url = new URL(window.location.href);
          url.searchParams.delete("computerCode");
          url.searchParams.delete("preview");
          window.history.replaceState(null, "", url);
        }} />}
        {invite && <HubInvitation key={invite} token={invite} close={() => {
          setInvite(null);
          const url = new URL(window.location.href);
          url.searchParams.delete("invite");
          if (url.pathname.startsWith("/invite/")) url.pathname = "/";
          window.history.replaceState(null, "", url);
        }} accepted={async (id) => {
          setInvite(null);
          window.history.replaceState(null, "", "/");
          await reload();
          navigate({ name: "threads", organizationId: id });
        }} />}
      </SidebarProvider>
    </HubModelFavorites>
    </HubPersonalContext>
  );
}
