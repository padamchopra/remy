import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ArchiveRestore, CornerDownRight, Folder, Inbox, Laptop, MessagesSquare, Plus, SquareKanban, type LucideIcon } from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { useStore } from "../state/store";
import { displayPath } from "../lib/path";
import { workspaceForPath } from "../lib/projects";
import { StateDot } from "./Badge";
import type { Chat } from "../state/types";
import { apiError } from "../lib/api-error";

export type AppSection = "inbox" | "threads" | "board" | "workspaces" | "devices";

const SECTIONS: { id: AppSection; label: string; Icon: LucideIcon }[] = [
  { id: "inbox", label: "Inbox", Icon: Inbox },
  { id: "threads", label: "Threads", Icon: MessagesSquare },
  { id: "workspaces", label: "Workspaces", Icon: Folder },
  { id: "board", label: "Board", Icon: SquareKanban },
  { id: "devices", label: "Devices", Icon: Laptop },
];

export function AppSidebar({
  section,
  threadId,
  onSection,
  onSelectThread,
  onNewThread,
}: {
  section: AppSection;
  threadId?: string;
  onSection: (section: AppSection) => void;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
}) {
  const chats = useStore((s) => s.chats);
  const archived = useStore((s) => s.archived);
  const restoreThread = useStore((s) => s.restoreThread);
  const dms = useStore((s) => s.dms);
  const agents = useStore((s) => s.agents);
  const workspaces = useStore((s) => s.workspaces);
  const servers = useStore((s) => s.servers);
  const threadsUnavailable = useStore((s) => s.threadsUnavailable);
  const needsYou = chats.filter((chat) => chat.state === "needs_input").length;
  // Agents, not conversations: an agent replicated to two Macs is still one row
  // in the Inbox, and a conversation whose agent is not on this board has
  // nothing here to open, so counting either would be a badge you cannot clear.
  const unread = agents.filter((agent) =>
    dms.some((chat) => chat.agentId === agent.id && chat.unread)).length;
  const many = servers.length > 1;
  const ids = new Set(chats.map((chat) => chat.id));
  const roots = chats.filter((chat) => !chat.parentChatId || !ids.has(chat.parentChatId));
  const ordered = roots.flatMap((root) => [root, ...chats.filter((chat) => chat.parentChatId === root.id)]);

  return (
    <View style={styles.wrap}>
      <View style={styles.nav}>
        {SECTIONS.map(({ id, label, Icon }) => {
          const on = section === id;
          return (
            <Pressable
              key={id}
              onPress={() => onSection(id)}
              style={({ pressed }) => [styles.navRow, on && styles.navOn, pressed && styles.pressed]}
            >
              <Icon size={18} color={on ? color.foreground : color.mutedForeground} />
              <Text style={[type.callout, { flex: 1, color: on ? color.foreground : color.mutedForeground }]}>
                {label}
              </Text>
              {id === "inbox" && unread > 0 ? <Text style={styles.badge}>{unread}</Text> : null}
              {id === "threads" && needsYou > 0 ? <Text style={styles.badge}>{needsYou}</Text> : null}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.listHead}>
        <Text style={type.caption}>Threads</Text>
        {chats.length > 0 ? <Text style={type.caption}>{chats.length}</Text> : null}
        <Pressable onPress={onNewThread} hitSlop={8} accessibilityLabel="New thread" style={styles.plus}>
          <Plus size={16} color={color.foreground} />
        </Pressable>
      </View>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {Object.entries(threadsUnavailable).map(([id, reason]) => (
          <Text key={id} style={[type.caption, { paddingHorizontal: 10 }]}>
            {many
              ? `${servers.find((server) => server.id === id)?.name ?? "A Mac"} can't hold threads: ${reason}`
              : `This Mac can't hold threads: ${reason}`}
          </Text>
        ))}
        {chats.length === 0 && Object.keys(threadsUnavailable).length === 0 ? (
          <Text style={[type.caption, { paddingHorizontal: 10 }]}>No threads yet.</Text>
        ) : (
          ordered.map((chat) => (
            <SidebarThread
              key={`${chat.serverId}:${chat.id}`}
              chat={chat}
              active={threadId === chat.id}
              place={
                workspaces[workspaceForPath(chat.cwd, workspaces)]?.name ??
                (many ? servers.find((server) => server.id === chat.serverId)?.name : undefined) ??
                displayPath(chat.cwd)
              }
              onPress={() => onSelectThread(chat.id)}
            />
          ))
        )}
        {archived.length > 0 ? (
          <View style={styles.archiveGroup}>
            <Text style={type.caption}>Archived</Text>
            {archived.map((thread) => (
              <Pressable
                key={`${thread.serverId}:${thread.id}`}
                accessibilityLabel={`Restore ${thread.title}`}
                onPress={() => {
                  void restoreThread(thread.id, thread.serverId)
                    .then((chat) => onSelectThread(chat.id))
                    .catch((error) => Alert.alert("Couldn't restore that thread", apiError(error)));
                }}
                style={({ pressed }) => [styles.archived, pressed && styles.pressed]}
              >
                <ArchiveRestore size={16} color={color.mutedForeground} />
                <Text style={[type.callout, styles.threadTitle]} numberOfLines={1}>{thread.title}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function SidebarThread({
  chat,
  active,
  place,
  onPress,
}: {
  chat: Chat;
  active: boolean;
  place: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.thread, active && styles.threadOn, pressed && styles.pressed]}
    >
      {chat.parentChatId ? (
        <CornerDownRight size={14} color={color.mutedForeground} />
      ) : (
        <StateDot state={chat.state} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.callout, styles.threadTitle]} numberOfLines={1}>
          {chat.title}
        </Text>
        <Text style={type.caption} numberOfLines={1}>
          {place}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.card, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: color.border },
  nav: { padding: space.sm, gap: 2 },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  navOn: { backgroundColor: color.accent },
  pressed: { opacity: 0.85 },
  badge: {
    minWidth: 18,
    textAlign: "center",
    color: color.foreground,
    fontSize: 11,
    fontWeight: "600",
    backgroundColor: color.muted,
    overflow: "hidden",
    borderRadius: 9,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  listHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  plus: {
    marginLeft: "auto",
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.muted,
  },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 6, paddingBottom: 24, gap: 2 },
  archiveGroup: { gap: 2, marginTop: space.lg, paddingHorizontal: 8 },
  archived: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 6,
    borderRadius: radius.md,
  },
  thread: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  threadOn: { backgroundColor: color.accent },
  threadTitle: { fontWeight: "600" },
});
