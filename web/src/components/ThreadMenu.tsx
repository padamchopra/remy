import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, Columns2, Folder, GitFork, GitPullRequest, Link, MoreHorizontal, Pencil, Pin, PinOff, Square, Trash2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { canWriteThread, type ComputerSummary, type HubThread } from "@remy/contract";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SidebarMenuAction, SidebarMenuItem } from "@/components/ui/sidebar";
import { StartSubthreadDialog } from "@/components/StartSubthreadDialog";
import { apiError } from "@/lib/api-error";
import { hubRequest, hubThreadPath } from "@/lib/hub-threads";
import { useHubProfile } from "@/lib/hub-profile";
import { transport } from "@/lib/transport";
import { threadGroup, threadIsRunning, threadLink, threadMenuGroups, threadWorkspace, type ThreadMenuFacts, type ThreadMenuKind } from "@/lib/thread-menu";
import { useStore } from "@/state/store";
import { useShallow } from "zustand/react/shallow";
import type { ArchivedThread, Chat, ChatState } from "@/state/types";

const NO_ARCHIVES: ArchivedThread[] = [];

const ICONS: Record<ThreadMenuKind, LucideIcon> = {
  pin: Pin,
  unpin: PinOff,
  rename: Pencil,
  copy: Link,
  spawn: GitFork,
  beside: Columns2,
  workspace: Folder,
  pr: GitPullRequest,
  stop: Square,
  archive: Archive,
  "stop-archive": Archive,
  unarchive: ArchiveRestore,
  delete: Trash2,
};

interface ThreadMenuActions {
  pin(pinned: boolean): Promise<void>;
  rename(title: string): Promise<void>;
  copy(): Promise<void>;
  interrupt(): Promise<void>;
  archive(): Promise<void>;
  remove(): Promise<void>;
  restore?: () => Promise<{ id: string }>;
  loadPullRequest?: () => Promise<string | undefined>;
}

interface ThreadMenuItem {
  label: string;
  icon: LucideIcon;
  run?: () => void;
  href?: string;
  disabled?: boolean;
  destructive?: boolean;
}

