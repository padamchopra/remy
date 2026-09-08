import { z } from "zod";

export const CONTRACT_VERSION = "0.1.0" as const;

export const contractVersionSchema = z.literal(CONTRACT_VERSION);
export type ContractVersion = z.infer<typeof contractVersionSchema>;

export const hubEnvironmentSchema = z.enum(["staging", "production"]);
export type HubEnvironment = z.infer<typeof hubEnvironmentSchema>;

export const dependencyStatusSchema = z.enum(["ready", "unavailable"]);
export const hubHealthSchema = z.object({
  contractVersion: contractVersionSchema,
  environment: hubEnvironmentSchema,
  release: z.string().min(1),
  status: z.enum(["ok", "degraded"]),
  dependencies: z.object({
    database: dependencyStatusSchema,
    coordinator: dependencyStatusSchema,
    objectStore: dependencyStatusSchema,
    queue: dependencyStatusSchema,
    secrets: dependencyStatusSchema,
  }),
});
export type HubHealth = z.infer<typeof hubHealthSchema>;

export function parseHubHealth(value: unknown): HubHealth {
  const result = hubHealthSchema.safeParse(value);
  if (!result.success) throw new TypeError("The hub health response is incompatible");
  return result.data;
}

export const hubErrorSchema = z.object({ error: z.string().min(1) });
export type HubError = z.infer<typeof hubErrorSchema>;

export const requestOutcomeSchema = z.object({
  event: z.literal("request.outcome"),
  environment: hubEnvironmentSchema,
  release: z.string().min(1),
  requestId: z.string().min(1),
  method: z.string().min(1),
  route: z.string().min(1),
  status: z.number().int().min(100).max(599),
  durationMs: z.number().nonnegative(),
  outcome: z.enum(["success", "error"]),
});
export type RequestOutcome = z.infer<typeof requestOutcomeSchema>;

export const hubErrorEventSchema = z.object({
  event: z.literal("error.unhandled"),
  environment: hubEnvironmentSchema,
  release: z.string().min(1),
  requestId: z.string().min(1),
  method: z.string().min(1),
  route: z.string().min(1),
  errorType: z.string().min(1),
});
export type HubErrorEvent = z.infer<typeof hubErrorEventSchema>;

export const uptimeCheckFrameSchema = z.object({
  contractVersion: contractVersionSchema,
  kind: z.literal("uptime.check"),
  checkedAt: z.string().datetime(),
  environment: hubEnvironmentSchema,
  release: z.string().min(1),
  status: z.enum(["ok", "failed"]),
  statusCode: z.number().int().min(0).max(599),
});
export type UptimeCheckFrame = z.infer<typeof uptimeCheckFrameSchema>;

export const COMPUTER_PROTOCOL_VERSION = 1 as const;
export const MINIMUM_COMPUTER_PROTOCOL_VERSION = 1 as const;
export const COMPUTER_HEARTBEAT_INTERVAL_MS = 15_000 as const;
export const COMPUTER_HEARTBEAT_TIMEOUT_MS = 45_000 as const;

export const computerProtocolRangeSchema = z.object({
  minimum: z.number().int().positive(),
  maximum: z.number().int().positive(),
}).refine((range) => range.minimum <= range.maximum, "The protocol range is invalid");
export type ComputerProtocolRange = z.infer<typeof computerProtocolRangeSchema>;

export const computerProviderCapabilitySchema = z.object({
  id: z.enum(["claude", "codex", "cursor"]),
  models: z.array(z.string()),
});
export const computerWorkspaceCapabilitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  origin: z.string().nullable(),
});
export const computerCapabilitiesSchema = z.object({
  providers: z.array(computerProviderCapabilitySchema),
  workspaces: z.array(computerWorkspaceCapabilitySchema),
  worktrees: z.boolean(),
  terminals: z.boolean(),
  emulator: z.boolean(),
});
export type ComputerCapabilities = z.infer<typeof computerCapabilitiesSchema>;

