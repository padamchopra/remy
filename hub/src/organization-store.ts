export type OrganizationRole = "owner" | "admin" | "member";

export type Organization = { id: string; name: string; createdAt: number; updatedAt: number };
export type Membership = { id: string; organizationId: string; userId: string; role: OrganizationRole; createdAt: number; updatedAt: number };
export type OrganizationSummary = Organization & { role: OrganizationRole };
export type OrganizationInvite = { id: string; organizationId: string; createdByUserId: string; email?: string; tokenHash: string; role: Exclude<OrganizationRole, "owner">; expiresAt: number; acceptedByUserId?: string; acceptedAt?: number; createdAt: number };
export type OrganizationTeam = { id: string; organizationId: string; name: string; createdAt: number; updatedAt: number };
export type OrganizationWorkspace = { id: string; organizationId: string; name: string; origin: string; restricted: boolean; createdAt: number; updatedAt: number };
export type WorkspaceAccess = { teamIds: string[]; userIds: string[] };
export type AuditEvent = { id: string; organizationId: string; actorUserId: string; action: string; targetKind: string; targetId: string; metadata: Record<string, unknown>; createdAt: number };

export interface OrganizationStore {
  createOrganization(organization: Organization, membership: Membership): Promise<void>;
  organizationsFor(userId: string): Promise<OrganizationSummary[]>;
  membership(organizationId: string, userId: string): Promise<Membership | undefined>;
  members(organizationId: string): Promise<Membership[]>;
  updateMembershipRole(organizationId: string, userId: string, role: OrganizationRole, at: number): Promise<boolean>;
  removeMembership(organizationId: string, userId: string): Promise<boolean>;
  deleteOrganization(organizationId: string): Promise<boolean>;
  organization(organizationId: string): Promise<Organization | undefined>;
  renameOrganization(organizationId: string, name: string, at: number): Promise<boolean>;
  counts(organizationId: string): Promise<{ members: number; teams: number; invites: number; workspaces: number }>;
  createInvite(invite: OrganizationInvite): Promise<void>;
  inviteByTokenHash(tokenHash: string): Promise<OrganizationInvite | undefined>;
  acceptInvite(inviteId: string, membership: Membership, userId: string, at: number): Promise<boolean>;
  createTeam(team: OrganizationTeam): Promise<void>;
  teams(organizationId: string): Promise<OrganizationTeam[]>;
  team(organizationId: string, teamId: string): Promise<OrganizationTeam | undefined>;
  renameTeam(organizationId: string, teamId: string, name: string, at: number): Promise<boolean>;
  deleteTeam(organizationId: string, teamId: string): Promise<boolean>;
  addTeamMember(organizationId: string, teamId: string, userId: string, at: number): Promise<boolean>;
  removeTeamMember(organizationId: string, teamId: string, userId: string): Promise<boolean>;
  teamMembers(organizationId: string, teamId: string): Promise<string[]>;
  createWorkspace(workspace: OrganizationWorkspace, access: WorkspaceAccess): Promise<void>;
  workspace(organizationId: string, workspaceId: string): Promise<OrganizationWorkspace | undefined>;
  workspaceByOrigin(organizationId: string, origin: string): Promise<OrganizationWorkspace | undefined>;
  visibleWorkspaces(organizationId: string, userId: string, administer: boolean): Promise<OrganizationWorkspace[]>;
  workspaceAccess(organizationId: string, workspaceId: string): Promise<WorkspaceAccess>;
  updateWorkspace(organizationId: string, workspaceId: string, patch: { name?: string; restricted?: boolean }, at: number): Promise<boolean>;
  replaceWorkspaceAccess(organizationId: string, workspaceId: string, access: WorkspaceAccess): Promise<void>;
  deleteWorkspace(organizationId: string, workspaceId: string): Promise<boolean>;
  appendAudit(event: AuditEvent): Promise<void>;
}

