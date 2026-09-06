import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { ArrowDown, ArrowLeft, ArrowUp, RefreshCw } from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { apiError } from "../lib/api-error";
import { PERMISSIONS, permissionOf } from "../lib/chat-options";
import { pairChoice, providerOf, type ModelChoice } from "../lib/providers";
import { useProviders, useServerSettings, useStore, useSupportsEffort } from "../state/store";
import type { AnalyticsReport, ProviderMcpStatus, Server, ServerSettings, Tooling } from "../state/types";
import { Button } from "../components/Button";
import { ModelPicker } from "../components/ModelPicker";

const CHECKOUTS = [
  { value: "main", label: "Main checkout" },
  { value: "worktree", label: "New worktree" },
] as const;
const WORKTREE_BASES = [
  { value: "remote", label: "Remote default" },
  { value: "local", label: "Current branch" },
] as const;
const REPO_UPDATES = [
  { value: "off", label: "Manually" },
  { value: "hourly", label: "Every hour" },
  { value: "sixHourly", label: "Every 6 hours" },
  { value: "daily", label: "Every day" },
] as const;

export function DeviceSettingsScreen({ server, onBack }: { server: Server; onBack: () => void }) {
  const settings = useServerSettings(server.id);
  const providers = useProviders(server.id);
  const effortUnavailable = !useSupportsEffort(server.id);
  const patchSettings = useStore((s) => s.patchSettings);
  const loadSettings = useStore((s) => s.loadSettings);
  const loadProviders = useStore((s) => s.loadProviders);
  const readTooling = useStore((s) => s.tooling);
  const readMcp = useStore((s) => s.providerMcp);
  const setMcp = useStore((s) => s.setProviderMcp);
  const setProviderEnabled = useStore((s) => s.setProviderEnabled);
  const readAnalytics = useStore((s) => s.analytics);
  const servers = useStore((s) => s.servers.filter((entry) => !entry.cloud));
  const agents = useStore((s) => s.agents.filter((agent) => !agent.builtIn));
  const [tooling, setTooling] = useState<Tooling>();
  const [mcp, setMcpState] = useState<ProviderMcpStatus[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsReport>();
  const [favorite, setFavorite] = useState("");
  const [worktreeRoot, setWorktreeRoot] = useState("");
  const [branchPrefix, setBranchPrefix] = useState("");
  const [error, setError] = useState<string>();

  const reload = async () => {
    setError(undefined);
    try {
      await Promise.all([loadSettings(server.id), loadProviders(server.id)]);
      const [nextTooling, nextMcp, nextAnalytics] = await Promise.all([
        readTooling(server.id),
        readMcp(server.id),
        readAnalytics(server.id),
      ]);
      setTooling(nextTooling);
      setMcpState(nextMcp);
      setAnalytics(nextAnalytics);
    } catch (caught) {
      setError(apiError(caught));
    }
  };

  useEffect(() => { void reload(); }, [server.id]);
  useEffect(() => {
    setWorktreeRoot(settings?.worktreeRoot ?? "");
    setBranchPrefix(settings?.worktreeBranchPrefix ?? "");
  }, [settings?.worktreeRoot, settings?.worktreeBranchPrefix]);

  const save = async (patch: Parameters<typeof patchSettings>[1], label: string) => {
    setError(undefined);
    try {
      await patchSettings(server.id, patch);
    } catch (caught) {
      setError(`Couldn't save ${label}: ${apiError(caught)}`);
    }
  };

  if (!settings) {
    return (
      <View style={styles.wrap}>
        <Button label="Back to computers" variant="ghost" onPress={onBack} />
        <Text style={type.heading}>{server.name}</Text>
        <Text style={type.caption}>{server.online ? "Reading this computer's settings…" : "This computer is unavailable."}</Text>
        <Button label="Try again" variant="outline" onPress={() => void reload()} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  const defaultChoice: ModelChoice = {
    provider: settings.defaultProvider ?? "claude",
    model: settings.defaultModel ?? "",
    effort: settings.defaultEffort ?? "",
  };
  const remyChoice: ModelChoice = {
    provider: settings.remyProvider ?? settings.defaultProvider ?? "claude",
    model: settings.remyModel ?? "",
    effort: settings.remyEffort ?? "",
  };
  const order = [...new Set([...(settings.devicePreferenceOrder ?? []), ...servers.map((entry) => entry.id)])]
    .filter((id) => servers.some((entry) => entry.id === id));

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} style={styles.back} accessibilityLabel="Back to computers">
        <ArrowLeft size={16} color={color.mutedForeground} />
        <Text style={type.caption}>Computers</Text>
      </Pressable>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={type.title}>{server.name}</Text>
          <Text style={type.caption}>Every setting below changes this computer.</Text>
        </View>
        <Pressable onPress={() => void reload()} accessibilityLabel="Refresh settings" style={styles.iconButton}>
          <RefreshCw size={17} color={color.mutedForeground} />
        </Pressable>
      </View>

      <Section title="Thread defaults">
        <Text style={type.caption}>A workspace or agent can choose something different.</Text>
        <ModelPicker
          providers={providers}
          value={defaultChoice}
          effortUnavailable={effortUnavailable}
          onPick={(choice) => {
            const next = pairChoice(providers, choice);
            void save({ defaultProvider: next.provider, defaultModel: next.model, defaultEffort: next.effort ?? "" }, "the default model");
          }}
        />
        <Choice
          options={PERMISSIONS.map((option) => ({ value: option.value, label: option.label }))}
          value={permissionOf(settings.defaultPermissionMode).value}
          onChange={(value) => void save({ defaultPermissionMode: value }, "the default permission")}
        />
      </Section>

      <Section title="Worktree defaults">
        <Choice options={CHECKOUTS} value={settings.defaultCheckout} onChange={(value) => void save({ defaultCheckout: value as "main" | "worktree" }, "the checkout default")} />
        <Choice options={WORKTREE_BASES} value={settings.worktreeBase} onChange={(value) => void save({ worktreeBase: value as "remote" | "local" }, "the branch source")} />
        <TextField label="Worktree root" value={worktreeRoot} onChange={setWorktreeRoot} onSave={() => save({ worktreeRoot }, "the worktree root")} />
        <TextField label="Branch prefix" value={branchPrefix} onChange={setBranchPrefix} onSave={() => save({ worktreeBranchPrefix: branchPrefix }, "the branch prefix")} />
      </Section>

      <Section title="Remy">
        <Text style={type.caption}>Choose the model Remy's own conversation uses on this computer.</Text>
        <ModelPicker
          providers={providers}
          value={remyChoice}
          effortUnavailable={effortUnavailable}
          onPick={(choice) => {
            const next = pairChoice(providers, choice);
            void save({ remyProvider: next.provider, remyModel: next.model, remyEffort: next.effort ?? "" }, "Remy's model");
          }}
        />
      </Section>

      <Section title="Providers">
        {providers.map((provider) => (
          <View key={provider.id} style={styles.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.callout}>{provider.label}</Text>
              <Text style={type.caption}>{provider.available ? "Installed" : "Not installed here"}</Text>
            </View>
            <Switch
              value={provider.enabled !== false}
              disabled={!provider.available}
              onValueChange={(enabled) => void setProviderEnabled(server.id, provider.id, enabled).catch((caught) => setError(apiError(caught)))}
            />
          </View>
        ))}
      </Section>

      <Section title="Favorite models">
        {(settings.favoriteModels ?? []).length === 0 ? <Text style={type.caption}>No favorite models yet.</Text> : settings.favoriteModels.map((entry) => (
          <View key={entry} style={styles.row}>
            <Text style={[type.mono, { flex: 1 }]}>{entry}</Text>
            <Pressable onPress={() => void save({ favoriteModels: settings.favoriteModels.filter((value) => value !== entry) }, "favorite models")}><Text style={styles.remove}>Remove</Text></Pressable>
          </View>
        ))}
        <TextInput value={favorite} onChangeText={setFavorite} placeholder="provider:model" placeholderTextColor={color.mutedForeground} autoCapitalize="none" autoCorrect={false} style={styles.input} />
        <Button
          label="Add favorite"
          variant="outline"
          disabled={!favorite.trim()}
          onPress={() => {
            const next = [...new Set([...(settings.favoriteModels ?? []), favorite.trim()])];
            void save({ favoriteModels: next }, "favorite models").then(() => setFavorite(""));
          }}
        />
      </Section>

      <Section title="Repository refresh">
        <Text style={type.caption}>Fetches every workspace and fast-forwards only clean main checkouts.</Text>
        <Choice options={REPO_UPDATES} value={settings.repoUpdate} onChange={(value) => void save({ repoUpdate: value as ServerSettings["repoUpdate"] }, "repository refresh")} />
      </Section>

      <Section title="Version control">
        <Choice
          options={[{ value: "off", label: "Keep your identity" }, { value: "author", label: "Credit the agent" }]}
          value={settings.defaultGitIdentity}
          onChange={(value) => void save({ defaultGitIdentity: value as "off" | "author" }, "version-control identity")}
        />
      </Section>

      <Section title="Pull request monitoring">
        <SwitchRow label="Monitor pull requests" value={settings.pullRequestMonitoringEnabled === true} onChange={(value) => void save({ pullRequestMonitoringEnabled: value }, "pull request monitoring")} />
        {settings.pullRequestMonitoringEnabled && agents.length > 0 ? (
          <Choice
            options={[{ value: "", label: "Workspace agent" }, ...agents.map((agent) => ({ value: agent.id, label: agent.name }))]}
            value={settings.pullRequestMonitoringAgentId ?? ""}
            onChange={(value) => void save({ pullRequestMonitoringAgentId: value }, "the monitoring agent")}
          />
        ) : null}
      </Section>

      <Section title="Preferred computer order">
        <Text style={type.caption}>Device-agnostic work tries these computers from top to bottom.</Text>
        {order.map((id, index) => {
          const computer = servers.find((entry) => entry.id === id);
          return (
            <View key={id} style={styles.row}>
              <Text style={[type.callout, { flex: 1 }]}>{computer?.name ?? id}</Text>
              <OrderButton icon={ArrowUp} label="Move up" disabled={index === 0} onPress={() => {
                const next = [...order];
                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                void save({ devicePreferenceOrder: next }, "preferred computer order");
              }} />
              <OrderButton icon={ArrowDown} label="Move down" disabled={index === order.length - 1} onPress={() => {
                const next = [...order];
                [next[index], next[index + 1]] = [next[index + 1], next[index]];
                void save({ devicePreferenceOrder: next }, "preferred computer order");
              }} />
            </View>
          );
        })}
      </Section>

      <Section title="Availability and notifications">
        <SwitchRow label="Notify this computer" value={settings.notifySelf === true} onChange={(value) => void save({ notifySelf: value }, "notifications")} />
        <SwitchRow
          label="Reachable from your tailnet"
          value={settings.tailscaleServeEnabled === true}
          disabled={settings.tailscaleServeEnabled === undefined}
          onChange={(value) => void save({ tailscaleServeEnabled: value }, "tailnet reachability")}
        />
        {settings.tailscaleServeEnabled === undefined ? <Text style={type.caption}>Tailnet reachability needs a newer Remy on this computer.</Text> : null}
        <SwitchRow
          label="Keep this computer awake"
          value={settings.preventSleep !== "off"}
          disabled={settings.preventSleepSupported === false}
          onChange={(value) => void save({ preventSleep: value ? "whileBusy" : "off" }, "sleep behavior")}
        />
      </Section>

      <Section title="Tooling and Remy integration">
        {tooling ? (Object.entries(tooling) as [keyof Tooling, Tooling[keyof Tooling]][]).map(([id, status]) => (
          <View key={id} style={styles.tool}>
            <Text style={type.callout}>{id === "gh" ? "GitHub CLI" : id[0].toUpperCase() + id.slice(1)}</Text>
            <Text style={type.caption}>{toolStatus(status)}</Text>
          </View>
        )) : <Text style={type.caption}>Reading installed tools…</Text>}
        {mcp.map((entry) => (
          <View key={entry.provider} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={type.callout}>{`${providerOf(providers, entry.provider)?.label ?? entry.provider} integration`}</Text>
              <Text style={type.caption}>{entry.configured ? "Connected" : entry.installed ? "Installed, not connected" : "Not installed"}</Text>
            </View>
            <Button
              label={entry.configured ? "Remove" : "Install"}
              variant="outline"
              onPress={() => void setMcp(server.id, entry.provider, !entry.configured)
                .then(async () => setMcpState(await readMcp(server.id)))
                .catch((caught) => setError(apiError(caught)))}
            />
          </View>
        ))}
      </Section>

      <Section title="General analytics">
        {analytics ? (
          <View style={styles.metrics}>
            <Metric label="Threads" value={analytics.totals.threads} />
            <Metric label="Turns" value={analytics.totals.turns} />
            <Metric label="Tool calls" value={analytics.totals.toolCalls} />
            <Metric label="Skills" value={analytics.totals.skillInvocations} />
          </View>
        ) : <Text style={type.caption}>No analytics are available yet.</Text>}
      </Section>

      <Section title="Usage analytics">
        {analytics ? (
          <>
            <Text style={type.callout}>{`${analytics.totals.totalTokens.toLocaleString()} processed tokens`}</Text>
            <Text style={type.callout}>{`$${analytics.totals.costUsd.toFixed(2)} API-equivalent cost`}</Text>
            {analytics.providers.map((entry) => (
              <Text key={entry.provider} style={type.caption}>{`${entry.provider} · ${entry.sessions} sessions · ${entry.totalTokens.toLocaleString()} tokens`}</Text>
            ))}
            {analytics.sources.filter((source) => source.status !== "ok").map((source) => (
              <Text key={source.provider} style={type.caption}>{source.message ?? `${source.provider} usage is ${source.status}.`}</Text>
            ))}
          </>
        ) : <Text style={type.caption}>Usage appears after this computer runs a thread.</Text>}
      </Section>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><Text style={type.heading}>{title}</Text>{children}</View>;
}

function Choice({ options, value, onChange }: { options: readonly { value: string; label: string }[]; value: string; onChange: (value: string) => void }) {
  return (
    <View style={styles.choices}>
      {options.map((option) => (
        <Pressable key={option.value} onPress={() => onChange(option.value)} style={[styles.choice, option.value === value && styles.choiceOn]}>
          <Text style={[styles.choiceText, option.value === value && { color: color.primaryForeground }]}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function SwitchRow({ label, value, disabled, onChange }: { label: string; value: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <View style={styles.row}><Text style={[type.callout, { flex: 1 }]}>{label}</Text><Switch value={value} disabled={disabled} onValueChange={onChange} /></View>;
}

function TextField({ label, value, onChange, onSave }: { label: string; value: string; onChange: (value: string) => void; onSave: () => Promise<void> }) {
  return <View style={{ gap: 6 }}><Text style={type.caption}>{label}</Text><TextInput value={value} onChangeText={onChange} autoCapitalize="none" autoCorrect={false} style={styles.input} /><Button label="Save" variant="outline" onPress={() => void onSave()} /></View>;
}

function OrderButton({ icon: Icon, label, disabled, onPress }: { icon: typeof ArrowUp; label: string; disabled: boolean; onPress: () => void }) {
  return <Pressable disabled={disabled} onPress={onPress} accessibilityLabel={label} style={[styles.iconButton, disabled && { opacity: 0.25 }]}><Icon size={16} color={color.mutedForeground} /></Pressable>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <View style={styles.metric}><Text style={type.title}>{value.toLocaleString()}</Text><Text style={type.caption}>{label}</Text></View>;
}

function toolStatus(status: Tooling[keyof Tooling]): string {
  if (!status.available) return status.error ?? "Not installed";
  const parts = [status.version, status.authenticated === false ? "Signed out" : status.account, status.plan].filter(Boolean);
  if (status.updateAvailable && status.latestVersion) parts.push(`Update ${status.latestVersion} available`);
  return parts.join(" · ") || "Available";
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  wrap: { flex: 1, justifyContent: "center", padding: space.xl, gap: space.md, backgroundColor: color.background },
  content: { padding: space.lg, gap: space.xl, paddingBottom: 48 },
  back: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 36, alignSelf: "flex-start" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  section: { gap: space.md },
  row: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { borderWidth: 1, borderColor: color.border, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 7 },
  choiceOn: { backgroundColor: color.primary, borderColor: color.primary },
  choiceText: { color: color.foreground, fontSize: 13 },
  input: { borderWidth: 1, borderColor: color.border, backgroundColor: color.card, color: color.foreground, borderRadius: radius.lg, padding: 11 },
  remove: { color: color.destructive, fontSize: 12 },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  tool: { borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: 11, gap: 3 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { width: "47%", backgroundColor: color.card, borderRadius: radius.lg, padding: 12, gap: 3 },
  error: { color: color.destructive, fontSize: 13 },
});
