import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { Pencil, Play, Plus, Repeat } from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { apiError } from "../lib/api-error";
import {
  AGENT_AVATAR_EXPRESSIONS,
  AGENT_AVATAR_SHAPES,
  AGENT_AVATAR_TONES,
  agentAvatarConfig,
  encodeAgentAvatar,
  type AgentAvatarConfig,
} from "../lib/agent-avatar";
import { cadenceSummary, whenLast, whenNext } from "../lib/routines";
import { useProviders, useServerSettings, useStore, useSupportsEffort } from "../state/store";
import type { Agent, Routine } from "../state/types";
import { AgentMark } from "../components/AgentMark";
import { Button } from "../components/Button";
import { EmptyState } from "../components/Empty";
import { ChoiceField, Field, Section, SwitchField, TextField } from "../components/Field";
import { ModelPicker, REMY_DEFAULT } from "../components/ModelPicker";

/// Everything about an agent, on the phone.
///
/// The roster lives in the Inbox rather than in Settings — an agent is somebody
/// you talk to — and this is that agent's own screen, pushed on top so a long
/// form gets the whole width without the thread list going anywhere. Everything
/// saves as you go: choices on change, text when you leave the field.

/// Two, because an agent that stops for permission on every edit is an agent
/// you have to sit with, which is not what one is for.
const PERMISSIONS = [
  { value: "auto", label: "Auto", detail: "Reads and writes on its own. Stops for anything it cannot undo." },
  { value: "bypassPermissions", label: "Bypass", detail: "Never stops to ask, including for commands that destroy work." },
] as const;

const IDENTITIES = [
  { value: REMY_DEFAULT, label: "Remy default", detail: "Follows the choice on this Mac." },
  { value: "off", label: "You", detail: "Commits carry your name." },
  { value: "author", label: "Agent", detail: "The agent is the author; you remain the committer." },
] as const;

