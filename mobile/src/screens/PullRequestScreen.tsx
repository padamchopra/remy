import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ArrowLeft, Check, ChevronDown, ChevronRight, CircleAlert, ExternalLink, GitCommit, GitPullRequest, MessageSquareText, RefreshCw } from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { apiError } from "../lib/api-error";
import { transport } from "../lib/transport";
import { useStore } from "../state/store";
import type {
  AuthoredPullRequest,
  Chat,
  PullRequestDiff,
  PullRequestDiffFile,
  PullRequestGuide,
  PullRequestGuideCommit,
  PullRequestGuideHunk,
  PullRequestGuideStep,
  PullRequestMonitoringPolicy,
  PullRequestTimelineItem,
} from "../state/types";
import { Button } from "../components/Button";
import { Markdown } from "../components/Markdown";

type Tab = "summary" | "code" | "guide";

export function PullRequestScreen({
  pullRequest: listed,
  threadId,
  onBack,
  onOpenThread,
}: {
  pullRequest: AuthoredPullRequest;
  threadId?: string;
  onBack: () => void;
  onOpenThread: (id: string) => void;
}) {
  const servers = useStore((state) => state.servers);
  const chats = useStore((state) => state.chats);
  const agents = useStore((state) => state.agents);
  const serverId = servers.find((server) => server.online && listed.sourceServerIds?.includes(server.id))?.id ?? listed.serverId;
  const related = threadId ? chats.find((chat) => chat.id === threadId) : relatedThread(listed, chats);
  const [tab, setTab] = useState<Tab>("summary");
  const [pullRequest, setPullRequest] = useState<PullRequestDiff>();
  const [timeline, setTimeline] = useState<PullRequestTimelineItem[]>([]);
  const [policy, setPolicy] = useState<PullRequestMonitoringPolicy>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [opened, setOpened] = useState(new Set<string>());

  const params = useMemo(() => new URLSearchParams({ repository: listed.repository, number: String(listed.number) }).toString(), [listed.number, listed.repository]);
  const monitoringPath = `/pull-request-monitoring?${new URLSearchParams({ workspaceId: listed.workspaceId, repository: listed.repository, number: String(listed.number) })}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [diff, activity, monitoring] = await Promise.all([
        transport.request<{ diff: PullRequestDiff }>(serverId, `/pull-requests/diff?${params}`),
        transport.request<{ timeline?: PullRequestTimelineItem[] }>(serverId, `/pull-requests/timeline?${params}`),
        transport.request<{ policy: PullRequestMonitoringPolicy }>(serverId, monitoringPath),
      ]);
      try {
        const views = await transport.request<{ review?: { id?: string; files?: { path: string; viewed: boolean }[] } }>(serverId, `/pull-requests/file-views?${params}`);
        const viewed = new Map((views.review?.files ?? []).map((file) => [file.path, file.viewed]));
        diff.diff.files = diff.diff.files.map((file) => ({ ...file, viewed: viewed.get(file.path) ?? file.viewed }));
      } catch {
        // The diff remains useful when GitHub cannot answer with viewed state.
      }
      setPullRequest(diff.diff);
      setTimeline(activity.timeline ?? []);
      setPolicy(monitoring.policy);
      void transport.request(serverId, "/pull-requests/read", { method: "POST", body: { repository: listed.repository, number: listed.number } }).catch(() => {});
    } catch (caught) {
      setError(apiError(caught));
    } finally {
      setLoading(false);
    }
  }, [monitoringPath, params, serverId]);

  useEffect(() => { void load(); }, [load]);

  const savePolicy = async (next?: { enabled: boolean; agentId: string | null; chatId: string | null }) => {
    try {
      const answer = await transport.request<{ policy: PullRequestMonitoringPolicy }>(serverId, monitoringPath, next
        ? { method: "PATCH", body: next }
        : { method: "DELETE" });
      setPolicy(answer.policy);
    } catch (caught) {
      setError(`Couldn't change monitoring: ${apiError(caught)}`);
    }
  };

  const markReady = () => Alert.alert("Mark this pull request ready?", "Reviewers will see that this draft is ready for review.", [
    { text: "Cancel", style: "cancel" },
    { text: "Mark ready", onPress: () => void transport.request(serverId, "/pull-requests/ready", {
      method: "POST", body: { repository: listed.repository, number: listed.number },
    }).then(() => setPullRequest((current) => current ? { ...current, isDraft: false } : current))
      .catch((caught) => setError(`Couldn't mark it ready: ${apiError(caught)}`)) },
  ]);

  return (
    <View style={styles.root}>
      <View style={styles.chrome}>
        <Pressable onPress={onBack} accessibilityLabel="Back to pull requests" style={styles.icon}><ArrowLeft size={18} color={color.foreground} /></Pressable>
        <GitPullRequest size={17} color={color.mutedForeground} />
        <Text style={[type.callout, { flex: 1 }]} numberOfLines={1}>{`#${listed.number} · ${listed.title}`}</Text>
        <Pressable onPress={() => void load()} accessibilityLabel="Refresh pull request" style={styles.icon}><RefreshCw size={17} color={color.mutedForeground} /></Pressable>
        <Pressable onPress={() => void Linking.openURL(listed.url)} accessibilityLabel="Open on GitHub" style={styles.icon}><ExternalLink size={17} color={color.mutedForeground} /></Pressable>
      </View>
      <View style={styles.tabs}>
        {(["summary", "code", "guide"] as const).map((value) => <TabButton key={value} label={value === "guide" ? "Guided review" : value[0].toUpperCase() + value.slice(1)} selected={tab === value} onPress={() => setTab(value)} />)}
      </View>
      {loading && !pullRequest ? <Centered text="Reading this pull request…" />
        : error && !pullRequest ? <View style={styles.center}><CircleAlert size={22} color={color.destructive} /><Text style={styles.error}>{error}</Text><Button label="Try again" variant="outline" onPress={() => void load()} /><Button label="Open on GitHub" variant="ghost" onPress={() => void Linking.openURL(listed.url)} /></View>
          : pullRequest ? (
            tab === "summary" ? <Summary pullRequest={pullRequest} listed={listed} timeline={timeline} policy={policy} agents={agents.filter((agent) => agent.serverId === serverId)} related={related} onPolicy={savePolicy} onThread={onOpenThread} onReady={markReady} />
              : tab === "code" ? <CodeReview pullRequest={pullRequest} serverId={serverId} opened={opened} setOpened={setOpened} setPullRequest={setPullRequest} setError={setError} />
                : <GuidedReview pullRequest={pullRequest} listed={listed} serverId={serverId} related={related} onThread={onOpenThread} />
          ) : null}
      {error && pullRequest ? <Text style={styles.inlineError}>{error}</Text> : null}
    </View>
  );
}

