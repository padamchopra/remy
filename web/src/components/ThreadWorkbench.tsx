import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Activity,
  ChartNoAxesCombined,
  Columns2,
  Gauge,
  GitFork,
  GitPullRequest,
  Globe2,
  MessagesSquare,
  Plus,
  Rows2,
  SquareTerminal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChatView, ThreadTicket } from "@/components/ChatView";
import { SurfaceLoading } from "@/components/Deferred";
import { StartSubthreadDialog } from "@/components/StartSubthreadDialog";
import { ThreadActivityTool } from "@/components/ThreadActivity";
import { ThreadTerminal, terminalSessionId } from "@/components/ThreadTerminal";
import { TabClose, TabCloseSpace, TabStrip, tabContentClass, tabListClass, tabTriggerClass } from "@/components/WorkbenchTabs";
import { browserKey, githubPullRequestTarget, useSharedBrowsers, type SharedBrowserView } from "@/hooks/use-thread-tools";
import { threadActivities } from "@/lib/thread-activity";
import {
  activateTab,
  closeTab,
  findTab,
  flattenWorkbench,
  focusGroup,
  focusedThreadId,
  groupsOf,
  moveTab,
  openTab,
  pruneWorkbench,
  resizeSplit,
  splitTab,
  tabId,
  updateWorkbench,
  useWorkbench,
  type Placement,
  type TabGroup,
  type ToolKind,
  type Workbench,
  type WorkbenchNode,
  type WorkbenchTab,
} from "@/lib/thread-workbench";
import { workspaceForPath } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { useStore } from "@/state/store";
import type { Chat, ChatCodeReference, ChatState } from "@/state/types";

// A tool is only worth its code once somebody opens it, and the tab strip has
// to draw before any of them has arrived. Running work is the exception: it
// costs almost nothing, so it ships with the strip rather than after it.
const SharedBrowser = lazy(() => import("@/components/SharedBrowser").then((module) => ({ default: module.SharedBrowser })));
const PullRequestView = lazy(() => import("@/components/PullRequestView").then((module) => ({ default: module.PullRequestView })));
const ThreadAnalyticsTool = lazy(() => import("@/components/ThreadInsights").then((module) => ({ default: module.ThreadAnalyticsTool })));
const ThreadPerformanceTool = lazy(() => import("@/components/ThreadInsights").then((module) => ({ default: module.ThreadPerformanceTool })));

const WIDE = "(min-width: 1024px)";

