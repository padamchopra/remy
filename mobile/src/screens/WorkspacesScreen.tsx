import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Folder } from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { displayPath } from "../lib/path";
import { useStore } from "../state/store";
import { EmptyState } from "../components/Empty";
import { WorkspaceMark } from "../components/WorkspaceMark";
import { workspaceGroups } from "../lib/projects";
import { Popover } from "../components/ComposerMenu";
import { Button } from "../components/Button";
import { apiError } from "../lib/api-error";

export function WorkspacesScreen({ onWorkspace }: { onWorkspace: (id: string) => void }) {
  const workspaces = useStore((s) => s.workspaces);
  const servers = useStore((s) => s.servers);
  const addWorkspace = useStore((s) => s.addWorkspace);
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [serverId, setServerId] = useState(servers.find((server) => server.online && !server.cloud)?.id ?? "");
  const [error, setError] = useState<string>();
  const groups = workspaceGroups(workspaces, servers);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View style={styles.head}>
        <Text style={type.heading}>Workspaces</Text>
        <Button label="Add" variant="outline" onPress={() => setAdding(true)} style={styles.add} />
      </View>
      {groups.length === 0 ? (
        <EmptyState
          compact
          icon={<Folder size={22} color={color.mutedForeground} />}
          title="No workspaces yet"
          detail="Add a folder on a computer to run threads in."
        />
      ) : (
        groups.map((group) => {
          const workspace = group.workspace;
          const machines = group.copies.flatMap((copy) => {
            const server = servers.find((entry) => entry.id === copy.serverId);
            return server ? [server.name] : [];
          });
          return (
            <Pressable
              key={group.id}
              onPress={() => onWorkspace(workspace.id)}
              style={({ pressed }) => [styles.card, pressed && { backgroundColor: color.accent }]}
            >
              <WorkspaceMark workspace={workspace} />
              <View style={{ flex: 1 }}>
                <Text style={type.callout}>{workspace.name}</Text>
                <Text style={type.mono} numberOfLines={1}>
                  {machines.join(" · ") || displayPath(workspace.path)}
                </Text>
              </View>
            </Pressable>
          );
        })
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Popover open={adding} onClose={() => setAdding(false)}>
        <View style={styles.form}>
          <Text style={type.heading}>Add workspace</Text>
          <Text style={type.caption}>Computer</Text>
          <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
            {servers.filter((server) => !server.cloud).map((server) => (
              <Pressable key={server.id} disabled={!server.online} onPress={() => setServerId(server.id)} style={[styles.chip, serverId === server.id && styles.chipOn, !server.online && { opacity: 0.35 }]}>
                <Text style={[styles.chipLabel, serverId === server.id && { color: color.primaryForeground }]}>{server.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <TextInput value={path} onChangeText={setPath} autoFocus autoCapitalize="none" autoCorrect={false} placeholder="/Users/you/code/repository" placeholderTextColor={color.mutedForeground} accessibilityLabel="Folder path" style={styles.input} />
          <TextInput value={name} onChangeText={setName} placeholder="Workspace name (optional)" placeholderTextColor={color.mutedForeground} accessibilityLabel="Workspace name" style={styles.input} />
          <Button
            label="Add workspace"
            disabled={!path.trim() || !serverId}
            onPress={() => void addWorkspace({ path, name, serverId })
              .then(() => { setAdding(false); setPath(""); setName(""); })
              .catch((caught) => setError(`Couldn't add that workspace: ${apiError(caught)}`))}
          />
        </View>
      </Popover>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.background },
  content: { padding: space.lg, gap: space.md, paddingBottom: 40 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  add: { minHeight: 34, paddingHorizontal: 12 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: 12,
  },
  form: { padding: space.md, gap: space.sm },
  chip: { borderWidth: 1, borderColor: color.border, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: color.primary, borderColor: color.primary },
  chipLabel: { color: color.foreground, fontSize: 13 },
  input: { borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, backgroundColor: color.background, color: color.foreground, padding: 11 },
  error: { color: color.destructive, fontSize: 13 },
});
