import { Fragment, memo, useCallback, useMemo, useRef, useState, type ComponentType } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ArrowUpCircle,
  ChevronDown,
  ChevronLeft,
  Clock,
  GitBranch,
  Pin,
  Settings2,
  SquarePen,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SETTINGS_SECTIONS, type SettingsTab } from "@/lib/settings-sections";
import { ProviderMark } from "@/components/ProviderMark";
import { WorkspaceMark } from "@/components/WorkspaceIcon";
import { deviceIcon } from "@/lib/devices";
import { modelLabel, providerLabel, PROVIDERS } from "@/lib/providers";
import { displayPath, plainText } from "@/lib/path";
import { reportRender } from "@/lib/render-probe";
import { ThreadMenu } from "@/components/ThreadMenu";
import { agoLabel, elapsedSince, useTicker } from "@/lib/elapsed";
import { workspaceForPath } from "@/lib/projects";
import { groupSidebarThreads, sidebarChat, visibleSidebarThreads } from "@/lib/sidebar-threads";
import { cn } from "@/lib/utils";
import { useStore } from "@/state/store";
import type { ArchivedThread, Chat, ChatState, Server, Ticket, Workspace } from "@/state/types";

const SETTLED_THREAD_BATCH = 30;

function useStableCallback<Arguments extends unknown[]>(callback: (...args: Arguments) => void) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback((...args: Arguments) => callbackRef.current(...args), []);
}