export const computerAccessSchema = z.object({
  mode: z.enum(["owner", "selected", "organization"]),
  userIds: z.array(z.string().min(1)).max(100).default([]),
  teamIds: z.array(z.string().min(1)).max(100).default([]),
});
export type ComputerAccess = z.infer<typeof computerAccessSchema>;
export const computerOwnershipSchema = z.enum(["personal", "organization", "hosted"]);

export const computerRegistrationInputSchema = z.object({
  computerId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  icon: z.string().max(40).default(""),
  ownership: computerOwnershipSchema.default("personal"),
  platform: z.enum(["darwin", "linux"]),
  daemonVersion: z.string().min(1),
  protocol: computerProtocolRangeSchema,
  publicKey: z.string().min(32),
  capabilities: computerCapabilitiesSchema,
});
export type ComputerRegistrationInput = z.infer<typeof computerRegistrationInputSchema>;

export const computerRegistrationSchema = computerRegistrationInputSchema.extend({
  organizationId: z.string().min(1),
  ownerUserId: z.string().min(1).nullable(),
  access: computerAccessSchema.default({ mode: "owner", userIds: [], teamIds: [] }),
  registeredAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type ComputerRegistration = z.infer<typeof computerRegistrationSchema>;
export type ComputerId = ComputerRegistration["computerId"];

export const computerAvailabilitySchema = z.enum(["available", "busy", "offline"]);
export type ComputerAvailability = z.infer<typeof computerAvailabilitySchema>;

export const computerHeartbeatSchema = z.object({
  computerId: z.string().min(1),
  availability: computerAvailabilitySchema,
  observedAt: z.string().datetime(),
});
export type ComputerHeartbeat = z.infer<typeof computerHeartbeatSchema>;

export const computerSummarySchema = computerRegistrationSchema.omit({ publicKey: true }).extend({
  availability: computerAvailabilitySchema,
  lastSeenAt: z.number().int().nonnegative().nullable(),
  updateRequired: z.boolean(),
  canManage: z.boolean().optional(),
  canUse: z.boolean().optional(),
});
export type ComputerSummary = z.infer<typeof computerSummarySchema>;


export const threadMemberSchema = z.object({ id: z.string().min(1).max(128), label: z.string().min(1).max(120) });
export type ThreadMember = z.infer<typeof threadMemberSchema>;
export const threadAccessSchema = z.object({
  organizationId: z.string().min(1),
  owner: threadMemberSchema,
  visibility: z.enum(["private", "open"]),
  participants: z.array(threadMemberSchema).max(100),
});
export type ThreadAccess = z.infer<typeof threadAccessSchema>;
export const threadSnapshotSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  access: threadAccessSchema,
  detail: z.object({ id: z.string(), title: z.string(), entries: z.array(z.record(z.string(), z.unknown())) }).catchall(z.unknown()),
});
export type ThreadSnapshot = z.infer<typeof threadSnapshotSchema>;
export type HubThread = ThreadSnapshot & { computerId: string; stale: boolean; observedAt: number };
export type ThreadLiveFrame =
  | { kind: "snapshot"; cursor: number; thread: HubThread }
  | { kind: "remove"; cursor: number; computerId: string; threadId: string }
  | { kind: "reset"; cursor: number }
  | { kind: "ready"; cursor: number };

export function canReadThread(access: ThreadAccess, userId: string): boolean {
  return access.visibility === "open" || access.owner.id === userId || access.participants.some((member) => member.id === userId);
}
export function canWriteThread(access: ThreadAccess, userId: string): boolean {
  return access.owner.id === userId || access.participants.some((member) => member.id === userId);
}

export const hubNotificationInputSchema = z.object({
  id: z.string().uuid(), threadId: z.string().uuid(),
  title: z.string().min(1).max(160), message: z.string().max(500),
  highPriority: z.boolean(), createdAt: z.number().int().nonnegative(),
});
export type HubNotificationInput = z.infer<typeof hubNotificationInputSchema>;
export type HubNotification = HubNotificationInput & { computerId: string; computerName: string; readAt: number | null };

