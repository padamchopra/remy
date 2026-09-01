import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pencil, Play, Plus, Repeat } from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { apiError } from "../lib/api-error";
import { AGENT_AVATAR_EXPRESSIONS, AGENT_AVATAR_SHAPES, agentAvatarConfig, encodeAgentAvatar } from "../lib/agent-avatar";
import { cadenceSummary, whenNext } from "../lib/routines";
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

  return (
    <View style={styles.routine}>
      <Repeat size={14} color={color.mutedForeground} />
      <View style={styles.routineText}>
        <Text style={type.callout} numberOfLines={1}>{routine.name}</Text>
        <Text style={type.caption} numberOfLines={1}>
          {routine.enabled
            ? `${cadenceSummary(routine)} · due ${whenNext(routine.nextRunAt)}`
            : `${cadenceSummary(routine)} · paused`}
          {routine.lastError ? " · last run failed" : ""}
        </Text>
      </View>
      <Pressable
        onPress={() => void act(() => saveRoutine(routine.id, { enabled: !routine.enabled }))}
        disabled={busy}
        accessibilityLabel={routine.enabled ? `Pause ${routine.name}` : `Resume ${routine.name}`}
        style={styles.routineAction}
      >
        <Text style={styles.routineActionLabel}>{routine.enabled ? "Pause" : "Resume"}</Text>
      </Pressable>
      <Pressable
        onPress={() => void act(() => runRoutine(routine.id))}
        disabled={busy}
        accessibilityLabel={`Run ${routine.name} now`}
        style={styles.routineAction}
      >
        <Play size={14} color={color.foreground} />
      </Pressable>
      <Pressable onPress={onEdit} accessibilityLabel={`Edit ${routine.name}`} style={styles.routineAction} data-link>
        <Pencil size={14} color={color.foreground} />
      </Pressable>
    </View>
  );
}

/// An agent's face is generated, not uploaded: pick its silhouette and how it
/// is feeling and the seed does the rest.
function FaceField({ agent, onChange }: { agent: Agent; onChange: (avatar: string) => void }) {
  const config = agentAvatarConfig(agent);
  return (
    <Field label="Face" description="Generated from the agent, so the same one is the same face everywhere.">
      <View style={styles.faces}>
        {AGENT_AVATAR_SHAPES.map((shape) => {
          const next = encodeAgentAvatar({ ...config, shape: shape.value });
          const on = config.shape === shape.value;
          return (
            <Pressable
              key={shape.value}
              onPress={() => onChange(next)}
              accessibilityLabel={shape.label}
              accessibilityState={{ selected: on }}
              style={[styles.face, on && styles.faceOn]}
            >
              <AgentMark agent={{ ...agent, avatar: next, builtIn: false }} size={32} />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.handoff}>
        {AGENT_AVATAR_EXPRESSIONS.map((expression) => {
          const on = config.expression === expression.value;
          return (
            <Pressable
              key={expression.value}
              onPress={() => onChange(encodeAgentAvatar({ ...config, expression: expression.value }))}
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
  face: {
    padding: 4,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    backgroundColor: color.card,
  },
  faceOn: { borderColor: color.primary },
  routine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.card,
    borderRadius: radius.lg,
    padding: 10,
  },
  routineText: { flex: 1, minWidth: 0, gap: 2 },
  routineAction: { paddingHorizontal: 8, paddingVertical: 6, minHeight: 32, justifyContent: "center" },
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