/// One sidebar thread menu for Mac and hosted: right-click and the hover ⋯.
function ThreadMenuView({
  chat,
  archive,
  children,
  itemClassName,
  facts,
  childCount,
  actions,
  onOpenThread,
  onOpenBeside,
  onOpenWorkspace,
  workspaceId,
  spawn,
}: {
  chat: Pick<Chat, "id" | "title" | "parentChatId" | "pinned" | "state">;
  archive?: boolean;
  children: ReactNode | ((open: boolean) => ReactNode);
  itemClassName?: string;
  facts: Omit<ThreadMenuFacts, "busy">;
  childCount: number;
  actions: ThreadMenuActions;
  onOpenThread?: (id: string) => void;
  onOpenBeside?: (id: string) => void;
  onOpenWorkspace?: (id: string) => void;
  workspaceId?: string;
  spawn?: Chat;
}) {
  const [dialog, setDialog] = useState<"rename" | "archive" | "delete" | "spawn">();
  const [title, setTitle] = useState(chat.title);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [prUrl, setPrUrl] = useState<string>();
  const [contextOpen, setContextOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const inputId = useId();
  const actionRef = useRef<HTMLButtonElement>(null);
  const menuOpen = contextOpen || dropdownOpen;
  const unavailable = busy || Boolean(facts.busy) || !facts.online;

  const loadPullRequest = actions.loadPullRequest;
  useEffect(() => {
    if (!menuOpen || archive || !facts.online || facts.cloud || !loadPullRequest) return;
    let cancelled = false;
    setPrUrl(undefined);
    void loadPullRequest().then((url) => {
      if (!cancelled && url) setPrUrl(url);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [menuOpen, archive, facts.online, facts.cloud, loadPullRequest, chat.id]);

  const perform = async (action: () => Promise<unknown>, success: string, failure: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await action();
      setDialog(undefined);
      toast.success(success);
    } catch (error) {
      toast.error(failure, { description: apiError(error) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const archiveThread = () => void perform(actions.archive, "Archived the thread.", "Couldn't archive the thread");
  const remove = () => void perform(actions.remove, "Deleted the thread.", "Couldn't delete the thread");
  const handlers: Partial<Record<ThreadMenuKind, () => void>> = {
    pin: () => void perform(() => actions.pin(true), "Pinned the thread.", "Couldn't update the pin"),
    unpin: () => void perform(() => actions.pin(false), "Unpinned the thread.", "Couldn't update the pin"),
    rename: () => { setTitle(chat.title); setDialog("rename"); },
    copy: () => void perform(actions.copy, "Copied the thread link.", "Couldn't copy the thread link"),
    spawn: () => setDialog("spawn"),
    beside: () => onOpenBeside?.(chat.id),
    workspace: () => workspaceId && onOpenWorkspace?.(workspaceId),
    stop: () => void perform(actions.interrupt, "Stopped the agent.", "Couldn't stop the agent"),
    archive: archiveThread,
    "stop-archive": () => setDialog("archive"),
    unarchive: () => void perform(async () => {
      const restored = await actions.restore!();
      onOpenThread?.(restored.id);
    }, "Unarchived the thread.", "Couldn't unarchive the thread"),
    delete: () => setDialog("delete"),
  };
  const groups: ThreadMenuItem[][] = threadMenuGroups({
    ...facts,
    archive,
    parent: Boolean(chat.parentChatId),
    running: threadIsRunning(chat),
    pinned: chat.pinned,
    workspace: Boolean(workspaceId && onOpenWorkspace),
    beside: Boolean(chat.parentChatId && onOpenBeside),
    pullRequest: Boolean(prUrl),
    busy,
  }).map((entries) => entries.map((entry) => ({
    label: entry.label,
    icon: ICONS[entry.kind],
    disabled: entry.disabled,
    destructive: entry.destructive,
    href: entry.kind === "pr" ? prUrl : undefined,
    run: handlers[entry.kind],
  })));

  const items = (context: boolean) => {
    const Group = context ? ContextMenuGroup : DropdownMenuGroup;
    const Item = context ? ContextMenuItem : DropdownMenuItem;
    const Separator = context ? ContextMenuSeparator : DropdownMenuSeparator;
    return groups.filter((actions) => actions.length > 0).map((entries, index) => (
      <Fragment key={index}>
        {index > 0 && <Separator />}
        <Group>
          {entries.map(({ label, icon: Icon, run, href, disabled, destructive }) => (
            <Item key={label} disabled={disabled} variant={destructive ? "destructive" : "default"} onSelect={run} asChild={Boolean(href)} data-link={href || label.startsWith("Open ") ? true : undefined}>
              {href ? <a href={href} target="_blank" rel="noreferrer"><Icon />{label}</a> : <><Icon />{label}</>}
            </Item>
          ))}
        </Group>
      </Fragment>
    ));
  };

  return (
    <ContextMenu onOpenChange={setContextOpen}>
      <ContextMenuTrigger asChild>
        <SidebarMenuItem className={itemClassName} data-thread-id={chat.id} onKeyDown={(event) => {
          if (!menuOpen && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
            event.preventDefault();
            setDropdownOpen(true);
          }
        }}>
          {typeof children === "function" ? children(menuOpen || Boolean(dialog)) : children}
          <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuAction ref={actionRef} showOnHover aria-label={`Thread actions for ${chat.title}`} aria-keyshortcuts="Shift+F10" title="Thread actions (Shift+F10)" className="bg-sidebar group-hover/menu-item:bg-sidebar-accent data-[state=open]:opacity-100">
                <MoreHorizontal />
              </SidebarMenuAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right" onCloseAutoFocus={(event) => { if (dialog) event.preventDefault(); }}>
              {items(false)}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(event) => { event.preventDefault(); if (!dialog) actionRef.current?.focus(); }}>
        {items(true)}
      </ContextMenuContent>

      <Dialog open={dialog === "rename"} onOpenChange={(next) => { if (!next && !busy) setDialog(undefined); }}>
        <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); actionRef.current?.focus(); }}>
          <DialogHeader>
            <DialogTitle>Rename thread</DialogTitle>
            <DialogDescription>Choose a name for this conversation.</DialogDescription>
          </DialogHeader>
          <form className="flex min-w-0 flex-col gap-4" onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim() || unavailable) return;
            void perform(() => actions.rename(title.trim()), "Renamed the thread.", "Couldn't rename the thread");
          }}>
            <FieldGroup><Field>
              <FieldLabel htmlFor={inputId}>Thread name</FieldLabel>
              <Input id={inputId} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} disabled={unavailable} autoFocus onFocus={(event) => event.target.select()} />
            </Field></FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(undefined)}>Cancel</Button>
              <Button type="submit" disabled={unavailable || !title.trim()}>Save name</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={dialog === "archive" || dialog === "delete"} onOpenChange={(next) => { if (!next && !busy) setDialog(undefined); }}>
        <AlertDialogContent onCloseAutoFocus={(event) => { event.preventDefault(); actionRef.current?.focus(); }}>
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">{dialog === "delete" ? "Delete" : "Stop and archive"} {chat.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              {dialog === "delete" ? "Permanently delete this conversation" : "Stop active agents and archive this conversation"}
              {childCount ? ` and ${childCount} ${childCount === 1 ? "subthread" : "subthreads"}` : ""}.
              {dialog === "delete" && !archive ? " Any active agents in these threads will stop." : ""}
              {dialog === "delete" ? " This cannot be undone." : " You can unarchive it later."}
              {" Workspace files and worktrees stay untouched."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={unavailable} onClick={(event) => { event.preventDefault(); if (dialog === "delete") remove(); else archiveThread(); }}>
              {dialog === "delete" ? "Delete thread" : "Stop and archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {spawn && <StartSubthreadDialog parent={spawn} open={dialog === "spawn"} onOpenChange={(next) => { if (!next) setDialog(undefined); }} onStarted={(child, beside) => beside && onOpenBeside ? onOpenBeside(child.id) : onOpenThread?.(child.id)} />}
    </ContextMenu>
  );
}