const proxyHeadersSchema = z.record(z.string(), z.string());
export const computerToHubFrameSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("notification"), notification: hubNotificationInputSchema }),
  z.object({ kind: z.literal("thread.snapshot"), snapshot: threadSnapshotSchema }),
  z.object({ kind: z.literal("thread.manifest"), ids: z.array(z.string().uuid()) }),
  z.object({ kind: z.literal("hello"), boardSync: z.boolean().optional(), protocolVersion: z.number().int().positive(), daemonVersion: z.string().min(1), capabilities: computerCapabilitiesSchema }),
  z.object({ kind: z.literal("heartbeat"), availability: z.enum(["available", "busy"]), observedAt: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("response"), id: z.string().min(1), status: z.number().int().min(100).max(599), headers: proxyHeadersSchema, body: z.string() }),
  z.object({ kind: z.literal("stream"), id: z.string().min(1), payload: z.string() }),
  z.object({ kind: z.literal("stream.end"), id: z.string().min(1), reason: z.string().optional() }),
]);
export type ComputerToHubFrame = z.infer<typeof computerToHubFrameSchema>;
export const hubToComputerFrameSchema = z.discriminatedUnion("kind", [
  z.object({kind:z.literal("agent.deleted"),threadIds:z.array(z.string().uuid()).max(1000)}),
  z.object({ kind: z.literal("board.changed") }),
  z.object({ kind: z.literal("welcome"), protocolVersion: z.number().int().positive(), heartbeatIntervalMs: z.number().int().positive(), threadRelay: z.boolean().optional(), notifications: z.boolean().optional() }),
  z.object({ kind: z.literal("notification.ack"), id: z.string().uuid() }),
  z.object({ kind: z.literal("update_required"), minimumDaemonVersion: z.string().min(1) }),
  z.object({ kind: z.literal("request"), id: z.string().min(1), method: z.string().min(1), path: z.string().startsWith("/"), headers: proxyHeadersSchema, body: z.string(), actor: threadMemberSchema.optional() }),
  z.object({ kind: z.literal("subscribe"), id: z.string().min(1), path: z.string().startsWith("/") }),
  z.object({ kind: z.literal("unsubscribe"), id: z.string().min(1) }),
]);
export type HubToComputerFrame = z.infer<typeof hubToComputerFrameSchema>;

export const computerConnectionAuthorizationSchema = z.object({
  computerId: z.string().uuid(),
  timestamp: z.number().int().nonnegative(),
  nonce: z.string().min(16).max(128),
  signature: z.string().min(32),
});
export type ComputerConnectionAuthorization = z.infer<typeof computerConnectionAuthorizationSchema>;

export function computerConnectionMessage(organizationId: string, authorization: Pick<ComputerConnectionAuthorization, "computerId" | "timestamp" | "nonce">): string {
  return ["remy-computer-connect-v1", organizationId, authorization.computerId, String(authorization.timestamp), authorization.nonce].join("\n");
}

export const accountClientKindSchema = z.enum(["web", "phone", "computer", "cli"]);
export type AccountClientKind = z.infer<typeof accountClientKindSchema>;

export const tokenPairSchema = z.object({
  tokenType: z.literal("Bearer"),
  accessToken: z.string().min(32),
  refreshToken: z.string().min(32).optional(),
  expiresIn: z.number().int().positive(),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const deviceAuthorizationSchema = z.object({
  deviceCode: z.string().min(32),
  userCode: z.string().regex(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/),
  expiresIn: z.number().int().positive(),
  interval: z.number().int().positive(),
});
export type DeviceAuthorization = z.infer<typeof deviceAuthorizationSchema>;

export const accountProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  emailVerified: z.boolean(),
  image: z.string().url().optional(),
  verifiedEmails: z.array(z.string().email()),
});
export type AccountProfile = z.infer<typeof accountProfileSchema>;

