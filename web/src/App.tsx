import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Folder,
  GitPullRequest,
  Inbox,
  MessagesSquare,
  PanelLeft,
  Plus,
  Search,
  SquareKanban,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AppActionsProvider } from "@/actions/context";
import { AppSidebar } from "@/components/AppSidebar";
import { ChatComposer } from "@/components/ChatComposer";
import { ChatView } from "@/components/ChatView";
import { PaneHeader } from "@/components/PaneHeader";
import { Palette } from "@/components/Palette";
import { AddWorkspaceDialog } from "@/components/AddWorkspace";
import { PairRequestDialog } from "@/components/PairRequest";
import { Board, NewTicketDialog } from "@/components/Board";
import { Recurring } from "@/components/Recurring";
import { MissingTicket, TicketView } from "@/components/TicketView";
import { SettingsPane, type SettingsTab } from "@/components/Settings";
import type { AnalyticsTab } from "@/components/AnalyticsSettings";
import { Inbox as InboxPane } from "@/components/Inbox";
import { WorkspaceSettings } from "@/components/WorkspaceSettings";
import { useNotifications } from "@/hooks/use-notifications";
import { useAppLocation } from "@/hooks/use-location";
import { useRelease } from "@/hooks/use-release";
import { deviceIcon } from "@/lib/devices";
import { apiError } from "@/lib/api-error";
import { agentConversation } from "@/lib/inbox";
import { notificationsEnabled } from "@/lib/notify";
import { devicesForWorkspace, isProjectIconFile, workspaceGroups } from "@/lib/projects";
import { sectionOf, type Route } from "@/lib/route";
import { WorkspaceIcon } from "@/components/WorkspaceIcon";
import { tintOf } from "@/lib/tints";
import { cn } from "@/lib/utils";
import { useStore } from "@/state/store";

type Section = "inbox" | "chats" | "workspaces" | "tasks" | "prs";

const APP_SIDEBAR_KEY = "remy.app-sidebar.shown";

function initialSidebarShown(): boolean {
  try {
    return localStorage.getItem(APP_SIDEBAR_KEY) !== "false";
  } catch {
    return true;
  }
}

function routeForSection(section: Section): Route {
  if (section === "chats") return { name: "threads" };
  if (section === "workspaces") return { name: "workspaces" };
  // Tasks opens on the board; its other tab is a route of its own.
  if (section === "tasks") return { name: "board" };
  return { name: section };
}

const SECTIONS: { id: Section; label: string; icon: typeof Inbox }[] = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "chats", label: "Threads", icon: MessagesSquare },
  { id: "workspaces", label: "Workspaces", icon: Folder },
  { id: "tasks", label: "Tasks", icon: SquareKanban },
  { id: "prs", label: "Pull requests", icon: GitPullRequest },
];

// Inbox draws its own: what is missing there is an agent, not a thread.
const EMPTY: Record<
  Exclude<Section, "inbox">,
  { title: string; detail: string; action: "none" | "chat" | "workspace"; icon: typeof Inbox }
> = {
  chats: {
    title: "No threads yet",
    detail: "Start one in a workspace on this machine.",
    action: "chat",
    icon: MessagesSquare,
  },
  workspaces: {
    title: "No workspaces yet",
    detail: "Add a folder on this machine to run threads in.",
    action: "workspace",
    icon: Folder,
  },
  tasks: {
    // Both task panes draw their own empty states, which know whether the gap
    // is a missing project or an empty column.
    title: "Nothing on the board",
    detail: "Add a workspace to plan work in it.",
    action: "workspace",
    icon: SquareKanban,
  },
  prs: {
    title: "No pull requests",
    detail: "Open a PR from a workspace on this machine.",
    action: "none",
    icon: GitPullRequest,
  },
};

