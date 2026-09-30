import { AppSidebar } from "./sidebar/AppSidebar";
import { useHubThreadGroups } from "./sidebar/useHubSidebar";
import { PaneHeader } from "./PaneHeader";
import { useHubProfile } from "@/lib/hub-profile";
import { HubModelFavorites } from "./HubModelFavorites";
import { EmptyState } from "@/components/EmptyState";
import { lazy, useEffect, useRef, useState } from "react";
import {
  Layers,
  Folder,
  Laptop,
  MessagesSquare,
  GitPullRequest,
  Users,
  User,
  LogOut,
  Settings2,
  Building2,
  Plug,
  Bell,
  Plus,
  X,
  Columns2,
  Rows2,
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
import { cachedHubThread, clearHubThreadCache } from "@/lib/hub-thread-cache";
import { requestComposerWorkspace } from "@/lib/composer-workspace";
import { currentLocation, listenToLocationChanges, navigateLocation, normalizeLocation, parseLocation, type Route } from "@/lib/route";
import { addAppTab, closeAppTab, focusAppTab, navigateAppTab, readAppTabs, saveAppTabs, splitAppTab, type AppTabs } from "@/lib/app-tabs";
import { apiError } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Tabs as AppTabsRoot, TabsList as AppTabsList, TabsTrigger as AppTabsTrigger } from "@/components/ui/tabs-base";

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
  SidebarInset,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  EmptyContent,
} from "@/components/ui/empty";
import { HubPersonalContext } from "@/lib/hub-scope";
import { AppLoading } from "@/components/AppLoading";
import { PaneLoading } from "@/components/PaneLoading";
import { Spinner } from "@/components/ui/spinner";
import { Deferred } from "@/components/Deferred";
import { HubComputerApproval } from "./HubComputerApproval";
import { HubInvitation } from "./HubInvitation";
import { HubSignIn } from "./HubSignIn";
import { HubNotifications } from "./HubNotifications";
import { hubAllView, hubThreads } from "./hub-surfaces";
const WorkspacesList = lazy(() => import("./HubWorkspaces"));
const PullRequests = lazy(() => import("./PullRequests").then((module) => ({ default: module.PullRequests })));
const OrganizationAdmin = lazy(() => import("./HubOrganizationAdmin"));
const AllView = hubAllView.Surface;
const GeneralSettings = lazy(() => import("./HubGeneralSettings"));
const Threads = hubThreads.Surface;
const Computers = lazy(() =>
  import("./HubComputers").then((m) => ({ default: m.HubComputers })),
);
const WorkspaceDetails = lazy(() => import("./HubWorkspaceDetails"));
const OrganizationSettings = lazy(() => import("./HubOrganizationSettings"));
const Connections = lazy(() =>
  import("./HubConnections").then((m) => ({ default: m.HubConnections })),
);

function SidebarNavigation({ route }: { route: Route }) {
  const { setOpenMobile } = useSidebar();
  useEffect(() => setOpenMobile(false), [route, setOpenMobile]);
  return null;
}

function appTabLabel(route: Route, threads: HubThread[]): string {
  if (route.name === "threads") return route.threadId
    ? threads.find((thread) => thread.id === route.threadId)?.detail.title || "Thread"
    : "New thread";
  if (route.name === "prs") return route.number ? `Pull request #${route.number}` : "Pull requests";
  if (route.name === "workspaces") return route.workspaceId ? "Workspace" : "Workspaces";
  const labels: Record<string, string> = {
    general: "General settings", devices: "Computers", connections: "Connections",
    organization: "Organizations", providers: "Models", members: "Members", teams: "Teams",
    "version-control": "Version control",
  };
  return labels[route.tab] ?? "Settings";
}

