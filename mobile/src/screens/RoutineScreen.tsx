import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Clock } from "lucide-react-native";
import { color, space, type } from "../theme";
import { apiError } from "../lib/api-error";
import { CADENCE_LABEL, WEEKDAYS, cadenceSummary, clockHour, whenLast } from "../lib/routines";
import { useStore } from "../state/store";
import type { Cadence } from "../state/types";
import { Button } from "../components/Button";
import { ComposerMenu } from "../components/ComposerMenu";
import { EmptyState } from "../components/Empty";
import { ChoiceField, Field, TextField } from "../components/Field";

const CADENCES = (Object.keys(CADENCE_LABEL) as Cadence[]).map((value) => ({
  value,
  label: CADENCE_LABEL[value],
}));

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: clockHour(hour),
}));

const MINUTES = Array.from({ length: 60 }, (_, minute) => ({
  value: String(minute),
  label: String(minute).padStart(2, "0"),
}));

const DAYS = Array.from({ length: 28 }, (_, index) => ({
  value: String(index + 1),
  label: String(index + 1),
}));

/// One routine: what this agent does, and when it starts.
///
/// Creating one is a conversation — you ask the agent, and it writes the whole
/// instruction it wants to receive each time. This is where you change it after.
export function RoutineScreen({ routineId, onDone }: { routineId: string; onDone: () => void }) {
  const routine = useStore((s) => s.routines.find((entry) => entry.id === routineId));
  const agent = useStore((s) => s.agents.find((entry) => entry.id === routine?.agentId));
  const servers = useStore((s) => s.servers);
  const settings = useStore((s) => s.settings);
  const boardDevices = useStore((s) => s.boardDevices);
  const saveRoutine = useStore((s) => s.saveRoutine);
  const deleteRoutine = useStore((s) => s.deleteRoutine);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [weekday, setWeekday] = useState(1);
  const [day, setDay] = useState(1);
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!routine) return;
    setName(routine.name);
    setPrompt(routine.prompt);
    setCadence(routine.cadence);
    setWeekday(routine.weekday ?? 1);
    setDay(routine.day ?? 1);
    setHour(routine.hour);
    setMinute(routine.minute);
  }, [routineId, routine?.updatedAt]);

  if (!routine) {
    return (
      <View style={styles.wrap}>
        <EmptyState title="That routine is gone" detail="It was deleted on the Mac that owns its clock." />
      </View>
    );
  }

  const clockMatch = boardDevices.find((entry) => entry.deviceId === routine.schedulerDeviceId);
  const clock = servers.find((entry) => entry.id === clockMatch?.serverId);
  const clockName = clock?.name ?? "The Mac that created it";
  const preference = clock ? settings[clock.id]?.devicePreferenceOrder ?? [] : [];
  const preferredNames = preference.map((deviceId) => {
    const match = boardDevices.find((entry) => entry.deviceId === deviceId);
    return servers.find((entry) => entry.id === match?.serverId)?.name;
  }).filter((name): name is string => Boolean(name));

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await saveRoutine(routine.id, { name, prompt, cadence, weekday, day, hour, minute });
      onDone();
    } catch (caught) {
      setError(apiError(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    Alert.alert(`Delete ${routine.name}?`, "This routine will not run again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void deleteRoutine(routine.id)
          .then(onDone)
          .catch((caught) => setError(apiError(caught))),
      },
    ]);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={type.caption}>
        {agent ? `${agent.name} · ${cadenceSummary({ cadence, hour, minute, weekday, day })}` : cadenceSummary({ cadence, hour, minute, weekday, day })}
      </Text>

      <View style={styles.status}>
        <Text style={type.callout}>Where it runs</Text>
        <Text style={type.caption}>
          {clock?.online === false
            ? `${clockName} owns this routine's clock and is offline, so it cannot start on schedule.`
            : `${clockName} owns this routine's clock.`}
        </Text>
        <Text style={type.caption}>
          {preferredNames.length
            ? `Preferred device order: ${preferredNames.join(", ")}, then another available Mac.`
            : `No preferred device order is set, so it tries ${clockName}, then another available Mac.`}
        </Text>
        <Text style={type.caption}>
          {routine.lastRunAt ? `Last run: ${whenLast(routine.lastRunAt)}` : "It has not run yet."}
        </Text>
        {routine.lastError ? <Text style={styles.error}>Latest error: {routine.lastError}</Text> : null}
      </View>

      <TextField label="Name" value={name} onCommit={setName} />
      <TextField
        label="Instruction"
        description="The whole thing this agent receives each time it runs."
        value={prompt}
        lines={8}
        onCommit={setPrompt}
      />

      <ChoiceField label="How often" value={cadence} options={CADENCES} onChange={setCadence} />

      <Field label="Time">
        <View style={styles.row}>
          <ComposerMenu
            icon={Clock}
            label={clockHour(hour)}
            value={String(hour)}
            onChange={(value) => setHour(Number(value))}
            options={HOURS}
            style={styles.menu}
          />
          <ComposerMenu
            icon={Clock}
            label={`:${String(minute).padStart(2, "0")}`}
            value={String(minute)}
            onChange={(value) => setMinute(Number(value))}
            options={MINUTES}
            style={styles.menu}
          />
        </View>
      </Field>

      {cadence === "weekly" ? (
        <ChoiceField
          label="Day of the week"
          value={String(weekday)}
          options={WEEKDAYS.map((label, index) => ({ value: String(index), label: label.slice(0, 3) }))}
          onChange={(value) => setWeekday(Number(value))}
        />
      ) : null}

      {cadence === "monthly" ? (
        <Field label="Day of the month">
          <ComposerMenu
            icon={Clock}
            label={`Day ${day}`}
            value={String(day)}
            onChange={(value) => setDay(Number(value))}
            options={DAYS}
            style={styles.menu}
          />
        </Field>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        <Button label="Save" busy={busy} onPress={() => void save()} />
        <Button label="Delete routine" variant="ghost" onPress={remove} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.background },
  content: { padding: space.lg, gap: space.lg, paddingBottom: 60 },
  row: { flexDirection: "row", gap: space.sm },
  menu: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignSelf: "flex-start",
  },
  actions: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  status: { gap: space.xs },
  error: { color: color.destructive, fontSize: 13 },
});
