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
  SquareKanban,
  Users,
  User,
  Bot,
  LogOut,
  Settings2,
  Building2,
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
const WorkspacesList = lazy(() => import("./HubWorkspaces"));
const PullRequests = lazy(() => import("./PullRequests").then((module) => ({ default: module.PullRequests })));
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
  const threadGroups = useHubThreadGroups({
    organizationId: organizationId === "all" ? personal?.id ?? "personal" : organizationId,
    threads,
    onSelect: (thread) => navigate({ name: "threads", organizationId, threadId: thread.id }),
    onOpenWorkspace: (thread, workspaceId) => navigate(isAll
      ? { name: "workspaces", workspaceId, organizationId: "all", ownerOrganizationId: thread.access.organizationId }
      : { name: "workspaces", workspaceId, organizationId }),
  });
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
          label: "Agents",
          icon: Bot,
          route: { name: "settings", tab: "agents", organizationId },
          selected: section === "agents",
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
  const paneLabel = [...links, ...settingsLinks].find((link) => link.selected)?.label ?? "Remy";
  const workspacesListOpen = route.name === "workspaces" && !route.workspaceId;
  const showPaneHeader =
    route.name !== "prs" &&
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
                onSettings: () => navigate({name:"settings",tab:"organization",organizationTab:"general",organizationId:o.id}),
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
          emptyThreads={!inSettings && threadsLoaded && !threads.length ? "No threads yet." : undefined}
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
                .then(() => { setPersonal(undefined); setOrganizations([]); setThreads([]); setSignedOut(true); })
                .catch((e) => setError(apiError(e))),
            }],
          }}
        />
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
            <Deferred open><OrganizationAdmin organizations={organizations} selectedId={isAll ? route.ownerOrganizationId : organizationId} tab={route.organizationTab ?? "general"} onSelect={owner => navigate({...route,tab:"organization",organizationId:isAll ? "all" : owner,...(isAll ? {ownerOrganizationId:owner} : {})})} onTab={organizationTab => navigate({...route,tab:"organization",organizationTab,ownerOrganizationId:isAll ? route.ownerOrganizationId ?? organizations[0]?.id : undefined})} /></Deferred>
          ) : route.name === "prs" ? (
            <div className="flex min-h-0 flex-1"><Deferred open><PullRequests servers={[]} workspaces={[]} hostedOrganizationIds={isAll ? contexts.map((item) => item.id) : [organization.id]} onOpenThread={() => undefined} onOpenWorkspace={() => undefined} /></Deferred></div>
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
                hidden={section !== "agents"}
                className="min-h-0 flex-1 overflow-auto"
              >
                <Deferred open={section === "agents"}>
                  <Inbox
                    organizationId={organization.id}
                    userId={profile?.id ?? ""}
                    agentId={route.name === "settings" && route.tab === "agents" ? route.agent : undefined}
                    choose={(id) =>
                      navigate({
                        name: "settings",
                        tab: "agents",
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
            </>
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