export function App() {
  // Everywhere you can be is in the URL, so a reload lands back on it and the
  // back button walks where you have been. Only what is genuinely transient —
  // an open palette, an open dialog — stays in React state.
  const [location, navigate] = useAppLocation();
  const { route } = location;
  const section = sectionOf(route) as Section;
  const view = route.name === "settings" ? "settings" : "app";
  const settingsTab: SettingsTab = route.name === "settings" ? route.tab : "general";
  const analyticsTab: AnalyticsTab = route.name === "settings" && route.tab === "analytics"
    ? route.analyticsTab ?? "general"
    : "general";
  const providerDeviceId = route.name === "settings" && route.tab === "providers"
    ? route.deviceId
    : undefined;
  const selected = route.name === "threads" ? (route.threadId ?? null) : null;
  const workspaceSettingsId = route.name === "workspaces" ? (route.workspaceId ?? null) : null;

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addWorkspaceOpen, setAddWorkspaceOpen] = useState(false);
  const [addTicketOpen, setAddTicketOpen] = useState(false);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [sidebarShown, setSidebarShown] = useState(initialSidebarShown);

  const toggleSidebar = () => {
    setSidebarShown((shown) => {
      const next = !shown;
      try {
        localStorage.setItem(APP_SIDEBAR_KEY, String(next));
      } catch {
        // The control still works for this window when storage is unavailable.
      }
      return next;
    });
  };

  const go = (next: Route, replace = false) => navigate({ route: next }, replace);

  const openSettings = (tab: SettingsTab = "general") => go({ name: "settings", tab });

  // Settings is a place you came from somewhere, but the somewhere is not
  // recorded, so leaving it goes to the threads the app opens on.
  const closeSettings = () => go({ name: "threads" });

  const servers = useStore((s) => s.servers);
  const allChats = useStore((s) => s.chats);
  const archived = useStore((s) => s.archived);
  const allWorkspaces = useStore((s) => s.workspaces);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const start = useStore((s) => s.start);
  const loadSettings = useStore((s) => s.loadSettings);
  const tickets = useStore((s) => s.tickets);
  const projects = useStore((s) => s.projects);
  const agents = useStore((s) => s.agents);
  const boardLoading = useStore((s) => s.boardLoading);
  const dms = useStore((s) => s.dms);
  const saveAgent = useStore((s) => s.saveAgent);
  const loadBoard = useStore((s) => s.loadBoard);
  const release = useRelease();

  // Opens the connection and holds it for the life of the app.
  useEffect(() => start(), [start]);

  useEffect(() => {
    if (error) toast.error("Can't reach this machine", { description: error });
  }, [error]);

  // The composer starts a chat on this machine's defaults, so they are read as
  // soon as it answers rather than only when Settings is opened.
  const anyServerOnline = servers.some((server) => server.online);
  useEffect(() => {
    if (!anyServerOnline) return;
    void loadSettings().catch(() => {
      // A machine that cannot answer already shows as offline.
    });
  }, [anyServerOnline, loadSettings]);

  // The sidebar puts a ticket key on every thread that has one, so the board is
  // read once a machine answers rather than only on the board's own route.
  useEffect(() => {
    if (!anyServerOnline) return;
    void loadBoard().catch(() => {
      // An unreachable machine already shows as offline.
    });
  }, [anyServerOnline, loadBoard]);

  // Every device at once: that a thread runs somewhere else is what the row's
  // device mark says, not something to filter the list down to.
  const scoped = allChats;
  const chats = scoped;
  const groupedWorkspaces = useMemo(
    () => workspaceGroups(allWorkspaces, servers),
    [allWorkspaces, servers],
  );
  const workspaces = allWorkspaces;

  // Remy leads the roster; the rest keep the order they were written in. It
  // answers for the app, so it is the one you land on with nothing else said.
  const roster = useMemo(
    () => [...agents].sort((a, b) => Number(b.builtIn ?? false) - Number(a.builtIn ?? false)),
    [agents],
  );
  const inboxHandle = route.name === "inbox" ? route.agent : undefined;
  // A named handle is the one you get, or nothing. Falling back to the first
  // agent would race the roster: opening an agent the moment it is made would
  // bounce back to whoever happens to lead the list.
  const inboxAgent = inboxHandle
    ? roster.find((entry) => entry.handle === inboxHandle)
    : roster[0];
  const inboxDm = inboxAgent
    ? agentConversation(inboxAgent.id, dms, servers)
    : undefined;
  const unread = roster.filter((agent) =>
    dms.some((chat) => chat.agentId === agent.id && chat.unread),
  ).length;

  const newAgent = async () => {
    setCreatingAgent(true);
    try {
      // Made straight away rather than behind a form: its settings are the
      // form, and the machine makes the handle unique.
      const made = await saveAgent(undefined, { name: "New agent" });
      go({ name: "inbox", agent: made.handle });
    } catch (caught) {
      toast.error("Couldn't create that agent", { description: apiError(caught) });
    } finally {
      setCreatingAgent(false);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (event.key === "Escape" && !paletteOpen) {
        if (
          event.defaultPrevented
          || (event.target instanceof Element
            && event.target.closest('[role="dialog"], [role="menu"], [role="listbox"]'))
        ) {
          return;
        }
        if (workspaceSettingsId) {
          event.preventDefault();
          go({ name: "workspaces" });
          return;
        }
        if (view === "settings") {
          event.preventDefault();
          closeSettings();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const active = chats.find((chat) => chat.id === selected) ?? null;
  const activeArchive = archived.find((thread) => thread.id === selected) ?? null;
  const archivedChat = activeArchive ? {
    id: activeArchive.id,
    serverId: activeArchive.serverId,
    title: activeArchive.title,
    cwd: activeArchive.cwd,
    state: "idle" as const,
    provider: activeArchive.provider,
    agentId: activeArchive.agentId,
    model: activeArchive.model,
    effort: activeArchive.effort,
    preview: activeArchive.preview,
    updatedAt: activeArchive.archivedAt,
  } : null;
  const needsYou = scoped.filter((chat) => chat.state === "needs_input").length;
  const working = scoped.filter((chat) => chat.state === "working").length;
  const onlineDevices = servers.filter((server) => server.online).length;
  const anyOnline = onlineDevices > 0;
  const openWorkspace = allWorkspaces.find((workspace) => workspace.id === workspaceSettingsId) ?? null;
  // Tickets are addressed by key, which is what someone pastes into a message.
  const openTicket = route.name === "ticket" ? tickets.find((ticket) => ticket.key === route.key) : undefined;
  // Chats live in the sidebar, so the main pane is either the chat you opened or
  // the composer for the next one. There is no list of them here.
  const canCompose = !loading && !error && servers.length > 0;

  const draftChat = () => go({ name: "threads" });

  const openChat = (id: string) => go({ name: "threads", threadId: id });

  /// Where a conversation opens, whichever list it is in. A notification only
  /// carries an id, and an inbox conversation opened as a thread would land on
  /// a route that cannot find it.
  const openConversation = (id: string) => {
    const dm = dms.find((chat) => chat.id === id);
    const agent = dm && roster.find((entry) => entry.id === dm.agentId);
    if (agent) go({ name: "inbox", agent: agent.handle });
    else openChat(id);
  };

  // Banners come from the same socket the feed does, so a thread that needs you
  // says so whether or not this window is the one in front.
  useNotifications({
    enabled: notificationsEnabled(),
    // What is already on screen, so a banner is not raised for it: a thread, or
    // the conversation the inbox has open.
    openThreadId: selected ?? (route.name === "inbox" ? inboxDm?.id ?? null : null),
    onOpen: openConversation,
  });

  // Opening with no hash writes the one it resolved to, so the address bar
  // says where you are from the first paint.
  useEffect(() => {
    if (!window.location.hash) navigate(location, true);
    // Once, on mount: afterwards the hash is whatever navigation made it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Landing on the inbox with nothing named writes the one it opened, so a
  // reload comes back to it. A handle that names nothing is left alone: the
  // pane says so, rather than the URL quietly becoming a different agent.
  useEffect(() => {
    if (route.name !== "inbox" || route.agent || !roster[0]) return;
    go({ name: "inbox", agent: roster[0].handle }, true);
  }, [route.name, route.name === "inbox" ? route.agent : undefined, roster[0]?.handle]);

  // A thread can be deleted from another window, or the URL can name one that
  // never existed. Fall back to the composer rather than showing an empty pane.
  useEffect(() => {
    if (!selected || loading) return;
    if (
      allChats.some((chat) => chat.id === selected)
      || archived.some((thread) => thread.id === selected)
    ) return;
    go({ name: "threads" }, true);
  }, [selected, loading, allChats, archived]);

  const chatCounts = (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <span>{needsYou} need you</span>
      <span>{working} active</span>
      <span>{scoped.length - needsYou - working} idle</span>
    </div>
  );

  return (
    <AppActionsProvider
      context={{
        hasProjects: projects.length > 0,
        addTicket: () => setAddTicketOpen(true),
        startThread: draftChat,
        registerWorkspace: () => setAddWorkspaceOpen(true),
      }}
    >
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Titlebar. Draggable, with the leading inset clearing the traffic lights. */}
      <header
        className="app-drag flex shrink-0 items-center gap-3 border-b border-border bg-sidebar pr-3"
        style={{ height: "var(--workspace-topbar-height)", paddingLeft: "var(--titlebar-traffic-light-inset)" }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="app-no-drag"
              aria-label={sidebarShown ? "Hide sidebar" : "Show sidebar"}
              aria-pressed={sidebarShown}
              onClick={toggleSidebar}
            >
              <PanelLeft />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{sidebarShown ? "Hide sidebar" : "Show sidebar"}</TooltipContent>
        </Tooltip>
        <div className="app-no-drag ml-auto flex items-center gap-2">
          <Badge variant={anyOnline ? "success" : "secondary"}>
            <span className="size-1.5 rounded-full bg-current" />
            {onlineDevices} device{onlineDevices === 1 ? "" : "s"}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => setPaletteOpen(true)}>
            <Search />
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </Button>
        </div>
      </header>

      <SidebarProvider className="min-h-0 flex-1">
        <div
          aria-hidden={!sidebarShown}
          inert={!sidebarShown}
          className={cn(
            "min-h-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none",
            sidebarShown ? "w-52" : "w-0",
          )}
        >
          <AppSidebar
            view={view}
            settingsTab={settingsTab}
            section={section}
            selected={selected}
            servers={servers}
            scoped={scoped}
            archived={archived}
            workspaces={allWorkspaces}
            needsYou={needsYou}
            unread={unread}
            sections={SECTIONS}
            onSection={(id) => go(routeForSection(id as Section))}
            onSelectChat={openChat}
            onOpenTicket={(key) => go({ name: "ticket", key })}
            onOpenWorkspace={(workspaceId) => go({ name: "workspaces", workspaceId })}
            onNewThread={draftChat}
            openSettings={openSettings}
            closeSettings={closeSettings}
            updateAvailable={release.available}
          />
        </div>

        {view === "settings" ? (
          <SettingsPane
            tab={settingsTab}
            analyticsTab={analyticsTab}
            onAnalyticsTab={(tab) => go({ name: "settings", tab: "analytics", analyticsTab: tab }, true)}
            providerDeviceId={providerDeviceId}
            onProviderDevice={(deviceId) => go({ name: "settings", tab: "providers", deviceId })}
            release={release}
          />
        ) : route.name === "board" ? (
          <Board
            scope={route.scope}
            onScope={(scope) => go({ name: "board", ...(scope ? { scope } : {}) }, true)}
            onTab={(tab) => go({ name: tab, ...(route.scope ? { scope: route.scope } : {}) })}
            onOpenTicket={(key) => go({ name: "ticket", key })}
            onAddWorkspace={() => setAddWorkspaceOpen(true)}
          />
        ) : route.name === "recurring" ? (
          <Recurring
            scope={route.scope}
            onScope={(scope) => go({ name: "recurring", ...(scope ? { scope } : {}) }, true)}
            onTab={(tab) => go({ name: tab, ...(route.scope ? { scope: route.scope } : {}) })}
            onOpenTicket={(key) => go({ name: "ticket", key })}
            onOpenWorkspace={(workspaceId) => go({ name: "workspaces", workspaceId })}
            onAddWorkspace={() => setAddWorkspaceOpen(true)}
          />
        ) : route.name === "ticket" ? (
          openTicket ? (
            <TicketView
              key={openTicket.id}
              ticket={openTicket}
              onBack={() => go({ name: "board" })}
              onOpenTicket={(key) => go({ name: "ticket", key })}
              onOpenThread={openChat}
              onOpenWorkspace={(workspaceId) => go({ name: "workspaces", workspaceId })}
              onOpenAgent={(handle) => go({ name: "inbox", agent: handle })}
            />
          ) : (
            <MissingTicket ticketKey={route.key} onBack={() => go({ name: "board" })} />
          )
        ) : route.name === "inbox" ? (
          <InboxPane
            agents={roster}
            {...(inboxAgent ? { selected: inboxAgent } : {})}
            {...(!inboxAgent && inboxHandle ? { missing: inboxHandle } : {})}
            loading={boardLoading && roster.length === 0}
            onSelectAgent={(handle) => go({ name: "inbox", agent: handle })}
            onNewAgent={() => void newAgent()}
            creatingAgent={creatingAgent}
            onOpenTicket={(key) => go({ name: "ticket", key })}
            onOpenThread={openChat}
            onOpenWorkspace={(workspaceId) => go({ name: "workspaces", workspaceId })}
            onDeleted={() => go({ name: "inbox" }, true)}
          />
        ) : openWorkspace ? (
          <WorkspaceSettings workspace={openWorkspace} onBack={() => go({ name: "workspaces" })} />
        ) : (
          <main className="flex min-w-0 flex-1 flex-col">
            {section === "chats" && active ? (
              <ChatView
                key={active.id}
                chat={active}
                persona={agents.find(
                  (agent) => agent.id === active.agentId && agent.serverId === active.serverId,
                )}
                onOpenTicket={(key) => go({ name: "ticket", key })}
                onOpenThread={openChat}
                onOpenWorkspace={(workspaceId) => go({ name: "workspaces", workspaceId })}
              />
            ) : section === "chats" && activeArchive && archivedChat ? (
              <ChatView
                key={`archived:${activeArchive.id}`}
                chat={archivedChat}
                archived={activeArchive}
                persona={agents.find(
                  (agent) => agent.id === activeArchive.agentId && agent.serverId === activeArchive.serverId,
                )}
                onRestored={openChat}
                onOpenThread={openChat}
                onOpenWorkspace={(workspaceId) => go({ name: "workspaces", workspaceId })}
              />
            ) : section === "chats" && canCompose ? (
              <ChatComposer
                workspaces={workspaces}
                servers={servers}
                onCreated={(id) => go({ name: "threads", threadId: id })}
                onAddWorkspace={() => setAddWorkspaceOpen(true)}
                headerEnd={chatCounts}
              />
            ) : (
              <>
            <PaneHeader crumbs={[{ label: SECTIONS.find((s) => s.id === section)?.label ?? "" }]}>
              {section === "chats" && chatCounts}
              {section === "workspaces" && (
                <Button size="sm" onClick={() => setAddWorkspaceOpen(true)}>
                  <Plus />
                  Add workspace
                </Button>
              )}
            </PaneHeader>

            {section === "workspaces" ? (
              groupedWorkspaces.length === 0 ? (
                <EmptyState
                  section={section as Exclude<Section, "inbox">}
                  loading={loading}
                  error={error}
                  hasServers={servers.length > 0}
                  onAddConnection={() => openSettings("devices")}
                  onAddWorkspace={() => setAddWorkspaceOpen(true)}
                />
              ) : (
                <ScrollArea className="min-h-0 flex-1">
                  <div className="flex flex-col gap-2 p-4">
                    {groupedWorkspaces.map((group) => {
                      const workspace = group.workspace;
                      const colors = tintOf(workspace.tint);
                      const devices = devicesForWorkspace(workspace, group.copies, servers);
                      return (
                      <Card
                        key={group.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => go({ name: "workspaces", workspaceId: workspace.id })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            go({ name: "workspaces", workspaceId: workspace.id });
                          }
                        }}
                        data-link
                        className="gap-0 py-0 shadow-none hover:bg-accent"
                      >
                        <div className="flex items-center gap-3 px-3.5 py-2.5">
                          <span
                            className={cn(
                              "flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg",
                              colors.well,
                              colors.fg,
                            )}
                          >
                            <WorkspaceIcon
                              workspaceId={workspace.id}
                              icon={workspace.icon}
                              className={isProjectIconFile(workspace.icon) ? "size-8" : "size-4"}
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm leading-5 font-medium">{workspace.name}</span>
                          </span>
                          {devices.length > 0 && (
                            <span className="flex shrink-0 items-center -space-x-1.5">
                              {devices.map((server) => {
                                const DeviceIcon = deviceIcon(server.icon);
                                const chip = tintOf(server.tint);
                                return (
                                  <Tooltip key={server.id}>
                                    <TooltipTrigger asChild>
                                      <span
                                        className={cn(
                                          "relative flex size-6 items-center justify-center rounded-full border border-background",
                                          chip.well,
                                          chip.fg,
                                        )}
                                      >
                                        <DeviceIcon className="size-3" />
                                        <span
                                          className={cn(
                                            "absolute -right-0 -bottom-0 size-1.5 rounded-full ring-1 ring-background",
                                            server.online ? "bg-success" : "bg-muted-foreground",
                                          )}
                                        />
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>{server.name}</TooltipContent>
                                  </Tooltip>
                                );
                              })}
                            </span>
                          )}
                        </div>
                      </Card>
                      );
                    })}
                  </div>
                </ScrollArea>
              )
            ) : (
              <EmptyState
                section={section as Exclude<Section, "inbox">}
                loading={loading}
                error={error}
                hasServers={servers.length > 0}
                onAddConnection={() => openSettings("devices")}
                onAddWorkspace={() => setAddWorkspaceOpen(true)}
              />
            )}
              </>
            )}
          </main>
        )}
      </SidebarProvider>

      <AddWorkspaceDialog open={addWorkspaceOpen} onOpenChange={setAddWorkspaceOpen} />
      <NewTicketDialog
        open={addTicketOpen}
        onOpenChange={setAddTicketOpen}
        projects={projects}
        onCreated={(key) => go({ name: "ticket", key })}
      />
      {/* Wherever you are: another machine is waiting on your answer. */}
      <PairRequestDialog />
      <Palette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        chats={scoped}
        onOpenChat={openChat}
        onOpenSection={(id) => go(routeForSection(id as Section))}
        sections={SECTIONS}
      />
    </div>
    </AppActionsProvider>
  );
}

function EmptyState({
  section,
  loading,
  error,
  hasServers,
  onAddConnection,
  onAddWorkspace,
}: {
  section: Exclude<Section, "inbox">;
  loading: boolean;
  error?: string;
  hasServers: boolean;
  onAddConnection: () => void;
  onAddWorkspace: () => void;
}) {
  const fallback = EMPTY[section];
  const { title, detail, action, icon: Icon } = loading
    ? { title: "Connecting…", detail: "Loading threads from this machine.", action: "none" as const, icon: fallback.icon }
    : error
      ? { title: "Can't reach this machine", detail: error, action: "none" as const, icon: fallback.icon }
      : !hasServers
        ? {
            title: "No devices connected",
            detail: "Pair a machine from Devices.",
            action: "connect" as const,
            icon: fallback.icon,
          }
        : fallback;

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle className={loading ? "shimmer" : undefined}>{title}</EmptyTitle>
        <EmptyDescription>{detail}</EmptyDescription>
      </EmptyHeader>
      {action !== "none" && (
        <EmptyContent>
          {action === "connect" && (
            <Button onClick={onAddConnection}>
              Add a connection
              <ArrowUpRight />
            </Button>
          )}
          {action === "chat" && (
            <Button>
              <Plus />
              New thread
            </Button>
          )}
          {action === "workspace" && (
            <Button onClick={onAddWorkspace}>
              <Plus />
              Add workspace
            </Button>
          )}
        </EmptyContent>
      )}
    </Empty>
  );
}