function MacThreadMenu({
  chat,
  archive,
  children,
  itemClassName,
  onOpenThread,
  onOpenBeside,
  onOpenWorkspace,
}: {
  chat: Chat;
  archive?: ArchivedThread;
  children: ReactNode | ((open: boolean) => ReactNode);
  itemClassName?: string;
  onOpenThread: (id: string) => void;
  onOpenBeside?: (id: string) => void;
  onOpenWorkspace?: (id: string) => void;
}) {
  const group = useStore(useShallow((state) => threadGroup(chat, state.chats)));
  const archives = useStore((state) => archive ? state.archived : NO_ARCHIVES);
  const workspaceId = useStore((state) => threadWorkspace(chat, state.workspaces)?.id);
  const [online, cloud] = useStore(useShallow((state) => {
    const server = state.servers.find((entry) => entry.id === chat.serverId);
    return [server?.online === true, server?.cloud === true] as const;
  }));
  const childCount = archive
    ? archives.filter((entry) => entry.serverId === archive.serverId && archive.chatId && entry.parentChatId === archive.chatId).length
    : group.length - 1;
  const actions = useMemo<ThreadMenuActions>(() => ({
    pin: (pinned) => useStore.getState().pinThread(chat.id, pinned),
    rename: (title) => useStore.getState().renameThread(chat.id, title),
    copy: () => navigator.clipboard.writeText(threadLink(chat.id, window.location.href)),
    interrupt: () => useStore.getState().interrupt(chat.id),
    archive: async () => {
      if ((chat.parentChatId || cloud) && threadIsRunning(chat)) await useStore.getState().interrupt(chat.id);
      await useStore.getState().archiveThread(chat.id);
    },
    remove: async () => {
      if (archive) return useStore.getState().deleteArchivedThread(archive.id, archive.serverId);
      if (cloud && threadIsRunning(chat)) await useStore.getState().interrupt(chat.id);
      return useStore.getState().deleteThread(chat.id);
    },
    restore: archive ? () => useStore.getState().restoreThread(archive.id, archive.serverId) : undefined,
    loadPullRequest: async () => {
      const { pullRequest } = await transport.request<{ pullRequest: { url: string } | null }>(
        chat.serverId,
        `/chats/${encodeURIComponent(chat.id)}/pull-request`,
      );
      return pullRequest && /^https:\/\/github\.com\//.test(pullRequest.url) ? pullRequest.url : undefined;
    },
  }), [archive, chat, cloud]);
  return (
    <ThreadMenuView
      chat={chat}
      archive={Boolean(archive)}
      itemClassName={itemClassName}
      childCount={childCount}
      facts={{ online, cloud, groupRunning: group.some(threadIsRunning) }}
      workspaceId={workspaceId}
      onOpenThread={onOpenThread}
      onOpenBeside={onOpenBeside}
      onOpenWorkspace={onOpenWorkspace}
      spawn={!archive && !chat.parentChatId ? chat : undefined}
      actions={actions}
    >
      {children}
    </ThreadMenuView>
  );
}

