import type { ComponentType } from "react";
import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowUpCircle,
  ChevronLeft,
  Clock,
  GitBranch,
  Pin,
  PinOff,
  Settings2,
  SquarePen,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
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
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
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
import { apiError } from "@/lib/api-error";
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
  onOpenTicket: (key: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onNewThread: () => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  updateAvailable?: boolean;
}) {
  const now = useTicker(scoped.some((chat) => chat.workingSince));
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
            <SidebarGroup className="min-h-0">
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
                  {scoped.length === 0 ? (
                    stillLooking ? null : (
                      <p className="px-2 py-1.5 text-xs text-muted-foreground">
                        {archived.length > 0 ? "No active threads." : "No threads yet."}
                      </p>
                    )
                  ) : (
                    scoped.map((chat) => (
                      <SidebarMenuItem key={chat.id}>
                        <ThreadRow
                          chat={chat}
                          active={selected === chat.id}
                          workspace={workspaces[workspaceForPath(chat.cwd, workspaces)]}
                          server={servers.find((entry) => entry.id === chat.serverId)}
                          now={now}
                          onSelect={() => onSelectChat(chat.id)}
                          onOpenTicket={onOpenTicket}
                          onOpenWorkspace={onOpenWorkspace}
                        />
                        <ThreadActions chat={chat} />
                      </SidebarMenuItem>
                    ))
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
                      <ArchivedThreadItem
                        key={`${thread.serverId}:${thread.id}`}
                        thread={thread}
                        workspace={workspaces[workspaceForPath(thread.cwd, workspaces)]}
                        server={servers.find((entry) => entry.id === thread.serverId)}
                        onSelectChat={onSelectChat}
                      />
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


/// Hover actions keep lifecycle controls beside the thread without crowding
/// every row. Archiving stays unavailable while a turn is in flight.
const threadActionLeftClass = "z-20 right-6 translate-x-1 !bg-transparent transition-[opacity,transform] duration-150 group-focus-within/menu-item:translate-x-0 group-hover/menu-item:translate-x-0 hover:!bg-transparent motion-reduce:transition-none";
const threadActionRightClass = "z-20 translate-x-1 !bg-transparent transition-[opacity,transform] duration-150 group-focus-within/menu-item:translate-x-0 group-hover/menu-item:translate-x-0 hover:!bg-transparent motion-reduce:transition-none";
const threadRowHoverClass = "group-focus-within/menu-item:!bg-sidebar-row-hover group-hover/menu-item:!bg-sidebar-row-hover";

function ThreadActionFade({ compact = false }: { compact?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute right-1 z-10 h-5 w-[72px] bg-[linear-gradient(to_right,transparent_0,var(--sidebar-row-hover)_32px,var(--sidebar-row-hover)_100%)] transition-opacity duration-150 group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 md:opacity-0 motion-reduce:transition-none",
        compact ? "top-1" : "top-1.5",
      )}
    />
  );
}

function ThreadActions({ chat }: { chat: Chat }) {
  const pinThread = useStore((s) => s.pinThread);
  const archiveThread = useStore((s) => s.archiveThread);
  const [saving, setSaving] = useState(false);
  const running = chat.state === "working" || chat.state === "needs_input";

  const pin = async () => {
    setSaving(true);
    try {
      await pinThread(chat.id, !chat.pinned);
      toast.success(chat.pinned ? "Unpinned the thread." : "Pinned the thread.");
    } catch (caught) {
      toast.error(`Couldn't ${chat.pinned ? "unpin" : "pin"} that thread`, { description: apiError(caught) });
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    setSaving(true);
    try {
      await archiveThread(chat.id);
      toast.success("Archived the thread.");
    } catch (caught) {
      toast.error("Couldn't archive that thread", { description: apiError(caught) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ThreadActionFade />

      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarMenuAction
            showOnHover
            className={threadActionLeftClass}
            aria-label={`${chat.pinned ? "Unpin" : "Pin"} ${chat.title}`}
            disabled={saving}
            onClick={() => void pin()}
          >
            {chat.pinned ? <PinOff /> : <Pin />}
          </SidebarMenuAction>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>{chat.pinned ? "Unpin" : "Pin"}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarMenuAction
            showOnHover
            className={threadActionRightClass}
            aria-label={`Archive ${chat.title}`}
            disabled={saving || running}
            onClick={() => void archive()}
          >
            <Archive />
          </SidebarMenuAction>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>Archive</TooltipContent>
      </Tooltip>
    </>
  );
}

function ArchivedThreadItem({
  thread,
  workspace,
  server,
  onSelectChat,
}: {
  thread: ArchivedThread;
  workspace?: Workspace;
  server?: Server;
  onSelectChat: (id: string) => void;
}) {
  const restoreThread = useStore((s) => s.restoreThread);
  const deleteArchivedThread = useStore((s) => s.deleteArchivedThread);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const chat = await restoreThread(thread.id, thread.serverId);
      toast.success("Unarchived the thread.");
      onSelectChat(chat.id);
    } catch (caught) {
      toast.error("Couldn't unarchive that thread", { description: apiError(caught) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteArchivedThread(thread.id, thread.serverId);
      toast.success("Deleted the thread.");
    } catch (caught) {
      toast.error("Couldn't delete that thread", { description: apiError(caught) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        data-link
        size="sm"
        className={cn(
          "text-muted-foreground group-has-data-[sidebar=menu-action]/menu-item:pr-2 group-focus-within/menu-item:pr-12 group-hover/menu-item:pr-12",
          threadRowHoverClass,
        )}
        disabled={busy}
        onClick={() => void restore()}
      >
        <WorkspaceMark home={!workspace} workspace={workspace} server={server} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sidebar-foreground">{thread.title}</span>
      </SidebarMenuButton>

      <ThreadActionFade compact />

      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarMenuAction
            showOnHover
            className={threadActionLeftClass}
            aria-label={`Unarchive ${thread.title}`}
            disabled={busy}
            onClick={() => void restore()}
          >
            <ArchiveRestore />
          </SidebarMenuAction>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>Unarchive</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarMenuAction
            showOnHover
            className={threadActionRightClass}
            aria-label={`Delete ${thread.title}`}
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            <Trash2 />
          </SidebarMenuAction>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>Delete</TooltipContent>
      </Tooltip>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {thread.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the archived conversation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              Delete thread
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarMenuItem>
  );
}

/// One thread in the list: what it is, where it runs, and what it is doing.
function ThreadRow({
  chat,
  active,
  workspace,
  server,
  now,
  onSelect,
  onOpenTicket,
  onOpenWorkspace,
}: {
  chat: Chat;
  active: boolean;
  workspace?: Workspace;
  server?: Server;
  now: number;
  onSelect: () => void;
  onOpenTicket: (key: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
}) {
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
        "h-auto flex-col items-stretch gap-1 py-2 group-has-data-[sidebar=menu-action]/menu-item:pr-2 group-focus-within/menu-item:pr-12 group-hover/menu-item:pr-12",
        threadRowHoverClass,
      )}
      onClick={onSelect}
    >
      {/* Where the thread lives, and what it is answering — an eyebrow above
          the title, so you place the row before you read it. */}
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-none font-normal text-muted-foreground">
        <WorkspaceMark home={!workspace} workspace={workspace} server={server} size="sm" />
        <span className="min-w-0 flex-1 truncate">{place}</span>
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
    <HoverCard openDelay={450}>
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