export const accountSessionSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  clientKind: accountClientKindSchema,
  clientName: z.string().min(1),
  accessExpiresAt: z.number().int(),
  refreshExpiresAt: z.number().int().optional(),
  createdAt: z.number().int(),
  lastSeenAt: z.number().int(),
  revokedAt: z.number().int().optional(),
});
export type AccountSession = z.infer<typeof accountSessionSchema>;

export const organizationRoleSchema = z.enum(["owner", "admin", "member"]);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;
export const organizationSchema = z.object({ id: z.string().min(1), name: z.string().min(1), role: organizationRoleSchema, createdAt: z.number().int(), updatedAt: z.number().int() });
export type Organization = z.infer<typeof organizationSchema>;
export const organizationMemberSchema = z.object({ id: z.string().min(1), organizationId: z.string().min(1), userId: z.string().min(1), role: organizationRoleSchema, createdAt: z.number().int(), updatedAt: z.number().int() });
export type OrganizationMember = z.infer<typeof organizationMemberSchema>;
export const organizationTeamSchema = z.object({ id: z.string().min(1), organizationId: z.string().min(1), name: z.string().min(1), createdAt: z.number().int(), updatedAt: z.number().int() });
export type OrganizationTeam = z.infer<typeof organizationTeamSchema>;
export const organizationInviteSchema = z.object({ id: z.string().min(1), organizationId: z.string().min(1), email: z.string().email().optional(), role: z.enum(["admin", "member"]), expiresAt: z.number().int(), token: z.string().min(32).optional() });
export type OrganizationInvite = z.infer<typeof organizationInviteSchema>;
export const workspaceAccessSchema = z.object({ teamIds: z.array(z.string().min(1)), userIds: z.array(z.string().min(1)) });
export type WorkspaceAccess = z.infer<typeof workspaceAccessSchema>;
export const organizationWorkspaceSchema = z.object({ id: z.string().min(1), organizationId: z.string().min(1), name: z.string().min(1), origin: z.string().min(1), restricted: z.boolean(), createdAt: z.number().int(), updatedAt: z.number().int(), access: workspaceAccessSchema.optional() });
export type OrganizationWorkspace = z.infer<typeof organizationWorkspaceSchema>;
export const organizationDeletionImpactSchema = z.object({ organizationId: z.string().min(1), name: z.string().min(1), members: z.number().int().nonnegative(), teams: z.number().int().nonnegative(), invites: z.number().int().nonnegative(), workspaces: z.number().int().nonnegative(), deletes: z.array(z.string().min(1)) });
export type OrganizationDeletionImpact = z.infer<typeof organizationDeletionImpactSchema>;

