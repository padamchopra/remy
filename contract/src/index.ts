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

export const computerRegistrationSchema = z.object({
  contractVersion: contractVersionSchema,
  computerId: z.string().min(1),
  name: z.string().min(1),
  platform: z.enum(["darwin", "linux"]),
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
  organizationWorkspace: { method: "GET", path: "/api/organizations/:organizationId/workspaces/:workspaceId", response: organizationWorkspaceSchema },
  organizationDeletionImpact: { method: "GET", path: "/api/organizations/:organizationId/deletion-impact", response: organizationDeletionImpactSchema },
  organizationBoard: { method: "GET", path: "/api/organizations/:organizationId/board/:entity", response: z.object({ items: z.array(boardProjectionSchema), version: boardVersionVectorSchema }) },
  organizationBoardEntity: { method: "GET", path: "/api/organizations/:organizationId/board/:entity/:entityId", response: boardProjectionSchema },
  appendOrganizationBoardEvent: { method: "POST", path: "/api/organizations/:organizationId/board/events", response: boardAppendResultSchema },
  organizationBoardLive: { method: "GET", path: "/api/organizations/:organizationId/board/live", response: boardLiveFrameSchema },
} as const;