function Summary({ pullRequest, listed, timeline, policy, agents, related, onPolicy, onThread, onReady }: {
  pullRequest: PullRequestDiff;
  listed: AuthoredPullRequest;
  timeline: PullRequestTimelineItem[];
  policy?: PullRequestMonitoringPolicy;
  agents: ReturnType<typeof useStore.getState>["agents"];
  related?: Chat;
  onPolicy: (next?: { enabled: boolean; agentId: string | null; chatId: string | null }) => Promise<void>;
  onThread: (id: string) => void;
  onReady: () => void;
}) {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={type.title}>{pullRequest.title}</Text>
      <Text style={type.caption}>{`${pullRequest.repository} · ${pullRequest.headRefName} → ${pullRequest.baseRefName}`}</Text>
      <View style={styles.metrics}><Metric label="Files" value={pullRequest.changedFiles} /><Metric label="Added" value={pullRequest.additions} /><Metric label="Removed" value={pullRequest.deletions} /></View>
      {pullRequest.body ? <Markdown text={pullRequest.body} /> : <Text style={type.caption}>No description.</Text>}
      {pullRequest.isDraft ? <Button label="Mark ready for review" variant="outline" onPress={onReady} /> : null}
      {related ? <Button label="Open related thread" variant="ghost" onPress={() => onThread(related.id)} /> : null}

      <Section title="Checks">
        {pullRequest.checks.length === 0 ? <Text style={type.caption}>No checks reported.</Text> : pullRequest.checks.map((check) => <View key={check.name} style={styles.row}><StatusDot state={check.state} /><Text style={[type.callout, { flex: 1 }]}>{check.name}</Text><Text style={type.caption}>{check.state}</Text></View>)}
      </Section>

      {listed.stack ? <Section title={`Stack #${listed.stack.number}`}><Text style={type.caption}>{`${listed.stack.position} of ${listed.stack.size} · based on ${listed.stack.baseRefName}`}</Text>{listed.stack.entries?.sort((a, b) => b.position - a.position).map((entry) => <Text key={entry.number} style={type.callout}>{`${entry.position}. #${entry.number} ${entry.title} · ${entry.isDraft ? "Draft" : entry.state.toLowerCase()}`}</Text>)}</Section> : null}

      <Section title="Monitoring">
        <Text style={type.caption}>{policy ? `${policy.enabled ? "On" : "Off"} · ${policy.explicit ? "Set for this pull request" : `Inherited from ${policy.source === "workspace" ? "the workspace" : "Remy"}`}` : "Reading monitoring policy…"}</Text>
        <View style={styles.wrapRow}>
          <Button label="Off" variant={!policy?.enabled && policy?.explicit ? "primary" : "outline"} onPress={() => void onPolicy({ enabled: false, agentId: null, chatId: null })} />
          {related ? <Button label="This thread" variant={policy?.chatId === related.id ? "primary" : "outline"} onPress={() => void onPolicy({ enabled: true, agentId: null, chatId: related.id })} /> : null}
          {agents.map((agent) => <Button key={agent.id} label={agent.name} variant={policy?.agentId === agent.id ? "primary" : "outline"} onPress={() => void onPolicy({ enabled: true, agentId: agent.id, chatId: null })} />)}
          {policy?.explicit ? <Button label="Use inherited" variant="ghost" onPress={() => void onPolicy()} /> : null}
        </View>
      </Section>

      <Section title="Recent activity">
        {timeline.length === 0 ? <Text style={type.caption}>No recent activity.</Text> : timeline.map((item) => <View key={item.id} style={styles.activity}><GitCommit size={15} color={color.mutedForeground} /><View style={{ flex: 1, gap: 3 }}><Text style={type.callout}>{`${item.author} · ${item.kind.replace("_", " ")}${item.state ? ` · ${item.state.toLowerCase()}` : ""}`}</Text>{item.body ? <Markdown text={item.body} /> : null}<Text style={type.caption}>{new Date(item.createdAt).toLocaleString()}</Text></View></View>)}
      </Section>
    </ScrollView>
  );
}