export const boardLogEntitySchema = z.enum(["project", "ticket", "agent", "memory", "recurrence"]);
export type BoardLogEntity = z.infer<typeof boardLogEntitySchema>;
export const boardProjectionEntitySchema = z.enum(["tickets", "agents", "memories", "routines"]);
export type BoardProjectionEntity = z.infer<typeof boardProjectionEntitySchema>;
export const boardLogKindSchema = z.enum(["create", "field", "status", "comment", "comment_edit", "comment_delete", "handoff", "link", "unlink", "ran", "tombstone"]);
export type BoardLogKind = z.infer<typeof boardLogKindSchema>;
export const boardActorSchema = z.object({
  kind: z.enum(["member", "agent", "computer"]),
  id: z.string().min(1),
  label: z.string().min(1),
});
export type BoardActor = z.infer<typeof boardActorSchema>;
export const boardLogEventSchema = z.object({
  id: z.string().min(1),
  deviceId: z.string().min(1),
  lamport: z.number().int().positive(),
  at: z.number().int().nonnegative(),
  entity: boardLogEntitySchema,
  entityId: z.string().min(1),
  kind: boardLogKindSchema,
  payload: z.record(z.string(), z.unknown()),
  actor: boardActorSchema,
});
export type BoardLogEvent = z.infer<typeof boardLogEventSchema>;
export const boardAppendInputSchema = z.object({
  entity: boardLogEntitySchema,
  entityId: z.string().min(1),
  kind: boardLogKindSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type BoardAppendInput = z.infer<typeof boardAppendInputSchema>;
export const boardActivitySchema = z.object({
  eventId: z.string().min(1),
  at: z.number().int().nonnegative(),
  kind: boardLogKindSchema,
  actor: boardActorSchema,
  payload: z.record(z.string(), z.unknown()),
});
export type BoardActivity = z.infer<typeof boardActivitySchema>;
export const boardProjectionSchema = z.object({
  entity: boardLogEntitySchema,
  id: z.string().min(1),
  fields: z.record(z.string(), z.unknown()),
  activity: z.array(boardActivitySchema),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  lastActor: boardActorSchema,
});
export type BoardProjection = z.infer<typeof boardProjectionSchema>;
export const boardVersionVectorSchema = z.record(z.string(), z.number().int().nonnegative());
export type BoardVersionVector = z.infer<typeof boardVersionVectorSchema>;
export const boardLiveFrameSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), cursor: z.number().int().positive(), event: boardLogEventSchema }),
  z.object({ kind: z.literal("reset"), cursor: z.number().int().nonnegative(), reason: z.literal("cursor_unavailable") }),
]);
export type BoardLiveFrame = z.infer<typeof boardLiveFrameSchema>;
export const boardAppendResultSchema = z.object({ event: boardLogEventSchema, projection: boardProjectionSchema.nullable(), cursor: z.number().int().positive(), version: boardVersionVectorSchema });
export type BoardAppendResult = z.infer<typeof boardAppendResultSchema>;

export const hubRoutes = {
  health: { method: "GET", path: "/health", response: hubHealthSchema },
  profile: { method: "GET", path: "/api/profile", response: accountProfileSchema },
  sessions: { method: "GET", path: "/api/sessions", response: z.object({ sessions: z.array(accountSessionSchema) }) },
  startDeviceAuthorization: { method: "POST", path: "/api/device/authorization", response: deviceAuthorizationSchema },
  refreshSession: { method: "POST", path: "/api/sessions/refresh", response: tokenPairSchema },
  organizations: { method: "GET", path: "/api/organizations", response: z.object({ organizations: z.array(organizationSchema) }) },
  organizationMembers: { method: "GET", path: "/api/organizations/:organizationId/members", response: z.object({ members: z.array(organizationMemberSchema) }) },
  organizationTeams: { method: "GET", path: "/api/organizations/:organizationId/teams", response: z.object({ teams: z.array(organizationTeamSchema) }) },
  organizationWorkspaces: { method: "GET", path: "/api/organizations/:organizationId/workspaces", response: z.object({ workspaces: z.array(organizationWorkspaceSchema) }) },
  registerComputer: { method: "POST", path: "/api/organizations/:organizationId/computers", response: computerRegistrationSchema },
  organizationComputers: { method: "GET", path: "/api/organizations/:organizationId/computers", response: z.object({ computers: z.array(computerSummarySchema) }) },
  connectComputer: { method: "GET", path: "/api/organizations/:organizationId/computers/connect", response: hubToComputerFrameSchema },
  organizationWorkspace: { method: "GET", path: "/api/organizations/:organizationId/workspaces/:workspaceId", response: organizationWorkspaceSchema },
  organizationDeletionImpact: { method: "GET", path: "/api/organizations/:organizationId/deletion-impact", response: organizationDeletionImpactSchema },
  organizationBoard: { method: "GET", path: "/api/organizations/:organizationId/board/:entity", response: z.object({ items: z.array(boardProjectionSchema), version: boardVersionVectorSchema }) },
  organizationBoardEntity: { method: "GET", path: "/api/organizations/:organizationId/board/:entity/:entityId", response: boardProjectionSchema },
  appendOrganizationBoardEvent: { method: "POST", path: "/api/organizations/:organizationId/board/events", response: boardAppendResultSchema },
  organizationBoardLive: { method: "GET", path: "/api/organizations/:organizationId/board/live", response: boardLiveFrameSchema },
} as const;