function HostedThreadMenu({
  chat,
  hosted,
  children,
  itemClassName,
  onOpenWorkspace,
}: {
  chat: Chat;
  hosted: HostedThreadMenuSource;
  children: ReactNode | ((open: boolean) => ReactNode);
  itemClassName?: string;
  onOpenWorkspace?: (id: string) => void;
}) {
  const { profile } = useHubProfile(hosted.organizationId);
  const pending = hosted.thread.computerId === "pending";
  const cloud = hosted.computer?.ownership === "hosted";
  const online = !pending && !hosted.thread.stale && hosted.computer != null && hosted.computer.availability !== "offline";
  const writable = Boolean(profile && canWriteThread(hosted.thread.access, profile.id));
  const running = threadIsRunning(chat);
  const path = hubThreadPath(hosted.organizationId, hosted.thread.computerId, hosted.thread.id);
  const actions = useMemo<ThreadMenuActions>(() => ({
    pin: (pinned) => hubRequest(path, "PATCH", { pinned }),
    rename: (title) => hubRequest(path, "PATCH", { title }),
    copy: () => navigator.clipboard.writeText(threadLink(chat.id, window.location.href, { hosted: true })),
    interrupt: () => hubRequest(`${path}/interrupt`, "POST"),
    archive: async () => {
      if (running) await hubRequest(`${path}/interrupt`, "POST");
      await hubRequest(`${path}/archive`, "POST");
    },
    remove: async () => {
      if (running) await hubRequest(`${path}/interrupt`, "POST");
      await hubRequest(path, "DELETE");
    },
  }), [chat.id, path, running]);
  return (
    <ThreadMenuView
      chat={chat}
      itemClassName={itemClassName}
      childCount={hosted.childCount ?? 0}
      facts={{
        online: online && writable,
        cloud,
        groupRunning: running,
        spawn: false,
        linkable: !pending,
      }}
      workspaceId={hosted.workspaceId}
      onOpenWorkspace={hosted.workspaceId ? onOpenWorkspace : undefined}
      actions={actions}
    >
      {children}
    </ThreadMenuView>
  );
}

export interface HostedThreadMenuSource {
  organizationId: string;
  thread: HubThread;
  computer?: ComputerSummary;
  workspaceId?: string;
  childCount?: number;
}

export function hubThreadAsChat(thread: HubThread): Chat {
  const state = thread.detail.state;
  const chatState: ChatState = state === "working" || state === "needs_input" || state === "error" ? state : "idle";
  return {
    id: thread.id,
    serverId: thread.computerId,
    title: thread.detail.title,
    cwd: typeof thread.detail.cwd === "string" ? thread.detail.cwd : "",
    state: chatState,
    pinned: thread.detail.pinned === true,
    parentChatId: typeof thread.detail.parentChatId === "string" ? thread.detail.parentChatId : undefined,
    updatedAt: typeof thread.detail.updatedAt === "number" ? thread.detail.updatedAt : thread.observedAt,
  };
}

export function ThreadMenu({
  chat,
  archive,
  hosted,
  children,
  itemClassName,
  onOpenThread,
  onOpenBeside,
  onOpenWorkspace,
}: {
  chat: Chat;
  archive?: ArchivedThread;
  hosted?: HostedThreadMenuSource;
  children: ReactNode | ((open: boolean) => ReactNode);
  itemClassName?: string;
  onOpenThread?: (id: string) => void;
  onOpenBeside?: (id: string) => void;
  onOpenWorkspace?: (id: string) => void;
}) {
  if (hosted) {
    return (
      <HostedThreadMenu chat={chat} hosted={hosted} itemClassName={itemClassName} onOpenWorkspace={onOpenWorkspace}>
        {children}
      </HostedThreadMenu>
    );
  }
  return (
    <MacThreadMenu chat={chat} archive={archive} itemClassName={itemClassName} onOpenThread={onOpenThread!} onOpenBeside={onOpenBeside} onOpenWorkspace={onOpenWorkspace}>
      {children}
    </MacThreadMenu>
  );
}
