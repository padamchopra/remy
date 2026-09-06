import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CircleSlash, SquareKanban } from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { BOARD_COLUMNS, STATUS_LABEL, byRank, neighboursAt, subTicketProgress, topLevel } from "../lib/tickets";
import { useStore } from "../state/store";
import { EmptyState } from "../components/Empty";
import { Button } from "../components/Button";
import { StateDot } from "../components/Badge";
import { apiError } from "../lib/api-error";
import type { ChatState, Ticket, TicketStatus } from "../state/types";

const ALL = "all";

export function BoardScreen({ onOpen, onCompose }: { onOpen: (key: string) => void; onCompose: () => void }) {
  const tickets = useStore((s) => s.tickets);
  const projects = useStore((s) => s.projects);
  const chats = useStore((s) => s.chats);
  const agents = useStore((s) => s.agents);
  const servers = useStore((s) => s.servers);
  const boardDevices = useStore((s) => s.boardDevices);
  const unavailable = useStore((s) => s.boardUnavailable);
  const loading = useStore((s) => s.boardLoading);
  const loadBoard = useStore((s) => s.loadBoard);
  const moveTicket = useStore((s) => s.moveTicket);
  const [scope, setScope] = useState(ALL);
  const [showCancelled, setShowCancelled] = useState(false);
  const online = servers.filter((server) => server.online && !server.cloud).length;
  const partial = Object.keys(unavailable).length > 0 && online > 0;

  useEffect(() => {
    if (online > 0) void loadBoard().catch(() => {});
  }, [online, loadBoard]);

  useEffect(() => {
    if (scope !== ALL && !projects.some((project) => project.id === scope)) setScope(ALL);
  }, [projects, scope]);

  const scoped = useMemo(
    () => scope === ALL ? tickets : tickets.filter((ticket) => ticket.projectId === scope),
    [scope, tickets],
  );
  const open = topLevel(scoped).filter((ticket) => ticket.status !== "cancelled");
  const cancelled = topLevel(scoped).filter((ticket) => ticket.status === "cancelled").sort(byRank);

  const move = async (ticket: Ticket, status: TicketStatus, index: number) => {
    const { before, after } = neighboursAt(scoped, status, index, ticket.id);
    try {
      await moveTicket(ticket.id, status, before, after);
    } catch (caught) {
      Alert.alert("Couldn't move that ticket", apiError(caught));
    }
  };

  if (loading && tickets.length === 0) {
    return <View style={styles.wrap}><EmptyState icon={<SquareKanban size={22} color={color.mutedForeground} />} title="Reading the board…" detail="Your tickets will appear here." /></View>;
  }

  if (online === 0 && tickets.length === 0) {
    return (
      <View style={styles.wrap}>
        <EmptyState
          icon={<CircleSlash size={22} color={color.mutedForeground} />}
          title="The board is offline"
          detail="Connect one of your computers and try again."
          action={<Button label="Try again" onPress={() => void loadBoard().catch(() => {})} />}
        />
      </View>
    );
  }

  if (projects.length === 0 && open.length === 0) {
    return (
      <View style={styles.wrap}>
        <EmptyState
          icon={<SquareKanban size={22} color={color.mutedForeground} />}
          title="No workspaces yet"
          detail="Add a folder on a computer to plan work in it."
        />
      </View>
    );
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      {partial ? (
        <View style={styles.notice}>
          <Text style={type.callout}>Some computers are unavailable.</Text>
          <Text style={type.caption}>The board keeps the latest work they shared.</Text>
        </View>
      ) : online === 0 ? (
        <View style={styles.notice}>
          <Text style={type.callout}>You're offline.</Text>
          <Text style={type.caption}>This is the latest board saved on your phone.</Text>
        </View>
      ) : null}

      {projects.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scopes}>
          <ScopeChip label="All workspaces" selected={scope === ALL} onPress={() => setScope(ALL)} />
          {projects.map((project) => (
            <ScopeChip key={project.id} label={project.name} selected={scope === project.id} onPress={() => setScope(project.id)} />
          ))}
        </ScrollView>
      ) : null}

      {open.length === 0 ? (
        <View style={styles.emptyBoard}>
          <Text style={type.heading}>Nothing on this board</Text>
          <Text style={type.caption}>Write the first ticket for this workspace.</Text>
          <Button label="New ticket" onPress={onCompose} />
        </View>
      ) : null}

      {BOARD_COLUMNS.map((status, columnIndex) => {
        const column = open.filter((ticket) => ticket.status === status).sort(byRank);
        return (
          <View key={status} style={styles.column}>
            <View style={styles.columnHead}>
              <Text style={type.caption}>{STATUS_LABEL[status]}</Text>
              <Text style={type.caption}>{column.length}</Text>
            </View>
            {column.length === 0 ? <Text style={styles.emptyColumn}>No tickets here.</Text> : null}
            {column.map((ticket, index) => {
              const link = ticket.threads.at(-1);
              const thread = link ? chats.find((chat) => chat.id === link.chatId) : undefined;
              const actor = ticket.assigneeAgentId === "workspace"
                ? "Workspace agent"
                : ticket.assigneeAgentId === "you" || !ticket.assigneeAgentId
                  ? "You"
                  : agents.find((agent) => agent.id === ticket.assigneeAgentId)?.name ?? "Unavailable agent";
              const deviceId = ticket.deviceId
                ? boardDevices.find((entry) => entry.deviceId === ticket.deviceId)?.serverId
                : ticket.serverId;
              const device = servers.find((server) => server.id === deviceId);
              return (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  progress={subTicketProgress(scoped, ticket)}
                  actor={actor}
                  device={device?.name ?? "Unavailable computer"}
                  threadState={thread?.state}
                  onPress={() => onOpen(ticket.key)}
                  onUp={index > 0 ? () => void move(ticket, status, index - 1) : undefined}
                  onDown={index < column.length - 1 ? () => void move(ticket, status, index + 1) : undefined}
                  onLeft={columnIndex > 0 ? () => void move(ticket, BOARD_COLUMNS[columnIndex - 1], 0) : undefined}
                  onRight={columnIndex < BOARD_COLUMNS.length - 1
                    ? () => void move(ticket, BOARD_COLUMNS[columnIndex + 1], 0)
                    : undefined}
                />
              );
            })}
          </View>
        );
      })}

      {cancelled.length > 0 ? (
        <View style={styles.column}>
          <Pressable onPress={() => setShowCancelled((shown) => !shown)} style={styles.columnHead}>
            <Text style={type.caption}>Cancelled</Text>
            <Text style={type.caption}>{showCancelled ? "Hide" : `${cancelled.length} · Show`}</Text>
          </Pressable>
          {showCancelled ? cancelled.map((ticket) => (
            <Pressable key={ticket.id} onPress={() => onOpen(ticket.key)} style={styles.cancelledCard}>
              <Text style={type.caption}>{ticket.key}</Text>
              <Text style={type.callout}>{ticket.title}</Text>
            </Pressable>
          )) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function ScopeChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.scope, selected && styles.scopeOn]}>
      <Text style={[styles.scopeLabel, selected && { color: color.primaryForeground }]}>{label}</Text>
    </Pressable>
  );
}

