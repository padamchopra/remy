import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { color, radius, space, type } from "../theme";
import { apiError } from "../lib/api-error";
import { useStore } from "../state/store";
import { Button } from "../components/Button";

export function NewTicketScreen({ onCreated }: { onCreated: (key: string) => void }) {
  const projects = useStore((s) => s.projects);
  const createTicket = useStore((s) => s.createTicket);
  const loadBoard = useStore((s) => s.loadBoard);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (projects.length === 0) void loadBoard().catch(() => {});
  }, [projects.length, loadBoard]);

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || !projectId || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const ticket = await createTicket({
        projectId,
        title: trimmed,
        ...(body.trim() ? { body: body.trim() } : {}),
      });
      onCreated(ticket.key);
    } catch (caught) {
      setError(apiError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={88}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[type.body, { color: color.mutedForeground }]}>Name the work. You can assign it once it exists.</Text>
        {projects.length > 1 ? (
          <>
            <Text style={type.caption}>Workspace</Text>
            <ScrollView horizontal style={styles.chips} contentContainerStyle={{ gap: 8 }}>
              {projects.map((project) => (
                <Pressable
                  key={project.id}
                  onPress={() => setProjectId(project.id)}
                  style={[styles.chip, projectId === project.id && styles.chipOn]}
                >
                  <Text style={[styles.chipLabel, projectId === project.id && { color: color.primaryForeground }]}>
                    {project.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : null}
        <Text style={type.caption}>Title</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Flaky login test"
          placeholderTextColor={color.mutedForeground}
          autoFocus
          returnKeyType="next"
          onSubmitEditing={() => void submit()}
          style={styles.input}
        />
        <Text style={type.caption}>Description</Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="What has to change, and how you will know it worked."
          placeholderTextColor={color.mutedForeground}
          multiline
          style={[styles.input, styles.area]}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          label="Create ticket"
          busy={busy}
          disabled={!title.trim() || !projectId}
          onPress={() => void submit()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.background },
  body: { padding: space.lg, gap: space.md, paddingBottom: 40 },
  chips: { flexGrow: 0 },
  chip: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: color.card,
  },
  chipOn: { backgroundColor: color.primary, borderColor: color.primary },
  chipLabel: { fontSize: 13, color: color.foreground },
  input: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.card,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: color.foreground,
    fontSize: 15,
  },
  area: { minHeight: 120, textAlignVertical: "top" },
  error: { color: color.destructive, fontSize: 13 },
});
