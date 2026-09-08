import type { BoardAppendInput, BoardProjection } from "@remy/contract";
import type { OrganizationBoard } from "./organization-board.js";
import { OrganizationService } from "./organizations.js";
import type { OrganizationStore } from "./organization-store.js";

export class BoardAccess {
  constructor(
    private readonly store: OrganizationStore,
    private readonly board: OrganizationBoard,
    private readonly organizationId: string,
    private readonly userId: string,
  ) {}
  async canRead(projection: BoardProjection): Promise<boolean> {
    if (!(await this.store.membership(this.organizationId, this.userId)))
      return false;
    const workspaceId = projection.fields.projectId;
    if (workspaceId === undefined || workspaceId === "") return true;
    if (typeof workspaceId !== "string") return false;
    if (!(await this.store.workspace(this.organizationId, workspaceId)))
      return !!(await this.board.project(workspaceId));
    try {
      await new OrganizationService(this.store).workspace(
        this.organizationId,
        this.userId,
        workspaceId,
      );
      return true;
    } catch {
      return false;
    }
  }
  async canWrite(input: BoardAppendInput): Promise<boolean> {
    const entity = (
      {
        ticket: "tickets",
        agent: "agents",
        memory: "memories",
        recurrence: "routines",
      } as const
    )[input.entity as "ticket" | "agent" | "memory" | "recurrence"];
    if (!entity) return false;
    if (
      input.payload.projectId !== undefined &&
      typeof input.payload.projectId !== "string"
    )
      return false;
    const current = await this.board.detail(entity, input.entityId);
    if (input.kind === "create" && current) return false;
    if (input.kind !== "create" && (!current || !(await this.canRead(current))))
      return false;
    return this.canRead({
      ...(current ?? {
        entity: input.entity,
        id: input.entityId,
        activity: [],
        createdAt: 0,
        updatedAt: 0,
        lastActor: { kind: "member", id: this.userId, label: "Member" },
      }),
      fields: { ...current?.fields, ...input.payload },
    });
  }
}