function CodeReview({ pullRequest, serverId, opened, setOpened, setPullRequest, setError }: {
  pullRequest: PullRequestDiff;
  serverId: string;
  opened: Set<string>;
  setOpened: (next: Set<string>) => void;
  setPullRequest: (update: (current?: PullRequestDiff) => PullRequestDiff | undefined) => void;
  setError: (error?: string) => void;
}) {
  const mark = async (file: PullRequestDiffFile, viewed: boolean) => {
    if (!pullRequest.nodeId) return setError("GitHub did not return a review id. Refresh and try again.");
    try {
      await transport.request(serverId, "/pull-requests/file-viewed", { method: "POST", body: { pullRequestId: pullRequest.nodeId, path: file.path, viewed } });
      setPullRequest((current) => current ? { ...current, files: current.files.map((entry) => entry.path === file.path ? { ...entry, viewed } : entry) } : current);
    } catch (caught) {
      setError(`Couldn't update that file: ${apiError(caught)}`);
    }
  };
  return <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>{pullRequest.files.length === 0 ? <Text style={styles.empty}>This pull request has no changed files.</Text> : pullRequest.files.map((file) => {
    const open = opened.has(file.path);
    return <View key={file.path} style={styles.file}><Pressable onPress={() => { const next = new Set(opened); open ? next.delete(file.path) : next.add(file.path); setOpened(next); }} style={styles.fileHead}>{open ? <ChevronDown size={17} color={color.mutedForeground} /> : <ChevronRight size={17} color={color.mutedForeground} />}<Text style={[type.mono, { flex: 1 }]} numberOfLines={2}>{file.path}</Text>{file.viewed ? <Check size={16} color={color.primary} /> : null}</Pressable>{open ? <View style={styles.fileBody}>{file.hunks.map((hunk, index) => <View key={`${file.path}:${index}`}><Text style={styles.hunk}>{hunk.header}</Text>{hunk.lines.map((line, lineIndex) => <DiffLine key={`${lineIndex}:${line.oldLine}:${line.newLine}`} line={line} />)}</View>)}<Button label={file.viewed ? "Mark not viewed" : "Mark viewed"} variant="outline" onPress={() => void mark(file, !file.viewed)} /></View> : null}</View>;
  })}</ScrollView>;
}

