import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Check, KeyRound, Trash2 } from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { apiError } from "../lib/api-error";
import { useStore } from "../state/store";
import type { Project, Server, Workspace, WorkspaceEnvironment } from "../state/types";
import { Button } from "./Button";
import { MenuItem, Popover } from "./ComposerMenu";

interface FleetEnvironment extends WorkspaceEnvironment {
  machines: string[];
}

export function WorkspaceEnvironments({
  project,
  workspace,
  copies,
  servers,
}: {
  project: Project;
  workspace: Workspace;
  copies: Workspace[];
  servers: Server[];
}) {
  const list = useStore((s) => s.environments);
  const create = useStore((s) => s.createEnvironment);
  const rename = useStore((s) => s.renameEnvironment);
  const activate = useStore((s) => s.activateEnvironment);
  const remove = useStore((s) => s.deleteEnvironment);
  const saveValues = useStore((s) => s.saveEnvironmentValues);
  const removeValue = useStore((s) => s.deleteEnvironmentValue);
  const listFiles = useStore((s) => s.environmentFiles);
  const importFile = useStore((s) => s.importEnvironmentFile);
  const [byServer, setByServer] = useState<Record<string, WorkspaceEnvironment[]>>({});
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [values, setValues] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [pickingFile, setPickingFile] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const answered = await Promise.all(copies.map(async (copy) => {
      try {
        return [copy.serverId, await list(project.id, copy.serverId)] as const;
      } catch {
        return [copy.serverId, []] as const;
      }
    }));
    setByServer(Object.fromEntries(answered));
  }, [copies, list, project.id]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const environments = useMemo(() => {
    const merged = new Map<string, FleetEnvironment>();
    for (const [serverId, entries] of Object.entries(byServer)) {
      const machine = servers.find((server) => server.id === serverId)?.name ?? "Unavailable computer";
      for (const environment of entries) {
        const previous = merged.get(environment.id);
        const available = environment.variables.length > 0 ? [machine] : [];
        merged.set(environment.id, previous
          ? { ...previous, active: previous.active || environment.active, machines: [...new Set([...previous.machines, ...available])] }
          : { ...environment, machines: available });
      }
    }
    return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [byServer, servers]);

  const local = byServer[workspace.serverId] ?? [];
  const active = local.find((entry) => entry.active);
  const selected = local.find((entry) => entry.id === selectedId)
    ?? local.find((entry) => entry.active)
    ?? local[0];

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected?.id, selectedId]);

  const run = async (action: () => Promise<void>, message: string) => {
    setError(undefined);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(`${message}: ${apiError(caught)}`);
      throw caught;
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text style={type.heading}>Environments</Text>
        <Button label="Add" variant="outline" onPress={() => { setName(""); setCreating(true); }} style={styles.small} />
      </View>
      <Text style={type.caption}>
        Values are encrypted and cannot be viewed again. Exact values are removed from output, but encoded or transformed values may not be recognized.
      </Text>
      {environments.length === 0 ? <Text style={type.caption}>No environments yet.</Text> : environments.map((environment) => (
        <Pressable
          key={environment.id}
          onPress={() => setSelectedId(environment.id)}
          style={[styles.environment, selected?.id === environment.id && styles.environmentOn]}
        >
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={type.callout}>{environment.name}</Text>
            <Text style={type.caption}>
              {environment.machines.length > 0
                ? `Configured on ${environment.machines.join(" · ")}`
                : "No values are configured on an available computer."}
            </Text>
          </View>
          {environment.active ? <Check size={16} color={color.primary} /> : null}
        </Pressable>
      ))}

      {selected ? (
        <View style={styles.editor}>
          <View style={styles.head}>
            <Text style={type.callout}>{selected.name}</Text>
            <Pressable onPress={() => { setName(selected.name); setRenaming(true); }}><Text style={styles.action}>Rename</Text></Pressable>
          </View>
          <View style={styles.actions}>
            <Button
              label={active?.id === selected.id ? "Disable" : "Activate"}
              variant="outline"
              onPress={() => void run(
                () => activate(project.id, workspace.serverId, active?.id === selected.id ? undefined : selected.id),
                "Couldn't change that environment",
              ).catch(() => {})}
            />
            <Button
              label="Delete"
              variant="danger"
              onPress={() => Alert.alert(`Delete ${selected.name}?`, "Its configured values are deleted from every paired computer after they sync.", [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => void run(
                  () => remove(project.id, workspace.serverId, selected.id),
                  "Couldn't delete that environment",
                ).then(() => setSelectedId(undefined)).catch(() => {}) },
              ])}
            />
          </View>
          <Text style={type.caption}>Configured names on {servers.find((server) => server.id === workspace.serverId)?.name ?? "this computer"}</Text>
          {selected.variables.length === 0 ? <Text style={type.caption}>No values are configured here.</Text> : selected.variables.map((variable) => (
            <View key={variable.name} style={styles.variable}>
              <KeyRound size={14} color={color.mutedForeground} />
              <Text style={[type.mono, { flex: 1 }]}>{variable.name}</Text>
              <Pressable
                onPress={() => Alert.alert(`Remove ${variable.name}?`, "The stored value is deleted from this environment.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Remove", style: "destructive", onPress: () => void run(
                    () => removeValue(project.id, workspace.serverId, selected.id, variable.name),
                    "Couldn't remove that value",
                  ).catch(() => {}) },
                ])}
                accessibilityLabel={`Remove ${variable.name}`}
              >
                <Trash2 size={15} color={color.destructive} />
              </Pressable>
            </View>
          ))}
          <TextInput
            value={values}
            onChangeText={setValues}
            placeholder="API_KEY=…\nDATABASE_URL=…"
            placeholderTextColor={color.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            secureTextEntry
            accessibilityLabel="Environment values"
            style={styles.values}
          />
          <Text style={type.caption}>Saving replaces any names you include. Existing values never come back to this phone.</Text>
          <View style={styles.actions}>
            <Button
              label="Save values"
              disabled={!values.trim()}
              onPress={() => void run(
                () => saveValues(project.id, workspace.serverId, selected.id, values),
                "Couldn't save those values",
              ).then(() => setValues("")).catch(() => {})}
            />
            <Button
              label="Import file…"
              variant="outline"
              onPress={() => void listFiles(project.id, workspace.serverId)
                .then((found) => { setFiles(found); setPickingFile(true); })
                .catch((caught) => setError(`Couldn't find environment files: ${apiError(caught)}`))}
            />
          </View>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Popover open={creating} onClose={() => setCreating(false)}>
        <View style={styles.form}>
          <Text style={type.heading}>Add environment</Text>
          <TextInput value={name} onChangeText={setName} autoFocus placeholder="Development" placeholderTextColor={color.mutedForeground} style={styles.input} />
          <Button label="Add environment" disabled={!name.trim()} onPress={() => void run(
            () => create(project.id, workspace.serverId, name),
            "Couldn't add that environment",
          ).then(() => setCreating(false)).catch(() => {})} />
        </View>
      </Popover>

      <Popover open={renaming} onClose={() => setRenaming(false)}>
        <View style={styles.form}>
          <Text style={type.heading}>Rename environment</Text>
          <TextInput value={name} onChangeText={setName} autoFocus style={styles.input} />
          <Button label="Rename" disabled={!name.trim()} onPress={() => selected && void run(
            () => rename(project.id, workspace.serverId, selected.id, name),
            "Couldn't rename that environment",
          ).then(() => setRenaming(false)).catch(() => {})} />
        </View>
      </Popover>

      <Popover open={pickingFile} onClose={() => setPickingFile(false)}>
        {files.length === 0 ? <Text style={styles.empty}>Add a .env file to the workspace root, then try again.</Text> : files.map((file) => (
          <MenuItem
            key={file}
            label={file}
            detail="Import and remove"
            onPress={() => {
              setPickingFile(false);
              if (!selected) return;
              void run(
                () => importFile(project.id, workspace.serverId, selected.id, file, true),
                "Couldn't import that file",
              ).catch(() => {});
            }}
          />
        ))}
      </Popover>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  small: { minHeight: 44, paddingHorizontal: 12 },
  environment: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: 11 },
  environmentOn: { borderColor: color.primary },
  editor: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border, paddingTop: space.md, gap: space.sm },
  action: { color: color.primary, fontSize: 13, fontWeight: "600" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  variable: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 8, backgroundColor: color.card, borderRadius: radius.md },
  values: { minHeight: 108, borderWidth: 1, borderColor: color.border, backgroundColor: color.card, color: color.foreground, fontFamily: "Menlo", fontSize: 12, borderRadius: radius.lg, padding: 12, textAlignVertical: "top" },
  form: { padding: space.md, gap: space.sm },
  input: { borderWidth: 1, borderColor: color.border, backgroundColor: color.background, color: color.foreground, borderRadius: radius.lg, padding: 12 },
  empty: { ...type.caption, textAlign: "center", padding: space.xl },
  error: { color: color.destructive, fontSize: 13 },
});
