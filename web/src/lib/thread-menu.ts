import type { Chat, Workspace } from "../state/types";

const childrenByCatalogue = new WeakMap<Chat[], Map<string, Chat[]>>();

export function threadGroup(chat: Chat, chats: Chat[]): Chat[] {
  if (chat.parentChatId) return [chat];
  let children = childrenByCatalogue.get(chats);
  if (!children) {
    children = new Map();
    for (const entry of chats) {
      if (!entry.parentChatId) continue;
      const key = `${entry.serverId}\u0000${entry.parentChatId}`;
      const group = children.get(key);
      if (group) group.push(entry);
      else children.set(key, [entry]);
    }
    childrenByCatalogue.set(chats, children);
  }
  return [chat, ...(children.get(`${chat.serverId}\u0000${chat.id}`) ?? [])];
}

export function threadIsRunning(chat: Pick<Chat, "state">): boolean {
  return chat.state === "working" || chat.state === "needs_input";
}

export function threadWorkspace(chat: Pick<Chat, "serverId" | "cwd">, workspaces: Workspace[]): Workspace | undefined {
  return workspaces.find((workspace) => workspace.serverId === chat.serverId
    && (workspace.path === chat.cwd || workspace.worktrees.some((tree) => tree.path === chat.cwd)));
}

export function threadLink(id: string, currentUrl: string): string {
  const url = new URL(currentUrl);
  // A packaged file path is not a shareable URL; use Remy's app deep link.
  if (url.protocol === "file:") return `remy://chat/${encodeURIComponent(id)}`;
  url.hash = `/threads/${encodeURIComponent(id)}`;
  url.search = "";
  return url.toString();
}
