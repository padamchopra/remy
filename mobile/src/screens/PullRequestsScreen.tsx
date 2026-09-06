import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { CircleAlert, GitPullRequest, RefreshCw } from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { mergePullRequests, pullRequestAttention } from "../lib/pull-requests";
import { transport } from "../lib/transport";
import { useStore } from "../state/store";
import type { AuthoredPullRequest } from "../state/types";

const cache = new Map<string, AuthoredPullRequest[]>();

export function PullRequestsScreen({ onOpen }: { onOpen: (pullRequest: AuthoredPullRequest) => void }) {
  const servers = useStore((state) => state.servers.filter((server) => !server.cloud && !server.workspaceOnly));
  const serverKey = servers.map((server) => `${server.id}:${server.online}`).sort().join("\0");
  const serversRef = useRef(servers);
  serversRef.current = servers;
  const [pullRequests, setPullRequests] = useState<AuthoredPullRequest[]>(() => mergePullRequests([...cache.values()].flat()));
  const [filter, setFilter] = useState<"all" | "ready" | "draft">("all");
  const [loading, setLoading] = useState(cache.size === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    const eligible = serversRef.current;
    const available = eligible.filter((server) => server.online);
    const batches = await Promise.all(available.map(async (server) => {
      try {
        const result = await transport.request<{ pullRequests?: Omit<AuthoredPullRequest, "serverId">[] }>(
          server.id, `/pull-requests${refresh ? "?refresh=1" : ""}`,
        );
        return { serverId: server.id, rows: (result.pullRequests ?? []).map((row) => ({ ...row, serverId: server.id })) };
      } catch {
        return { serverId: server.id };
      }
    }));
    for (const batch of batches) if (batch.rows) cache.set(batch.serverId, batch.rows);
    const ids = new Set(eligible.map((server) => server.id));
    for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
    setPullRequests(mergePullRequests([...cache.values()].flat()));
    setFailed(batches.filter((batch) => !batch.rows).map((batch) => batch.serverId));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load, serverKey]);

  useEffect(() => transport.subscribe((_source, payload) => {
    if (payload && typeof payload === "object" && (payload as { type?: unknown }).type === "pull-requests") void load(true);
  }, ["pull-requests", "sidebar"]), [load]);

  const visible = useMemo(() => pullRequests.filter((pullRequest) => filter === "all"
    || (filter === "draft" ? pullRequest.isDraft : !pullRequest.isDraft)), [filter, pullRequests]);
  const unavailable = servers.filter((server) => !server.online || failed.includes(server.id));

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} refreshControl={undefined}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={type.heading}>Pull requests</Text>
          <Text style={type.caption}>Your authored work across every available computer.</Text>
        </View>
        <Pressable onPress={() => void load(true)} accessibilityLabel="Refresh pull requests" style={styles.refresh}>
          <RefreshCw size={17} color={color.mutedForeground} />
        </Pressable>
      </View>
      <View style={styles.filters}>
        <Filter label={`All ${pullRequests.length}`} selected={filter === "all"} onPress={() => setFilter("all")} />
        <Filter label={`Ready ${pullRequests.filter((row) => !row.isDraft).length}`} selected={filter === "ready"} onPress={() => setFilter("ready")} />
        <Filter label={`Drafts ${pullRequests.filter((row) => row.isDraft).length}`} selected={filter === "draft"} onPress={() => setFilter("draft")} />
      </View>

      {unavailable.length > 0 ? (
        <View style={styles.notice}>
          <CircleAlert size={16} color={color.mutedForeground} />
          <Text style={[type.caption, { flex: 1 }]}>{`${unavailable.map((server) => server.name).join(" · ")} ${unavailable.length === 1 ? "is" : "are"} unavailable. Showing everything else.`}</Text>
          <Pressable onPress={() => void load(true)}><Text style={styles.action}>Try again</Text></Pressable>
        </View>
      ) : null}

      {loading ? <Text style={styles.empty}>Reading pull requests…</Text>
        : visible.length === 0 ? <Text style={styles.empty}>{pullRequests.length === 0 ? "No pull requests need attention." : "No pull requests match this filter."}</Text>
          : visible.map((pullRequest) => <PullRequestRow key={pullRequest.url} pullRequest={pullRequest} onPress={() => onOpen(pullRequest)} />)}
      {refreshing ? <Text style={type.caption}>Refreshing…</Text> : null}
    </ScrollView>
  );
}

function Filter({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.filter, selected && styles.filterOn]}><Text style={[styles.filterText, selected && styles.filterTextOn]}>{label}</Text></Pressable>;
}

function PullRequestRow({ pullRequest, onPress }: { pullRequest: AuthoredPullRequest; onPress: () => void }) {
  const attention = pullRequestAttention(pullRequest);
  const checks = pullRequest.checks.length === 0 ? "No checks"
    : pullRequest.checks.some((check) => check.state === "fail") ? "Checks failing"
      : pullRequest.checks.some((check) => check.state === "pending") ? "Checks running"
        : "Checks complete";
  const activity = pullRequest.unreadComments[0] ?? pullRequest.comments[0];
  return (
    <Pressable onPress={onPress} accessibilityLabel={`Open pull request #${pullRequest.number}`} style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}>
      <GitPullRequest size={18} color={attention === "failing" ? color.destructive : attention === "waiting" ? color.primary : color.mutedForeground} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={type.callout} numberOfLines={2}>{pullRequest.title}</Text>
        <Text style={type.caption}>{`${pullRequest.repository} · #${pullRequest.number} · ${pullRequest.authorLogin || "Unknown author"}`}</Text>
        <Text style={type.caption}>{`${pullRequest.isDraft ? "Draft" : "Open"} · ${reviewLabel(pullRequest.reviewDecision)} · ${checks}`}</Text>
        {pullRequest.stack ? <Text style={type.caption}>{`Stack #${pullRequest.stack.number} · ${pullRequest.stack.position} of ${pullRequest.stack.size}`}</Text> : null}
        {activity ? <Text style={styles.activity} numberOfLines={2}>{`${activity.author}: ${activity.body}`}</Text> : null}
      </View>
    </Pressable>
  );
}

function reviewLabel(value: string): string {
  if (value === "APPROVED") return "Approved";
  if (value === "CHANGES_REQUESTED") return "Changes requested";
  if (value === "REVIEW_REQUIRED") return "Review needed";
  return "No review decision";
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  content: { padding: space.lg, gap: space.md, paddingBottom: 48 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  refresh: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  filters: { flexDirection: "row", gap: 6 },
  filter: { borderWidth: 1, borderColor: color.border, borderRadius: radius.full, paddingHorizontal: 11, paddingVertical: 7 },
  filterOn: { backgroundColor: color.primary, borderColor: color.primary },
  filterText: { color: color.foreground, fontSize: 13, fontWeight: "600" },
  filterTextOn: { color: color.primaryForeground },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: 10 },
  action: { color: color.primary, fontSize: 13, fontWeight: "600" },
  card: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderColor: color.border, backgroundColor: color.card, borderRadius: radius.lg, padding: 12 },
  activity: { ...type.caption, color: color.foreground, backgroundColor: color.muted, borderRadius: radius.md, padding: 7 },
  empty: { ...type.caption, textAlign: "center", padding: space.xl, borderWidth: 1, borderStyle: "dashed", borderColor: color.border, borderRadius: radius.lg },
});
