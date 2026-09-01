import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Archive, MoreHorizontal, Pencil, Pin, PinOff, Square, Trash2 } from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { apiError } from "../lib/api-error";
import { useStore } from "../state/store";
import { Button } from "./Button";
import { MenuItem, MenuSeparator, Popover } from "./ComposerMenu";
import type { Chat } from "../state/types";

/// What you can do to a thread that is not talking to it. The same actions the
/// window's thread menu has, on the control that is already in the header.
export function ThreadMenu({ chat, onGone }: { chat: Chat; onGone: () => void }) {
  const pinThread = useStore((s) => s.pinThread);
  const renameThread = useStore((s) => s.renameThread);
  const archiveThread = useStore((s) => s.archiveThread);
  const deleteThread = useStore((s) => s.deleteThread);
  const stopThread = useStore((s) => s.stopThread);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(chat.title);
  const working = chat.state === "working";

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
});
