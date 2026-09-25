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
    if (input.entity !== "ticket") return false;
    const entity = "tickets" as const;
    if (
      input.payload.projectId !== undefined &&
      typeof input.payload.projectId !== "string"
    )
      return false;
    const current = await this.board.detail(entity, input.entityId);
    if (input.kind === "create" && current) return false;
    if (input.kind !== "create" && (!current || !(await this.canRead(current))))
      return false;
    if (input.entity === "ticket") {
      if(input.payload.assigneeMemberId && (typeof input.payload.assigneeMemberId!=="string" || !await this.store.membership(this.organizationId,input.payload.assigneeMemberId)))return false;
      if(input.payload.parentId){const parent=await this.board.detail("tickets",String(input.payload.parentId));if(!parent||parent.id===input.entityId||parent.fields.projectId!==(current?.fields.projectId??input.payload.projectId)||!await this.canRead(parent))return false;}
    }
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
