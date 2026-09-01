import type { Chat, Server } from "../state/types";

/// Which device runs an agent's work, and which of its conversations the Inbox
/// shows. Mirrors `web/src/lib/inbox.ts`: an agent's conversation is one
/// conversation however many Macs hold a copy of the agent.

const STATE_RANK: Record<Chat["state"], number> = {
  needs_input: 0,
  working: 1,
  error: 2,
  idle: 3,
};

/// Devices that can hold an agent's home-folder conversation, preferred first.
/// The order comes from the Mac's own preference list; without one, a Mac this
/// phone is paired with directly leads.
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
      return Number(b.home ?? false) - Number(a.home ?? false);
    });
}

/// The device a new thread or an agent's turn goes to when nothing has picked
/// one.
export function preferredServer(servers: Server[], preferenceOrder: string[] = []): Server | undefined {
  return availableAgentServers(servers, preferenceOrder)[0]
    ?? servers.find((server) => server.home)
    ?? servers.find((server) => server.online)
    ?? servers[0];
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
