import type { ComponentType } from "react";
import { useShallow } from "zustand/react/shallow";
import { MessagesSquare } from "lucide-react";
import { useAppActions } from "@/actions/context";
import { Badge } from "@/components/ui/badge";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { displayPath } from "@/lib/path";
import { cn } from "@/lib/utils";
import { useStore } from "@/state/store";
import type { Chat } from "@/state/types";

const NO_CHATS: Chat[] = [];

/// Everything addressable, behind ⌘K.
///
/// cmdk owns matching, grouping, selection and key handling, so this file is
/// only the data and how a row looks. Groups are ordered so whatever needs a
/// person comes first.
export function Palette({
  open,
  onOpenChange,
  sections,
  onOpenChat,
  onOpenSection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: { id: string; label: string; icon: ComponentType<{ className?: string }> }[];
  onOpenChat: (id: string) => void;
  onOpenSection: (id: string) => void;
}) {
  const chats = useStore(useShallow((state) => open ? state.chats : NO_CHATS));
  const { actions, run: runAction } = useAppActions();
  const run = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };

  const attention = chats.filter((chat) => chat.state === "needs_input");
  const rest = chats.filter((chat) => chat.state !== "needs_input");
  const actionGroups = actions.reduce((groups, action) => {
    const entries = groups.get(action.group);
    if (entries) entries.push(action);
    else groups.set(action.group, [action]);
    return groups;
  }, new Map<string, typeof actions>());

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Quick open"
      description="Search threads and commands"
      showCloseButton={false}
      className="top-[12%] translate-y-0 sm:max-w-[620px]"
    >
      <CommandInput placeholder="Search threads and commands" />
      <CommandList className="max-h-[min(520px,65vh)]">
        <CommandEmpty>No matches. Try a thread title or an action.</CommandEmpty>

        {attention.length > 0 && (
          <CommandGroup heading="Needs you">
            {attention.map((chat) => (
              <ChatRow key={chat.id} chat={chat} onSelect={run(() => onOpenChat(chat.id))} />
            ))}
          </CommandGroup>
        )}

        {attention.length > 0 && rest.length > 0 && <CommandSeparator />}

        {rest.length > 0 && (
          <CommandGroup heading="Threads">
            {rest.map((chat) => (
              <ChatRow key={chat.id} chat={chat} onSelect={run(() => onOpenChat(chat.id))} />
            ))}
          </CommandGroup>
        )}

        {(attention.length > 0 || rest.length > 0) && <CommandSeparator />}

        <CommandGroup heading="Go to">
          {sections.map(({ id, label, icon: Icon }) => (
            <CommandItem key={id} value={label} onSelect={run(() => onOpenSection(id))}>
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {Array.from(actionGroups, ([group, entries], index) => (
          <div key={group}>
            {index > 0 && <CommandSeparator />}
            <CommandGroup heading={group}>
              {entries.map((action) => {
                const Icon = action.icon;
                return (
                  <CommandItem
                    key={action.id}
                    value={`${action.label} ${action.keywords?.join(" ") ?? ""}`}
                    onSelect={run(() => void runAction(action.id))}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{action.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </div>
        ))}
      </CommandList>

      <Separator />
      <div className="flex h-10 items-center gap-4 bg-muted px-4">
        <span className="text-xs text-muted-foreground">Threads and every section of the app</span>
        <span className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <KbdGroup>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
            </KbdGroup>
            Navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> Open
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd> Close
          </span>
        </span>
      </div>
    </CommandDialog>
  );
}

function ChatRow({ chat, onSelect }: { chat: Chat; onSelect: () => void }) {
  return (
    <CommandItem value={`${chat.title} ${displayPath(chat.cwd)}`} onSelect={onSelect}>
      <MessagesSquare
        className={cn(
          "size-4 shrink-0",
          chat.state === "needs_input" && "text-warning-foreground",
          chat.state === "working" && "text-info-foreground",
          chat.state === "error" && "text-destructive",
          chat.state === "idle" && "text-muted-foreground",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{chat.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {chat.preview ?? displayPath(chat.cwd)}
        </span>
      </span>
      {chat.state === "needs_input" && <Badge variant="warning">Needs you</Badge>}
      {chat.state === "working" && <Badge variant="info">Working</Badge>}
    </CommandItem>
  );
}