type Row = Record<string, unknown>;
const organizationFrom = (row: Row): Organization => ({ id: String(row.id), name: String(row.name), createdAt: Number(row.createdAt), updatedAt: Number(row.updatedAt) });
const membershipFrom = (row: Row): Membership => ({ id: String(row.id), organizationId: String(row.organization_id), userId: String(row.user_id), role: String(row.role) as OrganizationRole, createdAt: Number(row.createdAt), updatedAt: Number(row.updatedAt) });
const teamFrom = (row: Row): OrganizationTeam => ({ id: String(row.id), organizationId: String(row.organization_id), name: String(row.name), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) });
const workspaceFrom = (row: Row): OrganizationWorkspace => ({ id: String(row.id), organizationId: String(row.organization_id), name: String(row.name), origin: String(row.origin), restricted: Boolean(row.restricted), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) });
const inviteFrom = (row: Row): OrganizationInvite => ({ id: String(row.id), organizationId: String(row.organization_id), createdByUserId: String(row.created_by_user_id), ...(row.email ? { email: String(row.email) } : {}), tokenHash: String(row.token_hash), role: String(row.role) as Exclude<OrganizationRole, "owner">, expiresAt: Number(row.expires_at), ...(row.accepted_by_user_id ? { acceptedByUserId: String(row.accepted_by_user_id) } : {}), ...(row.accepted_at ? { acceptedAt: Number(row.accepted_at) } : {}), createdAt: Number(row.created_at) });

export class D1OrganizationStore implements OrganizationStore {
  constructor(private readonly db: D1Database) {}

