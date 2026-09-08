import type { BoardActor, BoardProjection } from "@remy/contract";
import type { OrganizationBoard, BoardStorage } from "./organization-board.js";
import type { OrganizationStore } from "./organization-store.js";
import { BoardAccess } from "./board-access.js";
export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  at: number;
  actorId: string;
};
export class ScopedAgents {
  constructor(
    private readonly board: OrganizationBoard,
    private readonly storage: BoardStorage,
    private readonly organizations: OrganizationStore,
    private readonly org: string,
  ) {}
  async visible(user: string) {
    const access = new BoardAccess(
      this.organizations,
      this.board,
      this.org,
      user,
    );
    return (
      await Promise.all(
        (await this.board.list("agents")).items.map(async (a) =>
          (await access.canRead(a)) ? a : undefined,
        ),
      )
    ).filter((a): a is BoardProjection => !!a);
  }
  async get(id: string, user: string) {
    const agent = await this.board.detail("agents", id);
    if (
      !agent ||
      !(await new BoardAccess(
        this.organizations,
        this.board,
        this.org,
        user,
      ).canRead(agent))
    )
      throw Error("Agent not found.");
    return agent;
  }
  async conversation(id: string, user: string) {
    await this.get(id, user);
    return (
      (await this.storage.get<AgentMessage[]>(`agent-conversation:${id}`)) ?? []
    );
  }
  async message(id: string, user: string, text: string, messageId: string) {
    await this.get(id, user);
    if (
      !text.trim() ||
      text.length > 32000 ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(messageId)
    )
      throw Error("Enter a shorter message.");
    return this.storage.transaction(async (storage) => {
      if (!await storage.get(`board:projection:agent:${id}`)) throw Error("Agent not found.");
      const key = `agent-conversation:${id}`,
        messages = (await storage.get<AgentMessage[]>(key)) ?? [];
      if (!messages.some((m) => m.id === messageId)) {
        if (
          messages.length >= 1000 ||
          JSON.stringify(messages).length + text.length > 2_000_000
        )
          throw Error("This conversation is full.");
        messages.push({
          id: messageId,
          role: "user",
          text: text.trim(),
          at: Date.now(),
          actorId: user,
        });
        await storage.put(key, messages);
      }
      return messages;
    });
  }
  async remove(id: string, actor: BoardActor) {
    await this.board.append({entity:"agent",entityId:id,kind:"tombstone",payload:{}},actor);
    for (const entity of ["memories", "routines"] as const)
      for (const row of (await this.board.list(entity)).items)
        if (row.fields.agentId === id)
          await this.board.append(
            {
              entity: entity === "memories" ? "memory" : "recurrence",
              entityId: row.id,
              kind: "tombstone",
              payload: {},
            },
            actor,
          );
    await this.storage.delete(`agent-conversation:${id}`);
  }
  async departures() {
    const actor: BoardActor = { kind: "agent", id: "remy", label: "Remy" };
    for (const agent of (await this.board.list("agents")).items) {
      if (
        agent.fields.scope === "personal" &&
        !(await this.organizations.membership(
          this.org,
          String(agent.fields.ownerId),
        ))
      )
        await this.remove(agent.id, actor);
      else if (
        agent.fields.scope === "team" &&
        !(await this.organizations.team(this.org, String(agent.fields.ownerId)))
      )
        await this.remove(agent.id, actor);
      else if (
        agent.fields.scope === "workspace" &&
        !(await this.organizations.workspace(
          this.org,
          String(agent.fields.ownerId),
        ))
      )
        await this.remove(agent.id, actor);
    }
  }
}