export default function HubApp({ runtime }: { runtime: HubRuntime }) {
  const [appTabs, setAppTabs] = useState<AppTabs>(() => {
    const initial = normalizeLocation().route;
    const stored = readAppTabs(initial);
    return navigateAppTab(stored, initial);
  });
  const route = appTabs.tabs.find((tab) => tab.id === appTabs.focused)?.route ?? appTabs.tabs[0]!.route;
  const changeTabs = (change: (current: AppTabs) => AppTabs) => setAppTabs((current) => {
    const next = change(current);
    saveAppTabs(next);
    return next;
  });
  const focusTab = (tabId: string) => {
    const next = focusAppTab(appTabs, tabId);
    changeTabs(() => next);
    const selected = next.tabs.find((tab) => tab.id === next.focused);
    if (selected) navigateLocation({ route: selected.route });
  };
  const closeTab = (tabId: string) => {
    const next = closeAppTab(appTabs, tabId);
    changeTabs(() => next);
    const selected = next.tabs.find((tab) => tab.id === next.focused);
    if (selected) navigateLocation({ route: selected.route });
  };
  const newTab = () => {
    const next = addAppTab(appTabs, { name: "threads", organizationId: route.organizationId });
    changeTabs(() => next);
    navigateLocation({ route: next.tabs.at(-1)!.route });
  };
  const splitTab = (direction: "horizontal" | "vertical") => {
    const next = splitAppTab(appTabs, direction, { name: "threads", organizationId: route.organizationId });
    changeTabs(() => next);
    navigateLocation({ route: next.tabs.find((tab) => tab.id === next.focused)!.route });
  };
  const previousSurface = useRef<Route | undefined>(undefined);
  useEffect(() => {
    if (route.name !== "settings") previousSurface.current = route;
  }, [route]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [personal, setPersonal] = useState<Organization>();
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const openThread = (id?: string): HubThread[] => {
    if (!id) return [];
    const cached = cachedHubThread(id);
    return cached ? [cached.thread] : [];
  };
  const [profile, setProfile] = useState<{ id: string; name: string; image?: string }>();
  const liveProfile = useHubProfile(route.organizationId === "all" ? personal?.id ?? "personal" : route.organizationId ?? "personal").profile;
  const shownProfile = liveProfile ?? profile;
  const [loaded, setLoaded] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");
  const [threadError, setThreadError] = useState("");
  const [threads, setThreads] = useState<HubThread[]>(() => {
    const initial = normalizeLocation().route;
    return initial.name === "threads" ? openThread(initial.threadId) : [];
  });
  const [create, setCreate] = useState(false);
  const [addingWorkspace, setAddingWorkspace] = useState(false);
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
    changeTabs((current) => navigateAppTab(current, next));
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
      if (e instanceof HubRequestError && e.status === 401) { clearHubThreadCache(); setSignedOut(true); }
      else setError(apiError(e));
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    const changed = () => {
      const next = parseLocation(currentLocation()).route;
      setAppTabs((current) => {
        const selected = current.tabs.find((tab) => tab.id === current.focused)!;
        if (JSON.stringify(selected.route) === JSON.stringify(next)) return current;
        const updated = navigateAppTab(current, next);
        saveAppTabs(updated);
        return updated;
      });
    };
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
    setThreadsLoaded(false);
    setError("");
    setThreadError("");
    if (!contexts.length) return;
    const values = new Map<string, HubThread[]>();
    const settled = new Set<string>();
    const failures = new Map<string, string>();
    const emitFailure = () => setThreadError(failures.values().next().value ?? "");
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
    const off = contexts.map(owner => watchHubThreads(owner.id, value => { values.set(owner.id,value); settled.add(owner.id); failures.delete(owner.id); emitFailure(); emit(); }, message => { settled.add(owner.id); failures.set(owner.id, `${owner.name}: ${message}`); emitFailure(); emit(); }));
    const offOwners = contexts.map(owner => watchHubResource<{organization:Organization}>(hubThreadBase(owner.id), value => {
      if (!value) return;
      if (value.organization.personal) setPersonal(value.organization);
      else setOrganizations(all => all.map(o => o.id === owner.id ? value.organization : o));
    }, () => { void reload(); }));
    return () => [...off, ...offOwners].forEach(stop => stop());
  }, [profile?.id, contextIds]);
  const threadGroups = useHubThreadGroups({
    organizationId: organizationId === "all" ? personal?.id ?? "personal" : organizationId,
    threads: isAll ? threads : threads.filter((thread) => thread.access.organizationId === organizationId),
    onSelect: (thread) => navigate({ name: "threads", organizationId, threadId: thread.id }),
    onOpenWorkspace: (thread, workspaceId) => navigate(isAll
      ? { name: "workspaces", workspaceId, organizationId: "all", ownerOrganizationId: thread.access.organizationId }
      : { name: "workspaces", workspaceId, organizationId }),
  });
  // Threads is the surface a person opens on, so its code starts downloading
  // with the account list rather than after it: waiting for the accounts, then
  // the view, then the thread pane, then the composer's reads made each one a
  // separate round trip before the composer could draw.
  if (route.name === "threads") {
    if (isAll) void hubAllView.preload();
    void hubThreads.preload();
  }
  if (!loaded && !(profile && organization)) return <AppLoading />;
  if (signedOut) return <HubSignIn runtime={runtime} />;
  const requestedSection = route.name === "settings" ? route.tab : route.name;
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
          label: "Workspaces",
          icon: Folder,
          route: { name: "workspaces", organizationId },
          selected: section === "workspaces",
        },
        {
          label: "Pull requests",
          icon: GitPullRequest,
          route: { name: "prs", organizationId },
          selected: route.name === "prs",
        },
      ]
    : [];
  const settingsLinks: {
    label: string;
    icon: typeof Users;
    route: Route;
    selected: boolean;
  }[] = organization
    ? [
        {
          label: "General",
          icon: Settings2,
          route: { name: "settings", tab: "general", organizationId },
          selected: section === "general",
        },
        {
          label: "Computers",
          icon: Laptop,
          route: { name: "settings", tab: "devices", organizationId: "all" },
          selected: section === "devices",
        },
        {
          label: "Connections",
          icon: Plug,
          route: { name: "settings", tab: "connections", organizationId },
          selected: section === "connections",
        },
        {
          label: "Organizations",
          icon: Building2,
          route: { name:"settings", tab:"organization", organizationId },
          selected: organizationSettings,
        },
      ]
    : [];
  const renderPane = (paneRoute: Route) => {
    const route = paneRoute;
    const organizationId = route.organizationId ?? "all";
    const isAll = organizationId === "all";
    const organization = isAll ? {...personal, id: "all", name: "All", role: "owner", personal: false} as Organization : contexts.find((item) => item.id === organizationId);
    const isPersonal = organization?.personal === true;
    const paneThreads = isAll ? threads : threads.filter((thread) => thread.access.organizationId === organizationId);
    const requestedSection = route.name === "settings" ? route.tab : route.name;
    const organizationSettings = route.name === "settings" && ["organization", "members", "teams"].includes(route.tab);
    const section = organizationSettings ? "organization" : requestedSection;
    const paneLabel = route.name === "threads" ? "Threads" : route.name === "workspaces" ? "Workspaces" : route.name === "prs" ? "Pull requests" : section === "devices" ? "Computers" : section === "connections" ? "Connections" : section === "organization" ? "Organizations" : "General";
    const workspacesListOpen = route.name === "workspaces" && !route.workspaceId;
    const showPaneHeader = route.name !== "prs" && !(route.name === "settings" && route.tab === "devices") && !(route.name === "threads" && route.threadId) && !(route.name === "workspaces" && route.workspaceId);
    const paneCrumbs = route.name === "settings" ? [{ label: "Settings" }, { label: paneLabel }] : [{ label: paneLabel }];
    return <HubPersonalContext value={isPersonal}>
          {showPaneHeader && <PaneHeader sidebar crumbs={paneCrumbs}>
            {workspacesListOpen && (isAll ? contexts : organization ? [organization] : []).some(o => o.role !== "member") && (
              <Button className="h-7 gap-1.5 rounded-md px-2.5 text-xs has-[>svg]:px-2.5 [&_svg:not([class*='size-'])]:size-3.5" onClick={() => setAddingWorkspace(true)}>
                <Plus strokeWidth={2} />Add workspace
              </Button>
            )}
          </PaneHeader>}
          {(error || threadError) && (
            <p role="alert" className="px-4 py-2">
              {error || threadError}
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
          ) : (
            <>
              <div
                hidden={!workspacesListOpen}
                className={workspacesListOpen ? "min-h-0 flex-1 overflow-auto" : undefined}
              >
                <Deferred open={workspacesListOpen}>
                  <WorkspacesList
                    organizations={contexts}
                    filter={organizationId ?? "all"}
                    threads={paneThreads}
                    open={workspacesListOpen}
                    adding={addingWorkspace}
                    onAddingChange={setAddingWorkspace}
                    onNewThread={(owner, workspaceId) => {
                      requestComposerWorkspace({ organizationId: owner, workspaceId });
                      navigate({ name: "threads", organizationId });
                    }}
                    onOpenWorkspace={(owner, id) => navigate({
                      name: "workspaces",
                      workspaceId: id,
                      organizationId: isAll ? "all" : owner,
                      ...(isAll ? { ownerOrganizationId: owner } : {}),
                    })}
                    onAdded={(owner) => {
                      if (!isAll && owner !== organizationId) navigate({ name: "workspaces", organizationId: owner });
                    }}
                  />
                </Deferred>
              </div>
          {workspacesListOpen ? null : organizationSettings && route.name === "settings" ? (
            <Deferred open><OrganizationAdmin organizations={organizations} selectedId={isAll ? route.ownerOrganizationId : organizationId} tab={route.organizationTab ?? "members"} onSelect={owner => navigate({...route,tab:"organization",organizationId:isAll ? "all" : owner,...(isAll ? {ownerOrganizationId:owner} : {})})} onTab={organizationTab => navigate({...route,tab:"organization",organizationTab,ownerOrganizationId:isAll ? route.ownerOrganizationId ?? organizations[0]?.id : undefined})} /></Deferred>
          ) : route.name === "prs" ? (
            <div className="flex min-h-0 flex-1"><Deferred open><PullRequests
              servers={[]}
              workspaces={[]}
              hostedOrganizationIds={isAll ? contexts.map((item) => item.id) : [organization.id]}
              onOpenThread={() => undefined}
              onOpenWorkspace={() => undefined}
              selected={route.repository && route.number ? { repository: route.repository, number: route.number, ...(route.view ? { view: route.view } : {}) } : undefined}
              onSelect={(address) => navigate({ name: "prs", organizationId: route.organizationId, ...address })}
              hubThreads={paneThreads}
              onOpenHubThread={(thread) => navigate({ name: "threads", organizationId, threadId: thread.id })}
              onStartThread={() => navigate({ name: "threads", organizationId })}
              onConnectGitHub={() => navigate({ name: "settings", tab: "connections", organizationId })}
              onOpenHostedWorkspace={(owner, workspaceId) => navigate(isAll
                ? { name: "workspaces", workspaceId, organizationId: "all", ownerOrganizationId: owner }
                : { name: "workspaces", workspaceId, organizationId })}
            /></Deferred></div>
          ) : isAll ? (
            <Deferred open><AllView organizations={contexts} route={route} navigate={navigate} threads={paneThreads} threadsLoaded={threadsLoaded} accountsLoaded={loaded} /></Deferred>
          ) : (
            <div key={organization.id} className="flex min-h-0 flex-1 flex-col">
              <div hidden={section !== "general"} className="min-h-0 overflow-auto px-5 py-6"><Deferred open={section === "general"}><GeneralSettings organizationId={organization.id} /></Deferred></div>
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
              <div hidden={section !== "devices"} className={section === "devices" ? "flex min-h-0 flex-1 flex-col" : undefined}>
                <Deferred open={section === "devices"}>
                  <Computers accounts={contexts} all />
                </Deferred>
              </div>
              <div
                hidden={section !== "connections"}
                className="min-h-0 overflow-auto"
              >
                <Deferred open={section === "connections"}>
                  <Connections organizationId={organization.id} />
                </Deferred>
              </div>
              {(["members", "teams"] as const).map((kind) => (
                <div hidden={section !== kind || isPersonal} key={kind} className="min-h-0 overflow-auto">
                  <Deferred open={section === kind && !isPersonal}>
                    <OrganizationSettings organizationId={organization.id} kind={kind} role={organization.role} />
                  </Deferred>
                </div>
              ))}
              <div hidden={section !== "workspaces"} className="min-h-0 overflow-auto">
                <Deferred open={section === "workspaces"}>
                  {route.name === "workspaces" && route.workspaceId && (
                    <WorkspaceDetails
                      key={`${organization.id}:${route.workspaceId}`}
                      organizationId={organization.id}
                      workspaceId={route.workspaceId}
                      owner={organization}
                      onBack={() => navigate({ name: "workspaces", organizationId: organization.id })}
                      onNewThread={() => {
                        requestComposerWorkspace({ organizationId: organization.id, workspaceId: route.workspaceId! });
                        navigate({ name: "threads", organizationId: organization.id });
                      }}
                    />
                  )}
                </Deferred>
              </div>
            </div>
          )}
            </>
          )}
          </HubPersonalContext>;
  };
  return (
    <HubPersonalContext value={isPersonal}>
      <HubModelFavorites key={profile?.id} organizationId={isAll ? undefined : organizationId}>
      <SidebarProvider>
        <SidebarNavigation route={route} />
        <AppSidebar
          collapsible="icon"
          showTrigger
          selected={route.name === "threads" ? route.threadId ?? null : null}
          account={organization ? {
            label: organization.name,
            icon: isAll ? Layers : isPersonal ? User : Building2,
            views: [
              { id: "all", label: "All", icon: Layers, selected: isAll, onSelect: () => navigate({name:"threads",organizationId:"all"}) },
              ...(personal ? [{ id: personal.id, label: "Personal", icon: User, selected: isPersonal, onSelect: () => navigate({name:"threads",organizationId:personal.id}) }] : []),
              ...organizations.map(o => ({
                id: o.id,
                label: o.name,
                icon: Building2,
                organization: true,
                selected: o.id === organizationId,
                onSelect: () => navigate({name:"threads",organizationId:o.id}),
                onSettings: () => navigate({name:"settings",tab:"organization",organizationTab:"members",organizationId:o.id}),
              })),
            ],
            onCreate: () => setCreate(true),
          } : undefined}
          back={inSettings ? { label: "Back", onSelect: () => { const previous = previousSurface.current; navigate(previous && previous.organizationId === organizationId ? previous : { name: "threads", organizationId }); } } : undefined}
          onNewThread={inSettings ? undefined : () => navigate({ name: "threads", organizationId })}
          nav={inSettings
            ? [
                ...settingsLinks.filter(link => !isPersonal || !["Members", "Teams"].includes(link.label)).map(link => ({
                  id: link.label, label: link.label, icon: link.icon, selected: link.selected, onSelect: () => navigate(link.route),
                })),
                ...(organization ? [{ id: "notifications", label: "Notifications", icon: Bell, selected: false, onSelect: () => setNotificationsAccount(organization.id) }] : []),
              ]
            : links.map(link => ({
                id: link.label, label: link.label, icon: link.icon, selected: link.selected, onSelect: () => navigate(link.route),
              }))}
          groups={inSettings ? [] : threadGroups}
          emptyThreads={!inSettings && threadsLoaded && !(isAll ? threads : threads.filter((thread) => thread.access.organizationId === organizationId)).length ? "No threads yet." : undefined}
          footer={organization && !inSettings ? [{
            label: "Settings",
            icon: Settings2,
            selected: false,
            onSelect: () => navigate({ name: "settings", tab: "general", organizationId }),
          }] : []}
          accountMenu={{
            name: shownProfile?.name ?? "",
            image: shownProfile?.image,
            items: [{
              label: "Sign out",
              icon: LogOut,
              onSelect: () => void hubRequest("/api/sessions/current", "DELETE")
                .then(() => { clearHubThreadCache(); setPersonal(undefined); setOrganizations([]); setThreads([]); setSignedOut(true); })
                .catch((e) => setError(apiError(e))),
            }],
          }}
        />
        <SidebarInset className="h-svh min-w-0 overflow-hidden">
          <AppTabsRoot value={appTabs.focused} onValueChange={(value) => focusTab(String(value))} className="flex h-11 shrink-0 flex-row data-[orientation=horizontal]:flex-row items-center gap-1 border-b border-border px-2">
            <AppTabsList aria-label="Open tabs" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
              {appTabs.tabs.map((tab) => {
                const selected = tab.id === appTabs.focused;
                const label = appTabLabel(tab.route, threads);
                return <div key={tab.id} className="flex min-w-0 shrink-0 items-center rounded-md bg-transparent data-[selected=true]:bg-foreground/8" data-selected={selected}>
                  <AppTabsTrigger value={tab.id} className="max-w-44 min-w-0 gap-1.5 px-2 text-xs font-normal" aria-label={label}>
                    {tab.route.name === "threads" ? <MessagesSquare className="size-3.5 shrink-0" /> : tab.route.name === "prs" ? <GitPullRequest className="size-3.5 shrink-0" /> : tab.route.name === "settings" ? <Settings2 className="size-3.5 shrink-0" /> : <Folder className="size-3.5 shrink-0" />}
                    <span className="truncate">{label}</span>
                  </AppTabsTrigger>
                  {appTabs.tabs.length > 1 && <Button type="button" variant="ghost" size="icon-xs" aria-label={`Close ${label}`} className="size-5 shrink-0" onClick={() => closeTab(tab.id)}><X /></Button>}
                </div>;
              })}
            </AppTabsList>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="New tab" title="New tab" onClick={newTab}><Plus /></Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Split left and right" title="Split left and right" className="hidden md:inline-flex" onClick={() => splitTab("horizontal")}><Columns2 /></Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Split top and bottom" title="Split top and bottom" className="hidden md:inline-flex" onClick={() => splitTab("vertical")}><Rows2 /></Button>
            {appTabs.split && <Button type="button" variant="ghost" size="sm" onClick={() => changeTabs((current) => ({ ...current, split: undefined }))}>Unsplit</Button>}
          </AppTabsRoot>
          <div className={appTabs.split ? appTabs.split.direction === "horizontal" ? "flex min-h-0 flex-1" : "flex min-h-0 flex-1 flex-col" : "flex min-h-0 flex-1"}>
            {[...(appTabs.split ? [appTabs.split.first, appTabs.split.second] : [appTabs.focused]), ...appTabs.tabs.map((tab) => tab.id).filter((id) => id !== appTabs.focused && id !== appTabs.split?.first && id !== appTabs.split?.second)].map((tabId) => {
              const tab = appTabs.tabs.find((entry) => entry.id === tabId);
              if (!tab) return null;
              const visible = tab.id === appTabs.focused || tab.id === appTabs.split?.first || tab.id === appTabs.split?.second;
              return <section key={tab.id} aria-label={tab.route.name === "threads" ? "Thread pane" : `${tab.route.name} pane`} onPointerDownCapture={() => { if (tab.id !== appTabs.focused) focusTab(tab.id); }} onFocusCapture={() => { if (tab.id !== appTabs.focused) focusTab(tab.id); }} className={visible ? `flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${appTabs.split && tab.id !== appTabs.focused ? "max-md:hidden" : ""} ${appTabs.split && tab.id !== appTabs.split.first ? appTabs.split.direction === "horizontal" ? "border-border md:border-l" : "border-border md:border-t" : ""}` : "hidden"}>
                {renderPane(tab.route)}
              </section>;
            })}
          </div>
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