function GuidedReview({ pullRequest, listed, serverId, related, onThread }: { pullRequest: PullRequestDiff; listed: AuthoredPullRequest; serverId: string; related?: Chat; onThread: (id: string) => void }) {
  const [guide, setGuide] = useState<PullRequestGuide>();
  const [commits, setCommits] = useState<PullRequestGuideCommit[]>([]);
  const [selected, setSelected] = useState(new Set<string>());
  const [owner, setOwner] = useState(serverId);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string>();
  const [stepIndex, setStepIndex] = useState(0);
  const params = new URLSearchParams({ repository: pullRequest.repository, number: String(pullRequest.number), ...(related ? { chatId: related.id } : {}) }).toString();

  const load = useCallback(async () => {
    setLoading(true); setError(undefined);
    try {
      const found = await transport.request<{ guide?: PullRequestGuide; peerId?: string }>(serverId, `/pull-requests/guide/discover?${params}`);
      if (found.guide) {
        setGuide(found.guide); setCommits(found.guide.commits); setSelected(new Set(found.guide.commitShas)); setOwner(found.peerId ?? serverId);
      } else {
        const context = await transport.request<{ guide?: PullRequestGuide; commits: PullRequestGuideCommit[] }>(serverId, `/pull-requests/guide?${params}`);
        setGuide(context.guide); setCommits(context.guide?.commits ?? context.commits); setSelected(new Set(context.guide?.commitShas ?? context.commits.map((commit) => commit.sha)));
      }
    } catch (caught) { setError(apiError(caught)); } finally { setLoading(false); }
  }, [params, serverId]);
  useEffect(() => { void load(); }, [load]);

  const start = async () => {
    setGenerating(true); setError(undefined);
    try {
      const result = await transport.request<{ guide: PullRequestGuide }>(serverId, "/pull-requests/guide", { method: "POST", body: { repository: pullRequest.repository, number: pullRequest.number, ...(related ? { chatId: related.id } : {}), commitShas: commits.filter((commit) => selected.has(commit.sha)).map((commit) => commit.sha) } });
      setGuide(result.guide); setOwner(serverId);
    } catch (caught) { setError(apiError(caught)); } finally { setGenerating(false); }
  };

  if (loading && !guide) return <Centered text="Looking for a saved review…" />;
  if (!guide) return <ScrollView style={styles.scroll} contentContainerStyle={styles.content}><Text style={type.title}>Build a guided review</Text><Text style={type.caption}>Choose commits, then let the inherited thread or workspace model arrange the changes into a reading order.</Text>{commits.map((commit) => <Pressable key={commit.sha} onPress={() => { const next = new Set(selected); next.has(commit.sha) ? next.delete(commit.sha) : next.add(commit.sha); setSelected(next); }} style={styles.commit}>{selected.has(commit.sha) ? <Check size={16} color={color.primary} /> : <View style={styles.unchecked} />}<View style={{ flex: 1 }}><Text style={type.callout}>{commit.title}</Text><Text style={type.caption}>{`${commit.author} · ${commit.sha.slice(0, 7)}`}</Text></View></Pressable>)}{error ? <Text style={styles.error}>{error}</Text> : null}<View style={styles.wrapRow}>{error ? <Button label="Try again" variant="outline" onPress={() => void load()} /> : null}<Button label={generating ? "Building guide…" : "Start review"} busy={generating} disabled={selected.size === 0 || commits.length === 0} onPress={() => void start()} /></View></ScrollView>;

  const surfaced = new Set(guide.steps.flatMap((step) => step.hunkIds));
  const steps = [...guide.steps];
  const uncovered = guide.hunks.filter((hunk) => !surfaced.has(hunk.id));
  if (uncovered.length > 0) steps.push({ id: "uncovered", title: "Changes the guide missed", summary: "These changes are in the selected diff but not in a generated step.", hunkIds: uncovered.map((hunk) => hunk.id) });
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const stale = guide.hunks.some((hunk) => hunk.revision?.head && pullRequest.headRefOid && hunk.revision.head !== pullRequest.headRefOid);
  return <ScrollView style={styles.scroll} contentContainerStyle={styles.content}><View><Text style={type.title}>Guided review</Text><Text style={type.caption}>{`${guide.commits.length} ${guide.commits.length === 1 ? "commit" : "commits"} · ${steps.length} ${steps.length === 1 ? "step" : "steps"}`}</Text></View>{stale ? <View style={styles.notice}><CircleAlert size={16} color={color.destructive} /><Text style={[type.caption, { flex: 1 }]}>This saved guide belongs to an earlier revision. The Code tab has the current changes.</Text></View> : null}{error ? <View style={styles.notice}><Text style={[styles.error, { flex: 1 }]}>{error}</Text><Pressable onPress={() => void load()}><Text style={styles.action}>Reconnect</Text></Pressable></View> : null}{step ? <GuideStepView guide={guide} step={step} owner={owner} pullRequest={pullRequest} related={related} onGuide={setGuide} onError={setError} onThread={onThread} /> : <Text style={styles.empty}>This guide has no steps.</Text>}<View style={styles.guideNav}><Button label="Previous" variant="outline" disabled={stepIndex === 0} onPress={() => setStepIndex((index) => Math.max(0, index - 1))} /><Text style={type.caption}>{`${stepIndex + 1} of ${steps.length}`}</Text><Button label="Next" variant="outline" disabled={stepIndex >= steps.length - 1} onPress={() => setStepIndex((index) => Math.min(steps.length - 1, index + 1))} /></View></ScrollView>;
}

