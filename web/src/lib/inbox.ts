import type { Chat, Server } from "~/state/types";

const STATE_RANK: Record<Chat["state"], number> = {
  needs_input: 0,
  working: 1,
  error: 2,
  idle: 3,
};

/// Devices that can hold an agent's home-folder conversation, preferred first.
export function availableAgentServers(servers: Server[], preferenceOrder: string[] = []): Server[] {
  const rank = new Map(preferenceOrder.map((id, index) => [id, index]));
  return servers
    .filter((server) => server.online && !server.workspaceOnly)
    .sort((a, b) => {
      const aRank = rank.get(a.id);
      const bRank = rank.get(b.id);
      if (aRank !== undefined || bRank !== undefined) {
        return (aRank ?? Number.MAX_SAFE_INTEGER) - (bRank ?? Number.MAX_SAFE_INTEGER);
      }
      return Number(b.local ?? false) - Number(a.local ?? false);
    });
}

/// The one conversation the Inbox presents for an agent, wherever it runs.
export function agentConversation(
  agentId: string,
  dms: Chat[],
  servers: Server[],
  preferenceOrder: string[] = [],
): Chat | undefined {
  const ranked = availableAgentServers(servers, preferenceOrder);
  const rank = new Map(ranked.map((server, index) => [server.id, index]));
  return dms
    .filter((chat) => chat.agentId === agentId)
    .sort((a, b) =>
      Number(rank.has(b.serverId)) - Number(rank.has(a.serverId))
      || Number(b.unread ?? false) - Number(a.unread ?? false)
      || STATE_RANK[a.state] - STATE_RANK[b.state]
      || (rank.get(a.serverId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.serverId) ?? Number.MAX_SAFE_INTEGER)
      || b.updatedAt - a.updatedAt,
    )[0];
}
