import {
  COMPUTER_HEARTBEAT_TIMEOUT_MS,
  MINIMUM_COMPUTER_PROTOCOL_VERSION,
  computerRegistrationInputSchema,
  computerSummarySchema,
  computerAccessSchema,
  type ComputerAccess,
} from "@remy/contract";
import type { OrganizationStore } from "./organization-store.js";
import type { ComputerStore, StoredComputer } from "./computer-store.js";
import { OrganizationService, repositoryOrigin, OrganizationError } from "./organizations.js";

export class ComputerService {
  constructor(private readonly store: ComputerStore, private readonly now: () => number = Date.now, private readonly minimumDaemonVersion = "0.1.0", private readonly organizations?: OrganizationStore) {}

  async register(organizationId: string, ownerUserId: string, input: unknown) {
    const parsed = computerRegistrationInputSchema.parse(input);
    if (parsed.ownership !== "personal") {
      const actor = await this.organizations?.membership(organizationId, ownerUserId);
      if (!actor || actor.role === "member") throw new OrganizationError(403, "Ask an organization admin to register this computer.");
    }
    const existing = await this.store.computer(organizationId, parsed.computerId);
    if (existing && existing.ownership !== parsed.ownership) throw new OrganizationError(409, "Remove this computer before changing its owner.");
    const at = this.now();
    const computer = { ...parsed, organizationId, ownerUserId: parsed.ownership === "personal" ? ownerUserId : null,
      access: existing?.access ?? { mode: parsed.ownership === "personal" ? "owner" as const : "organization" as const, userIds: [], teamIds: [] }, registeredAt: existing?.registeredAt ?? at, updatedAt: at, lastSeenAt: null };
    if (await this.store.register(computer) === "conflict") throw new OrganizationError(409, "This computer is already registered.");
    const { lastSeenAt: _, ...registration } = computer;
    return registration;
  }

  async canUse(computer: StoredComputer, userId: string): Promise<boolean> {
    if (this.organizations && !await this.organizations.membership(computer.organizationId, userId)) return false;
    if (computer.ownerUserId === userId || computer.access.mode === "organization") return true;
    if (computer.access.mode !== "selected") return false;
    if (computer.access.userIds.includes(userId)) return true;
    for (const teamId of computer.access.teamIds) {
      if ((await this.organizations?.teamMembers(computer.organizationId, teamId))?.includes(userId)) return true;
    }
    return false;
  }

  async canUseWorkspace(computer: StoredComputer, userId: string, workspaceId: string): Promise<boolean> {
    const capability = computer.capabilities.workspaces.find((w) => w.id === workspaceId);
    if (!capability || !await this.canUse(computer, userId)) return false;
    if (!this.organizations) return true;
    const workspace = await this.organizations.workspace(computer.organizationId, workspaceId)
      ?? (capability.origin ? await this.organizations.workspaceByOrigin(computer.organizationId, repositoryOrigin(capability.origin)) : undefined);
    if (!workspace) return true;
    try { await new OrganizationService(this.organizations).workspace(computer.organizationId, userId, workspace.id); return true; }
    catch { return false; }
  }

  async canReadWorkspace(computer: StoredComputer, userId: string, cwd: unknown): Promise<boolean> {
    if (typeof cwd !== "string") return false;
    const workspace = computer.capabilities.workspaces.filter((w) => cwd === w.path || cwd.startsWith(w.path.replace(/\/$/, "") + "/")).sort((a,b) => b.path.length-a.path.length)[0];
    return !!workspace && this.canUseWorkspace(computer, userId, workspace.id);
  }

  async canManage(computer: StoredComputer, userId: string): Promise<boolean> {
    if (computer.ownerUserId) return computer.ownerUserId === userId;
    const actor = await this.organizations?.membership(computer.organizationId, userId);
    return !!actor && actor.role !== "member";
  }

  async requireUse(org: string, id: string, userId: string) {
    const computer = await this.store.computer(org, id);
    if (!computer || !await this.canUse(computer, userId)) throw new OrganizationError(404, "This computer is not available to you.");
    return computer;
  }

  async update(org: string, id: string, userId: string, patch: { name?: string; icon?: string; access?: ComputerAccess }) {
    const computer = await this.store.computer(org, id);
    if (!computer || !await this.canManage(computer, userId)) throw new OrganizationError(404, "Computer not found.");
    if (patch.access) {
      patch.access = computerAccessSchema.parse(patch.access);
      if (!computer.ownerUserId && patch.access.mode === "owner") throw new OrganizationError(400, "Choose members or your organization for a shared computer.");
      for (const member of patch.access.userIds) if (!await this.organizations?.membership(org, member)) throw new OrganizationError(400, "Choose a member of your organization.");
      for (const team of patch.access.teamIds) if (!await this.organizations?.team(org, team)) throw new OrganizationError(400, "Choose a team in your organization.");
    }
    await this.store.update(org, id, patch, this.now());
  }

  async remove(org: string, id: string, userId: string) {
    const computer = await this.store.computer(org, id);
    if (!computer || !await this.canManage(computer, userId)) throw new OrganizationError(404, "Computer not found.");
    await this.store.remove(org, id);
  }

  async list(organizationId: string, userId?: string) {
    const now = this.now();
    const visible: StoredComputer[] = [];
    for (const computer of await this.store.computers(organizationId)) {
      if (!userId || await this.canUse(computer, userId) || await this.canManage(computer, userId)) visible.push(computer);
    }
    return Promise.all(visible.map(async ({ publicKey: _, ...computer }) => computerSummarySchema.parse({
      ...computer,
      capabilities: { ...computer.capabilities, workspaces: userId ? (await Promise.all(computer.capabilities.workspaces.map(async (w) => await this.canUseWorkspace({ ...computer, publicKey: "" }, userId, w.id) ? w : undefined))).filter((w) => w !== undefined) : computer.capabilities.workspaces },
      canManage: userId ? await this.canManage({ ...computer, publicKey: "" }, userId) : false,
      canUse: userId ? await this.canUse({ ...computer, publicKey: "" }, userId) : false,
      availability: computer.lastSeenAt !== null && now - computer.lastSeenAt <= COMPUTER_HEARTBEAT_TIMEOUT_MS ? "available" : "offline",
      updateRequired: computer.protocol.maximum < MINIMUM_COMPUTER_PROTOCOL_VERSION || versionBefore(computer.daemonVersion, this.minimumDaemonVersion),
    })));
  }
}

export function versionBefore(current: string, minimum: string): boolean {
  const parts = (value: string) => value.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0];
  const left = parts(current); const right = parts(minimum);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) < (right[index] ?? 0);
  }
  return false;
}