function compareEvents(left: BoardLogEvent, right: BoardLogEvent): number {
  return left.lamport - right.lamport || left.deviceId.localeCompare(right.deviceId) || left.id.localeCompare(right.id);
}

const editable: Record<BoardLogEntity, readonly string[]> = {
  project: ["name", "keyPrefix", "defaultProvider", "defaultModel", "defaultEffort", "defaultPermissionMode"],
  ticket: ["title", "body", "status", "priority", "assigneeAgentId", "parentId", "rank", "deviceId", "branch", "handoffs", "startedAt", "closedAt"],
  agent: ["scope", "ownerId", "createdByUserId", "builtIn", "name", "handle", "role", "instructions", "provider", "model", "effort", "permissionMode", "avatar", "tint", "autoStart", "handoffTo", "gitIdentity", "gitName"],
  memory: ["content"],
  recurrence: ["projectId", "runAsUserId", "timeZone", "name", "prompt", "cadence", "hour", "minute", "weekday", "day", "enabled", "schedulerDeviceId"],
};

function applyFields(fields: Record<string, unknown>, payload: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
  const next = { ...fields };
  for (const key of allowed) if (payload[key] !== undefined) next[key] = payload[key];
  return next;
}

function createdFields(entity: BoardLogEntity, event: BoardLogEvent): Record<string, unknown> | undefined {
  if (entity === "ticket") return applyFields({ number: Number(event.payload.number ?? 0), projectId: String(event.payload.projectId ?? ""), title: "Untitled", body: "", status: "backlog", priority: 0, rank: "n", handoffs: 0 }, event.payload, editable.ticket);
  if (entity === "agent") return applyFields({ scope: "org", ownerId: "", name: "Agent", handle: "agent", instructions: "", provider: "default", permissionMode: "default", autoStart: true, handoffTo: [], gitIdentity: "default" }, event.payload, editable.agent);
  if (entity === "memory") {
    if (typeof event.payload.agentId !== "string" || !event.payload.agentId || typeof event.payload.content !== "string" || !event.payload.content.trim()) return undefined;
    const scope = event.payload.scope === "workspace" ? "workspace" : "global";
    if (scope === "workspace" && (typeof event.payload.projectId !== "string" || !event.payload.projectId)) return undefined;
    return { agentId: event.payload.agentId, scope, ...(scope === "workspace" ? { projectId: event.payload.projectId } : {}), content: event.payload.content.trim() };
  }
  if (entity === "recurrence") {
    if (event.payload.type !== "routine") return undefined;
    return applyFields({ type: "routine", agentId: String(event.payload.agentId ?? ""), name: "Routine", prompt: "", cadence: "weekly", hour: 9, minute: 0, enabled: true, schedulerDeviceId: String(event.payload.schedulerDeviceId ?? event.deviceId), runs: 0 }, event.payload, editable.recurrence);
  }
  return { ...event.payload };
}