function GuideStepView({ guide, step, owner, pullRequest, related, onGuide, onError, onThread }: { guide: PullRequestGuide; step: PullRequestGuideStep; owner: string; pullRequest: PullRequestDiff; related?: Chat; onGuide: (guide: PullRequestGuide) => void; onError: (error?: string) => void; onThread: (id: string) => void }) {
  const hunks = step.hunkIds.flatMap((id) => guide.hunks.find((hunk) => hunk.id === id) ?? []);
  return <View style={{ gap: space.lg }}><View><Text style={type.heading}>{step.title}</Text><Markdown text={step.summary} /></View>{hunks.map((hunk) => <GuideHunkView key={hunk.id} guide={guide} step={step} hunk={hunk} owner={owner} pullRequest={pullRequest} related={related} onGuide={onGuide} onError={onError} onThread={onThread} />)}</View>;
}

function GuideHunkView({ guide, step, hunk, owner, pullRequest, related, onGuide, onError, onThread }: { guide: PullRequestGuide; step: PullRequestGuideStep; hunk: PullRequestGuideHunk; owner: string; pullRequest: PullRequestDiff; related?: Chat; onGuide: (guide: PullRequestGuide) => void; onError: (error?: string) => void; onThread: (id: string) => void }) {
  const [start, setStart] = useState<number>();
  const [end, setEnd] = useState<number>();
  const [question, setQuestion] = useState("");
  const selected = start === undefined ? undefined : [Math.min(start, end ?? start), Math.max(start, end ?? start)] as const;
  const ask = async () => {
    if (!selected || !question.trim()) return;
    try {
      const result = await transport.request<{ guide: PullRequestGuide }>(owner, "/pull-requests/guide/question", { method: "POST", body: { repository: guide.repository, number: guide.number, stepId: step.id, hunkId: hunk.id, start: selected[0], end: selected[1], question } });
      onGuide(result.guide); setQuestion("");
    } catch (caught) { onError(`Couldn't answer that question: ${apiError(caught)}`); }
  };
  const send = async () => {
    if (!related || !selected) return;
    const lines = hunk.lines.slice(selected[0], selected[1] + 1);
    try {
      await transport.request(related.serverId, `/chats/${encodeURIComponent(related.id)}/message`, { method: "POST", body: { text: "Review this change.", codeReferences: [{ id: `pr-${Date.now()}`, path: hunk.path, startLine: lines.find((line) => line.newLine !== null)?.newLine ?? 1, endLine: [...lines].reverse().find((line) => line.newLine !== null)?.newLine ?? 1, comment: `Pull request #${pullRequest.number}`, lines }] } });
      onThread(related.id);
    } catch (caught) { onError(`Couldn't send that context: ${apiError(caught)}`); }
  };
  const questions = guide.questions.filter((entry) => entry.stepId === step.id && entry.hunkId === hunk.id);
  return <View style={styles.file}><View style={styles.fileHead}><Text style={[type.mono, { flex: 1 }]}>{hunk.path}</Text></View><Text style={styles.hunk}>{hunk.header}</Text>{hunk.lines.map((line, index) => <Pressable key={`${index}:${line.oldLine}:${line.newLine}`} onPress={() => { if (start === undefined || end !== undefined) { setStart(index); setEnd(undefined); } else setEnd(index); }} style={selected && index >= selected[0] && index <= selected[1] ? styles.selectedLine : undefined}><DiffLine line={line} /></Pressable>)}{selected ? <View style={styles.question}><Text style={type.caption}>{`Lines ${selected[0] + 1}–${selected[1] + 1} selected`}</Text><TextInput value={question} onChangeText={setQuestion} placeholder="Ask about these lines" placeholderTextColor={color.mutedForeground} multiline style={styles.input} /><View style={styles.wrapRow}><Button label="Ask" disabled={!question.trim()} onPress={() => void ask()} />{related ? <Button label="Send to thread" variant="outline" onPress={() => void send()} /> : null}</View></View> : <Text style={type.caption}>Tap one line, then another, to select a range.</Text>}{questions.map((entry) => <View key={entry.id} style={styles.answer}><Text style={type.callout}>{entry.question}</Text><Markdown text={entry.answer} /></View>)}</View>;
}

