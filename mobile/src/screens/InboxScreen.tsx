import { useEffect, useState } from "react";
import { Bot, Repeat, SlidersHorizontal } from "lucide-react-native";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "../theme";
import { agentConversation } from "../lib/inbox";
import { plainText } from "../lib/path";
import { cadenceSummary } from "../lib/routines";
import { useDevicePreferenceOrder, useStore } from "../state/store";
import { apiError } from "../lib/api-error";
import { AgentMark } from "../components/AgentMark";
import { Button } from "../components/Button";
import { EmptyState } from "../components/Empty";
import { StateBadge } from "../components/Badge";
import type { Agent, Chat, Routine } from "../state/types";

/// The inbox: one conversation per agent, on whichever Mac holds it.
///
/// Everything about an agent lives here rather than in a settings pane, because
/// an agent is somebody you talk to. Tapping a row opens the conversation; its
/// own screen — name, instructions, what it thinks with, its routines — opens
/// on top from the row's settings control.
export function InboxScreen({
  onOpen,
  onSettings,
}: {
  onOpen: (agentId: string) => void;
  onSettings: (agentId: string) => void;
}) {
  const agents = useStore((s) => s.agents);
  const dms = useStore((s) => s.dms);
  const servers = useStore((s) => s.servers);
  const routines = useStore((s) => s.routines);
  const missing = useStore((s) => s.missing);
  const deviceOrder = useDevicePreferenceOrder();
  const loading = useStore((s) => s.loading);
  const boardLoading = useStore((s) => s.boardLoading);
  const error = useStore((s) => s.error);
  const refresh = useStore((s) => s.refresh);
  const loadBoard = useStore((s) => s.loadBoard);
  const saveAgent = useStore((s) => s.saveAgent);
  const [creating, setCreating] = useState(false);
  const named = servers.length > 1;

  // A new agent starts as a blank somebody. Everything about it is on its own
  // screen, so that is where you land.
  const create = async () => {
    setCreating(true);
    try {
      const agent = await saveAgent(undefined, { name: "New agent" });
      onSettings(agent.id);
    } catch (caught) {
      Alert.alert("Couldn't add an agent", apiError(caught));
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    void loadBoard().catch(() => {
      // A Mac that cannot answer already shows as offline.
    });
  }, [loadBoard]);

  // Remy leads; the rest keep the order they were written in.
  const roster = [...agents].sort((a, b) => Number(b.builtIn ?? false) - Number(a.builtIn ?? false));

  const reload = async () => {
    await refresh();
    await loadBoard().catch(() => {});
  };

  if (!loading && !boardLoading && roster.length === 0) {
    return (
      <View style={styles.wrap}>
        <EmptyState
          icon={<Bot size={22} color={color.mutedForeground} />}
          title={error ? (named ? "Can't reach your Macs" : "Can't reach this Mac") : "No agents yet"}
          detail={error ?? "Write one to hand work to, then talk to it here."}
          action={error ? undefined : <Button label="Add an agent" busy={creating} onPress={() => void create()} />}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => void reload()} tintColor={color.foreground} />
      }
    >
      {roster.map((agent) => (
        <AgentRow
          key={`${agent.serverId}:${agent.id}`}
          agent={agent}
          dm={agentConversation(agent.id, dms, servers, deviceOrder)}
          machine={named ? servers.find((server) => server.id === agent.serverId)?.name : undefined}
          routines={routines.filter((routine) => routine.agentId === agent.id)}
          routinesUnknown={missing[agent.serverId]?.includes("routines") === true}
          onPress={() => onOpen(agent.id)}
          onSettings={() => onSettings(agent.id)}
        />
      ))}
      <Button label="Add an agent" variant="outline" busy={creating} onPress={() => void create()} />
    </ScrollView>
  );
}

function AgentRow({
  agent,
  dm,
  machine,
  routines,
  routinesUnknown,
  onPress,
  onSettings,
}: {
  agent: Agent;
  dm?: Chat;
  machine?: string;
  routines: Routine[];
  /// True when the Mac holding this agent is too old to have routines at all,
  /// which is not the same as the agent having none.
  routinesUnknown: boolean;
  onPress: () => void;
  onSettings: () => void;
}) {
  const preview = dm?.preview ? plainText(dm.preview) : agent.role;
  const next = routines.filter((routine) => routine.enabled).sort((a, b) => a.nextRunAt - b.nextRunAt)[0];

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.header}>
        <AgentMark agent={agent} size={22} />
        <Text style={[type.callout, styles.title, dm?.unread && styles.strong]} numberOfLines={1}>
          {agent.name}
        </Text>
        {dm?.state === "working" ? <StateBadge state="working" /> : dm?.unread ? <View style={styles.dot} /> : null}
        {/* Its own 44pt target, and it has to beat the row it sits inside: a
            press that reaches the card instead opens the conversation, which is
            the opposite of what was asked for. */}
        <Pressable
          onPress={onSettings}
          onStartShouldSetResponder={() => true}
          accessibilityLabel={`${agent.name} settings`}
          style={({ pressed }) => [styles.settings, pressed && styles.settingsOn]}
        >
          <SlidersHorizontal size={18} color={color.foreground} />
        </Pressable>
      </View>
      {preview ? (
        <Text style={[styles.preview, dm?.unread && styles.strong]} numberOfLines={2}>
          {preview}
        </Text>
      ) : null}
      <Text style={type.mono} numberOfLines={1}>
        {machine ? `${machine} · @${agent.handle}` : `@${agent.handle}`}
      </Text>
      {routinesUnknown ? (
        <View style={styles.routine}>
          <Repeat size={12} color={color.mutedForeground} />
          <Text style={type.caption} numberOfLines={1}>
            Routines need a newer Remy on {machine ?? "this Mac"}.
          </Text>
        </View>
      ) : next ? (
        <View style={styles.routine}>
          <Repeat size={12} color={color.mutedForeground} />
          <Text style={type.caption} numberOfLines={1}>
            {`${next.name} · ${cadenceSummary(next)}`}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.background },
  content: { padding: space.lg, gap: space.md, paddingBottom: 40 },
  row: {
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: space.md,
    gap: 6,
  },
  pressed: { opacity: 0.7 },
  header: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { flex: 1, color: color.foreground },
  strong: { color: color.foreground, fontWeight: "600" },
  preview: { ...type.caption, color: color.mutedForeground },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.primary },
  routine: { flexDirection: "row", alignItems: "center", gap: 6 },
  settings: {
    width: 44,
    height: 44,
    marginRight: -10,
    marginVertical: -12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  settingsOn: { backgroundColor: color.accent },
});
