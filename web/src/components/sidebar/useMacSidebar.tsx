import { useMemo, useState, type ComponentType } from "react";
import { useShallow } from "zustand/react/shallow";
import { Archive, ArrowUpCircle, Pin, Settings2 } from "lucide-react";
import { WorkspaceMark } from "@/components/WorkspaceIcon";
import { agoLabel, elapsedSince, useTicker } from "@/lib/elapsed";
import { deviceIcon } from "@/lib/devices";
import { workspaceForPath } from "@/lib/projects";
import { groupSidebarThreads, visibleSidebarThreads } from "@/lib/sidebar-threads";
import { SETTINGS_SECTIONS, type SettingsTab } from "@/lib/settings-sections";
import { useStore } from "@/state/store";
import type { ArchivedThread, Chat, ChatState, Server, Workspace } from "@/state/types";
import type {
  SidebarFooterItem,
  SidebarNavItem,
  SidebarThread,
  SidebarThreadGroup,
} from "./contract";

const SETTLED_THREAD_BATCH = 30;

/// Reads this machine's daemon and hands `AppSidebar` the shapes it draws.
/// The hosted shell has its own reader; neither is a second sidebar.
export function useMacSidebar({
  view,
  settingsTab,
  section,
  selected,
  servers,
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
  const [limits, setLimits] = useState<Record<string, number>>({});
  const chats = useStore((state) => state.chats);
  const tickets = useStore((state) => state.tickets);
  const avatar = useStore((state) => state.settings?.avatar);
  const stillLooking = useStore((state) => state.loading);
  const needsYou = useStore((state) => state.chats.filter((chat) => chat.state === "needs_input").length);
  const unread = useStore(useShallow((state) => state.agents.filter((agent) =>
    state.dms.some((chat) => chat.agentId === agent.id && chat.unread),
  ).length));
  const anyWorking = chats.some((chat) => Boolean(chat.workingSince));
  const now = useTicker(anyWorking);
  const machine = servers.find((server) => server.local) ?? servers[0];

  const revealMore = (key: string) => setLimits((current) => ({
    ...current,
    [key]: (current[key] ?? SETTLED_THREAD_BATCH) + SETTLED_THREAD_BATCH,
  }));

  const nav: SidebarNavItem[] = sections.map(({ id, label, icon }) => ({
    id,
    label,
    icon: icon as SidebarNavItem["icon"],
    count: id === "inbox" ? unread : id === "chats" ? needsYou : undefined,
    selected: section === id,
    onSelect: () => onSection(id),
  }));

  const settingsNav: SidebarNavItem[] = SETTINGS_SECTIONS.map(({ id, label, icon }) => ({
    id,
    label,
    icon,
    count: id === "general" && updateAvailable ? 1 : undefined,
    selected: settingsTab === id,
    onSelect: () => openSettings(id),
  }));

  const groups = useMemo<SidebarThreadGroup[]>(() => {
    const listed = chats.filter((chat) => !chat.dm);
    const topology = listed.map((chat) => ({
      id: chat.id,
      parentChatId: chat.parentChatId,
      bucket: chat.pinned ? "pinned" : "threads",
      state: chat.state,
      serverId: chat.serverId,
      cwd: chat.cwd,
    }));
    const byId = new Map(listed.map((chat) => [chat.id, chat]));
    const resolve = (chat: Chat, aggregate: ChatState): SidebarThread => {
      const workspace = workspaces[workspaceForPath(chat.cwd, workspaces)];
      const server = servers.find((entry) => entry.id === chat.serverId);
      const branch = workspace?.worktrees.find((tree) => tree.path === chat.cwd)?.branch;
      const ticket = tickets.find((entry) => entry.threads.some((link) => link.chatId === chat.id));
      const time = chat.workingSince ? elapsedSince(chat.workingSince, now) : agoLabel(chat.updatedAt, now);
      return {
        key: chat.id,
        id: chat.id,
        signature: [
          chat.title, time, aggregate, chat.pinned, chat.preview, chat.provider, chat.model,
          workspace?.id, workspace?.name, workspace?.icon, workspace?.tint, branch,
          server?.id, server?.name, server?.icon, ticket?.key, ticket?.title,
        ].join("\u0000"),
        title: chat.title,
        time,
        state: aggregate,
        pinned: chat.pinned,
        preview: chat.preview,
        branch: branch ?? undefined,
        provider: chat.provider,
        model: chat.model,
        people: [{ id: "you", label: "You", image: avatar ?? undefined }],
        workspace: workspace
          ? {
              name: workspace.name,
              mark: <WorkspaceMark home={false} workspace={workspace} server={server} size="sm" />,
              onOpen: () => onOpenWorkspace(workspace.id),
            }
          : undefined,
        computer: server ? { name: server.name, icon: server.icon } : undefined,
        ticket: ticket ? { key: ticket.key, title: ticket.title, onOpen: () => onOpenTicket(ticket.key) } : undefined,
        menu: {
          chat,
          onOpenThread: onSelectChat,
          onOpenBeside,
          onOpenWorkspace,
        },
        onSelect: () => onSelectChat(chat.id),
      };
    };

    const built = groupSidebarThreads(topology).map((group) => {
      const limit = group.key === "pinned" ? Number.POSITIVE_INFINITY : limits[group.key] ?? SETTLED_THREAD_BATCH;
      const { visible, hidden } = visibleSidebarThreads(group.threads, selected, limit);
      return {
        key: group.key,
        label: group.key === "pinned" ? "Pinned" : "Recent threads",
        icon: group.key === "pinned" ? Pin : undefined,
        hidden: Math.min(hidden, SETTLED_THREAD_BATCH),
        onRevealMore: hidden > 0 ? () => revealMore(group.key) : undefined,
        threads: visible.flatMap((entry) => {
          const chat = byId.get(entry.id);
          if (!chat) return [];
          const childStates = entry.childIds.flatMap((id) => {
            const child = byId.get(id);
            return child ? [child.state] : [];
          });
          const row = resolve(chat, aggregateThreadState([chat.state, ...childStates]));
          row.children = entry.childIds.flatMap((id) => {
            const child = byId.get(id);
            return child ? [resolve(child, child.state)] : [];
          });
          return [row];
        }),
      } satisfies SidebarThreadGroup;
    });

    if (archived.length > 0) {
      const limit = limits.archived ?? SETTLED_THREAD_BATCH;
      const visible = archived.filter((thread, index) => index < limit || thread.id === selected);
      built.push({
        key: "archived",
        label: "Archived",
        icon: Archive,
        hidden: Math.min(archived.length - visible.length, SETTLED_THREAD_BATCH),
        onRevealMore: archived.length > visible.length ? () => revealMore("archived") : undefined,
        threads: visible.map((thread) => {
          const workspace = workspaces[workspaceForPath(thread.cwd, workspaces)];
          const server = servers.find((entry) => entry.id === thread.serverId);
          const time = agoLabel(thread.archivedAt, now);
          const chat: Chat = { ...thread, state: "idle", updatedAt: thread.archivedAt };
          return {
            key: `${thread.serverId}:${thread.id}`,
            id: thread.id,
            signature: [thread.title, time, workspace?.id, server?.id].join("\u0000"),
            title: thread.title,
            time,
            state: "idle" as ChatState,
            people: [{ id: "you", label: "You", image: avatar ?? undefined }],
            workspace: workspace
              ? { name: workspace.name, mark: <WorkspaceMark home={false} workspace={workspace} server={server} size="sm" /> }
              : undefined,
            computer: server ? { name: server.name, icon: server.icon } : undefined,
            menu: { chat, archive: thread, onOpenThread: onSelectChat },
            onSelect: () => onSelectChat(thread.id),
          } satisfies SidebarThread;
        }),
      });
    }
    return built;
  }, [chats, tickets, workspaces, servers, archived, selected, limits, now, avatar]);

  const footer: SidebarFooterItem[] = [
    ...(view !== "settings" && updateAvailable
      ? [{ label: "Update available", icon: ArrowUpCircle, onSelect: () => openSettings("general") }]
      : []),
    ...(view === "settings"
      ? []
      : [{
          label: "Settings",
          icon: Settings2,
          selected: false,
          onSelect: () => openSettings("general"),
        }]),
  ];

  return {
    account: machine
      ? { label: machine.name, icon: deviceIcon(machine.icon), views: [] }
      : undefined,
    nav: view === "settings" ? settingsNav : nav,
    groups: view === "settings" ? [] : groups,
    footer,
    selected,
    onNewThread: view === "settings" ? undefined : onNewThread,
    back: view === "settings" ? { label: "Back", onSelect: closeSettings } : undefined,
    // Before the first read answers there is nothing to say about the threads
    // yet, and on a machine that has some "No threads yet." is a wrong claim
    // corrected a moment later.
    emptyThreads: stillLooking || archived.length > 0 ? undefined : "No threads yet.",
  };
}

function aggregateThreadState(states: ChatState[]): ChatState {
  if (states.includes("needs_input")) return "needs_input";
  if (states.includes("working")) return "working";
  if (states.includes("error")) return "error";
  return "idle";
}
