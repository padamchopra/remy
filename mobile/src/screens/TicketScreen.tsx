import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { color, radius, space, type } from "../theme";
import { apiError } from "../lib/api-error";
import { DERIVED_STATUSES, STATUS_LABEL, TICKET_STATUSES, byRank } from "../lib/tickets";
import { useStore } from "../state/store";
import { Button } from "../components/Button";
import { EmptyState } from "../components/Empty";
import type { TicketActivity } from "../state/types";

export function TicketScreen({ ticketKey, onOpenThread }: { ticketKey: string; onOpenThread: (id: string) => void }) {
  const ticket = useStore((s) => s.tickets.find((entry) => entry.key === ticketKey));
  const loadBoard = useStore((s) => s.loadBoard);
  const moveTicket = useStore((s) => s.moveTicket);
  const commentOnTicket = useStore((s) => s.commentOnTicket);
  const ticketActivity = useStore((s) => s.ticketActivity);
  const chats = useStore((s) => s.chats);
  const agents = useStore((s) => s.agents);
  const tickets = useStore((s) => s.tickets);
  const servers = useStore((s) => s.servers);
  const boardDevices = useStore((s) => s.boardDevices);
  const [body, setBody] = useState("");
  const [activity, setActivity] = useState<TicketActivity[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!ticket) void loadBoard().catch(() => {});
  }, [ticket, loadBoard]);

  useEffect(() => {
    if (!ticket) return;
    void ticketActivity(ticket.id).then(setActivity).catch(() => {});
  }, [ticket, ticketActivity]);

  if (!ticket) {
    return (
      <View style={styles.wrap}>
        <EmptyState title="No such ticket" detail={`${ticketKey} is not on this board.`} />
      </View>
    );
  }

  const children = tickets.filter((entry) => entry.parentId === ticket.id).sort(byRank);
  const assignee = ticket.assigneeAgentId === "you" || !ticket.assigneeAgentId
    ? "You"
    : ticket.assigneeAgentId === "workspace"
      ? "Workspace agent"
      : agents.find((entry) => entry.id === ticket.assigneeAgentId)?.name ?? "An agent on another Mac";
  // `deviceId` is the durable answer and survives replication; the Mac that
  // answered with the ticket is the fallback for a board written before it.
  const deviceMatch = ticket.deviceId
    ? boardDevices.find((entry) => entry.deviceId === ticket.deviceId)
    : undefined;
  const device = servers.find((entry) => entry.id === (deviceMatch ? deviceMatch.serverId : ticket.serverId));

  const comment = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    try {
      await commentOnTicket(ticket.id, trimmed);
      setBody("");
      setActivity(await ticketActivity(ticket.id));
    } catch (caught) {
      setError(apiError(caught));
    }
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <Text style={type.caption}>{ticket.key}</Text>
      <Text style={type.title}>{ticket.title}</Text>
      {ticket.body ? <Text style={type.body}>{ticket.body}</Text> : null}
      <Text style={type.caption}>
        {`${assignee} · ${device?.name ?? "No device"}`}
      </Text>
      <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
        {TICKET_STATUSES.map((status) => (
          <Pressable
            key={status}
            onPress={() => void moveTicket(ticket.id, status)}
            style={[styles.chip, ticket.status === status && styles.chipOn]}
          >
            <Text style={[styles.chipLabel, ticket.status === status && { color: color.primaryForeground }]}>
              {STATUS_LABEL[status]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {DERIVED_STATUSES.includes(ticket.status) ? (
        <Text style={type.caption}>Remy sets this one by watching the thread.</Text>
      ) : null}
      {children.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={type.caption}>Sub-tickets</Text>
          {children.map((child) => (
            <View key={child.id} style={styles.link}>
              <Text style={type.caption}>{`${child.key} · ${STATUS_LABEL[child.status]}`}</Text>
              <Text style={type.callout}>{child.title}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {ticket.threads.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={type.caption}>Threads</Text>
          {ticket.threads.map((link) => {
            const thread = chats.find((entry) => entry.id === link.chatId);
            const runner = link.agentId
              ? agents.find((entry) => entry.id === link.agentId)?.name
              : undefined;
            // A thread on a Mac that is not answering still has a name, but
            // there is nothing here to open.
            if (!thread) {
              return (
                <View key={link.chatId} style={styles.link}>
                  <Text style={type.callout}>
                    {runner ? `${runner}'s thread is on another Mac` : "That thread is on another Mac"}
                  </Text>
                </View>
              );
            }
            return (
              <Pressable key={link.chatId} onPress={() => onOpenThread(link.chatId)} style={styles.link}>
                <Text style={type.callout} numberOfLines={1}>{thread.title}</Text>
                <Text style={type.caption} numberOfLines={1}>
                  {runner ? `${runner} · ${link.stage ?? STATUS_LABEL[ticket.status]}` : link.stage ?? "You attached this"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {activity.map((item) => (
        <View key={item.id} style={styles.event}>
          <Text style={type.caption}>
            {item.actor} · {item.kind}
            {item.editedAt ? " · edited" : ""}
          </Text>
          {item.body ? <Text style={type.callout}>{item.body}</Text> : null}
        </View>
      ))}
      {error ? <Text style={{ color: color.destructive }}>{error}</Text> : null}
      <TextInput
        value={body}
        onChangeText={setBody}
        placeholder="Comment on this ticket"
        placeholderTextColor={color.mutedForeground}
        style={styles.input}
        multiline
      />
      <Button label="Add comment" disabled={!body.trim()} onPress={() => void comment()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.background },
  content: { padding: space.lg, gap: space.md, paddingBottom: 40 },
  chip: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: color.card,
  },
  chipOn: { backgroundColor: color.primary, borderColor: color.primary },
  chipLabel: { fontSize: 13, color: color.foreground },
  link: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: 12,
    gap: 4,
    backgroundColor: color.card,
  },
  event: { gap: 4 },
  input: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.card,
    borderRadius: radius.lg,
    padding: 12,
    minHeight: 72,
    color: color.foreground,
  },
});
