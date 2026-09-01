import { ScrollView, StyleSheet, Text, View } from "react-native";
import { color, space, type } from "../theme";
import { displayPath } from "../lib/path";
import { effortLabel, modelLabel, providerOf } from "../lib/providers";
import { useProviders, useStore } from "../state/store";
import { EmptyState } from "../components/Empty";
import { WorkspaceMark } from "../components/WorkspaceMark";

export function WorkspaceScreen({ id }: { id: string }) {
  const workspace = useStore((s) => s.workspaces.find((entry) => entry.id === id));
  const server = useStore((s) => s.servers.find((entry) => entry.id === workspace?.serverId));
  const providers = useProviders(workspace?.serverId);
  if (!workspace) {
    return (
      <View style={styles.wrap}>
        <EmptyState title="No such workspace" detail="It was removed on the Mac." />
      </View>
    );
  }
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <WorkspaceMark workspace={workspace} />
        <View style={{ flex: 1 }}>
          <Text style={type.title}>{workspace.name}</Text>
          <Text style={type.mono}>{displayPath(workspace.path)}</Text>
        </View>
      </View>
      <Text style={type.caption}>{server?.name ?? "This Mac"}</Text>
      <Text style={type.callout}>
        {workspace.provider
          ? `Threads here run on ${providerOf(providers, workspace.provider)?.label ?? workspace.provider} · ${modelLabel(providers, { provider: workspace.provider, model: workspace.model ?? "", effort: workspace.effort ?? "" })} · ${effortLabel(providers, { provider: workspace.provider, model: workspace.model ?? "", effort: workspace.effort ?? "" })}`
          : `Threads here follow ${server?.name ?? "this Mac"}.`}
      </Text>
      {workspace.worktrees.map((tree) => (
        <Text key={tree.path} style={type.callout}>
          {tree.branch ?? "Detached"}
          {tree.isMain ? " · Main checkout" : ""}
          {tree.dirty ? " · Uncommitted changes" : ""}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.background },
  content: { padding: space.lg, gap: space.md },
  heading: { flexDirection: "row", alignItems: "center", gap: 12 },
});
