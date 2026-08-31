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
import { ArrowUp, Box, Square, Wrench } from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { apiError } from "../lib/api-error";
import { CLOUD_MODES, cloudModeOf, MODELS, PERMISSIONS, modelLabel, permissionOf } from "../lib/chat-options";
import { displayPath } from "../lib/path";
import { workspaceForPath } from "../lib/projects";
import { useStore } from "../state/store";
import type { ChatApproval, ChatQuestionRequest, ConvDiffLine, ConvEntry } from "../state/types";
import { StateBadge } from "../components/Badge";
import { Button } from "../components/Button";
import { ComposerMenu } from "../components/ComposerMenu";
import { EmptyState } from "../components/Empty";
import { Markdown } from "../components/Markdown";

export function ThreadScreen({ id }: { id: string }) {
  const chat = useStore((s) => s.chats.find((entry) => entry.id === id));
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
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    void openChat(id).catch((caught) => setError(apiError(caught)));
    return () => closeChat();
  }, [id, openChat, closeChat]);

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
  const entries = (open?.entries ?? []).filter((entry) => !entry.activity);
  const workspace = workspaces[workspaceForPath(chat.cwd, workspaces)];
  const server = servers.find((entry) => entry.id === chat.serverId);
  const cloud = server?.cloud === true;
  const permission = cloud ? cloudModeOf(open?.permissionMode) : permissionOf(open?.permissionMode);
  const provider = open?.provider ?? chat.provider;
  const agentName = cloud ? "Cursor Cloud" : provider === "codex" ? "Codex" : provider === "cursor" ? "Cursor" : "Claude";

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
          entries.map((entry) => <Entry key={entry.id} entry={entry} agentName={agentName} />)
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
            <ComposerMenu
              icon={Box}
              label={modelLabel(open?.model)}
              value={open?.model ?? ""}
              onChange={(value) => void setChatOptions({ model: value || null })}
              options={MODELS}
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

function Entry({ entry, agentName }: { entry: ConvEntry; agentName: string }) {
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
  return <ToolEntry entry={entry} />;
}

function ToolEntry({ entry }: { entry: ConvEntry }) {
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