function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(WIDE).matches);
  useEffect(() => {
    const media = window.matchMedia(WIDE);
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  return wide;
}

/// Everything shared by the groups of one collection: the threads in it, the
/// browsers they drive, and the ways to change the layout.
interface Bench {
  parent: Chat;
  chats: Chat[];
  workbench: Workbench;
  wide: boolean;
  browsers: ReturnType<typeof useSharedBrowsers>;
  terminalActive: Record<string, boolean>;
  setTerminalActive: (threadId: string, active: boolean) => void;
  codeReferences: Record<string, ChatCodeReference[]>;
  setCodeReferences: (threadId: string, references: ChatCodeReference[]) => void;
  change: (change: (workbench: Workbench) => Workbench, focus?: boolean) => void;
  open: (tab: WorkbenchTab, placement?: Placement) => void;
  openTool: (kind: ToolKind, threadId: string, placement: Placement) => void;
  openLink: (threadId: string, href: string) => void;
  close: (tab: WorkbenchTab) => void;
  startSubthread: () => void;
  onOpenThread: (id: string) => void;
  onOpenTicket: (key: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
}

export function ThreadWorkbench({
  routeThread,
  focusedId,
  onOpenThread,
  onOpenTicket,
  onOpenWorkspace,
  onFocusThread,
}: {
  routeThread: Chat;
  focusedId?: string;
  onOpenThread: (id: string) => void;
  onOpenTicket: (key: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
  /// The thread you are in changed by way of a tab or a group, so the URL and
  /// the sidebar follow it.
  onFocusThread: (parentId: string, threadId: string) => void;
}) {
  const parentId = routeThread.parentChatId ?? routeThread.id;
  const chats = useStore(useShallow((state) =>
    state.chats.filter((chat) => chat.id === parentId || chat.parentChatId === parentId)));
  const parent = chats.find((chat) => chat.id === parentId) ?? routeThread;
  const workbench = useWorkbench(parentId);
  const wide = useWide();
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [terminalActive, setTerminalActiveState] = useState<Record<string, boolean>>({});
  const [codeReferences, setCodeReferencesState] = useState<Record<string, ChatCodeReference[]>>({});
  const chatIds = chats.map((chat) => chat.id).join(" ");

  // What the collection no longer has leaves the workbench, and the thread the
  // URL names is always somewhere in it: a reload or a pasted link lands on it.
  const focusTarget = focusedId ?? routeThread.id;
  useEffect(() => {
    const allowed = new Set(chatIds.split(" "));
    updateWorkbench(parentId, (current) => {
      let next = pruneWorkbench(current, parentId, allowed);
      if (allowed.has(focusTarget) && focusedThreadId(next) !== focusTarget) {
        next = findTab(next, focusTarget)
          ? activateTab(next, focusTarget)
          : openTab(next, { kind: "thread", threadId: focusTarget });
      }
      return next;
    });
    // Only when the collection or the URL's thread changes: the workbench's own
    // focus is written back to the URL, and must not bounce back off it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId, chatIds, focusTarget]);

  const change = useCallback((apply: (workbench: Workbench) => Workbench, focus = true) => {
    const next = updateWorkbench(parentId, apply);
    if (!focus) return;
    const threadId = focusedThreadId(next);
    if (threadId) onFocusThread(parentId, threadId);
  }, [parentId, onFocusThread]);

  const browserTabs = useMemo(() => groupsOf(workbench.root)
    .flatMap((group) => group.tabs)
    .flatMap((tab) => tab.kind === "browser" ? [{ chatId: tab.threadId, browserId: tab.browserId }] : []), [workbench]);
  const browsers = useSharedBrowsers(
    parent.serverId,
    chatIds.split(" "),
    browserTabs,
    true,
    // The agent opened one: it appears as a tab beside the thread, without
    // taking you off what you were reading.
    (chatId, browserId) => updateWorkbench(parentId, (current) =>
      openTab(current, { kind: "browser", threadId: chatId, browserId }, { at: "tool", threadId: chatId }, false)),
  );

  const open = useCallback((tab: WorkbenchTab, placement: Placement = { at: "focused" }) => {
    change((current) => openTab(current, tab, placement));
  }, [change]);

  const openTool = useCallback((kind: ToolKind, threadId: string, placement: Placement) => {
    if (kind === "browser") {
      const existing = browserTabs.filter((tab) => tab.chatId === threadId);
      const browserId = existing.length === 0
        ? "default"
        : `browser-${Date.now().toString(36)}`;
      open({ kind: "browser", threadId, browserId }, placement);
      return;
    }
    open({ kind, threadId }, placement);
  }, [browserTabs, open]);

  const openLink = useCallback((threadId: string, href: string) => {
    const pullRequest = githubPullRequestTarget(href);
    if (pullRequest) {
      open({ kind: "pull-request", threadId, repository: pullRequest.repository, number: pullRequest.number }, { at: "tool", threadId });
      return;
    }
    // The thread's browser, or its first one is made for the link.
    const browserId = browserTabs.find((tab) => tab.chatId === threadId)?.browserId ?? "default";
    open({ kind: "browser", threadId, browserId }, { at: "tool", threadId });
    void browsers.open(threadId, browserId, href);
  }, [browserTabs, browsers, open]);

  const close = useCallback((tab: WorkbenchTab) => {
    change((current) => closeTab(current, tabId(tab)));
    if (tab.kind === "browser") void browsers.close(tab.threadId, tab.browserId);
  }, [browsers, change]);

  const bench: Bench = {
    parent,
    chats,
    workbench,
    wide,
    browsers,
    terminalActive,
    setTerminalActive: (threadId, active) => setTerminalActiveState((current) =>
      current[threadId] === active ? current : { ...current, [threadId]: active }),
    codeReferences,
    setCodeReferences: (threadId, references) => setCodeReferencesState((current) => ({ ...current, [threadId]: references })),
    change,
    open,
    openTool,
    openLink,
    close,
    startSubthread: () => setSpawnOpen(true),
    onOpenThread,
    onOpenTicket,
    onOpenWorkspace,
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {wide ? (
        <WorkbenchSplit node={workbench.root} bench={bench} />
      ) : (
        <GroupView group={flattenWorkbench(workbench)} focused bench={bench} />
      )}

      <StartSubthreadDialog
        parent={parent}
        open={spawnOpen}
        onOpenChange={setSpawnOpen}
        onStarted={(child, beside) => open({ kind: "thread", threadId: child.id }, beside ? { at: "beside" } : { at: "focused" })}
      />
    </div>
  );
}

function WorkbenchSplit({ node, bench }: { node: WorkbenchNode; bench: Bench }) {
  if (node.type === "group") {
    return <GroupView group={node} focused={bench.workbench.focused === node.id} bench={bench} />;
  }
  const firstId = `${node.id}-first`;
  const secondId = `${node.id}-second`;
  return (
    <ResizablePanelGroup
      id={`workbench-split-${node.id}`}
      orientation={node.direction}
      defaultLayout={{ [firstId]: node.ratio * 100, [secondId]: (1 - node.ratio) * 100 }}
      className="min-h-0 min-w-0 flex-1"
      onLayoutChanged={(next, meta) => {
        if (!meta.isUserInteraction || typeof next[firstId] !== "number") return;
        bench.change((current) => resizeSplit(current, node.id, next[firstId]! / 100), false);
      }}
    >
      <ResizablePanel id={firstId} minSize="16rem" className="flex min-h-0 min-w-0 overflow-hidden">
        <WorkbenchSplit node={node.first} bench={bench} />
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize panes" />
      <ResizablePanel id={secondId} minSize="16rem" className="flex min-h-0 min-w-0 overflow-hidden">
        <WorkbenchSplit node={node.second} bench={bench} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/// One group: a strip of tabs and the one in front. Every tab stays mounted
/// behind the front one, so a terminal keeps its shell and a browser its page
/// while something else is in front.
function GroupView({ group, focused, bench }: { group: TabGroup; focused: boolean; bench: Bench }) {
  const groups = groupsOf(bench.workbench.root);
  const many = groups.length > 1 && bench.wide;
  const activeTab = group.tabs.find((tab) => tabId(tab) === group.active) ?? group.tabs[0];
  const activeChat = activeTab ? bench.chats.find((chat) => chat.id === activeTab.threadId) : undefined;
  const onlyTab = groups.flatMap((entry) => entry.tabs).length === 1;

  return (
    <section
      aria-label={activeTab ? `${tabLabel(activeTab, bench)} pane` : "Pane"}
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", many && focused && "bg-accent/5")}
      onPointerDownCapture={() => {
        if (!focused && group.id !== "all") bench.change((current) => focusGroup(current, group.id));
      }}
    >
      <Tabs
        value={group.active}
        onValueChange={(id) => bench.change((current) => activateTab(current, id))}
        className="min-h-0 flex-1 gap-0"
      >
        <TabStrip
          actions={activeTab?.kind === "thread" && activeChat && !activeChat.dm
            ? <ThreadTicket chatId={activeChat.id} onOpenTicket={bench.onOpenTicket} />
            : undefined}
        >
          <TabsList aria-label="Open tabs" className={tabListClass}>
            {group.tabs.map((tab) => (
              <TabTrigger
                key={tabId(tab)}
                tab={tab}
                group={group}
                active={tabId(tab) === group.active}
                closable={!onlyTab && !(tab.kind === "thread" && tab.threadId === bench.parent.id)}
                bench={bench}
              />
            ))}
          </TabsList>
          {activeChat && <AddMenu group={group} chat={activeChat} bench={bench} />}
        </TabStrip>

        {group.tabs.map((tab) => {
          const id = tabId(tab);
          const active = id === group.active;
          return (
            <TabsContent key={id} value={id} forceMount className={tabContentClass}>
              <Surface tab={tab} visible={active} focused={focused && active} bench={bench} />
            </TabsContent>
          );
        })}
      </Tabs>
    </section>
  );
}

function TabTrigger({
  tab,
  group,
  active,
  closable,
  bench,
}: {
  tab: WorkbenchTab;
  group: TabGroup;
  active: boolean;
  closable: boolean;
  bench: Bench;
}) {
  const id = tabId(tab);
  const label = tabLabel(tab, bench);
  const Icon = tabIcon(tab);
  const chat = bench.chats.find((entry) => entry.id === tab.threadId);
  const groups = groupsOf(bench.workbench.root);
  const others = groups.filter((entry) => entry.id !== group.id);
  const canSplit = bench.wide && group.tabs.length > 1 && group.id !== "all";
  const dot = tabDot(tab, bench);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group/tab flex h-8 min-w-0 shrink-0 items-center">
          <Tooltip>
            {/* On a wrapper rather than the tab: a trigger passed the tab as its
                child would write its own open state over the tab's active one. */}
            <TooltipTrigger asChild>
              <span className="flex min-w-0 items-center">
                <TabsTrigger value={id} className={cn(tabTriggerClass, closable && "pr-1")}>
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{label}</span>
                  {dot}
                  {closable && <TabCloseSpace />}
                </TabsTrigger>
              </span>
            </TooltipTrigger>
            {/* Whose tab it is, since a collection can hold more than one thread. */}
            <TooltipContent>{chat && tab.kind !== "thread" ? `${label} · ${chat.title}` : label}</TooltipContent>
          </Tooltip>
          {closable && <TabClose label={label} active={active} onClose={() => bench.close(tab)} />}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {canSplit && (
          <>
            <ContextMenuItem onSelect={() => bench.change((current) => splitTab(current, id, "horizontal"))}>
              <Columns2 />
              Split right
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => bench.change((current) => splitTab(current, id, "vertical"))}>
              <Rows2 />
              Split down
            </ContextMenuItem>
          </>
        )}
        {bench.wide && others.map((other) => {
          const front = other.tabs.find((entry) => tabId(entry) === other.active) ?? other.tabs[0];
          return (
            <ContextMenuItem key={other.id} onSelect={() => bench.change((current) => moveTab(current, id, other.id))}>
              <Columns2 />
              Move beside {front ? tabLabel(front, bench) : "pane"}
            </ContextMenuItem>
          );
        })}
        {(canSplit || (bench.wide && others.length > 0)) && closable && <ContextMenuSeparator />}
        {closable && (
          <ContextMenuItem onSelect={() => bench.close(tab)}>
            <X />
            Close
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/// What can be opened in this group, for the thread whose tab is in front.
function AddMenu({ group, chat, bench }: { group: TabGroup; chat: Chat; bench: Bench }) {
  const servers = useStore((state) => state.servers);
  const server = servers.find((entry) => entry.id === chat.serverId);
  const conversational = chat.dm === true;
  const terminalAvailable = !conversational && server?.cloud !== true && Boolean(server);
  const openTabs = groupsOf(bench.workbench.root).flatMap((entry) => entry.tabs);
  const hasBrowser = openTabs.some((tab) => tab.kind === "browser" && tab.threadId === chat.id);
  const canAddBrowser = !conversational && (bench.browsers.supportsInstances || !hasBrowser);
  const closedThreads = bench.chats.filter((entry) => !openTabs.some((tab) => tab.kind === "thread" && tab.threadId === entry.id));
  const here: Placement = group.id === "all" ? { at: "focused" } : { at: "group", groupId: group.id };
  const tool = (kind: ToolKind) => bench.openTool(kind, chat.id, here);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Add tab">
              <Plus />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Add tab</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => tool("terminal")} disabled={!terminalAvailable}>
            <SquareTerminal />
            Terminal
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => tool("browser")} disabled={!canAddBrowser}>
            <Globe2 />
            Browser
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => tool("pull-request")} disabled={conversational}>
            <GitPullRequest />
            Pull request
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => tool("activity")} disabled={conversational}>
            <Activity />
            Running work
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => tool("analytics")} disabled={conversational}>
            <ChartNoAxesCombined />
            Analytics
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => tool("performance")} disabled={conversational}>
            <Gauge />
            Performance
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {closedThreads.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Threads</DropdownMenuLabel>
              {closedThreads.map((entry) => (
                <DropdownMenuItem key={entry.id} onSelect={() => bench.open({ kind: "thread", threadId: entry.id }, here)}>
                  {entry.parentChatId ? <GitFork /> : <MessagesSquare />}
                  <span className="truncate">{entry.title}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
        {!conversational && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={bench.startSubthread}>
              <GitFork />
              Start subthread
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/// The tab's content. Whatever is in it stays mounted while another tab is in
/// front; `visible` tells the surfaces that poll or paint whether to bother.
function Surface({ tab, visible, focused, bench }: { tab: WorkbenchTab; visible: boolean; focused: boolean; bench: Bench }) {
  const agents = useStore((state) => state.agents);
  const workspaces = useStore((state) => state.workspaces);
  const chat = bench.chats.find((entry) => entry.id === tab.threadId);
  if (!chat) return null;

  if (tab.kind === "thread") {
    return (
      <ChatView
        key={chat.id}
        chat={chat}
        embedded
        focused={focused}
        persona={agents.find((agent) => agent.id === chat.agentId && agent.serverId === chat.serverId)}
        codeReferences={bench.codeReferences[chat.id] ?? EMPTY_REFERENCES}
        onCodeReferencesChange={(references) => bench.setCodeReferences(chat.id, references)}
        onOpenLink={(href) => bench.openLink(chat.id, href)}
        onOpenTicket={bench.onOpenTicket}
        onOpenThread={bench.onOpenThread}
        onOpenWorkspace={bench.onOpenWorkspace}
      />
    );
  }

  if (tab.kind === "terminal") {
    const workspace = workspaces[workspaceForPath(chat.cwd, workspaces)];
    return (
      <ThreadTerminal
        serverId={chat.serverId}
        terminalId={terminalSessionId("thread", chat.id)}
        cwd={chat.cwd}
        label={workspace?.name ?? "Terminal"}
        visible={visible}
        onHide={() => bench.close(tab)}
        onSessionClosed={() => bench.close(tab)}
        onActiveChange={(active) => bench.setTerminalActive(chat.id, active)}
      />
    );
  }

  if (tab.kind === "activity") {
    return <ActivitySurface chat={chat} />;
  }

  return (
    <Suspense fallback={<SurfaceLoading />}>
      {tab.kind === "browser" ? (
        <SharedBrowser
          chatId={chat.id}
          serverId={chat.serverId}
          browserId={tab.browserId}
          view={bench.browsers.views[browserKey(chat.id, tab.browserId)]}
          setView={(view: SharedBrowserView) => bench.browsers.setView(chat.id, tab.browserId, view)}
        />
      ) : tab.kind === "analytics" ? (
        <ThreadAnalyticsTool chatId={chat.id} serverId={chat.serverId} enabled={visible} />
      ) : tab.kind === "performance" ? (
        <ThreadPerformanceTool chatId={chat.id} serverId={chat.serverId} enabled={visible} />
      ) : (
        <PullRequestView
          chatId={tab.repository && tab.number ? undefined : chat.id}
          serverId={chat.serverId}
          repository={tab.repository}
          number={tab.number}
          codeReferences={bench.codeReferences[chat.id] ?? EMPTY_REFERENCES}
          onAddReference={(reference) => bench.setCodeReferences(chat.id, [...(bench.codeReferences[chat.id] ?? []), reference])}
          onRemoveReference={(referenceId) => bench.setCodeReferences(chat.id, (bench.codeReferences[chat.id] ?? []).filter((reference) => reference.id !== referenceId))}
        />
      )}
    </Suspense>
  );
}

const EMPTY_REFERENCES: ChatCodeReference[] = [];

/// What the thread is doing right now, read from the same transcript the
/// thread tab shows. It is populated while that thread's transcript is open.
function ActivitySurface({ chat }: { chat: Chat }) {
  const detail = useStore((state) => state.details[chat.id]);
  const server = useStore((state) => state.servers.find((entry) => entry.id === chat.serverId));
  const open = detail?.id === chat.id ? detail : undefined;
  const working = (open?.state ?? chat.state) === "working";
  const connected = server?.online === true;
  const entries = open?.entries;
  const activities = useMemo(
    () => threadActivities(entries ?? [], open?.provider ?? chat.provider ?? "claude", working, connected),
    [entries, open?.provider, chat.provider, working, connected],
  );
  return <ThreadActivityTool activities={activities} connected={connected} />;
}

function tabLabel(tab: WorkbenchTab, bench: Bench): string {
  if (tab.kind === "thread") return bench.chats.find((chat) => chat.id === tab.threadId)?.title ?? "Thread";
  if (tab.kind === "terminal") return "Terminal";
  if (tab.kind === "pull-request") return "Pull request";
  if (tab.kind === "activity") return "Running work";
  if (tab.kind === "analytics") return "Analytics";
  if (tab.kind === "performance") return "Performance";
  // The second browser for a thread says so; the first is just the browser.
  const siblings = groupsOf(bench.workbench.root)
    .flatMap((group) => group.tabs)
    .filter((entry) => entry.kind === "browser" && entry.threadId === tab.threadId);
  const index = siblings.findIndex((entry) => tabId(entry) === tabId(tab));
  return index > 0 ? `Browser ${index + 1}` : "Browser";
}

function tabIcon(tab: WorkbenchTab): ComponentType<{ className?: string }> {
  if (tab.kind === "thread") return MessagesSquare;
  if (tab.kind === "terminal") return SquareTerminal;
  if (tab.kind === "browser") return Globe2;
  if (tab.kind === "pull-request") return GitPullRequest;
  if (tab.kind === "activity") return Activity;
  if (tab.kind === "analytics") return ChartNoAxesCombined;
  return Gauge;
}

/// A dot for what is live in the tab: the thread's state, an agent driving the
/// browser, a shell with something running.
function tabDot(tab: WorkbenchTab, bench: Bench): ReactNode {
  if (tab.kind === "thread") {
    const state = bench.chats.find((chat) => chat.id === tab.threadId)?.state;
    return state && state !== "idle" ? <StateDot state={state} /> : null;
  }
  const live = tab.kind === "browser"
    ? bench.browsers.views[browserKey(tab.threadId, tab.browserId)]?.active === true
    : tab.kind === "terminal"
      ? bench.terminalActive[tab.threadId] === true
      : false;
  return live ? <span role="img" aria-label="Active" className="size-1.5 shrink-0 rounded-full bg-success-foreground" /> : null;
}

function StateDot({ state }: { state: ChatState }) {
  const label = state === "needs_input" ? "Needs you" : state === "working" ? "Working" : "Error";
  const tone = state === "needs_input"
    ? "bg-warning"
    : state === "working"
      ? "bg-info animate-pulse motion-reduce:animate-none"
      : "bg-destructive";
  return <span role="img" aria-label={label} className={cn("size-1.5 shrink-0 rounded-full", tone)} />;
}