export function foldBoardEvents(entity: BoardLogEntity, id: string, events: BoardLogEvent[]): BoardProjection | undefined {
  let fields: Record<string, unknown> | undefined;
  let createdAt = 0;
  let updatedAt = 0;
  let lastActor: BoardActor | undefined;
  const activity: BoardProjection["activity"] = [];
  const links = new Map<string, Record<string, unknown>>();

  for (const event of events.sort(compareEvents)) {
    if (event.kind === "tombstone") return undefined;
    if (entity === "recurrence" && event.kind === "create" && event.payload.type !== "routine") return undefined;
    if (event.kind === "create") {
      fields = createdFields(entity, event);
      createdAt = event.at;
    } else if (fields && (event.kind === "field" || event.kind === "status")) {
      fields = applyFields(fields, event.payload, editable[entity]);
      if (event.kind === "status" && event.payload.status === "in_progress" && fields.startedAt === undefined) fields.startedAt = event.at;
      if (event.kind === "status") {
        if (event.payload.status === "done" || event.payload.status === "cancelled") fields.closedAt = event.at;
        else delete fields.closedAt;
      }
    } else if (fields && event.kind === "handoff") {
      fields = { ...fields, handoffs: Number(fields.handoffs ?? 0) + 1, assigneeAgentId: event.payload.toAgentId ?? fields.assigneeAgentId };
    } else if (fields && event.kind === "ran") {
      const failed = typeof event.payload.error === "string";
      fields = { ...fields, runs: Number(fields.runs ?? 0) + (failed ? 0 : 1), lastRunAt: event.at };
      if (failed) fields.lastError = event.payload.error;
      else delete fields.lastError;
    } else if (fields && (event.kind === "link" || event.kind === "unlink")) {
      const key = `${String(event.payload.computerId ?? event.payload.deviceId ?? event.deviceId)}:${String(event.payload.chatId ?? "")}`;
      if (event.kind === "link") links.set(key, { ...event.payload, computerId: event.payload.computerId ?? event.payload.deviceId ?? event.deviceId, deviceId: event.payload.deviceId ?? event.deviceId, createdAt: event.at });
      else links.delete(key);
    }
    if (!fields) continue;
    updatedAt = event.at;
    lastActor = event.actor;
    activity.push({ eventId: event.id, at: event.at, kind: event.kind, actor: event.actor, payload: event.payload });
  }

  if (!fields || !lastActor) return undefined;
  if (entity === "ticket" && links.size > 0) fields = { ...fields, threads: [...links.values()] };
  return { entity, id, fields, activity, createdAt, updatedAt, lastActor };
}

export const hostedSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(["fly-sprites", "modal"]).default("fly-sprites"),
  region: z.string().regex(/^[a-z0-9-]{0,40}$/).default(""),
  cpu: z.number().min(0.25).max(16).default(1),
  memoryMiB: z.number().int().min(512).max(32768).default(2048),
  idleMinutes: z.number().int().min(10).max(15).default(12),
});
export type HostedSettings = z.infer<typeof hostedSettingsSchema>;
export type HostedComputerState = {
  workspaceId: string; computerId: string; provider: HostedSettings["provider"];
  phase: "allocating" | "restoring" | "ready" | "checkpointing" | "asleep" | "failed";
  lastUsedAt: number; error?: string;
  usage: { activeMs: number; warmIdleMs: number; snapshotByteMs: number };
  timing: { allocationMs?: number; restoreMs?: number; readyMs?: number; warmRequestMs?: number; firstResponseMs?: number };
};

export const routingRuleSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(120),
  workspaceId: z.string().optional(),
  teamId: z.string().optional(),
  trigger: z.enum(["manual", "ticket", "routine", "agent"]).optional(),
  target: z.object({computerId:z.string().optional(),class:z.enum(["hosted","darwin","linux"]).optional(),emulator:z.boolean().optional()}),
});
export type RoutingRule = z.infer<typeof routingRuleSchema>;

export const hubRoutineSchema = z.object({
 name:z.string().trim().min(1).max(120),prompt:z.string().trim().min(1).max(16000),
 projectId:z.string().min(1),agentId:z.string().min(1),runAsUserId:z.string().min(1),
 cadence:z.enum(["daily","weekdays","weekly","monthly"]),hour:z.number().int().min(0).max(23),minute:z.number().int().min(0).max(59),
 weekday:z.number().int().min(0).max(6).default(1),day:z.number().int().min(1).max(31).default(1),
 timeZone:z.string().max(100).default("UTC").refine(value=>{try{new Intl.DateTimeFormat("en",{timeZone:value});return true;}catch{return false;}}),enabled:z.boolean().default(true),
});
export type HubRoutine = z.infer<typeof hubRoutineSchema>;
