import { useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SquareKanban } from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { BOARD_COLUMNS, STATUS_LABEL, byRank, subTicketProgress, topLevel } from "../lib/tickets";
import { useStore } from "../state/store";
import { EmptyState } from "../components/Empty";
import { Button } from "../components/Button";
import type { Ticket } from "../state/types";

export function BoardScreen({
  onOpen,
  onCompose,
}: {
  onOpen: (key: string) => void;
  onCompose: () => void;
}) {
  const tickets = useStore((s) => s.tickets);
  const projects = useStore((s) => s.projects);
  const loading = useStore((s) => s.boardLoading);
  const loadBoard = useStore((s) => s.loadBoard);
  const anyOnline = useStore((s) => s.servers.some((server) => server.online));
  // A sub-ticket belongs on its parent, where its progress is already counted.
  const open = topLevel(tickets).filter((ticket) => ticket.status !== "cancelled");

  useEffect(() => {
    if (anyOnline) void loadBoard().catch(() => {});
  }, [anyOnline, loadBoard]);

  if (!loading && open.length === 0) {
    return (
      <View style={styles.wrap}>
        <EmptyState
          icon={<SquareKanban size={22} color={color.mutedForeground} />}
          title={projects.length === 0 ? "No projects yet" : "Nothing on the board"}
          detail={
            projects.length === 0
              ? "Add a folder on a Mac to plan work in it."
              : "Write the first ticket."
          }
          action={projects.length > 0 ? <Button label="New ticket" onPress={onCompose} /> : undefined}
        />
      </View>
    );
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      {BOARD_COLUMNS.map((status) => {
        const column = open.filter((ticket) => ticket.status === status).sort(byRank);
        if (column.length === 0) return null;
        return (
          <View key={status} style={styles.column}>
            <Text style={type.caption}>{STATUS_LABEL[status]}</Text>
            {column.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                progress={subTicketProgress(tickets, ticket)}
                onPress={() => onOpen(ticket.key)}
              />
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

function TicketCard({
  ticket,
  progress,
  onPress,
}: {
  ticket: Ticket;
  progress: { done: number; total: number };
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { backgroundColor: color.accent }]}>
      <Text style={type.caption}>
        {progress.total > 0 ? `${ticket.key} · ${progress.done}/${progress.total}` : ticket.key}
      </Text>
      <Text style={type.callout}>{ticket.title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.background },
  content: { padding: space.lg, gap: space.lg, paddingBottom: 40 },
  column: { gap: 8 },
  card: {
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: 12,
    gap: 4,
  },
});
