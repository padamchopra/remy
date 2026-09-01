import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Clock } from "lucide-react-native";
import { color, space, type } from "../theme";
import { apiError } from "../lib/api-error";
import { CADENCE_LABEL, WEEKDAYS, cadenceSummary, clockTime } from "../lib/routines";
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
  label: clockTime(hour, 0),
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
            label={clockTime(hour, minute)}
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

      {routine.lastError ? <Text style={styles.error}>Last run failed: {routine.lastError}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        <Button label="Save" busy={busy} onPress={() => void save()} />
        <Button label="Delete routine" variant="ghost" onPress={remove} />
      </View>
      <Text style={type.caption}>
        {routine.runs === 0
          ? "It has not run yet."
          : `It has run ${routine.runs === 1 ? "once" : `${routine.runs} times`}.`}
      </Text>
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
  error: { color: color.destructive, fontSize: 13 },
});
