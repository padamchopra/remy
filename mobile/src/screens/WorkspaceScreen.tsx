import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Check, X } from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { displayPath } from "../lib/path";
import { PROJECT_ICON_IDS, projectIcon } from "../lib/projects";
import { pairChoice, type ModelChoice } from "../lib/providers";
import { TINT_IDS, tintOf } from "../lib/tints";
import { useProviders, useServerSettings, useStore, useSupportsEffort } from "../state/store";
import { apiError } from "../lib/api-error";
import { EmptyState } from "../components/Empty";
import { WorkspaceMark } from "../components/WorkspaceMark";
import { EditableName } from "../components/EditableName";
import { Button } from "../components/Button";
import { ModelPicker, REMY_DEFAULT } from "../components/ModelPicker";
import { WorkspaceEnvironments } from "../components/WorkspaceEnvironments";
import type { Workspace } from "../state/types";

export function WorkspaceScreen({ id, onGone }: { id: string; onGone: () => void }) {
  const all = useStore((s) => s.workspaces);
  const projects = useStore((s) => s.projects);
  const chats = useStore((s) => s.chats);
  const servers = useStore((s) => s.servers);
  const updateWorkspace = useStore((s) => s.updateWorkspace);
  const removeWorkspace = useStore((s) => s.removeWorkspace);
  const closeWorktree = useStore((s) => s.closeWorktree);
  const closeAllWorktrees = useStore((s) => s.closeAllWorktrees);
  const initial = all.find((entry) => entry.id === id);
  const copies = useMemo(() => initial
    ? all.filter((entry) => entry.id === initial.id || Boolean(initial.origin && entry.origin === initial.origin))
    : [], [all, initial?.id, initial?.origin]);
  const [workspaceId, setWorkspaceId] = useState(id);
  const workspace = copies.find((entry) => entry.id === workspaceId) ?? initial;
  const server = servers.find((entry) => entry.id === workspace?.serverId);
  const project = projects.find((entry) => workspace && (
    entry.workspaceIds.includes(workspace.id) || Boolean(workspace.origin && entry.origin === workspace.origin)));
  const providers = useProviders(workspace?.serverId);
  const settings = useServerSettings(workspace?.serverId);
  const effortUnavailable = !useSupportsEffort(workspace?.serverId);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (workspace && workspace.id !== workspaceId) setWorkspaceId(workspace.id);
  }, [workspace?.id, workspaceId]);

  if (!workspace) {
    return <View style={styles.wrap}><EmptyState title="No such workspace" detail="It was removed on its computer." /></View>;
  }

  const save = async (patch: Parameters<typeof updateWorkspace>[1], label: string) => {
    setError(undefined);
    try {
      await updateWorkspace(workspace.id, patch);
    } catch (caught) {
      setError(`Couldn't save ${label}: ${apiError(caught)}`);
    }
  };

  const choice: ModelChoice = workspace.provider
    ? { provider: workspace.provider, model: workspace.model ?? "", effort: workspace.effort ?? "" }
    : { provider: REMY_DEFAULT, model: "", effort: "" };
  const defaultChoice = {
    provider: settings?.defaultProvider ?? "claude",
    model: settings?.defaultModel ?? "",
    effort: settings?.defaultEffort ?? "",
  };

  const close = async (tree: Workspace["worktrees"][number], force = false) => {
    try {
      await closeWorktree(workspace.id, tree.path, force);
    } catch (caught) {
      if (!force) {
        Alert.alert("Couldn't close that worktree", apiError(caught), [
          { text: "Cancel", style: "cancel" },
          { text: "Discard changes", style: "destructive", onPress: () => void close(tree, true) },
        ]);
      } else setError(`Couldn't close that worktree: ${apiError(caught)}`);
    }
  };

  const closeAll = async (force = false) => {
    try {
      await closeAllWorktrees(workspace.id, force);
    } catch (caught) {
      if (!force) {
        Alert.alert("Some worktrees have changes", apiError(caught), [
          { text: "Cancel", style: "cancel" },
          { text: "Discard all changes", style: "destructive", onPress: () => void closeAll(true) },
        ]);
      } else setError(`Couldn't close those worktrees: ${apiError(caught)}`);
    }
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <WorkspaceMark workspace={workspace} />
        <View style={{ flex: 1 }}>
          <EditableName value={workspace.name} label="workspace name" onCommit={(name) => void save({ name }, "that name")} />
          <Text style={type.mono}>{displayPath(workspace.path)}</Text>
        </View>
      </View>

      {copies.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {copies.map((copy) => {
            const machine = servers.find((entry) => entry.id === copy.serverId);
            return (
              <Chip key={`${copy.serverId}:${copy.id}`} label={machine?.name ?? "Unavailable computer"} selected={copy.id === workspace.id} onPress={() => setWorkspaceId(copy.id)} />
            );
          })}
        </ScrollView>
      ) : <Text style={type.caption}>{server?.name ?? "Unavailable computer"}</Text>}

      <View style={styles.section}>
        <Text style={type.heading}>Appearance</Text>
        <View style={styles.tints}>
          {TINT_IDS.map((id) => {
            const tint = tintOf(id);
            return (
              <Pressable key={id} onPress={() => void save({ tint: id }, "that tint")} accessibilityLabel={`${id} tint`} style={[styles.swatch, { backgroundColor: tint.fg }]}>
                {(workspace.tint ?? "zinc") === id ? <Check size={10} color="#111" /> : null}
              </Pressable>
            );
          })}
        </View>
        <View style={styles.icons}>
          {PROJECT_ICON_IDS.map((id) => {
            const Icon = projectIcon(id);
            return (
              <Pressable key={id} onPress={() => void save({ icon: id }, "that icon")} accessibilityLabel={`${id} icon`} style={[styles.icon, workspace.icon === id && styles.iconOn]}>
                <Icon size={18} color={color.foreground} />
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={type.heading}>Threads</Text>
        <Text style={type.caption}>Choose what new threads in this workspace use.</Text>
        <ModelPicker
          providers={providers}
          value={choice}
          allowDefault
          defaultChoice={defaultChoice}
          effortUnavailable={effortUnavailable}
          onPick={(next) => {
            if (next.provider === REMY_DEFAULT) void save({ provider: null, model: null, effort: null }, "that model");
            else {
              const settled = pairChoice(providers, next);
              void save({ provider: settled.provider, model: settled.model, effort: settled.effort ?? "" }, "that model");
            }
          }}
        />
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={type.heading}>Worktrees</Text>
          {workspace.worktrees.filter((tree) => !tree.isMain).length > 1 ? (
            <Pressable onPress={() => void closeAll()}><Text style={styles.action}>Close all</Text></Pressable>
          ) : null}
        </View>
        {workspace.worktrees.length === 0 ? <Text style={type.caption}>This folder is not a Git repository.</Text> : workspace.worktrees.map((tree) => (
          <View key={tree.path} style={styles.worktree}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={type.callout}>{tree.branch ?? "Detached"}</Text>
              <Text style={type.caption} numberOfLines={1}>{displayPath(tree.path)}</Text>
              <Text style={type.caption}>{tree.isMain ? "Main checkout" : tree.dirty ? "Uncommitted changes" : "Linked worktree"}</Text>
              {chats.filter((chat) => chat.serverId === workspace.serverId && (chat.cwd === tree.path || chat.cwd.startsWith(`${tree.path}/`))).map((chat) => (
                <Text key={chat.id} style={type.caption} numberOfLines={1}>{`Thread · ${chat.title}`}</Text>
              ))}
            </View>
            {!tree.isMain ? (
              <Pressable onPress={() => void close(tree)} accessibilityLabel={`Close ${tree.branch ?? "worktree"}`} style={styles.close}>
                <X size={16} color={color.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>

      {project ? <WorkspaceEnvironments project={project} workspace={workspace} copies={copies} servers={servers} /> : null}

      <View style={styles.section}>
        <Text style={type.heading}>Remove workspace</Text>
        <Text style={type.caption}>This only removes the folder from {server?.name ?? "this computer"}. Its files and repository stay where they are.</Text>
        <Button
          label="Remove workspace"
          variant="danger"
          onPress={() => Alert.alert(`Remove ${workspace.name}?`, "Its files stay on the computer, and its running threads keep running.", [
            { text: "Cancel", style: "cancel" },
            { text: "Remove", style: "destructive", onPress: () => void removeWorkspace(workspace.id)
              .then(onGone)
              .catch((caught) => setError(`Couldn't remove that workspace: ${apiError(caught)}`)) },
          ])}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipOn]}>
      <Text style={[styles.chipLabel, selected && { color: color.primaryForeground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.background },
  content: { padding: space.lg, gap: space.xl, paddingBottom: 48 },
  heading: { flexDirection: "row", alignItems: "center", gap: 12 },
  section: { gap: space.md },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  action: { color: color.primary, fontSize: 13, fontWeight: "600" },
  chips: { flexDirection: "row", gap: 8 },
  chip: { borderWidth: 1, borderColor: color.border, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: color.primary, borderColor: color.primary },
  chipLabel: { fontSize: 13, color: color.foreground },
  tints: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatch: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  icons: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
  iconOn: { backgroundColor: color.accent },
  worktree: { flexDirection: "row", alignItems: "center", gap: 8, padding: 11, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, backgroundColor: color.card },
  close: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  error: { color: color.destructive, fontSize: 13 },
});