function relatedThread(pullRequest: AuthoredPullRequest, chats: Chat[]): Chat | undefined {
  if (!pullRequest.worktreePath) return chats.find((chat) => chat.serverId === pullRequest.serverId && chat.cwd.startsWith(pullRequest.workspacePath));
  return chats.filter((chat) => chat.serverId === pullRequest.serverId && (chat.cwd === pullRequest.worktreePath || chat.cwd.startsWith(`${pullRequest.worktreePath}/`))).sort((left, right) => right.updatedAt - left.updatedAt)[0];
}

function TabButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.tab, selected && styles.tabOn]}><Text style={[styles.tabText, selected && { color: color.foreground }]}>{label}</Text></Pressable>; }
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <View style={{ gap: space.sm }}><Text style={type.heading}>{title}</Text>{children}</View>; }
function Metric({ label, value }: { label: string; value: number }) { return <View style={styles.metric}><Text style={type.heading}>{value.toLocaleString()}</Text><Text style={type.caption}>{label}</Text></View>; }
function StatusDot({ state }: { state: "pass" | "fail" | "pending" | "skipping" }) { return <View style={[styles.dot, { backgroundColor: state === "fail" ? color.destructive : state === "pass" ? color.primary : color.mutedForeground }]} />; }
function Centered({ text }: { text: string }) { return <View style={styles.center}><Text style={type.caption}>{text}</Text></View>; }
function DiffLine({ line }: { line: PullRequestDiff["files"][number]["hunks"][number]["lines"][number] }) { return <View style={[styles.line, line.kind === "add" ? styles.add : line.kind === "del" ? styles.del : undefined]}><Text style={styles.number}>{line.newLine ?? line.oldLine ?? ""}</Text><Text style={styles.code}>{`${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`}</Text></View>; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  chrome: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  icon: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  tab: { flex: 1, alignItems: "center", paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabOn: { borderBottomColor: color.primary },
  tabText: { color: color.mutedForeground, fontSize: 13, fontWeight: "600" },
  scroll: { flex: 1 }, content: { padding: space.lg, gap: space.xl, paddingBottom: 56 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl },
  error: { color: color.destructive, fontSize: 13, textAlign: "center" },
  inlineError: { color: color.destructive, fontSize: 12, paddingHorizontal: space.md, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border },
  metrics: { flexDirection: "row", gap: 8 }, metric: { flex: 1, alignItems: "center", gap: 2, backgroundColor: color.card, borderRadius: radius.lg, padding: 10 },
  row: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 8 }, dot: { width: 8, height: 8, borderRadius: 4 },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  activity: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border, paddingTop: 10 },
  file: { overflow: "hidden", borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, backgroundColor: color.card },
  fileHead: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10 }, fileBody: { gap: space.md, paddingBottom: space.md },
  hunk: { ...type.mono, color: color.mutedForeground, backgroundColor: color.muted, paddingHorizontal: 9, paddingVertical: 6 },
  line: { minHeight: 22, flexDirection: "row", alignItems: "flex-start", paddingRight: 6 }, add: { backgroundColor: "rgba(34,197,94,0.12)" }, del: { backgroundColor: "rgba(248,113,113,0.12)" },
  selectedLine: { backgroundColor: "rgba(96,165,250,0.22)" }, number: { width: 40, color: color.mutedForeground, fontFamily: "Menlo", fontSize: 10, textAlign: "right", paddingRight: 7, paddingTop: 3 }, code: { flex: 1, color: color.foreground, fontFamily: "Menlo", fontSize: 11, lineHeight: 17 },
  empty: { ...type.caption, textAlign: "center", padding: space.xl }, notice: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: 10 }, action: { color: color.primary, fontSize: 13, fontWeight: "600" },
  commit: { flexDirection: "row", alignItems: "center", gap: 9, minHeight: 48, padding: 9, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg }, unchecked: { width: 16, height: 16, borderWidth: 1, borderColor: color.border, borderRadius: 4 },
  guideNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, question: { gap: 8, padding: 10 }, input: { minHeight: 68, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, color: color.foreground, padding: 9, textAlignVertical: "top" }, answer: { gap: 6, margin: 10, padding: 10, borderRadius: radius.md, backgroundColor: color.muted },
});
