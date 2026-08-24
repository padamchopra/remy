import type { Chat, Server } from "~/state/types";

const STATE_RANK: Record<Chat["state"], number> = {
  needs_input: 0,
  working: 1,
  error: 2,
  idle: 3,
};

/// Devices that can hold an agent's home-folder conversation, quickest first.
export function availableAgentServers(servers: Server[]): Server[] {
  return servers
    .filter((server) => server.online && !server.workspaceOnly)
    .sort((a, b) => Number(b.local ?? false) - Number(a.local ?? false));
}

/// The one conversation the Inbox presents for an agent, wherever it runs.
export function agentConversation(agentId: string, dms: Chat[], servers: Server[]): Chat | undefined {
  const available = new Set(availableAgentServers(servers).map((server) => server.id));
  return dms
    .filter((chat) => chat.agentId === agentId)
    .sort((a, b) =>
      Number(available.has(b.serverId)) - Number(available.has(a.serverId))
      || Number(b.unread ?? false) - Number(a.unread ?? false)
      || STATE_RANK[a.state] - STATE_RANK[b.state]
      || b.updatedAt - a.updatedAt,
    )[0];
}
