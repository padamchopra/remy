import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ArrowUp,
  Bot,
  FolderGit2,
  GitPullRequest,
  Loader,
  Square,
  SquareKanban,
  Terminal,
  Wrench,
} from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { apiError } from "../lib/api-error";
import { CLOUD_MODES, cloudModeOf, PERMISSIONS, permissionOf } from "../lib/chat-options";
import { displayPath } from "../lib/path";
import { workspaceForPath } from "../lib/projects";
import { pairChoice, providerOf } from "../lib/providers";
import { useProviders, useStore, useSupportsEffort } from "../state/store";
import type {
  ChatApproval,
  ChatQuestionRequest,
  ConvArtifact,
  ConvDiffLine,
  ConvEntry,
  PullRequestSummary,
  ThreadActivity,
} from "../state/types";
import { StateBadge } from "../components/Badge";
import { Button } from "../components/Button";
import { ComposerMenu } from "../components/ComposerMenu";
import { EmptyState } from "../components/Empty";
import { Markdown } from "../components/Markdown";
import { ModelPicker } from "../components/ModelPicker";

export function ThreadScreen({
  id,
  onOpenArtifact,
}: {
  id: string;
  /// Where a card a Remy tool left in the feed goes when you tap it.
  onOpenArtifact?: (artifact: ConvArtifact) => void;
}) {
  // Both lists: an inbox conversation is opened by this screen too, and it is
  // never in `chats`.
  const chat = useStore((s) => s.chats.find((entry) => entry.id === id)
    ?? s.dms.find((entry) => entry.id === id));
  const detail = useStore((s) => s.detail);
  const loading = useStore((s) => s.detailLoading);
  const openChat = useStore((s) => s.openChat);
  const closeChat = useStore((s) => s.closeChat);
  const sendMessage = useStore((s) => s.sendMessage);
  const answerApproval = useStore((s) => s.answerApproval);
  const answerQuestion = useStore((s) => s.answerQuestion);
  const interrupt = useStore((s) => s.interrupt);
  const setChatOptions = useStore((s) => s.setChatOptions);
  const workspaces = useStore((s) => s.workspaces);
  const servers = useStore((s) => s.servers);
  const threadPullRequest = useStore((s) => s.threadPullRequest);
  const serverId = chat?.serverId;
  const providers = useProviders(serverId);
  const effortSupported = useSupportsEffort(serverId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [pullRequest, setPullRequest] = useState<PullRequestSummary>();
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    void openChat(id).catch((caught) => setError(apiError(caught)));
    return () => closeChat();
  }, [id, openChat, closeChat]);

  // The branch's pull request, re-read whenever the thread settles: a turn that
  // just finished is the turn most likely to have opened one.
  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;
    void threadPullRequest(id)
      .then((found) => {
        if (!cancelled) setPullRequest(found);
      })
      .catch(() => {
        if (!cancelled) setPullRequest(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [id, serverId, threadPullRequest, detail?.state]);

  if (!chat) {
    return (
      <View style={styles.wrap}>
        <EmptyState title="That thread is gone" detail="It was deleted on the Mac." />
      </View>
    );
  }

  const open = detail?.id === chat.id ? detail : undefined;
  const state = open?.state ?? chat.state;
  const working = state === "working";
  const entries = open?.entries ?? [];
  const workspace = workspaces[workspaceForPath(chat.cwd, workspaces)];
  const server = servers.find((entry) => entry.id === chat.serverId);
  const cloud = server?.cloud === true;
  const permission = cloud ? cloudModeOf(open?.permissionMode) : permissionOf(open?.permissionMode);
  const provider = open?.provider ?? chat.provider ?? "claude";
  const agentName = cloud ? "Cursor Cloud" : providerOf(providers, provider)?.label ?? "Claude";
  const asks = cloud || providerOf(providers, provider)?.approvals !== false;

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await sendMessage(trimmed);
      setText("");
    } catch (caught) {
      setError(apiError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={88}>
      <View style={styles.header}>
        <Text style={[type.caption, { flex: 1 }]} numberOfLines={1}>
          {workspace?.name ?? server?.name ?? "This Mac"} · {displayPath(chat.cwd)}
        </Text>
        <StateBadge state={state} />
      </View>
      {pullRequest ? <PullRequestRow pullRequest={pullRequest} /> : null}

      <ScrollView
        ref={scroll}
        style={styles.feed}
        contentContainerStyle={styles.feedContent}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
      >
        {loading && entries.length === 0 ? (
          <ActivityIndicator color={color.foreground} style={{ marginTop: 40 }} />
        ) : entries.length === 0 ? (
          <Text style={[type.body, { color: color.mutedForeground }]}>Send a message to get this thread going.</Text>
        ) : (
          entries.map((entry) => (
            <Entry key={entry.id} entry={entry} agentName={agentName} onOpenArtifact={onOpenArtifact} />
          ))
        )}
        {open?.approval ? (
          <ApprovalCard
            approval={open.approval}
            onDecide={async (decision) => {
              try {
                await answerApproval(open.approval!.requestId, decision);
              } catch (caught) {
                setError(apiError(caught));
              }
            }}
          />
        ) : null}
        {open?.question ? (
          <QuestionCard
            request={open.question}
            onAnswer={async (answers) => {
              try {
                await answerQuestion(open.question!.requestId, answers);
              } catch (caught) {
                setError(apiError(caught));
              }
            }}
          />
        ) : null}
        {open?.error ? <Text style={styles.threadError}>{open.error}</Text> : null}
      </ScrollView>

      <View style={styles.composer}>
        {error ? <Text style={styles.threadError}>{error}</Text> : null}
        <View style={styles.toolbar}>
          {cloud ? (
            <Text style={type.caption}>Cursor Cloud default</Text>
          ) : (
            <ModelPicker
              providers={providers}
              value={{ provider, model: open?.model ?? "", effort: open?.effort ?? "" }}
              // A thread keeps the provider that wrote its transcript.
              onlyProvider={provider}
              effortUnavailable={!effortSupported}
              onPick={(next) => {
                const settled = pairChoice(providers, next);
                void setChatOptions({
                  model: settled.model || null,
                  ...(effortSupported ? { effort: settled.effort || null } : {}),
                }).catch((caught) => setError(apiError(caught)));
              }}
            />
          )}
          <ComposerMenu
            icon={permission.icon}
            label={permission.label}
            value={open?.permissionMode ?? "default"}
            onChange={(value) => void setChatOptions({ permissionMode: value })}
            options={cloud ? CLOUD_MODES : PERMISSIONS}
          />
          {working ? (
            <Pressable onPress={() => void interrupt()} style={styles.stop}>
              <Square size={14} color={color.foreground} fill={color.foreground} />
              <Text style={styles.stopLabel}>Stop</Text>
            </Pressable>
          ) : null}
        </View>
        {!asks && (open?.permissionMode ?? "default") === "default" ? (
          <Text style={type.caption}>{agentName} can't stop to ask, so Ask keeps it read-only.</Text>
        ) : null}
        <View style={styles.box}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Reply, or ask for the next change."
            placeholderTextColor={color.mutedForeground}
            multiline
            style={styles.input}
          />
          <Pressable
            onPress={() => void submit()}
            disabled={!text.trim() || busy}
            style={[styles.send, (!text.trim() || busy) && { opacity: 0.4 }]}
          >
            <ArrowUp size={18} color={color.primaryForeground} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Entry({
  entry,
  agentName,
  onOpenArtifact,
}: {
  entry: ConvEntry;
  agentName: string;
  onOpenArtifact?: (artifact: ConvArtifact) => void;
}) {
  // Work the provider is running beside the turn arrives on its own entry.
  if (entry.activity) return <ActivityEntry activity={entry.activity} />;
  if (entry.kind === "user") {
    return (
      <View style={styles.you}>
        <Text style={styles.speaker}>You</Text>
        <View style={styles.bubbleYou}>
          <Text style={styles.youText}>{entry.text}</Text>
        </View>
      </View>
    );
  }
  if (entry.kind === "assistant") {
    return (
      <View style={styles.claude}>
        <Text style={[styles.speaker, { color: color.claude }]}>{agentName}</Text>
        <Markdown text={entry.text ?? ""} />
      </View>
    );
  }
  if (entry.kind === "thinking") {
    return (
      <Text style={styles.thinking}>{entry.text}</Text>
    );
  }
  return <ToolEntry entry={entry} onOpenArtifact={onOpenArtifact} />;
}

function ToolEntry({
  entry,
  onOpenArtifact,
}: {
  entry: ConvEntry;
  onOpenArtifact?: (artifact: ConvArtifact) => void;
}) {
  const failed = entry.status === "error";
  return (
    <View style={[styles.tool, failed && { borderColor: "rgba(248,113,113,0.4)" }]}>
      <View style={styles.toolHead}>
        <Wrench size={12} color={color.mutedForeground} />
        <Text style={styles.toolVerb}>{entry.verb ?? entry.tool ?? "Tool"}</Text>
        {entry.arg ? (
          <Text style={styles.toolArg} numberOfLines={1}>
            {entry.arg}
          </Text>
        ) : null}
      </View>
      {entry.diff && entry.diff.length > 0 ? <Diff lines={entry.diff} /> : null}
      {entry.output ? <Text style={styles.toolOut}>{entry.output}</Text> : null}
      {entry.attachments?.length ? (
        <Text style={styles.toolOut}>
          {entry.attachments.length === 1 ? "1 image" : `${entry.attachments.length} images`}
        </Text>
      ) : null}
      {entry.artifacts?.map((artifact, index) => (
        <ArtifactCard
          key={`${artifact.kind}:${artifact.key ?? artifact.id ?? index}`}
          artifact={artifact}
          onOpen={onOpenArtifact}
        />
      ))}
    </View>
  );
}

const ARTIFACT_ICON = {
  ticket: SquareKanban,
  thread: Bot,
  workspace: FolderGit2,
  routine: Loader,
} as const;

/// What a Remy tool made, as a card that opens it. The tool's own text says it
/// too; the card is what a person taps.
function ArtifactCard({
  artifact,
  onOpen,
}: {
  artifact: ConvArtifact;
  onOpen?: (artifact: ConvArtifact) => void;
}) {
  const Icon = ARTIFACT_ICON[artifact.kind] ?? SquareKanban;
  const reachable = Boolean(onOpen) && artifact.kind !== "routine";
  const body = (
    <>
      <Icon size={14} color={color.mutedForeground} />
      <View style={styles.artifactText}>
        <Text style={type.callout} numberOfLines={1}>
          {artifact.key ? `${artifact.key} · ${artifact.title}` : artifact.title}
        </Text>
        {artifact.detail ? (
          <Text style={type.caption} numberOfLines={1}>
            {artifact.detail}
          </Text>
        ) : null}
      </View>
    </>
  );
  if (!reachable) return <View style={styles.artifact}>{body}</View>;
  return (
    <Pressable
      onPress={() => onOpen?.(artifact)}
      accessibilityLabel={`Open ${artifact.title}`}
      style={({ pressed }) => [styles.artifact, pressed && { backgroundColor: color.accent }]}
    >
      {body}
    </Pressable>
  );
}

const ACTIVITY_LABEL: Record<ThreadActivity["status"], string> = {
  running: "Running",
  waiting: "Waiting",
  idle: "Idle",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
  unknown: "Status unavailable",
};

/// A subagent or a shell command the thread started. It is durable feed state
/// rather than a live-only badge, so it is still here after a reconnect.
function ActivityEntry({ activity }: { activity: ThreadActivity }) {
  const Icon = activity.kind === "shell" ? Terminal : Bot;
  return (
    <View style={styles.activity}>
      <View style={styles.toolHead}>
        <Icon size={12} color={color.mutedForeground} />
        <Text style={styles.toolVerb} numberOfLines={1}>
          {activity.title}
        </Text>
        <Text style={styles.activityStatus}>{ACTIVITY_LABEL[activity.status]}</Text>
      </View>
      {activity.command ? (
        <Text style={styles.toolArg} numberOfLines={2}>
          {activity.command}
        </Text>
      ) : null}
      {activity.progress ? <Text style={styles.toolOut}>{activity.progress}</Text> : null}
      {activity.status === "unknown" ? (
        <Text style={styles.toolOut}>Live status is unavailable; this work may still be running.</Text>
      ) : null}
    </View>
  );
}

/// The pull request on this thread's branch.
function PullRequestRow({ pullRequest }: { pullRequest: PullRequestSummary }) {
  return (
    <View style={styles.pr}>
      <GitPullRequest size={14} color={color.mutedForeground} />
      <Text style={type.caption} numberOfLines={1}>
        {`#${pullRequest.number} · ${pullRequest.title}`}
      </Text>
      <Text style={styles.prState}>{pullRequest.state.toLowerCase()}</Text>
    </View>
  );
}

function Diff({ lines }: { lines: ConvDiffLine[] }) {
  return (
    <View style={styles.diff}>
      {lines.map((line, index) => (
        <Text
          key={index}
          style={[
            styles.diffLine,
            line.kind === "add" && { color: color.success },
            line.kind === "del" && { color: color.destructive },
          ]}
        >
          {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
          {line.text}
        </Text>
      ))}
    </View>
  );
}

function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: ChatApproval;
  onDecide: (decision: "allow" | "allowAlways" | "deny") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const decide = async (decision: "allow" | "allowAlways" | "deny") => {
    setBusy(true);
    try {
      await onDecide(decision);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.ask}>
      <Text style={type.heading}>{approval.title ?? `${approval.verb} ${approval.arg}`.trim()}</Text>
      {approval.reason ? <Text style={type.caption}>{approval.reason}</Text> : null}
      {approval.plan ? <Markdown text={approval.plan} /> : null}
      {approval.diff && approval.diff.length > 0 ? <Diff lines={approval.diff} /> : null}
      <View style={styles.row}>
        <Button label="Allow" disabled={busy} onPress={() => void decide("allow")} />
        {approval.allowAlways ? (
          <Button label="Always allow" variant="outline" disabled={busy} onPress={() => void decide("allowAlways")} />
        ) : null}
        <Button label="Deny" variant="ghost" disabled={busy} onPress={() => void decide("deny")} />
      </View>
    </View>
  );
}

function QuestionCard({
  request,
  onAnswer,
}: {
  request: ChatQuestionRequest;
  onAnswer: (answers: Record<string, string | string[]>) => Promise<void>;
}) {
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const toggle = (question: string, label: string, multi: boolean) => {
    setPicks((current) => {
      const chosen = current[question] ?? [];
      if (!multi) return { ...current, [question]: chosen[0] === label ? [] : [label] };
      return {
        ...current,
        [question]: chosen.includes(label) ? chosen.filter((item) => item !== label) : [...chosen, label],
      };
    });
  };
  const submit = async () => {
    setBusy(true);
    try {
      const answers: Record<string, string | string[]> = {};
      for (const question of request.questions) {
        const chosen = picks[question.question] ?? [];
        answers[question.question] = question.multiSelect ? chosen : chosen[0] ?? "";
      }
      await onAnswer(answers);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.ask}>
      {request.questions.map((question) => (
        <View key={question.question} style={{ gap: 8 }}>
          <Text style={type.heading}>{question.header ?? question.question}</Text>
          {question.options.map((option) => {
            const on = (picks[question.question] ?? []).includes(option.label);
            return (
              <Pressable
                key={option.label}
                onPress={() => toggle(question.question, option.label, Boolean(question.multiSelect))}
                style={[styles.option, on && styles.optionOn]}
              >
                <Text style={type.callout}>{option.label}</Text>
                {option.description ? <Text style={type.caption}>{option.description}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ))}
      <Button label="Send answers" busy={busy} onPress={() => void submit()} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  feed: { flex: 1 },
  feedContent: { padding: space.lg, gap: space.lg, paddingBottom: 40 },
  you: { alignItems: "flex-end", gap: 4 },
  claude: { gap: 4 },
  speaker: { ...type.caption, fontWeight: "600" },
  bubbleYou: {
    backgroundColor: color.card,
    borderRadius: radius.xl,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: "85%",
  },
  youText: { color: color.foreground, fontSize: 15, lineHeight: 21 },
  thinking: { color: color.mutedForeground, fontStyle: "italic", fontSize: 13, lineHeight: 18 },
  tool: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.muted,
    borderRadius: radius.lg,
    padding: 10,
    gap: 6,
  },
  toolHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  toolVerb: { fontWeight: "600", fontSize: 12, color: color.foreground },
  toolArg: { flex: 1, fontFamily: "Menlo", fontSize: 11, color: color.mutedForeground },
  toolOut: { fontFamily: "Menlo", fontSize: 11, color: color.mutedForeground },
  activity: {
    borderWidth: 1,
    borderColor: color.border,
    borderStyle: "dashed",
    borderRadius: radius.lg,
    padding: 10,
    gap: 6,
  },
  activityStatus: { fontSize: 11, color: color.mutedForeground },
  artifact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.background,
    borderRadius: radius.md,
    padding: 10,
  },
  artifactText: { flex: 1, minWidth: 0, gap: 2 },
  pr: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  prState: { fontSize: 11, color: color.mutedForeground, textTransform: "capitalize" },
  diff: { backgroundColor: color.background, borderRadius: 6, padding: 8 },
  diffLine: { fontFamily: "Menlo", fontSize: 11, color: color.mutedForeground },
  ask: {
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.45)",
    backgroundColor: color.card,
    borderRadius: radius.xl,
    padding: space.md,
    gap: space.sm,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    padding: 10,
    gap: 2,
  },
  optionOn: { borderColor: color.primary, backgroundColor: "rgba(91,108,255,0.12)" },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
    padding: space.md,
    gap: 8,
  },
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  stop: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto" },
  stopLabel: { fontSize: 13, color: color.foreground },
  box: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.card,
    borderRadius: radius.xl,
    padding: 8,
  },
  input: { flex: 1, minHeight: 40, maxHeight: 140, color: color.foreground, fontSize: 15, paddingHorizontal: 8 },
  send: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: color.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  threadError: { color: color.destructive, fontSize: 13 },
});
