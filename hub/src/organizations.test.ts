import assert from "node:assert/strict";
import test from "node:test";

import type { AuditEvent, Membership, Organization, OrganizationInvite, OrganizationRole, OrganizationStore, OrganizationSummary, OrganizationTeam, OrganizationWorkspace, WorkspaceAccess } from "./organization-store.js";
import { OrganizationError, OrganizationService } from "./organizations.js";
import { createRouteHandler, type Env } from "./worker.js";

class MemoryOrganizationStore implements OrganizationStore {
  organizations: Organization[] = []; memberships: Membership[] = []; invites: OrganizationInvite[] = []; teamRows: OrganizationTeam[] = []; teamMemberships: { organizationId: string; teamId: string; userId: string }[] = []; workspaceRows: OrganizationWorkspace[] = []; workspaceGrants = new Map<string, WorkspaceAccess>(); audits: AuditEvent[] = [];
  async createOrganization(org: Organization, member: Membership) { this.organizations.push(org); this.memberships.push(member); }
  async organizationsFor(userId: string): Promise<OrganizationSummary[]> { return this.memberships.filter((m) => m.userId === userId).map((m) => ({ ...this.organizations.find((o) => o.id === m.organizationId)!, role: m.role })); }
  async membership(org: string, user: string) { return this.memberships.find((m) => m.organizationId === org && m.userId === user); }
  async members(org: string) { return this.memberships.filter((m) => m.organizationId === org); }
  async updateMembershipRole(org: string, user: string, role: OrganizationRole, at: number) { const m = await this.membership(org, user); if (!m) return false; m.role = role; m.updatedAt = at; return true; }
  async removeMembership(org: string, user: string) { const before = this.memberships.length; this.memberships = this.memberships.filter((m) => m.organizationId !== org || m.userId !== user); this.teamMemberships = this.teamMemberships.filter((m) => m.organizationId !== org || m.userId !== user); return before !== this.memberships.length; }
  async deleteOrganization(org: string) { const before = this.organizations.length; this.organizations = this.organizations.filter((o) => o.id !== org); this.memberships = this.memberships.filter((m) => m.organizationId !== org); this.invites = this.invites.filter((i) => i.organizationId !== org); this.teamRows = this.teamRows.filter((t) => t.organizationId !== org); return before !== this.organizations.length; }
  async organization(org: string) { return this.organizations.find((o) => o.id === org); }
  async renameOrganization(org: string, name: string, at: number) { const row = await this.organization(org); if (!row) return false; row.name = name; row.updatedAt = at; return true; }
  async counts(org: string) { return { members: this.memberships.filter((m) => m.organizationId === org).length, teams: this.teamRows.filter((t) => t.organizationId === org).length, invites: this.invites.filter((i) => i.organizationId === org && !i.acceptedAt).length, workspaces: this.workspaceRows.filter((workspace) => workspace.organizationId === org).length }; }
  async createInvite(i: OrganizationInvite) { this.invites.push(i); }
  async inviteByTokenHash(hash: string) { return this.invites.find((i) => i.tokenHash === hash); }
  async acceptInvite(id: string, member: Membership, user: string, at: number) { const i = this.invites.find((candidate) => candidate.id === id && !candidate.acceptedAt && candidate.expiresAt > at); if (!i) return false; i.acceptedAt = at; i.acceptedByUserId = user; if (!await this.membership(member.organizationId, user)) this.memberships.push(member); return true; }
  async createTeam(t: OrganizationTeam) { this.teamRows.push(t); }
  async teams(org: string) { return this.teamRows.filter((t) => t.organizationId === org); }
  async team(org: string, id: string) { return this.teamRows.find((t) => t.organizationId === org && t.id === id); }
  async renameTeam(org: string, id: string, name: string, at: number) { const t = await this.team(org, id); if (!t) return false; t.name = name; t.updatedAt = at; return true; }
  async deleteTeam(org: string, id: string) { const before = this.teamRows.length; this.teamRows = this.teamRows.filter((t) => t.organizationId !== org || t.id !== id); return before !== this.teamRows.length; }
  async addTeamMember(org: string, team: string, user: string) { if (this.teamMemberships.some((m) => m.teamId === team && m.userId === user)) return false; this.teamMemberships.push({ organizationId: org, teamId: team, userId: user }); return true; }
  async removeTeamMember(org: string, team: string, user: string) { const before = this.teamMemberships.length; this.teamMemberships = this.teamMemberships.filter((m) => m.organizationId !== org || m.teamId !== team || m.userId !== user); return before !== this.teamMemberships.length; }
  async teamMembers(org: string, team: string) { return this.teamMemberships.filter((m) => m.organizationId === org && m.teamId === team).map((m) => m.userId); }
  async createWorkspace(workspace: OrganizationWorkspace, access: WorkspaceAccess) { this.workspaceRows.push(workspace); this.workspaceGrants.set(workspace.id, structuredClone(access)); }
  async workspace(org: string, id: string) { return this.workspaceRows.find((workspace) => workspace.organizationId === org && workspace.id === id); }
  async workspaceByOrigin(org: string, origin: string) { return this.workspaceRows.find((workspace) => workspace.organizationId === org && workspace.origin === origin); }
  async visibleWorkspaces(org: string, user: string, administer: boolean) { const teams = new Set(this.teamMemberships.filter((member) => member.organizationId === org && member.userId === user).map((member) => member.teamId)); return this.workspaceRows.filter((workspace) => workspace.organizationId === org && (administer || !workspace.restricted || this.workspaceGrants.get(workspace.id)?.userIds.includes(user) || this.workspaceGrants.get(workspace.id)?.teamIds.some((team) => teams.has(team)))); }
  async workspaceAccess(_org: string, id: string) { return structuredClone(this.workspaceGrants.get(id) ?? { teamIds: [], userIds: [] }); }
  async updateWorkspace(org: string, id: string, patch: { name?: string; restricted?: boolean }, at: number) { const workspace = await this.workspace(org, id); if (!workspace) return false; Object.assign(workspace, patch, { updatedAt: at }); return true; }
  async replaceWorkspaceAccess(_org: string, id: string, access: WorkspaceAccess) { this.workspaceGrants.set(id, structuredClone(access)); }
  async deleteWorkspace(org: string, id: string) { const before = this.workspaceRows.length; this.workspaceRows = this.workspaceRows.filter((workspace) => workspace.organizationId !== org || workspace.id !== id); this.workspaceGrants.delete(id); return before !== this.workspaceRows.length; }
  async appendAudit(event: AuditEvent) { this.audits.push(event); }
}

