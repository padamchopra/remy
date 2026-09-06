import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Archive, GitFork, GitPullRequest, MoreHorizontal, Pencil, Pin, PinOff, Square, SquareKanban, Trash2 } from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { apiError } from "../lib/api-error";
import { useStore } from "../state/store";
import { Button } from "./Button";
import { MenuItem, MenuSeparator, Popover } from "./ComposerMenu";
import type { Chat, PullRequestSummary } from "../state/types";

/// What you can do to a thread that is not talking to it. The same actions the
/// window's thread menu has, on the control that is already in the header.
export function ThreadMenu({
  chat,
  onGone,
  onOpenThread,
  onOpenTicket,
  onOpenPullRequest,
}: {
  chat: Chat;
  onGone: () => void;
  onOpenThread: (id: string) => void;
  onOpenTicket: (key: string) => void;
  onOpenPullRequest: (pullRequest: PullRequestSummary) => void;
}) {
  const pinThread = useStore((s) => s.pinThread);
  const renameThread = useStore((s) => s.renameThread);
  const archiveThread = useStore((s) => s.archiveThread);
  const deleteThread = useStore((s) => s.deleteThread);
  const stopThread = useStore((s) => s.stopThread);
  const createSubthread = useStore((s) => s.createSubthread);
  const ticketFromThread = useStore((s) => s.ticketFromThread);
  const threadPullRequest = useStore((s) => s.threadPullRequest);
  const tickets = useStore((s) => s.tickets);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [subthreading, setSubthreading] = useState(false);
  const [title, setTitle] = useState(chat.title);
  const [subthreadPrompt, setSubthreadPrompt] = useState("");
  const [includeParent, setIncludeParent] = useState(true);
  const [pullRequest, setPullRequest] = useState<PullRequestSummary>();
  const working = chat.state === "working";
  const linkedTicket = tickets.find((ticket) => ticket.threads.some((thread) => thread.chatId === chat.id));

  useEffect(() => {
    let cancelled = false;
    void threadPullRequest(chat.id).then((found) => {
      if (!cancelled) setPullRequest(found);
    }).catch(() => {
      if (!cancelled) setPullRequest(undefined);
    });
    return () => { cancelled = true; };
  }, [chat.id, chat.serverId, chat.state, threadPullRequest]);

  const run = async (what: string, act: () => Promise<unknown>, gone?: boolean) => {
    setOpen(false);
    try {
      await act();
      if (gone) onGone();
    } catch (caught) {
      Alert.alert(`Couldn't ${what}`, apiError(caught));
    }
  };

  const confirmDelete = () => {
    setOpen(false);
    Alert.alert(`Delete ${chat.title}?`, "Its transcript goes with it.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void run("delete that thread", () => deleteThread(chat.id), true),
      },
    ]);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityLabel="Thread actions"
        style={styles.trigger}
      >
        <MoreHorizontal size={18} color={color.mutedForeground} />
      </Pressable>

      <Popover open={open} onClose={() => setOpen(false)}>
        {working ? (
          <MenuItem
            icon={Square}
            label="Stop this run"
            onPress={() => void run("stop that run", () => stopThread(chat.id))}
          />
        ) : null}
        <MenuItem
          icon={chat.pinned ? PinOff : Pin}
          label={chat.pinned ? "Unpin thread" : "Pin thread"}
          onPress={() => void run("pin that thread", () => pinThread(chat.id, !chat.pinned))}
        />
        {!chat.parentChatId ? (
          <MenuItem
            icon={GitFork}
            label="Start subthread…"
            onPress={() => {
              setOpen(false);
              setSubthreadPrompt("");
              setIncludeParent(true);
              setSubthreading(true);
            }}
          />
        ) : null}
        <MenuItem
          icon={SquareKanban}
          label={linkedTicket ? `Open ${linkedTicket.key}` : "Track as ticket"}
          onPress={() => {
            if (linkedTicket) {
              setOpen(false);
              onOpenTicket(linkedTicket.key);
              return;
            }
            void run("track that thread", async () => {
              const ticket = await ticketFromThread(chat.id);
              onOpenTicket(ticket.key);
            });
          }}
        />
        {pullRequest ? (
          <MenuItem
            icon={GitPullRequest}
            label={`Open pull request #${pullRequest.number}`}
            onPress={() => {
              setOpen(false);
              onOpenPullRequest(pullRequest);
            }}
          />
        ) : null}
        <MenuSeparator />
        <MenuItem
          icon={Pencil}
          label="Rename…"
          onPress={() => {
            setTitle(chat.title);
            setOpen(false);
            setRenaming(true);
          }}
        />
        <MenuItem
          icon={Archive}
          label="Archive thread"
          onPress={() => void run("archive that thread", () => archiveThread(chat.id), true)}
        />
        <MenuSeparator />
        <MenuItem icon={Trash2} label="Delete thread" onPress={confirmDelete} />
      </Popover>

      <Popover open={subthreading} onClose={() => setSubthreading(false)}>
        <View style={styles.rename}>
          <Text style={type.heading}>Start subthread</Text>
          <TextInput
            value={subthreadPrompt}
            onChangeText={setSubthreadPrompt}
            autoFocus
            multiline
            accessibilityLabel="Subthread message"
            placeholder="What should this subthread work on?"
            placeholderTextColor={color.mutedForeground}
            style={[styles.input, styles.prompt]}
          />
          <Pressable
            onPress={() => setIncludeParent((current) => !current)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: includeParent }}
            style={styles.choice}
          >
            <View style={[styles.check, includeParent && styles.checkOn]} />
            <View style={{ flex: 1 }}>
              <Text style={type.callout}>Include this conversation</Text>
              <Text style={type.caption}>Give the subthread the context already here.</Text>
            </View>
          </Pressable>
          <Button
            label="Start subthread"
            disabled={!subthreadPrompt.trim()}
            onPress={() => {
              setSubthreading(false);
              void run("start that subthread", async () => {
                const child = await createSubthread({
                  parentId: chat.id,
                  text: subthreadPrompt.trim(),
                  includeParent,
                });
                onOpenThread(child.id);
              });
            }}
          />
        </View>
      </Popover>

      <Popover open={renaming} onClose={() => setRenaming(false)}>
        <View style={styles.rename}>
          <Text style={type.heading}>Rename thread</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            autoFocus
            selectTextOnFocus
            accessibilityLabel="Thread name"
            placeholderTextColor={color.mutedForeground}
            style={styles.input}
          />
          <Button
            label="Rename"
            disabled={!title.trim()}
            onPress={() => {
              setRenaming(false);
              void run("rename that thread", () => renameThread(chat.id, title));
            }}
          />
        </View>
      </Popover>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  rename: { padding: space.md, gap: space.sm },
  input: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.background,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: color.foreground,
    fontSize: 15,
  },
  prompt: { minHeight: 92, textAlignVertical: "top" },
  choice: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 48 },
  check: { width: 18, height: 18, borderRadius: 5, borderWidth: 1, borderColor: color.border },
  checkOn: { backgroundColor: color.primary, borderColor: color.primary },
});
