import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Folder } from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { displayPath } from "../lib/path";
import { useStore } from "../state/store";
import { EmptyState } from "../components/Empty";
import { WorkspaceMark } from "../components/WorkspaceMark";
import { workspaceGroups } from "../lib/projects";

export function WorkspacesScreen({ onWorkspace }: { onWorkspace: (id: string) => void }) {
  const workspaces = useStore((s) => s.workspaces);
  const servers = useStore((s) => s.servers);
  const groups = workspaceGroups(workspaces, servers);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      {groups.length === 0 ? (
        <EmptyState
          compact
          icon={<Folder size={22} color={color.mutedForeground} />}
          title="No workspaces yet"
          detail="Add a folder on a Mac to run threads in."
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.background },
  content: { padding: space.lg, gap: space.md, paddingBottom: 40 },
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
});
