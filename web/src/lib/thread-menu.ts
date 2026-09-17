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

export function threadLink(
  id: string,
  currentUrl: string,
  extra?: { hosted?: boolean },
): string {
  const url = new URL(currentUrl);
  // A packaged file path is not a shareable URL; use Remy's app deep link.
  if (url.protocol === "file:") return `remy://chat/${encodeURIComponent(id)}`;
  const hosted = extra?.hosted
    || url.pathname === "/app"
    || url.pathname.startsWith("/app/");
  if (hosted) {
    const base = url.pathname === "/app" || url.pathname.startsWith("/app/") ? "/app" : "";
    url.hash = "";
    url.search = "";
    url.pathname = `${base}/threads/${encodeURIComponent(id)}`;
    return url.toString();
  }
  url.hash = `/threads/${encodeURIComponent(id)}`;
  url.search = "";
  return url.toString();
}

/// One row action in ThreadMenu. Hosted and Mac render that one menu; this list
/// is how its items stay in the same order with the same enablement.
export type ThreadMenuKind =
  | "pin"
  | "unpin"
  | "rename"
  | "copy"
  | "spawn"
  | "beside"
  | "workspace"
  | "pr"
  | "stop"
  | "archive"
  | "stop-archive"
  | "unarchive"
  | "delete";

export interface ThreadMenuEntry {
  kind: ThreadMenuKind;
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  href?: boolean;
}

export interface ThreadMenuFacts {
  archive?: boolean;
  parent?: boolean;
  cloud?: boolean;
  running?: boolean;
  groupRunning?: boolean;
  pinned?: boolean;
  workspace?: boolean;
  beside?: boolean;
  pullRequest?: boolean;
  busy?: boolean;
  online?: boolean;
  linkable?: boolean;
  /// Hosted threads cannot start subthreads, even on a personal computer.
  spawn?: boolean;
}

/// Hosted pin/rename/archive/delete go through the hub, which can wake a cloud
/// computer. A missing, idle, or stale computer is not "the whole menu is off".
export function hostedThreadMenuFacts(input: {
  pending?: boolean;
  writable?: boolean;
  cloud?: boolean;
}): Pick<ThreadMenuFacts, "online" | "cloud" | "spawn" | "linkable"> {
  return {
    online: !input.pending && input.writable !== false,
    cloud: Boolean(input.cloud),
    spawn: false,
    linkable: !input.pending,
  };
}

export function threadMenuGroups(facts: ThreadMenuFacts): ThreadMenuEntry[][] {
  const unavailable = Boolean(facts.busy || !facts.online);
  const copy: ThreadMenuEntry = {
    kind: "copy",
    label: "Copy thread link",
    disabled: Boolean(facts.busy) || facts.linkable === false,
  };
  if (facts.archive) {
    return [
      [
        { kind: "unarchive", label: "Unarchive thread", disabled: unavailable || Boolean(facts.cloud) },
        copy,
      ],
      [{ kind: "delete", label: "Delete permanently…", destructive: true, disabled: unavailable }],
    ];
  }
  const first: ThreadMenuEntry[] = [
    ...(!facts.parent ? [{
      kind: facts.pinned ? "unpin" as const : "pin" as const,
      label: facts.pinned ? "Unpin thread" : "Pin thread",
      disabled: unavailable || Boolean(facts.cloud),
    }] : []),
    { kind: "rename", label: "Rename…" as const, disabled: unavailable },
    copy,
  ];
  const second: ThreadMenuEntry[] = [
    ...(!facts.parent && !facts.cloud && facts.spawn !== false ? [{ kind: "spawn" as const, label: "Start subthread…", disabled: unavailable }] : []),
    ...(facts.parent && facts.beside ? [{ kind: "beside" as const, label: "Open beside parent" }] : []),
    ...(facts.workspace ? [{ kind: "workspace" as const, label: "Open workspace" }] : []),
    ...(facts.pullRequest ? [{ kind: "pr" as const, label: "Open pull request", href: true }] : []),
  ];
  const third: ThreadMenuEntry[] = [
    ...(facts.running ? [{ kind: "stop" as const, label: "Stop agent", disabled: unavailable }] : []),
    {
      kind: facts.groupRunning ? "stop-archive" as const : "archive" as const,
      label: facts.groupRunning ? "Stop and archive…" : "Archive thread",
      disabled: unavailable,
    },
  ];
  const fourth: ThreadMenuEntry[] = [{ kind: "delete", label: "Delete thread…", destructive: true, disabled: unavailable }];
  return [first, second, third, fourth].filter((group) => group.length > 0);
}