  async createOrganization(org: Organization, member: Membership) {
    await this.db.batch([
      this.db.prepare("INSERT INTO organizations (id,name,createdAt,updatedAt) VALUES (?,?,?,?)").bind(org.id, org.name, org.createdAt, org.updatedAt),
      this.db.prepare("INSERT INTO memberships (id,organization_id,user_id,role,createdAt,updatedAt) VALUES (?,?,?,?,?,?)").bind(member.id, member.organizationId, member.userId, member.role, member.createdAt, member.updatedAt),
    ]);
  }
  async organizationsFor(userId: string) {
    const result = await this.db.prepare("SELECT o.*,m.role FROM organizations o JOIN memberships m ON m.organization_id=o.id WHERE m.user_id=? ORDER BY lower(o.name),o.id").bind(userId).all<Row>();
    return result.results.map((row) => ({ ...organizationFrom(row), role: String(row.role) as OrganizationRole }));
  }
  async membership(organizationId: string, userId: string) { const row = await this.db.prepare("SELECT * FROM memberships WHERE organization_id=? AND user_id=?").bind(organizationId, userId).first<Row>(); return row ? membershipFrom(row) : undefined; }
  async members(organizationId: string) { const result = await this.db.prepare("SELECT * FROM memberships WHERE organization_id=? ORDER BY createdAt,id").bind(organizationId).all<Row>(); return result.results.map(membershipFrom); }
  async updateMembershipRole(organizationId: string, userId: string, role: OrganizationRole, at: number) { const result = await this.db.prepare("UPDATE memberships SET role=?,updatedAt=? WHERE organization_id=? AND user_id=?").bind(role, at, organizationId, userId).run(); return result.meta.changes === 1; }
  async removeMembership(organizationId: string, userId: string) { const result = await this.db.prepare("DELETE FROM memberships WHERE organization_id=? AND user_id=?").bind(organizationId, userId).run(); return result.meta.changes === 1; }
  async deleteOrganization(organizationId: string) { const [, result] = await this.db.batch([this.db.prepare("DELETE FROM ssoProvider WHERE organizationId=?").bind(organizationId), this.db.prepare("DELETE FROM organizations WHERE id=?").bind(organizationId)]); return result.meta.changes === 1; }
  async organization(organizationId: string) { const row = await this.db.prepare("SELECT * FROM organizations WHERE id=?").bind(organizationId).first<Row>(); return row ? organizationFrom(row) : undefined; }
  async renameOrganization(organizationId: string, name: string, at: number) { const result = await this.db.prepare("UPDATE organizations SET name=?,updatedAt=? WHERE id=?").bind(name, at, organizationId).run(); return result.meta.changes === 1; }
  async counts(organizationId: string) { const row = await this.db.prepare("SELECT (SELECT count(*) FROM memberships WHERE organization_id=?) members,(SELECT count(*) FROM organization_teams WHERE organization_id=?) teams,(SELECT count(*) FROM organization_invites WHERE organization_id=? AND accepted_at IS NULL) invites,(SELECT count(*) FROM organization_workspaces WHERE organization_id=?) workspaces").bind(organizationId, organizationId, organizationId, organizationId).first<Row>(); return { members: Number(row?.members ?? 0), teams: Number(row?.teams ?? 0), invites: Number(row?.invites ?? 0), workspaces: Number(row?.workspaces ?? 0) }; }
  async createInvite(invite: OrganizationInvite) { await this.db.prepare("INSERT INTO organization_invites (id,organization_id,created_by_user_id,email,token_hash,role,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(invite.id, invite.organizationId, invite.createdByUserId, invite.email ?? null, invite.tokenHash, invite.role, invite.expiresAt, invite.createdAt).run(); }
  async inviteByTokenHash(tokenHash: string) { const row = await this.db.prepare("SELECT * FROM organization_invites WHERE token_hash=?").bind(tokenHash).first<Row>(); return row ? inviteFrom(row) : undefined; }
  async acceptInvite(inviteId: string, member: Membership, userId: string, at: number) {
    const invite = await this.db.prepare("UPDATE organization_invites SET accepted_by_user_id=?,accepted_at=? WHERE id=? AND accepted_at IS NULL AND expires_at>?").bind(userId, at, inviteId, at).run();
    if (invite.meta.changes !== 1) return false;
    await this.db.prepare("INSERT INTO memberships (id,organization_id,user_id,role,createdAt,updatedAt) VALUES (?,?,?,?,?,?) ON CONFLICT(organization_id,user_id) DO NOTHING").bind(member.id, member.organizationId, member.userId, member.role, member.createdAt, member.updatedAt).run();
    return true;
  }
  async createTeam(team: OrganizationTeam) { await this.db.prepare("INSERT INTO organization_teams (id,organization_id,name,created_at,updated_at) VALUES (?,?,?,?,?)").bind(team.id, team.organizationId, team.name, team.createdAt, team.updatedAt).run(); }
  async teams(organizationId: string) { const result = await this.db.prepare("SELECT * FROM organization_teams WHERE organization_id=? ORDER BY lower(name),id").bind(organizationId).all<Row>(); return result.results.map(teamFrom); }
  async team(organizationId: string, teamId: string) { const row = await this.db.prepare("SELECT * FROM organization_teams WHERE organization_id=? AND id=?").bind(organizationId, teamId).first<Row>(); return row ? teamFrom(row) : undefined; }
  async renameTeam(organizationId: string, teamId: string, name: string, at: number) { const result = await this.db.prepare("UPDATE organization_teams SET name=?,updated_at=? WHERE organization_id=? AND id=?").bind(name, at, organizationId, teamId).run(); return result.meta.changes === 1; }
  async deleteTeam(organizationId: string, teamId: string) { const result = await this.db.prepare("DELETE FROM organization_teams WHERE organization_id=? AND id=?").bind(organizationId, teamId).run(); return result.meta.changes === 1; }
  async addTeamMember(organizationId: string, teamId: string, userId: string, at: number) { try { await this.db.prepare("INSERT INTO organization_team_members (organization_id,team_id,user_id,created_at) VALUES (?,?,?,?)").bind(organizationId, teamId, userId, at).run(); return true; } catch { return false; } }
  async removeTeamMember(organizationId: string, teamId: string, userId: string) { const result = await this.db.prepare("DELETE FROM organization_team_members WHERE organization_id=? AND team_id=? AND user_id=?").bind(organizationId, teamId, userId).run(); return result.meta.changes === 1; }
  async teamMembers(organizationId: string, teamId: string) { const result = await this.db.prepare("SELECT user_id FROM organization_team_members WHERE organization_id=? AND team_id=? ORDER BY user_id").bind(organizationId, teamId).all<Row>(); return result.results.map((row) => String(row.user_id)); }
  async createWorkspace(workspace: OrganizationWorkspace, access: WorkspaceAccess) {
    await this.db.batch([
      this.db.prepare("INSERT INTO organization_workspaces (id,organization_id,name,origin,restricted,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(workspace.id, workspace.organizationId, workspace.name, workspace.origin, workspace.restricted ? 1 : 0, workspace.createdAt, workspace.updatedAt),
      ...access.teamIds.map((teamId) => this.db.prepare("INSERT INTO organization_workspace_teams (organization_id,workspace_id,team_id) VALUES (?,?,?)").bind(workspace.organizationId, workspace.id, teamId)),
      ...access.userIds.map((userId) => this.db.prepare("INSERT INTO organization_workspace_members (organization_id,workspace_id,user_id) VALUES (?,?,?)").bind(workspace.organizationId, workspace.id, userId)),
    ]);
  }
  async workspace(organizationId: string, workspaceId: string) { const row = await this.db.prepare("SELECT * FROM organization_workspaces WHERE organization_id=? AND id=?").bind(organizationId, workspaceId).first<Row>(); return row ? workspaceFrom(row) : undefined; }
  async workspaceByOrigin(organizationId: string, origin: string) { const row = await this.db.prepare("SELECT * FROM organization_workspaces WHERE organization_id=? AND origin=?").bind(organizationId, origin).first<Row>(); return row ? workspaceFrom(row) : undefined; }
  async visibleWorkspaces(organizationId: string, userId: string, administer: boolean) {
    const result = await this.db.prepare(`SELECT DISTINCT w.* FROM organization_workspaces w
      WHERE w.organization_id=? AND (? OR NOT w.restricted
        OR EXISTS (SELECT 1 FROM organization_workspace_members wm WHERE wm.workspace_id=w.id AND wm.user_id=?)
        OR EXISTS (SELECT 1 FROM organization_workspace_teams wt JOIN organization_team_members tm ON tm.team_id=wt.team_id WHERE wt.workspace_id=w.id AND tm.user_id=?))
      ORDER BY lower(w.name),w.id`).bind(organizationId, administer ? 1 : 0, userId, userId).all<Row>();
    return result.results.map(workspaceFrom);
  }
  async workspaceAccess(organizationId: string, workspaceId: string) {
    const [teams, users] = await Promise.all([
      this.db.prepare("SELECT team_id FROM organization_workspace_teams WHERE organization_id=? AND workspace_id=? ORDER BY team_id").bind(organizationId, workspaceId).all<Row>(),
      this.db.prepare("SELECT user_id FROM organization_workspace_members WHERE organization_id=? AND workspace_id=? ORDER BY user_id").bind(organizationId, workspaceId).all<Row>(),
    ]);
    return { teamIds: teams.results.map((row) => String(row.team_id)), userIds: users.results.map((row) => String(row.user_id)) };
  }
  async updateWorkspace(organizationId: string, workspaceId: string, patch: { name?: string; restricted?: boolean }, at: number) { const current = await this.workspace(organizationId, workspaceId); if (!current) return false; const result = await this.db.prepare("UPDATE organization_workspaces SET name=?,restricted=?,updated_at=? WHERE organization_id=? AND id=?").bind(patch.name ?? current.name, (patch.restricted ?? current.restricted) ? 1 : 0, at, organizationId, workspaceId).run(); return result.meta.changes === 1; }
  async replaceWorkspaceAccess(organizationId: string, workspaceId: string, access: WorkspaceAccess) { await this.db.batch([this.db.prepare("DELETE FROM organization_workspace_teams WHERE organization_id=? AND workspace_id=?").bind(organizationId, workspaceId), this.db.prepare("DELETE FROM organization_workspace_members WHERE organization_id=? AND workspace_id=?").bind(organizationId, workspaceId), ...access.teamIds.map((teamId) => this.db.prepare("INSERT INTO organization_workspace_teams (organization_id,workspace_id,team_id) VALUES (?,?,?)").bind(organizationId, workspaceId, teamId)), ...access.userIds.map((userId) => this.db.prepare("INSERT INTO organization_workspace_members (organization_id,workspace_id,user_id) VALUES (?,?,?)").bind(organizationId, workspaceId, userId))]); }
  async deleteWorkspace(organizationId: string, workspaceId: string) { const result = await this.db.prepare("DELETE FROM organization_workspaces WHERE organization_id=? AND id=?").bind(organizationId, workspaceId).run(); return result.meta.changes === 1; }
  async appendAudit(event: AuditEvent) { await this.db.prepare("INSERT INTO organization_audit_events (id,organization_id,actor_user_id,action,target_kind,target_id,metadata,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(event.id, event.organizationId, event.actorUserId, event.action, event.targetKind, event.targetId, JSON.stringify(event.metadata), event.createdAt).run(); }
}