export function AgentScreen({
  agentId,
  onOpenRoutine,
  onDeleted,
}: {
  agentId: string;
  onOpenRoutine: (routineId: string) => void;
  onDeleted: () => void;
}) {
  const agent = useStore((s) => s.agents.find((entry) => entry.id === agentId));
  const agents = useStore((s) => s.agents);
  const servers = useStore((s) => s.servers);
  const saveAgent = useStore((s) => s.saveAgent);
  const deleteAgent = useStore((s) => s.deleteAgent);
  const settings = useServerSettings(agent?.serverId);
  const providers = useProviders(agent?.serverId);
  const effortSupported = useSupportsEffort(agent?.serverId);
  const routinesUnknown = useStore((s) =>
    agent ? s.missing[agent.serverId]?.includes("routines") === true : false);
  const routines = useStore((s) => s.routines).filter((routine) => routine.agentId === agentId);
  const [error, setError] = useState<string>();

  if (!agent) {
    return (
      <View style={styles.wrap}>
        <EmptyState title="That agent is gone" detail="It was deleted on the Mac that held it." />
      </View>
    );
  }

  const save = async (patch: Record<string, unknown>, what: string) => {
    setError(undefined);
    try {
      await saveAgent(agent.id, patch);
    } catch (caught) {
      setError(`Couldn't change ${what}. ${apiError(caught)}`);
    }
  };

  // Remy answers for the app itself, so who it is comes with the version you
  // are running. What is left is what a preference actually is: what it thinks
  // with and what it may do unasked.
  const locked = agent.builtIn === true;
  const machine = servers.length > 1
    ? servers.find((server) => server.id === agent.serverId)?.name
    : undefined;
  const identity = agent.gitIdentity;
  const resolvedIdentity = identity === REMY_DEFAULT ? settings?.defaultGitIdentity ?? "off" : identity;
  const others = agents.filter((other) => other.id !== agent.id && !other.builtIn);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <AgentMark agent={agent} size={44} />
        <View style={styles.headerText}>
          <Text style={type.title} numberOfLines={1}>{agent.name}</Text>
          <Text style={type.mono} numberOfLines={1}>
            {machine ? `${machine} · @${agent.handle}` : `@${agent.handle}`}
          </Text>
        </View>
      </View>
      {locked ? (
        <Text style={type.caption}>Remy comes with the app. Pick what it thinks with; the rest is ours.</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!locked ? (
        <>
          <TextField
            label="Name"
            value={agent.name}
            onCommit={(name) => void save({ name }, "the name")}
          />
          <TextField
            label="Role"
            description="One line, shown under the name."
            value={agent.role ?? ""}
            placeholder="Implements the ticket in its own worktree"
            onCommit={(role) => void save({ role }, "the role")}
          />
          <TextField
            label="Handle"
            description="What another agent hands a ticket to, and what the CLI will take."
            value={agent.handle}
            mono
            onCommit={(handle) => void save({ handle }, "the handle")}
          />
          <FaceField agent={agent} onChange={(avatar) => void save({ avatar }, "the face")} />
        </>
      ) : null}

      <Section title="How it works">
        <Field label="Thinks with">
          <ModelPicker
            providers={providers}
            allowDefault
            defaultChoice={{
              provider: settings?.defaultProvider ?? "claude",
              model: settings?.defaultModel ?? "",
              effort: settings?.defaultEffort ?? "",
            }}
            value={{ provider: agent.provider || REMY_DEFAULT, model: agent.model ?? "", effort: agent.effort ?? "" }}
            effortUnavailable={!effortSupported}
            style={styles.picker}
            onPick={(next) => void save(
              {
                provider: next.provider,
                model: next.model,
                ...(effortSupported ? { effort: next.effort ?? "" } : {}),
              },
              "what it thinks with",
            )}
          />
        </Field>
        <ChoiceField
          label="Permission mode"
          value={agent.permissionMode === "bypassPermissions" ? "bypassPermissions" : "auto"}
          options={PERMISSIONS}
          onChange={(next) => void save({ permissionMode: next }, "what it may do unasked")}
        />
        {!locked ? (
          <SwitchField
            label="Start unattended"
            description="Lets the board run this agent when a ticket reaches Todo."
            value={agent.autoStart}
            onChange={(next) => void save({ autoStart: next }, "whether it starts unattended")}
          />
        ) : null}
      </Section>

      <Section title="Routines">
        <Text style={type.caption}>
          {routinesUnknown
            ? `Routines need a newer Remy on ${machine ?? "this Mac"}.`
            : `Ask ${agent.name} in Inbox to create work that repeats.`}
        </Text>
        {!routinesUnknown && routines.length === 0 ? (
          <Text style={type.caption}>No routines yet.</Text>
        ) : (
          routines.map((routine) => (
            <RoutineRow key={routine.id} routine={routine} onEdit={() => onOpenRoutine(routine.id)} />
          ))
        )}
      </Section>

      {!locked ? (
        <>
          <Section title="Instructions">
            <TextField
              label="Instructions"
              description="Added to the agent's own, not swapped for them."
              value={agent.instructions}
              placeholder="How this agent works, in the second person."
              lines={10}
              onCommit={(instructions) => void save({ instructions }, "the instructions")}
            />
          </Section>

          <Section title="Commits">
            <ChoiceField
              label="Commit attribution"
              value={identity}
              options={IDENTITIES}
              onChange={(next) => void save({ gitIdentity: next }, "who its commits credit")}
            />
            {resolvedIdentity !== "off" ? (
              <TextField
                label="Name on commits"
                description={agent.gitEmail
                  ? `Remy pairs it with ${agent.gitEmail}; .invalid is reserved and cannot receive mail.`
                  : undefined}
                value={agent.gitName ?? ""}
                placeholder={agent.name}
                onCommit={(gitName) => void save({ gitName }, "the name on its commits")}
              />
            ) : null}
          </Section>

          {others.length > 0 ? (
            <Section title="Handoff">
              <Field
                label="May hand a ticket to"
                description="It can pass work to nobody else unless you pick someone."
              >
                <View style={styles.handoff}>
                  {others.map((other) => {
                    const on = agent.handoffTo.includes(other.handle);
                    return (
                      <Pressable
                        key={other.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        onPress={() => void save(
                          {
                            handoffTo: on
                              ? agent.handoffTo.filter((handle) => handle !== other.handle)
                              : [...agent.handoffTo, other.handle],
                          },
                          "who it may hand a ticket to",
                        )}
                        style={[styles.chip, on && styles.chipOn]}
                      >
                        <Text style={[styles.chipLabel, on && { color: color.primaryForeground }]}>
                          @{other.handle}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Field>
            </Section>
          ) : null}

          <View style={styles.danger}>
            <Text style={type.callout}>Delete {agent.name}</Text>
            <Text style={type.caption}>
              Threads it already started keep running. Tickets assigned to it lose their assignee.
            </Text>
            <Button
              label="Delete agent"
              variant="ghost"
              onPress={() =>
                Alert.alert(`Delete ${agent.name}?`, "Its conversation goes with it.", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => void deleteAgent(agent.id)
                      .then(onDeleted)
                      .catch((caught) => setError(apiError(caught))),
                  },
                ])
              }
            />
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

function RoutineRow({ routine, onEdit }: { routine: Routine; onEdit: () => void }) {
  const runRoutine = useStore((s) => s.runRoutine);
  const saveRoutine = useStore((s) => s.saveRoutine);
  const [busy, setBusy] = useState(false);

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
    } catch (caught) {
      Alert.alert("Couldn't change that routine", apiError(caught));
    } finally {
      setBusy(false);
    }
  };

  // The schedule gets the full width and the actions get their own row: sharing
  // one line clipped "due tomorrow" and "paused", which is the half of the
  // sentence worth reading.
  return (
    <View style={styles.routine}>
      <View style={styles.routineHead}>
        <Repeat size={14} color={color.mutedForeground} />
        <View style={styles.routineText}>
          <Text style={type.callout} numberOfLines={1}>{routine.name}</Text>
          <Text style={type.caption} numberOfLines={2}>
            {routine.enabled
              ? `${cadenceSummary(routine)} · due ${whenNext(routine.nextRunAt)}`
              : `${cadenceSummary(routine)} · paused`}
          </Text>
          <Text style={[type.caption, routine.lastError ? styles.routineError : undefined]} numberOfLines={3}>
            {routine.lastRunAt ? `Last run: ${whenLast(routine.lastRunAt)}` : "It has not run yet."}
            {routine.lastError ? ` · ${routine.lastError}` : ""}
          </Text>
        </View>
      </View>
      <View style={styles.routineActions}>
        <Pressable
          onPress={() => void act(() => saveRoutine(routine.id, { enabled: !routine.enabled }))}
          disabled={busy}
          accessibilityLabel={routine.enabled ? `Pause ${routine.name}` : `Resume ${routine.name}`}
          style={({ pressed }) => [styles.routineAction, pressed && styles.routineActionOn]}
        >
          <Text style={styles.routineActionLabel}>{routine.enabled ? "Pause" : "Resume"}</Text>
        </Pressable>
        <Pressable
          onPress={() => void act(() => runRoutine(routine.id))}
          disabled={busy}
          accessibilityLabel={`Run ${routine.name} now`}
          style={({ pressed }) => [styles.routineAction, pressed && styles.routineActionOn]}
        >
          <Play size={14} color={color.foreground} />
          <Text style={styles.routineActionLabel}>Run now</Text>
        </Pressable>
        <Pressable
          onPress={onEdit}
          accessibilityLabel={`Edit ${routine.name}`}
          style={({ pressed }) => [styles.routineAction, pressed && styles.routineActionOn]}
          data-link
        >
          <Pencil size={14} color={color.foreground} />
          <Text style={styles.routineActionLabel}>Edit</Text>
        </Pressable>
      </View>
    </View>
  );
}

/// An agent's face is generated, not uploaded: its seed stays fixed while its
/// visible traits are adjusted, so every device can draw the same result.
function FaceField({ agent, onChange }: { agent: Agent; onChange: (avatar: string) => void }) {
  const [config, setConfig] = useState(() => agentAvatarConfig(agent));

  useEffect(() => {
    setConfig(agentAvatarConfig(agent));
  }, [agent.avatar, agent.id, agent.tint]);

  const save = (patch: Partial<AgentAvatarConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    onChange(encodeAgentAvatar(next));
  };

  const preview = { ...agent, avatar: encodeAgentAvatar(config), builtIn: false };

  return (
    <Field label="Face" description="Generated from the agent, so the same one is the same face everywhere.">
      <View style={styles.facePreview}>
        <AgentMark agent={preview} size={88} />
      </View>
      <Text style={styles.faceLabel}>Shape</Text>
      <View style={styles.faces}>
        {AGENT_AVATAR_SHAPES.map((shape) => {
          const on = config.shape === shape.value;
          return (
            <Pressable
              key={shape.value}
              onPress={() => save({ shape: shape.value })}
              accessibilityLabel={shape.label}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.face, on && styles.faceOn]}
            >
              <AgentMark
                agent={{ ...agent, avatar: encodeAgentAvatar({ ...config, shape: shape.value }), builtIn: false }}
                size={32}
              />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.faceLabelRow}>
        <Text style={styles.faceLabel}>Colour</Text>
        <Text style={type.mono}>{config.hue}°</Text>
      </View>
      <HuePicker
        value={config.hue}
        onPreview={(hue) => setConfig((current) => ({ ...current, hue }))}
        onCommit={(hue) => save({ hue })}
      />
      <View style={styles.handoff}>
        {AGENT_AVATAR_TONES.map((tone) => {
          const on = config.tone === tone.value;
          return (
            <Pressable
              key={tone.value}
              onPress={() => save({ tone: tone.value })}
              accessibilityLabel={`${tone.label} tone`}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipLabel, on && { color: color.primaryForeground }]}>{tone.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.faceLabel}>Expression</Text>
      <View style={styles.handoff}>
        {AGENT_AVATAR_EXPRESSIONS.map((expression) => {
          const on = config.expression === expression.value;
          return (
            <Pressable
              key={expression.value}
              onPress={() => save({ expression: expression.value })}
              accessibilityLabel={expression.label}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipLabel, on && { color: color.primaryForeground }]}>{expression.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Field>
  );
}

function HuePicker({
  value,
  onPreview,
  onCommit,
}: {
  value: number;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const width = useRef(1);
  const hueAt = (event: GestureResponderEvent) =>
    Math.min(359, Math.max(0, Math.round(event.nativeEvent.locationX / width.current * 359)));

  const adjust = (delta: number) => onCommit(Math.min(359, Math.max(0, value + delta)));

  return (
    <View
      accessible
      accessibilityLabel="Hue"
      accessibilityRole="adjustable"
      accessibilityValue={{ min: 0, max: 359, now: value, text: `${value} degrees` }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment") adjust(5);
        if (event.nativeEvent.actionName === "decrement") adjust(-5);
      }}
      onLayout={(event) => { width.current = event.nativeEvent.layout.width; }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(event) => onPreview(hueAt(event))}
      onResponderMove={(event) => onPreview(hueAt(event))}
      onResponderRelease={(event) => onCommit(hueAt(event))}
      onResponderTerminationRequest={() => false}
      style={styles.hue}
    >
      <View style={styles.hueTrack}>
        {Array.from({ length: 24 }, (_, index) => (
          <View
            key={index}
            style={{ flex: 1, backgroundColor: `hsl(${Math.round(index / 24 * 359)}, 75%, 55%)` }}
          />
        ))}
      </View>
      <View pointerEvents="none" style={[styles.hueThumb, { left: `${value / 359 * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.background },
  content: { padding: space.lg, gap: space.lg, paddingBottom: 60 },
  header: { flexDirection: "row", alignItems: "center", gap: space.md },
  headerText: { flex: 1, minWidth: 0, gap: 2 },
  error: { color: color.destructive, fontSize: 13 },
  picker: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.card,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignSelf: "flex-start",
  },
  handoff: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: color.card,
  },
  chipOn: { backgroundColor: color.primary, borderColor: color.primary },
  chipLabel: { fontSize: 13, color: color.foreground },
  faces: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  facePreview: { alignItems: "center", paddingVertical: space.sm },
  faceLabel: { color: color.mutedForeground, fontSize: 12, fontWeight: "500" },
  faceLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  hue: { width: "100%", height: 44, justifyContent: "center" },
  hueTrack: { height: 12, borderRadius: radius.full, overflow: "hidden", flexDirection: "row" },
  hueThumb: {
    position: "absolute",
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: radius.full,
    borderWidth: 3,
    borderColor: color.foreground,
    backgroundColor: color.background,
  },
  face: {
    padding: 4,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    backgroundColor: color.card,
  },
  faceOn: { borderColor: color.primary },
  routine: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.card,
    borderRadius: radius.lg,
    padding: 10,
    gap: 8,
  },
  routineHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  routineText: { flex: 1, minWidth: 0, gap: 2 },
  routineError: { color: color.destructive },
  routineActions: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  routineAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    minHeight: 36,
    borderRadius: radius.sm,
  },
  routineActionOn: { backgroundColor: color.accent },
  routineActionLabel: { fontSize: 13, color: color.foreground },
  danger: {
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.35)",
    backgroundColor: "rgba(248,113,113,0.06)",
    borderRadius: radius.lg,
    padding: space.md,
    gap: 6,
    alignItems: "flex-start",
  },
});
