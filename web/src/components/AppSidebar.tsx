import { Fragment, useState, type ComponentType } from "react";
import {
  ArrowUpCircle,
  ChevronLeft,
  Clock,
  CornerDownRight,
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
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SETTINGS_SECTIONS, type SettingsTab } from "@/components/Settings";
import { ProviderMark } from "@/components/ProviderMark";
import { WorkspaceMark } from "@/components/WorkspaceIcon";
import { deviceIcon } from "@/lib/devices";
import { modelLabel, providerLabel, PROVIDERS } from "@/lib/providers";
import { displayPath, plainText } from "@/lib/path";
import { ThreadMenu } from "@/components/ThreadMenu";
import { elapsedSince, useTicker } from "@/lib/elapsed";
import { workspaceForPath } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { useStore } from "@/state/store";
import type { ArchivedThread, Chat, ChatState, Server, Ticket, Workspace } from "@/state/types";

export function AppSidebar({
  view,
  settingsTab,
  section,
  selected,
  servers,
  scoped,
  archived,
  workspaces,
  needsYou,
  unread,
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
  scoped: Chat[];
  archived: ArchivedThread[];
  workspaces: Workspace[];
  needsYou: number;
  unread: number;
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
  const now = useTicker(scoped.some((chat) => chat.workingSince));
  const known = new Set(scoped.map((chat) => chat.id));
  const parents = scoped.filter((chat) => !chat.parentChatId || !known.has(chat.parentChatId));
  // Before the first read answers there is nothing to say about the threads
  // yet: "No threads yet." would be a claim, and on a machine that has some it
  // is a wrong one, corrected a moment later.
  const stillLooking = useStore((s) => s.loading);

  return (
    <Sidebar collapsible="none" className="border-r border-sidebar-border">
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
                {sections.map(({ id, label, icon: Icon }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton data-link isActive={section === id} onClick={() => onSection(id)}>
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                    {id === "inbox" && unread > 0 && <SidebarMenuBadge>{unread}</SidebarMenuBadge>}
                    {id === "chats" && needsYou > 0 && <SidebarMenuBadge>{needsYou}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarContent>
            {/* Threads, in every section. They are the work; whatever else you
                are looking at, one is always a click away. */}
            <SidebarGroup>
              <SidebarGroupLabel>
                Threads
              </SidebarGroupLabel>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarGroupAction aria-label="New thread" onClick={onNewThread}>
                    <SquarePen />
                  </SidebarGroupAction>
                </TooltipTrigger>
                <TooltipContent side="right">New thread</TooltipContent>
              </Tooltip>
              <SidebarGroupContent>
                <SidebarMenu>
                  {parents.length === 0 ? (
                    stillLooking ? null : (
                      <p className="px-2 py-1.5 text-xs text-muted-foreground">
                        {archived.length > 0 ? "No active threads." : "No threads yet."}
                      </p>
                    )
                  ) : (
                    parents.map((chat) => {
                      const children = scoped.filter((entry) => entry.parentChatId === chat.id);
                      const aggregate = aggregateThreadState([chat, ...children]);
                      return (
                        <Fragment key={chat.id}>
                          <ThreadMenu chat={chat} onOpenThread={onSelectChat} onOpenBeside={onOpenBeside} onOpenWorkspace={onOpenWorkspace}>
                            {(menuOpen) => <ThreadRow
                              contextDisabled={menuOpen}
                              chat={{ ...chat, state: aggregate }}
                              active={selected === chat.id}
                              workspace={workspaces[workspaceForPath(chat.cwd, workspaces)]}
                              server={servers.find((entry) => entry.id === chat.serverId)}
                              now={now}
                              onSelect={() => onSelectChat(chat.id)}
                              onOpenTicket={onOpenTicket}
                              onOpenWorkspace={onOpenWorkspace}
                            />}
                          </ThreadMenu>
                          {children.map((child) => (
                            <ThreadMenu key={child.id} chat={child} onOpenThread={onSelectChat} onOpenBeside={onOpenBeside} onOpenWorkspace={onOpenWorkspace}>
                              <SidebarMenuButton data-link size="sm" isActive={selected === child.id} className={cn("h-7 gap-1.5 pl-5 text-xs", threadRowHoverClass, threadRowActionSpaceClass)} onClick={() => onSelectChat(child.id)}>
                                <CornerDownRight />
                                <span className="min-w-0 flex-1 truncate">{child.title}</span>
                                <ThreadState state={child.state} />
                              </SidebarMenuButton>
                            </ThreadMenu>
                          ))}
                        </Fragment>
                      );
                    })
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            {archived.length > 0 && (
              <SidebarGroup className="pt-0">
                <SidebarGroupLabel>Archived</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {archived.map((thread) => (
                      <ThreadMenu key={`${thread.serverId}:${thread.id}`} chat={{ ...thread, state: "idle", updatedAt: thread.archivedAt }} archive={thread} onOpenThread={onSelectChat}>
                        <SidebarMenuButton data-link size="sm" className={cn(threadRowActionSpaceClass, threadRowHoverClass)} isActive={selected === thread.id} onClick={() => onSelectChat(thread.id)}>
                          <WorkspaceMark home={!workspaces[workspaceForPath(thread.cwd, workspaces)]} workspace={workspaces[workspaceForPath(thread.cwd, workspaces)]} server={servers.find((entry) => entry.id === thread.serverId)} size="sm" />
                          <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                        </SidebarMenuButton>
                      </ThreadMenu>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </SidebarContent>
        </>
      )}

      <SidebarFooter>
        <SidebarSeparator />
        <SidebarMenu>
          {view !== "settings" && updateAvailable && (
            <SidebarMenuItem>
              <SidebarMenuButton data-link onClick={() => openSettings("general")}>
                <ArrowUpCircle />
                <span>Update available</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton
              data-link
              isActive={view === "settings"}
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

function aggregateThreadState(group: Chat[]): ChatState {
  if (group.some((chat) => chat.state === "needs_input")) return "needs_input";
  if (group.some((chat) => chat.state === "working")) return "working";
  if (group.some((chat) => chat.state === "error")) return "error";
  return "idle";
}

function ThreadState({ state }: { state: ChatState }) {
  const label = state === "idle"
    ? "Done"
    : state === "needs_input"
      ? "Needs you"
      : state === "working"
        ? "Working"
        : "Error";
  const variant = state === "idle"
    ? "secondary"
    : state === "needs_input"
      ? "warning"
      : state === "working"
        ? "info"
        : "destructive";

  return (
    <Badge variant={variant} className="h-[18px] px-1.5 py-0 text-[10px] leading-4">
      {state === "working" ? <span className="shimmer">{label}</span> : label}
    </Badge>
  );
}


const threadRowHoverClass = "group-focus-within/menu-item:!bg-sidebar-row-hover group-hover/menu-item:!bg-sidebar-row-hover";
const threadRowActionSpaceClass = "pr-8";

/// One thread in the list: what it is, where it runs, and what it is doing.
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
  const [contextOpen, setContextOpen] = useState(false);
  const DeviceIcon = deviceIcon(server?.icon);
  const place = workspace?.name ?? displayPath(chat.cwd);
  const elapsed = chat.workingSince ? elapsedSince(chat.workingSince, now) : undefined;
  const tickets = useStore((s) => s.tickets);
  const ticket = tickets.find((entry) => entry.threads.some((link) => link.chatId === chat.id));

  const row = (
    <SidebarMenuButton
      data-link
      isActive={active}
      className={cn(
        "h-auto flex-col items-stretch gap-1 py-2",
        threadRowActionSpaceClass,
        threadRowHoverClass,
      )}
      onClick={onSelect}
    >
      {/* A linked ticket is the most useful destination; otherwise the
          workspace names where the thread lives. The workspace mark remains
          stable so either row is recognisable before it is read. */}
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-none font-normal text-muted-foreground">
        <WorkspaceMark home={!workspace} workspace={workspace} server={server} size="sm" />
        {ticket ? (
          // A key, not a button: this row is already a button, and one inside
          // another is not markup a browser will honour. The click is stopped
          // here so opening the ticket does not also open the thread.
          <span
            role="link"
            tabIndex={0}
            className="min-w-0 flex-1 truncate rounded font-mono text-[10px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
        ) : (
          <span className="min-w-0 flex-1 truncate">{place}</span>
        )}
      </span>

      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate">{chat.title}</span>
        {chat.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />}
        <ThreadState state={chat.state} />
      </span>

      {chat.preview && (
        <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{plainText(chat.preview)}</span>
      )}

      {/* Marks, not words, so they don't compete with the title. What the
          thread thinks with opens the line and where it runs closes it, so
          neither edge is left standing empty. */}
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-normal text-muted-foreground">
        <ThreadModel provider={chat.provider} model={chat.model} />
        <span className="flex-1" />
        {elapsed && (
          <span className="flex shrink-0 items-center gap-1 tabular-nums">
            <Clock className="size-3" />
            {elapsed}
          </span>
        )}
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
function ThreadModel({ provider, model }: { provider?: string; model?: string }) {
  const providers = useStore((s) => s.providers) ?? PROVIDERS;
  const name = providerLabel(providers, provider);
  const label = modelLabel(providers, { provider: provider ?? "claude", model: model ?? "" });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex shrink-0 items-center gap-0.5">
          <ProviderMark provider={provider} className="size-3" />
          {model && <span className="text-muted-foreground">{label}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {name} · {label}
      </TooltipContent>
    </Tooltip>
  );
}
