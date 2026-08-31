import type { Chat, Workspace } from "../state/types";

export function threadGroup(chat: Chat, chats: Chat[]): Chat[] {
  return [chat, ...(!chat.parentChatId
    ? chats.filter((entry) => entry.serverId === chat.serverId && entry.parentChatId === chat.id)
    : [])];
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
