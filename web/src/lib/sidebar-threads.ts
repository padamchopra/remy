import type { Chat, ChatState } from "../state/types";

const chatsByCatalogue = new WeakMap<Chat[], Map<string, Chat>>();

export interface SidebarThreadRecord {
  id: string;
  parentChatId?: string;
  bucket: string;
  state: ChatState;
  serverId: string;
  cwd: string;
}

export interface SidebarThreadCollection {
  id: string;
  childIds: string[];
  settled: boolean;
  serverId: string;
  cwd: string;
}

export interface SidebarThreadGroup {
  key: string;
  threads: SidebarThreadCollection[];
}

export function sidebarChat(chats: Chat[], id: string): Chat | undefined {
  let indexed = chatsByCatalogue.get(chats);
  if (!indexed) {
    indexed = new Map(chats.map((chat) => [chat.id, chat]));
    chatsByCatalogue.set(chats, indexed);
  }
  return indexed.get(id);
}

/// Index the catalogue once so parent and child grouping stays linear.
export function groupSidebarThreads(records: SidebarThreadRecord[]): SidebarThreadGroup[] {
  const known = new Set(records.map((record) => record.id));
  const byId = new Map(records.map((record) => [record.id, record]));
  const children = new Map<string, string[]>();
  const parents: SidebarThreadRecord[] = [];

  for (const record of records) {
    if (record.parentChatId && known.has(record.parentChatId)) {
      const ids = children.get(record.parentChatId);
      if (ids) ids.push(record.id);
      else children.set(record.parentChatId, [record.id]);
    } else {
      parents.push(record);
    }
  }

  const groups = new Map<string, SidebarThreadGroup>();
  for (const parent of parents) {
    const childIds = children.get(parent.id) ?? [];
    const thread = {
      id: parent.id,
      childIds,
      settled: parent.state === "idle"
        && childIds.every((id) => byId.get(id)?.state === "idle"),
      serverId: parent.serverId,
      cwd: parent.cwd,
    };
    const group = groups.get(parent.bucket);
    if (group) group.threads.push(thread);
    else groups.set(parent.bucket, { key: parent.bucket, threads: [thread] });
  }

  return [...groups.values()].sort((left, right) =>
    Number(right.key === "pinned") - Number(left.key === "pinned"));
}

export function visibleSidebarThreads(
  threads: SidebarThreadCollection[],
  selected: string | null,
  settledLimit: number,
): { visible: SidebarThreadCollection[]; hidden: number } {
  let settled = 0;
  const visible = threads.filter((thread) => {
    if (!thread.settled || thread.id === selected || thread.childIds.includes(selected ?? "")) return true;
    settled += 1;
    return settled <= settledLimit;
  });
  return { visible, hidden: threads.length - visible.length };
}