function TicketCard({
  ticket, progress, actor, device, threadState, onPress, onUp, onDown, onLeft, onRight,
}: {
  ticket: Ticket;
  progress: { done: number; total: number };
  actor: string;
  device: string;
  threadState?: ChatState;
  onPress: () => void;
  onUp?: () => void;
  onDown?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
}) {
  return (
    <View style={styles.card}>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.cardBody, pressed && { opacity: 0.75 }]}>
        <View style={styles.cardMeta}>
          <Text style={type.caption}>{ticket.key}</Text>
          {ticket.priority > 0 ? <Text style={styles.priority}>{`P${ticket.priority}`}</Text> : null}
          {threadState && threadState !== "idle" ? <StateDot state={threadState} /> : null}
        </View>
        <Text style={type.callout}>{ticket.title}</Text>
        {progress.total > 0 ? <Text style={type.caption}>{`${progress.done} of ${progress.total} sub-tickets complete`}</Text> : null}
        <Text style={type.caption} numberOfLines={1}>{`${actor} · ${device}`}</Text>
      </Pressable>
      <View style={styles.moveRow}>
        <MoveButton label="Move left" icon={ArrowLeft} onPress={onLeft} />
        <MoveButton label="Move up" icon={ArrowUp} onPress={onUp} />
        <MoveButton label="Move down" icon={ArrowDown} onPress={onDown} />
        <MoveButton label="Move right" icon={ArrowRight} onPress={onRight} />
      </View>
    </View>
  );
}

function MoveButton({ label, icon: Icon, onPress }: { label: string; icon: typeof ArrowUp; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.move, !onPress && styles.disabled, pressed && styles.pressed]}
    >
      <Icon size={15} color={color.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.background },
  content: { padding: space.lg, gap: space.lg, paddingBottom: 40 },
  notice: { borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: 12, gap: 3 },
  scopes: { gap: 8 },
  scope: { borderWidth: 1, borderColor: color.border, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 7 },
  scopeOn: { backgroundColor: color.primary, borderColor: color.primary },
  scopeLabel: { fontSize: 13, color: color.foreground },
  emptyBoard: { alignItems: "center", gap: space.sm, paddingVertical: space.xl },
  column: { gap: 8 },
  columnHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 28 },
  emptyColumn: { ...type.caption, borderWidth: 1, borderStyle: "dashed", borderColor: color.border, borderRadius: radius.lg, padding: 12 },
  card: { backgroundColor: color.card, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, overflow: "hidden" },
  cardBody: { padding: 12, gap: 5 },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 7 },
  priority: { marginLeft: "auto", color: color.mutedForeground, fontSize: 11, fontWeight: "700" },
  moveRow: { flexDirection: "row", justifyContent: "flex-end", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border },
  move: { width: 42, minHeight: 36, alignItems: "center", justifyContent: "center", borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: color.border },
  disabled: { opacity: 0.22 },
  pressed: { backgroundColor: color.accent },
  cancelledCard: { backgroundColor: color.card, borderRadius: radius.lg, padding: 12, gap: 4, opacity: 0.7 },
});