const random = () => Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const env = (): Env => ({ AUTH_SECRET: {} as SecretsStoreSecret, BETTER_AUTH_URL: "https://hub.example", COORDINATOR: {} as DurableObjectNamespace, DB: {} as D1Database, ENVIRONMENT: "staging", JOBS: {} as Queue, OBJECTS: {} as R2Bucket, RELEASE: "test" });

test("one account can belong to many organizations and tenant reads never cross", async () => {
  const store = new MemoryOrganizationStore(); const service = new OrganizationService(store, () => 1000, random);
  const first = await service.create("user-1", "First"); const second = await service.create("user-1", "Second");
  await assert.rejects(service.members(first.id, "user-2"), (error: unknown) => error instanceof OrganizationError && error.status === 404);
  assert.deepEqual((await service.list("user-1")).map((org) => org.id), [first.id, second.id]);
});

test("a valid session gets not found for another organization's resource", async () => {
  const store = new MemoryOrganizationStore(); const service = new OrganizationService(store, () => 1000, random); const org = await service.create("user-1", "Private");
  const route = createRouteHandler({
    accountStore: () => ({}) as never,
    accountService: () => ({ authenticate: async () => ({ sessionId: "session-2", userId: "user-2", clientKind: "web" }) }) as never,
    organizationStore: () => store,
    organizationService: () => service,
  });
  const response = await route(new Request(`https://hub.example/api/organizations/${org.id}/members`, { headers: { authorization: "Bearer valid-user-2-session" } }), env());
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Organization not found." });
});

test("email and link invitations expire and can be accepted only once", async () => {
  const store = new MemoryOrganizationStore(); let now = 1000; const service = new OrganizationService(store, () => now, random); const org = await service.create("owner", "Example");
  const invite = await service.createInvite(org.id, "owner", { email: "Person@Example.com", role: "member" });
  assert.equal(invite.email, "person@example.com");
  await assert.rejects(service.acceptInvite("wrong", invite.token, ["wrong@example.com"]), /Invitation not found/);
  assert.deepEqual(await service.acceptInvite("person", invite.token, ["person@example.com"]), { organizationId: org.id, role: "member" });
  await assert.rejects(service.acceptInvite("other", invite.token, ["person@example.com"]), /Invitation not found/);
  const expired = await service.createInvite(org.id, "owner", { role: "admin" }); now = expired.expiresAt;
  await assert.rejects(service.acceptInvite("other", expired.token, []), /Invitation not found/);
});