export function AppSidebar({
  view,
  settingsTab,
  section,
  selected,
  servers,
  threadStructure,
  archived,
  workspaces,
  sections,
  onSection,
  onSelectChat,
  onOpenBeside,
  onOpenTicket,
  onOpenWorkspace,
  onNewThread,
  openSettings,
  closeSettings,
  updateAvailable,
}: {
  view: "app" | "settings";
  settingsTab: SettingsTab;
  section: string;
  selected: string | null;
  servers: Server[];
  threadStructure: string[];
  archived: ArchivedThread[];
  workspaces: Workspace[];
  sections: { id: string; label: string; icon: ComponentType<{ className?: string }> }[];
  onSection: (id: string) => void;
  onSelectChat: (id: string) => void;
  onOpenBeside: (id: string) => void;
  onOpenTicket: (key: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onNewThread: () => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  updateAvailable?: boolean;
}) {
  const topology = useMemo(() => threadStructure.map((value) => {
    const [id, parentChatId, serverId, cwd, pinned, state] = value.split("\u0000");
    return {
      id: id!,
      parentChatId: parentChatId || undefined,
      bucket: pinned ? "pinned" : "threads",
      state: state as ChatState,
      serverId: serverId!,
      cwd: cwd!,
    };
  }), [threadStructure]);
  const groups = useMemo(() => groupSidebarThreads(topology), [topology]);
  const [settledLimits, setSettledLimits] = useState<Record<string, number>>({});
  const selectChat = useStableCallback(onSelectChat);
  const openBeside = useStableCallback(onOpenBeside);
  const openTicket = useStableCallback(onOpenTicket);
  const openWorkspace = useStableCallback(onOpenWorkspace);
  const revealMore = (key: string) => {
    setSettledLimits((current) => ({
      ...current,
      [key]: (current[key] ?? SETTLED_THREAD_BATCH) + SETTLED_THREAD_BATCH,
    }));
  };
  const now = useTicker(false);
  const needsYou = useStore((state) => state.chats.filter((chat) => chat.state === "needs_input").length);
  const unread = useStore((state) => state.agents.filter((agent) =>
    state.dms.some((chat) => chat.agentId === agent.id && chat.unread),
  ).length);
  // Before the first read answers there is nothing to say about the threads
  // yet: "No threads yet." would be a claim, and on a machine that has some it
  // is a wrong one, corrected a moment later.
  const stillLooking = useStore((s) => s.loading);
  const archivedLimit = settledLimits.archived ?? SETTLED_THREAD_BATCH;
  const visibleArchived = archived.filter((thread, index) =>
    index < archivedLimit || thread.id === selected);
  const hiddenArchived = archived.length - visibleArchived.length;

  return (
    <Sidebar collapsible="none">
      {view === "settings" ? (
        <>
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={closeSettings}>
                  <ChevronLeft />
                  Back
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => (
                    <SidebarMenuItem key={id}>
                      <SidebarMenuButton data-link isActive={settingsTab === id} onClick={() => openSettings(id)}>
                        <Icon />
                        <span>{label}</span>
                      </SidebarMenuButton>
                      {id === "general" && updateAvailable && <SidebarMenuBadge>1</SidebarMenuBadge>}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </>
      ) : (
        <>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {/* The one you are in is the bright one; the rest step back a
                    shade, so the sidebar has a hierarchy before it has colour.
                    Counts are quiet numbers, not badges. */}
                {sections.map(({ id, label, icon: Icon }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      data-link
                      isActive={section === id}
                      className="h-9 gap-2.5 px-2.5 text-sidebar-foreground/80"
                      onClick={() => onSection(id)}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                    {id === "inbox" && unread > 0 && (
                      <SidebarMenuBadge className="right-2.5 text-muted-foreground">{unread}</SidebarMenuBadge>
                    )}
                    {id === "chats" && needsYou > 0 && (
                      <SidebarMenuBadge className="right-2.5 text-muted-foreground">{needsYou}</SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* The one action the list has, as a row like the reference apps
              rather than an icon hiding in a label. */}
          <SidebarGroup className="pt-0">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton data-link className="h-9 gap-2.5 px-2.5 text-sidebar-foreground/80" onClick={onNewThread}>
                    <SquarePen />
                    <span>New thread</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarContent>
            {/* Threads, in every section. They are the work; whatever else you
                are looking at, one is always a click away. */}
            {groups.length === 0 ? (
              // With archived threads below, an empty active list says enough
              // by being empty. Only a machine with nothing at all is told so.
              stillLooking || archived.length > 0 ? null : (
                <p className="px-[18px] py-1.5 text-[11px] text-muted-foreground">No threads yet.</p>
              )
            ) : (
              groups.map((group) => {
                const limit = group.key === "pinned"
                  ? Number.POSITIVE_INFINITY
                  : settledLimits[group.key] ?? SETTLED_THREAD_BATCH;
                const { visible, hidden } = visibleSidebarThreads(group.threads, selected, limit);
                const revealCount = Math.min(hidden, SETTLED_THREAD_BATCH);
                return (
                  <SidebarGroup key={group.key} className="shrink-0 py-1">
                    {group.key === "pinned" && (
                      <SidebarGroupLabel className="h-7 px-2.5 text-[11px] text-muted-foreground">Pinned</SidebarGroupLabel>
                    )}
                    <SidebarGroupContent>
                      <SidebarMenu className="gap-0">
                        {visible.map((thread) => (
                          <ThreadGroup
                            key={thread.id}
                            id={thread.id}
                            childIds={thread.childIds}
                            selected={selected}
                            now={now}
                            onSelectChat={selectChat}
                            onOpenBeside={openBeside}
                            onOpenTicket={openTicket}
                            onOpenWorkspace={openWorkspace}
                          />
                        ))}
                        {hidden > 0 && (
                          <SidebarMenuItem>
                            <SidebarMenuButton
                              data-sidebar-show-more
                              data-hidden-count={hidden}
                              size="sm"
                              className="h-8 px-2.5 text-xs text-muted-foreground"
                              onClick={() => revealMore(group.key)}
                            >
                              <ChevronDown />
                              <span>Show {revealCount} more</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        )}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                );
              })
            )}
            {archived.length > 0 && (
              <SidebarGroup className="shrink-0 py-1">
                <SidebarGroupLabel className="h-7 px-2.5 text-[11px] text-muted-foreground">Archived</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu className="gap-0">
                    {visibleArchived.map((thread) => (
                      <ThreadMenu key={`${thread.serverId}:${thread.id}`} itemClassName={threadContainmentClass} chat={{ ...thread, state: "idle", updatedAt: thread.archivedAt }} archive={thread} onOpenThread={onSelectChat}>
                        <SidebarMenuButton data-link size="sm" className={cn("h-8 px-2.5", threadRowHoverClass)} isActive={selected === thread.id} onClick={() => onSelectChat(thread.id)}>
                          <WorkspaceMark home={!workspaces[workspaceForPath(thread.cwd, workspaces)]} workspace={workspaces[workspaceForPath(thread.cwd, workspaces)]} server={servers.find((entry) => entry.id === thread.serverId)} size="sm" />
                          <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                          <span className={cn("shrink-0 text-[11px] tabular-nums text-muted-foreground", threadRowTimeClass)}>{agoLabel(thread.archivedAt, now)}</span>
                        </SidebarMenuButton>
                      </ThreadMenu>
                    ))}
                    {hiddenArchived > 0 && (
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          data-sidebar-show-more
                          data-hidden-count={hiddenArchived}
                          size="sm"
                          className="h-8 px-2.5 text-xs text-muted-foreground"
                          onClick={() => revealMore("archived")}
                        >
                          <ChevronDown />
                          <span>Show {Math.min(hiddenArchived, SETTLED_THREAD_BATCH)} more</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </SidebarContent>
        </>
      )}

      <SidebarFooter>
        <SidebarMenu>
          {view !== "settings" && updateAvailable && (
            <SidebarMenuItem>
              <SidebarMenuButton data-link className="h-9 gap-2.5 px-2.5 text-sidebar-foreground/80" onClick={() => openSettings("general")}>
                <ArrowUpCircle />
                <span>Update available</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton
              data-link
              isActive={view === "settings"}
              className="h-9 gap-2.5 px-2.5 text-sidebar-foreground/80"
              onClick={() => openSettings(view === "settings" ? settingsTab : "general")}
            >
              <Settings2 />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function aggregateThreadState(states: ChatState[]): ChatState {
  if (states.includes("needs_input")) return "needs_input";
  if (states.includes("working")) return "working";
  if (states.includes("error")) return "error";
  return "idle";
}

function ThreadGroupInner({
  id,
  childIds,
  selected,
  now,
  onSelectChat,
  onOpenBeside,
  onOpenTicket,
  onOpenWorkspace,
}: {
  id: string;
  childIds: string[];
  selected: string | null;
  now: number;
  onSelectChat: (id: string) => void;
  onOpenBeside: (id: string) => void;
  onOpenTicket: (key: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
}) {
  const chat = useStore((state) => sidebarChat(state.chats, id));
  const childStates = useStore(useShallow((state) => childIds.flatMap((childId) => {
    const child = sidebarChat(state.chats, childId);
    return child ? [child.state] : [];
  })));
  const contextKey = useStore((state) => {
    const current = sidebarChat(state.chats, id);
    const workspace = current && state.workspaces[workspaceForPath(current.cwd, state.workspaces)];
    const server = current && state.servers.find((entry) => entry.id === current.serverId);
    return JSON.stringify([
      server && [server.id, server.name, server.icon],
      workspace && [workspace.id, workspace.name, workspace.icon, workspace.tint, workspace.worktrees],
    ]);
  });
  const { workspace, server } = useMemo(() => {
    const current = useStore.getState();
    return {
      workspace: chat ? current.workspaces[workspaceForPath(chat.cwd, current.workspaces)] : undefined,
      server: chat ? current.servers.find((entry) => entry.id === chat.serverId) : undefined,
    };
  }, [chat?.cwd, chat?.serverId, contextKey]);
  if (!chat) return null;
  const aggregate = aggregateThreadState([chat.state, ...childStates]);

  return (
    <Fragment>
      <ThreadMenu itemClassName={threadContainmentClass} chat={chat} onOpenThread={onSelectChat} onOpenBeside={onOpenBeside} onOpenWorkspace={onOpenWorkspace}>
        {(menuOpen) => <ThreadRow
          contextDisabled={menuOpen}
          chat={aggregate === chat.state ? chat : { ...chat, state: aggregate }}
          active={selected === chat.id}
          workspace={workspace}
          server={server}
          now={now}
          onSelect={() => onSelectChat(chat.id)}
          onOpenTicket={onOpenTicket}
          onOpenWorkspace={onOpenWorkspace}
        />}
      </ThreadMenu>
      {childIds.map((childId, index) => (
        <ChildThreadRow
          key={childId}
          id={childId}
          active={selected === childId}
          last={index === childIds.length - 1}
          now={now}
          onSelectChat={onSelectChat}
          onOpenBeside={onOpenBeside}
          onOpenWorkspace={onOpenWorkspace}
        />
      ))}
    </Fragment>
  );
}

const ThreadGroup = memo(ThreadGroupInner, (previous, next) =>
  previous.id === next.id
  && previous.selected === next.selected
  && previous.now === next.now
  && previous.childIds.length === next.childIds.length
  && previous.childIds.every((id, index) => id === next.childIds[index]));

/// A subthread under its parent, hanging off a guide line the way a tree
/// draws a branch: the line runs the height of the row and the last one ends
/// in an elbow.
const ChildThreadRow = memo(function ChildThreadRow({
  id,
  active,
  last,
  now,
  onSelectChat,
  onOpenBeside,
  onOpenWorkspace,
}: {
  id: string;
  active: boolean;
  last: boolean;
  now: number;
  onSelectChat: (id: string) => void;
  onOpenBeside: (id: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
}) {
  const chat = useStore((state) => sidebarChat(state.chats, id));
  if (!chat) return null;
  reportRender("thread-row", chat.id);
  const time = chat.workingSince ? elapsedSince(chat.workingSince, now) : agoLabel(chat.updatedAt, now);
  return (
    <ThreadMenu itemClassName={childThreadContainmentClass} chat={chat} onOpenThread={onSelectChat} onOpenBeside={onOpenBeside} onOpenWorkspace={onOpenWorkspace}>
      <SidebarMenuButton
        data-link
        size="sm"
        isActive={active}
        className={cn(
          "relative h-7 gap-1.5 overflow-visible pl-7 text-xs",
          "before:absolute before:left-[15px] before:top-0 before:w-px before:bg-border",
          last ? "before:h-1/2" : "before:bottom-0",
          "after:absolute after:left-[15px] after:top-1/2 after:h-px after:w-2 after:bg-border",
          threadRowHoverClass,
        )}
        onClick={() => onSelectChat(chat.id)}
      >
        <span className="min-w-0 flex-1 truncate">{chat.title}</span>
        <ThreadStateDot state={chat.state} />
        <span className={cn("shrink-0 text-[11px] font-normal tabular-nums text-muted-foreground", threadRowTimeClass)}>{time}</span>
      </SidebarMenuButton>
    </ThreadMenu>
  );
});

/// What the thread is doing, as a dot: colour is the state, and the word is
/// there on hover and for a screen reader. A pill on every row made the list
/// read as a status board; most rows are done, and done is not news.
function ThreadStateDot({ state }: { state: ChatState }) {
  const label = state === "idle"
    ? "Done"
    : state === "needs_input"
      ? "Needs you"
      : state === "working"
        ? "Working"
        : "Error";
  const tone = state === "idle"
    ? "bg-muted-foreground/35"
    : state === "needs_input"
      ? "bg-warning"
      : state === "working"
        ? "bg-info animate-pulse motion-reduce:animate-none"
        : "bg-destructive";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label={label} className={cn("size-2 shrink-0 rounded-full", tone)} />
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}


// The primitive pads a row for its menu action whenever one is present; the
// time takes that spot and gives way to the action instead.
const threadRowHoverClass = "group-focus-within/menu-item:!bg-sidebar-row-hover group-hover/menu-item:!bg-sidebar-row-hover group-has-data-[sidebar=menu-action]/menu-item:pr-2.5";
const threadContainmentClass = "[content-visibility:auto] [contain-intrinsic-size:auto_48px]";
const childThreadContainmentClass = "[content-visibility:auto] [contain-intrinsic-size:auto_28px]";
/// The time sits where the row's menu button appears, and gives way to it, so
/// no row keeps an empty margin for a control that is not there.
const threadRowTimeClass = "transition-opacity [@media(hover:hover)]:group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0";

/// One thread in the list: what it is and when it last moved, then what was
/// last said and what it runs with. Its workspace mark keeps that association
/// visible without splitting the thread list into workspace sections.
function ThreadRow({
  contextDisabled,
  chat,
  active,
  workspace,
  server,
  now,
  onSelect,
  onOpenTicket,
  onOpenWorkspace,
}: {
  contextDisabled: boolean;
  chat: Chat;
  active: boolean;
  workspace?: Workspace;
  server?: Server;
  now: number;
  onSelect: () => void;
  onOpenTicket: (key: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
}) {
  reportRender("thread-row", chat.id);
  const [contextOpen, setContextOpen] = useState(false);
  const tick = useTicker(Boolean(chat.workingSince));
  const DeviceIcon = deviceIcon(server?.icon);
  const time = chat.workingSince ? elapsedSince(chat.workingSince, tick) : agoLabel(chat.updatedAt, now);
  const tickets = useStore((s) => s.tickets);
  const ticket = tickets.find((entry) => entry.threads.some((link) => link.chatId === chat.id));

  const row = (
    <SidebarMenuButton
      data-link
      isActive={active}
      className={cn("h-auto flex-col items-stretch gap-0.5 px-2.5 py-1.5", threadRowHoverClass)}
      onClick={onSelect}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate">{chat.title}</span>
        {chat.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />}
        <ThreadStateDot state={chat.state} />
        <span className={cn("flex shrink-0 items-center gap-1 text-[11px] font-normal tabular-nums text-muted-foreground", threadRowTimeClass)}>
          {chat.workingSince && <Clock className="size-3" />}
          {time}
        </span>
      </span>

      {/* What was last said, led by the ticket it works when it has one, and
          closed by marks for what it thinks with and where it runs. */}
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-normal text-muted-foreground">
        {ticket && (
          // A key, not a button: this row is already a button, and one inside
          // another is not markup a browser will honour. The click is stopped
          // here so opening the ticket does not also open the thread.
          <span
            role="link"
            tabIndex={0}
            className="shrink-0 rounded font-mono text-[10px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={(event) => {
              event.stopPropagation();
              onOpenTicket(ticket.key);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              event.stopPropagation();
              onOpenTicket(ticket.key);
            }}
          >
            {ticket.key}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{chat.preview ? plainText(chat.preview) : ""}</span>
        <ThreadModel provider={chat.provider} model={chat.model} label={false} className="shrink-0" />
        {workspace && <WorkspaceMark home={false} workspace={workspace} server={server} size="sm" />}
        {server && (
          <Tooltip>
            <TooltipTrigger asChild>
              <DeviceIcon className="size-3 shrink-0" />
            </TooltipTrigger>
            <TooltipContent>{server.name}</TooltipContent>
          </Tooltip>
        )}
      </span>
    </SidebarMenuButton>
  );

  // The row is narrow and truncates; hovering says the whole of it — the full
  // title, which machine and workspace it runs in, its branch and its ticket.
  return (
    <HoverCard openDelay={450} open={contextOpen && !contextDisabled} onOpenChange={setContextOpen}>
      <HoverCardTrigger asChild>{row}</HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="w-72">
        <ThreadContext
          chat={chat}
          workspace={workspace}
          server={server}
          ticket={ticket}
          onOpenTicket={onOpenTicket}
          onOpenWorkspace={onOpenWorkspace}
        />
      </HoverCardContent>
    </HoverCard>
  );
}

/// Everything the sidebar row had to truncate.
function ThreadContext({
  chat,
  workspace,
  server,
  ticket,
  onOpenTicket,
  onOpenWorkspace,
}: {
  chat: Chat;
  workspace?: Workspace;
  server?: Server;
  ticket?: Ticket;
  onOpenTicket: (key: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
}) {
  const DeviceIcon = deviceIcon(server?.icon);
  const branch = workspace?.worktrees.find((tree) => tree.path === chat.cwd)?.branch;

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm leading-snug font-medium">{chat.title}</p>
      <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        {server && (
          <span className="flex items-center gap-1.5">
            <DeviceIcon className="size-3.5 shrink-0" />
            {server.name}
          </span>
        )}
        {workspace ? (
          <button
            type="button"
            data-link
            className="flex items-center gap-1.5 rounded text-left hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={() => onOpenWorkspace(workspace.id)}
          >
            <WorkspaceMark home={false} workspace={workspace} server={server} size="sm" />
            {workspace.name}
          </button>
        ) : (
          <span className="flex items-center gap-1.5">
            <WorkspaceMark home workspace={undefined} server={server} size="sm" />
            {displayPath(chat.cwd)}
          </span>
        )}
        {branch && (
          <span className="flex items-center gap-1.5 font-mono break-all">
            <GitBranch className="size-3.5 shrink-0" />
            {branch}
          </span>
        )}
        <ThreadModel provider={chat.provider} model={chat.model} className="gap-1.5 [&>svg]:size-3.5" />
      </div>
      {ticket && (
        <button
          type="button"
          data-link
          className="flex flex-col gap-0.5 rounded border-t border-border pt-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => onOpenTicket(ticket.key)}
        >
          <span className="font-mono text-[11px] text-muted-foreground">{ticket.key}</span>
          <span className="text-xs leading-snug hover:underline">{ticket.title}</span>
        </button>
      )}
    </div>
  );
}

/// What the thread thinks with: its provider's glyph, and the model beside it
/// where one was picked rather than left to that provider's own default.
function ThreadModel({
  provider,
  model,
  label: withLabel = true,
  className,
}: {
  provider?: string;
  model?: string;
  /// The model's name beside the glyph; without it the tooltip carries it.
  label?: boolean;
  className?: string;
}) {
  const providers = useStore((s) => s.providers) ?? PROVIDERS;
  const name = providerLabel(providers, provider);
  const label = modelLabel(providers, { provider: provider ?? "claude", model: model ?? "" });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("flex shrink-0 items-center gap-0.5", className)}>
          <ProviderMark provider={provider} className="size-3 shrink-0" />
          {withLabel && model && <span className="min-w-0 truncate text-muted-foreground">{label}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {name} · {label}
      </TooltipContent>
    </Tooltip>
  );
}
