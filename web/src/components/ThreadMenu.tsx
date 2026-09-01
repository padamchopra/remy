import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, Columns2, Folder, GitFork, GitPullRequest, Link, MoreHorizontal, Pencil, Pin, PinOff, Square, Trash2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
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
import { transport } from "@/lib/transport";
import { threadGroup, threadIsRunning, threadLink, threadWorkspace } from "@/lib/thread-menu";
import { useStore } from "@/state/store";
import { useShallow } from "zustand/react/shallow";
import type { ArchivedThread, Chat } from "@/state/types";

interface MenuAction {
  label: string;
  icon: LucideIcon;
  run?: () => void;
  href?: string;
  disabled?: boolean;
  destructive?: boolean;
}

export function ThreadMenu({ chat, archive, children, onOpenThread, onOpenBeside, onOpenWorkspace }: {
  chat: Chat;
  archive?: ArchivedThread;
  children: ReactNode | ((open: boolean) => ReactNode);
  onOpenThread: (id: string) => void;
  onOpenBeside?: (id: string) => void;
  onOpenWorkspace?: (id: string) => void;
}) {
  const group = useStore(useShallow((state) => threadGroup(chat, state.chats)));
  const archives = useStore((state) => state.archived);
  const workspaces = useStore((state) => state.workspaces);
  const servers = useStore((state) => state.servers);
  const [contextOpen, setContextOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dialog, setDialog] = useState<"rename" | "archive" | "delete" | "spawn">();
  const [title, setTitle] = useState(chat.title);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [prUrl, setPrUrl] = useState<string>();
  const inputId = useId();
  const actionRef = useRef<HTMLButtonElement>(null);
  const workspace = threadWorkspace(chat, workspaces);
  const server = servers.find((entry) => entry.id === chat.serverId);
  const online = server?.online === true;
  const cloud = server?.cloud === true;
  const running = group.some(threadIsRunning);
  const childCount = archive
    ? archives.filter((entry) => entry.serverId === archive.serverId && archive.chatId && entry.parentChatId === archive.chatId).length
    : group.length - 1;
  const menuOpen = contextOpen || dropdownOpen;

  useEffect(() => {
    if (!menuOpen || archive || !online || cloud) return;
    let cancelled = false;
    setPrUrl(undefined);
    void transport.request<{ pullRequest: { url: string } | null }>(chat.serverId, `/chats/${encodeURIComponent(chat.id)}/pull-request`)
      .then(({ pullRequest }) => {
        if (!cancelled && pullRequest && /^https:\/\/github\.com\//.test(pullRequest.url)) setPrUrl(pullRequest.url);
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [menuOpen, archive, online, cloud, chat.id, chat.serverId]);

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

  const copy = () => void perform(
    () => navigator.clipboard.writeText(threadLink(chat.id, window.location.href)),
    "Copied the thread link.", "Couldn't copy the thread link",
  );
  const archiveThread = () => void perform(async () => {
    // Subthreads must settle before their archive endpoint accepts them.
    if ((chat.parentChatId || cloud) && threadIsRunning(chat)) await useStore.getState().interrupt(chat.id);
    await useStore.getState().archiveThread(chat.id);
  }, "Archived the thread.", "Couldn't archive the thread");
  const remove = () => void perform(
    async () => {
      if (archive) return useStore.getState().deleteArchivedThread(archive.id, archive.serverId);
      if (cloud && threadIsRunning(chat)) await useStore.getState().interrupt(chat.id);
      return useStore.getState().deleteThread(chat.id);
    },
    "Deleted the thread.", "Couldn't delete the thread",
  );
  const unavailable = busy || !online;
  const groups: MenuAction[][] = archive ? [
    [
      { label: "Unarchive thread", icon: ArchiveRestore, disabled: unavailable || cloud, run: () => void perform(async () => {
        const restored = await useStore.getState().restoreThread(archive.id, archive.serverId);
        onOpenThread(restored.id);
      }, "Unarchived the thread.", "Couldn't unarchive the thread") },
      { label: "Copy thread link", icon: Link, run: copy, disabled: busy },
    ],
  ] : [
    [
      ...(!chat.parentChatId ? [{ label: chat.pinned ? "Unpin thread" : "Pin thread", icon: chat.pinned ? PinOff : Pin, disabled: unavailable || cloud, run: () => void perform(
        () => useStore.getState().pinThread(chat.id, !chat.pinned),
        chat.pinned ? "Unpinned the thread." : "Pinned the thread.", "Couldn't update the pin",
      ) }] : []),
      { label: "Rename…", icon: Pencil, disabled: unavailable, run: () => { setTitle(chat.title); setDialog("rename"); } },
      { label: "Copy thread link", icon: Link, run: copy, disabled: busy },
    ],
    [
      ...(!chat.parentChatId && !cloud ? [{ label: "Start subthread…", icon: GitFork, disabled: unavailable, run: () => setDialog("spawn") }] : []),
      ...(chat.parentChatId && onOpenBeside ? [{ label: "Open beside parent", icon: Columns2, run: () => onOpenBeside(chat.id) }] : []),
      ...(workspace && onOpenWorkspace ? [{ label: "Open workspace", icon: Folder, run: () => onOpenWorkspace(workspace.id) }] : []),
      ...(prUrl ? [{ label: "Open pull request", icon: GitPullRequest, href: prUrl }] : []),
    ],
    [
      ...(threadIsRunning(chat) ? [{ label: "Stop agent", icon: Square, disabled: unavailable, run: () => void perform(
        () => useStore.getState().interrupt(chat.id), "Stopped the agent.", "Couldn't stop the agent",
      ) }] : []),
      { label: running ? "Stop and archive…" : "Archive thread", icon: Archive, disabled: unavailable, run: () => running ? setDialog("archive") : archiveThread() },
    ],
  ];
  groups.push([{ label: archive ? "Delete permanently…" : "Delete thread…", icon: Trash2, destructive: true, disabled: unavailable, run: () => setDialog("delete") }]);

  const items = (context: boolean) => {
    const Group = context ? ContextMenuGroup : DropdownMenuGroup;
    const Item = context ? ContextMenuItem : DropdownMenuItem;
    const Separator = context ? ContextMenuSeparator : DropdownMenuSeparator;
    return groups.filter((actions) => actions.length > 0).map((actions, index) => (
      <Fragment key={index}>
        {index > 0 && <Separator />}
        <Group>
          {actions.map(({ label, icon: Icon, run, href, disabled, destructive }) => (
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
        <SidebarMenuItem data-thread-id={chat.id} onKeyDown={(event) => {
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

      <Dialog open={dialog === "rename"} onOpenChange={(open) => { if (!open && !busy) setDialog(undefined); }}>
        <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); actionRef.current?.focus(); }}>
          <DialogHeader>
            <DialogTitle>Rename thread</DialogTitle>
            <DialogDescription>Choose a name for this conversation.</DialogDescription>
          </DialogHeader>
          <form className="flex min-w-0 flex-col gap-4" onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim() || unavailable) return;
            void perform(() => useStore.getState().renameThread(chat.id, title.trim()), "Renamed the thread.", "Couldn't rename the thread");
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

      <AlertDialog open={dialog === "archive" || dialog === "delete"} onOpenChange={(open) => { if (!open && !busy) setDialog(undefined); }}>
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
      {!archive && !chat.parentChatId && <StartSubthreadDialog parent={chat} open={dialog === "spawn"} onOpenChange={(open) => { if (!open) setDialog(undefined); }} onStarted={(child, beside) => beside && onOpenBeside ? onOpenBeside(child.id) : onOpenThread(child.id)} />}
    </ContextMenu>
  );
}
