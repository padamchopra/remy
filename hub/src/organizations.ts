import { tokenHash } from "./accounts.js";
import type { AuditEvent, Membership, OrganizationInvite, OrganizationRole, OrganizationStore, OrganizationTeam, WorkspaceAccess } from "./organization-store.js";

const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
type Clock = () => number;
type Random = (bytes: number) => Uint8Array;
const defaultRandom: Random = (bytes) => crypto.getRandomValues(new Uint8Array(bytes));

function token(random: Random): string {
  let raw = "";
  for (const byte of random(32)) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function repositoryOrigin(value: string): string {
  return value.trim().replace(/\.git$/i, "").replace(/^git@([^:]+):/, "$1/").replace(/^ssh:\/\//, "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export class OrganizationError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export class OrganizationService {
  constructor(private readonly store: OrganizationStore, private readonly now: Clock = Date.now, private readonly random: Random = defaultRandom) {}

  private async audit(organizationId: string, actorUserId: string, action: string, targetKind: string, targetId: string, metadata: Record<string, unknown> = {}) {
    const event: AuditEvent = { id: crypto.randomUUID(), organizationId, actorUserId, action, targetKind, targetId, metadata, createdAt: this.now() };
    await this.store.appendAudit(event);
  }
  private async access(organizationId: string, userId: string, allowed?: OrganizationRole[]): Promise<Membership> {
    const member = await this.store.membership(organizationId, userId);
    if (!member || (allowed && !allowed.includes(member.role))) throw new OrganizationError(404, "Organization not found.");
    return member;
  }
  private async workspaceAccessInput(organizationId: string, access: WorkspaceAccess): Promise<WorkspaceAccess> {
    const teamIds = [...new Set(access.teamIds)];
    const userIds = [...new Set(access.userIds)];
    for (const teamId of teamIds) if (!await this.store.team(organizationId, teamId)) throw new OrganizationError(404, "Team not found.");
    for (const memberId of userIds) if (!await this.store.membership(organizationId, memberId)) throw new OrganizationError(404, "Member not found.");
    return { teamIds, userIds };
  }
  async list(userId: string) { return this.store.organizationsFor(userId); }
  async create(userId: string, name: string) {
    const now = this.now();
    const organization = { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now };
    await this.store.createOrganization(organization, { id: crypto.randomUUID(), organizationId: organization.id, userId, role: "owner", createdAt: now, updatedAt: now });
    await this.audit(organization.id, userId, "organization.created", "organization", organization.id);
    return { ...organization, role: "owner" as const };
  }
  async rename(organizationId: string, userId: string, name: string) { await this.access(organizationId, userId, ["owner", "admin"]); await this.store.renameOrganization(organizationId, name, this.now()); await this.audit(organizationId, userId, "organization.renamed", "organization", organizationId); }
  async members(organizationId: string, userId: string) { await this.access(organizationId, userId); return this.store.members(organizationId); }
  async createInvite(organizationId: string, userId: string, input: { email?: string; role: "admin" | "member" }) {
    await this.access(organizationId, userId, ["owner", "admin"]);
    const rawToken = token(this.random); const now = this.now();
    const invite: OrganizationInvite = { id: crypto.randomUUID(), organizationId, createdByUserId: userId, ...(input.email ? { email: input.email.toLowerCase() } : {}), tokenHash: await tokenHash(rawToken), role: input.role, expiresAt: now + INVITE_LIFETIME_MS, createdAt: now };
    await this.store.createInvite(invite);
    await this.audit(organizationId, userId, "invite.created", "invite", invite.id, { role: input.role, delivery: input.email ? "email" : "link" });
    return { id: invite.id, organizationId, role: invite.role, expiresAt: invite.expiresAt, token: rawToken, ...(invite.email ? { email: invite.email } : {}) };
  }
  async acceptInvite(userId: string, rawToken: string, verifiedEmails: string[]) {
    const invite = await this.store.inviteByTokenHash(await tokenHash(rawToken)); const now = this.now();
    if (!invite || invite.acceptedAt || invite.expiresAt <= now) throw new OrganizationError(404, "Invitation not found.");
    if (invite.email && !verifiedEmails.some((email) => email.toLowerCase() === invite.email)) throw new OrganizationError(404, "Invitation not found.");
    const membership: Membership = { id: crypto.randomUUID(), organizationId: invite.organizationId, userId, role: invite.role, createdAt: now, updatedAt: now };
    if (!await this.store.acceptInvite(invite.id, membership, userId, now)) throw new OrganizationError(404, "Invitation not found.");
    await this.audit(invite.organizationId, userId, "invite.accepted", "invite", invite.id);
    const acceptedMembership = await this.store.membership(invite.organizationId, userId);
    return { organizationId: invite.organizationId, role: acceptedMembership?.role ?? invite.role };
  }
  async teams(organizationId: string, userId: string) { await this.access(organizationId, userId); return this.store.teams(organizationId); }
  async teamMembers(organizationId: string, userId: string, teamId: string) { await this.access(organizationId, userId); if (!await this.store.team(organizationId, teamId)) throw new OrganizationError(404, "Team not found."); return this.store.teamMembers(organizationId, teamId); }
  async createTeam(organizationId: string, userId: string, name: string) { await this.access(organizationId, userId, ["owner", "admin"]); const now = this.now(); const team: OrganizationTeam = { id: crypto.randomUUID(), organizationId, name, createdAt: now, updatedAt: now }; await this.store.createTeam(team); await this.audit(organizationId, userId, "team.created", "team", team.id); return team; }
  async renameTeam(organizationId: string, userId: string, teamId: string, name: string) { await this.access(organizationId, userId, ["owner", "admin"]); if (!await this.store.renameTeam(organizationId, teamId, name, this.now())) throw new OrganizationError(404, "Team not found."); await this.audit(organizationId, userId, "team.renamed", "team", teamId); }
  async deleteTeam(organizationId: string, userId: string, teamId: string) { await this.access(organizationId, userId, ["owner", "admin"]); if (!await this.store.deleteTeam(organizationId, teamId)) throw new OrganizationError(404, "Team not found."); await this.audit(organizationId, userId, "team.deleted", "team", teamId); }
  async changeTeamMember(organizationId: string, userId: string, teamId: string, memberUserId: string, add: boolean) { await this.access(organizationId, userId, ["owner", "admin"]); if (!await this.store.team(organizationId, teamId) || !await this.store.membership(organizationId, memberUserId)) throw new OrganizationError(404, "Team not found."); const changed = add ? await this.store.addTeamMember(organizationId, teamId, memberUserId, this.now()) : await this.store.removeTeamMember(organizationId, teamId, memberUserId); if (!changed) throw new OrganizationError(404, add ? "Member not found." : "Team member not found."); await this.audit(organizationId, userId, add ? "team.member_added" : "team.member_removed", "team", teamId, { userId: memberUserId }); }
  async workspaces(organizationId: string, userId: string) { const member = await this.access(organizationId, userId); return this.store.visibleWorkspaces(organizationId, userId, member.role !== "member"); }
  async workspace(organizationId: string, userId: string, workspaceId: string) {
    const member = await this.access(organizationId, userId);
    const workspace = (await this.store.visibleWorkspaces(organizationId, userId, member.role !== "member")).find((candidate) => candidate.id === workspaceId);
    if (!workspace) throw new OrganizationError(404, "Workspace not found.");
    return member.role === "member" ? workspace : { ...workspace, access: await this.store.workspaceAccess(organizationId, workspaceId) };
  }
  async createWorkspace(organizationId: string, userId: string, input: { name: string; origin: string; access?: WorkspaceAccess }) {
    await this.access(organizationId, userId, ["owner", "admin"]);
    const origin = repositoryOrigin(input.origin);
    if (!origin) throw new OrganizationError(400, "Enter the repository origin.");
    if (await this.store.workspaceByOrigin(organizationId, origin)) throw new OrganizationError(409, "This workspace is already registered.");
    const access = input.access ? await this.workspaceAccessInput(organizationId, input.access) : { teamIds: [], userIds: [] };
    const now = this.now();
    const workspace = { id: crypto.randomUUID(), organizationId, name: input.name, origin, restricted: input.access !== undefined, createdAt: now, updatedAt: now };
    await this.store.createWorkspace(workspace, access);
    await this.audit(organizationId, userId, "workspace.created", "workspace", workspace.id, { restricted: workspace.restricted });
    return { ...workspace, access };
  }
  async updateWorkspace(organizationId: string, userId: string, workspaceId: string, patch: { name?: string; access?: WorkspaceAccess | null }) {
    await this.access(organizationId, userId, ["owner", "admin"]);
    if (!await this.store.workspace(organizationId, workspaceId)) throw new OrganizationError(404, "Workspace not found.");
    const access = patch.access === undefined ? undefined : patch.access === null ? { teamIds: [], userIds: [] } : await this.workspaceAccessInput(organizationId, patch.access);
    await this.store.updateWorkspace(organizationId, workspaceId, { ...(patch.name ? { name: patch.name } : {}), ...(patch.access !== undefined ? { restricted: patch.access !== null } : {}) }, this.now());
    if (access) await this.store.replaceWorkspaceAccess(organizationId, workspaceId, access);
    await this.audit(organizationId, userId, "workspace.updated", "workspace", workspaceId, { ...(patch.name ? { name: true } : {}), ...(patch.access !== undefined ? { access: patch.access === null ? "organization" : "restricted" } : {}) });
    return this.workspace(organizationId, userId, workspaceId);
  }
  async deleteWorkspace(organizationId: string, userId: string, workspaceId: string) { await this.access(organizationId, userId, ["owner", "admin"]); if (!await this.store.deleteWorkspace(organizationId, workspaceId)) throw new OrganizationError(404, "Workspace not found."); await this.audit(organizationId, userId, "workspace.deleted", "workspace", workspaceId); }
  async removeMember(organizationId: string, userId: string, memberUserId: string) { const actor = await this.access(organizationId, userId, ["owner", "admin"]); const target = await this.store.membership(organizationId, memberUserId); if (!target || target.role === "owner" || (actor.role === "admin" && target.role === "admin")) throw new OrganizationError(404, "Member not found."); await this.store.removeMembership(organizationId, memberUserId); await this.audit(organizationId, userId, "membership.removed", "user", memberUserId); }
  async changeRole(organizationId: string, userId: string, memberUserId: string, role: "admin" | "member") { await this.access(organizationId, userId, ["owner"]); const target = await this.store.membership(organizationId, memberUserId); if (!target || target.role === "owner") throw new OrganizationError(404, "Member not found."); await this.store.updateMembershipRole(organizationId, memberUserId, role, this.now()); await this.audit(organizationId, userId, "membership.role_changed", "user", memberUserId, { role }); }
  async leave(organizationId: string, userId: string) { const member = await this.access(organizationId, userId); if (member.role === "owner") throw new OrganizationError(409, "Transfer ownership before you leave."); await this.store.removeMembership(organizationId, userId); await this.audit(organizationId, userId, "membership.left", "user", userId); }
  async transfer(organizationId: string, userId: string, nextOwnerId: string) { await this.access(organizationId, userId, ["owner"]); const next = await this.store.membership(organizationId, nextOwnerId); if (!next) throw new OrganizationError(404, "Member not found."); const now = this.now(); await this.store.updateMembershipRole(organizationId, nextOwnerId, "owner", now); await this.store.updateMembershipRole(organizationId, userId, "admin", now); await this.audit(organizationId, userId, "ownership.transferred", "user", nextOwnerId); }
  async deletionImpact(organizationId: string, userId: string) { await this.access(organizationId, userId, ["owner"]); const organization = await this.store.organization(organizationId); if (!organization) throw new OrganizationError(404, "Organization not found."); return { organizationId, name: organization.name, ...(await this.store.counts(organizationId)), deletes: ["memberships", "teams", "invitations", "workspaces", "organization settings"] as const }; }
  async delete(organizationId: string, userId: string, confirmation: string) { const impact = await this.deletionImpact(organizationId, userId); if (confirmation !== impact.name) throw new OrganizationError(400, "Enter the organization name to confirm deletion."); await this.audit(organizationId, userId, "organization.deleted", "organization", organizationId, impact); await this.store.deleteOrganization(organizationId); }
}
