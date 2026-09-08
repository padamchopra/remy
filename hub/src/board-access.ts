import {hubRoutineSchema} from "@remy/contract";
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
    if (projection.entity === "agent") {
      const scope = projection.fields.scope ?? "org",
        owner = projection.fields.ownerId;
      if (scope === "personal") return owner === this.userId;
      if (scope === "team")
        return (
          typeof owner === "string" &&
          (await this.store.teamMembers(this.organizationId, owner)).includes(
            this.userId,
          )
        );
      if (scope === "workspace") {
        if (typeof owner !== "string") return false;
        try {
          await new OrganizationService(this.store).workspace(
            this.organizationId,
            this.userId,
            owner,
          );
          return true;
        } catch {
          return false;
        }
      }
      return scope === "org";
    }
    if (projection.entity === "memory" || projection.entity === "recurrence") {
      const agent =
        typeof projection.fields.agentId === "string" &&
        (await this.board.detail("agents", projection.fields.agentId));
      return !!agent && this.canRead(agent);
    }
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
    if (input.entity === "agent") {
      const fields = { ...current?.fields, ...input.payload },
        scope = fields.scope ?? "org",
        owner = fields.ownerId;
      if (
        fields.name !== undefined &&
        (typeof fields.name !== "string" ||
          !fields.name.trim() ||
          fields.name.length > 120)
      )
        return false;
      if (
        fields.instructions !== undefined &&
        (typeof fields.instructions !== "string" ||
          fields.instructions.length > 32000)
      )
        return false;
      const member = await this.store.membership(
        this.organizationId,
        this.userId,
      );
      if (
        !member ||
        !["org", "team", "workspace", "personal"].includes(String(scope))
      )
        return false;
      if (current?.fields.builtIn) {
        const allowed=["provider","model","effort","permissionMode",...(current.fields.builtIn==="orchestrator" && member.role!=="member"?["name"]:[])];
        return input.kind==="field" && Object.keys(input.payload).every(k=>allowed.includes(k)) && await this.canRead(current);
      }
      if (
        input.payload.builtIn ||
        (input.payload.createdByUserId &&
          input.payload.createdByUserId !== this.userId)
      )
        return false;
      if (scope === "personal" && owner !== this.userId) return false;
      if (scope === "org" && member.role === "member") return false;
      if (
        scope === "team" &&
        (typeof owner !== "string" ||
          !(await this.store.teamMembers(this.organizationId, owner)).includes(
            this.userId,
          ))
      )
        return false;
      if (
        scope === "workspace" &&
        (typeof owner !== "string" ||
          !(await this.store.workspace(this.organizationId, owner)))
      )
        return false;
      if (
        current &&
        (scope !== current.fields.scope || owner !== current.fields.ownerId)
      ) {
        const outward =
          (current.fields.scope === "personal" && scope === "team") ||
          (current.fields.scope === "team" && scope === "org");
        if (!outward) return false;
      }
    }
    if(input.entity === "recurrence" && input.kind!=="tombstone") {
      const parsed=hubRoutineSchema.safeParse({...current?.fields,...input.payload,runAsUserId:this.userId});if(!parsed.success)return false;
      try{await new OrganizationService(this.store).workspace(this.organizationId,this.userId,parsed.data.projectId);}catch{return false;}
      if(input.payload.runAsUserId && input.payload.runAsUserId!==this.userId)return false;
    }
    if (input.entity === "ticket") {
      if(input.payload.assigneeMemberId && (typeof input.payload.assigneeMemberId!=="string" || !await this.store.membership(this.organizationId,input.payload.assigneeMemberId)))return false;
      if(input.payload.parentId){const parent=await this.board.detail("tickets",String(input.payload.parentId));if(!parent||parent.id===input.entityId||parent.fields.projectId!==(current?.fields.projectId??input.payload.projectId)||!await this.canRead(parent))return false;}

      const assigned = input.payload.assigneeAgentId ?? input.payload.toAgentId;
      if (assigned && !["you", "workspace"].includes(String(assigned))) {
        const agent =
          typeof assigned === "string" &&
          (await this.board.detail("agents", assigned));
        if (!agent || !(await this.canRead(agent))) return false;
      }
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