test("teams contain only members from their organization and every change is audited", async () => {
  const store = new MemoryOrganizationStore(); const service = new OrganizationService(store, () => 1000, random); const org = await service.create("owner", "Example");
  const invite = await service.createInvite(org.id, "owner", { role: "member" }); await service.acceptInvite("member", invite.token, []);
  const team = await service.createTeam(org.id, "owner", "Builders"); await service.changeTeamMember(org.id, "owner", team.id, "member", true); await service.renameTeam(org.id, "owner", team.id, "Engineering");
  await assert.rejects(service.changeTeamMember(org.id, "owner", team.id, "outsider", true), /Team not found/);
  assert.deepEqual(store.audits.map((event) => event.action), ["organization.created", "invite.created", "invite.accepted", "team.created", "team.member_added", "team.renamed"]);
});

test("owners transfer before leaving and deletion requires an impact preview confirmation", async () => {
  const store = new MemoryOrganizationStore(); const service = new OrganizationService(store, () => 1000, random); const org = await service.create("owner", "Example");
  const invite = await service.createInvite(org.id, "owner", { role: "admin" }); await service.acceptInvite("next", invite.token, []);
  await assert.rejects(service.leave(org.id, "owner"), /Transfer ownership/); await service.transfer(org.id, "owner", "next"); await service.leave(org.id, "owner");
  assert.equal((await store.membership(org.id, "next"))?.role, "owner");
  const impact = await service.deletionImpact(org.id, "next"); assert.equal(impact.members, 1); assert.deepEqual(impact.deletes, ["memberships", "teams", "invitations", "workspaces", "organization settings"]);
  await assert.rejects(service.delete(org.id, "next", "Wrong"), /organization name/); await service.delete(org.id, "next", "Example"); assert.equal(await store.organization(org.id), undefined);
});

test("workspace catalogues hide team-restricted repositories from members outside the team", async () => {
  const store = new MemoryOrganizationStore(); const service = new OrganizationService(store, () => 1000, random); const org = await service.create("owner", "Example");
  for (const user of ["builder", "outsider"]) store.memberships.push({ id: `membership-${user}`, organizationId: org.id, userId: user, role: "member", createdAt: 1000, updatedAt: 1000 });
  const team = await service.createTeam(org.id, "owner", "Builders"); await service.changeTeamMember(org.id, "owner", team.id, "builder", true);
  const shared = await service.createWorkspace(org.id, "owner", { name: "Shared", origin: "https://github.com/example/shared.git" });
  const restricted = await service.createWorkspace(org.id, "owner", { name: "Private", origin: "https://github.com/example/private.git", access: { teamIds: [team.id], userIds: [] } });
  assert.deepEqual((await service.workspaces(org.id, "builder")).map((workspace) => workspace.id), [shared.id, restricted.id]);
  assert.deepEqual((await service.workspaces(org.id, "outsider")).map((workspace) => workspace.id), [shared.id]);
  await assert.rejects(service.workspace(org.id, "outsider", restricted.id), (error: unknown) => error instanceof OrganizationError && error.status === 404);
  assert.deepEqual((await service.workspace(org.id, "owner", restricted.id) as { access: WorkspaceAccess }).access.teamIds, [team.id]);
});

test("workspace access accepts organization members, rejects foreign principals, and can return to organization-wide", async () => {
  const store = new MemoryOrganizationStore(); const service = new OrganizationService(store, () => 1000, random); const org = await service.create("owner", "Example");
  const invite = await service.createInvite(org.id, "owner", { role: "member" }); await service.acceptInvite("member", invite.token, []);
  const workspace = await service.createWorkspace(org.id, "owner", { name: "Remy", origin: "git@github.com:padam/remy.git", access: { teamIds: [], userIds: ["member"] } });
  assert.equal(workspace.origin, "github.com/padam/remy");
  await assert.rejects(service.createWorkspace(org.id, "owner", { name: "Duplicate", origin: "https://github.com/padam/remy.git" }), (error: unknown) => error instanceof OrganizationError && error.status === 409);
  await assert.rejects(service.updateWorkspace(org.id, "owner", workspace.id, { access: { teamIds: ["foreign"], userIds: [] } }), /Team not found/);
  const updated = await service.updateWorkspace(org.id, "owner", workspace.id, { access: null });
  assert.equal(updated.restricted, false);
  assert.deepEqual((await service.workspaces(org.id, "member")).map((entry) => entry.id), [workspace.id]);
});
