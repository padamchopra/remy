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

/// A model's name as the provider itself reports it. `models` stays a list of
/// ids so a hub or client that predates names still reads it.
export const computerModelInfoSchema = z.object({
  value: z.string().max(200),
  label: z.string().min(1).max(120),
  context: z.string().max(16).optional(),
  resolvedLabel: z.string().max(120).optional(),
});
export const computerProviderCapabilitySchema = z.object({
  id: z.enum(["claude", "codex", "cursor"]),
  models: z.array(z.string()),
  modelInfo: z.array(computerModelInfoSchema).max(1000).optional(),
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
  shared: z.boolean().optional(),
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
  z.object({ kind: z.literal("account.changed") }),
  z.object({ kind: z.literal("notification"), organizationId: z.string().min(1).optional(), notification: hubNotificationInputSchema }),
  z.object({ kind: z.literal("thread.snapshot"), snapshot: threadSnapshotSchema }),
  z.object({ kind: z.literal("thread.manifest"), organizationId: z.string().min(1).optional(), ids: z.array(z.string().uuid()) }),
  z.object({ kind: z.literal("hello"), protocolVersion: z.number().int().positive(), daemonVersion: z.string().min(1), capabilities: computerCapabilitiesSchema }),
  z.object({ kind: z.literal("heartbeat"), availability: z.enum(["available", "busy"]), observedAt: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("response"), id: z.string().min(1), status: z.number().int().min(100).max(599), headers: proxyHeadersSchema, body: z.string() }),
  z.object({ kind: z.literal("stream"), id: z.string().min(1), payload: z.string() }),
  z.object({ kind: z.literal("stream.end"), id: z.string().min(1), reason: z.string().optional() }),
]);
export type ComputerToHubFrame = z.infer<typeof computerToHubFrameSchema>;
export const hubToComputerFrameSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("thread.retired"), threadIds: z.array(z.string().uuid()).max(1000) }),
  z.object({ kind: z.literal("board.changed") }),
  z.object({ kind: z.literal("sharing.changed"), organizationIds: z.array(z.string().min(1)).max(100) }),
  z.object({ kind: z.literal("welcome"), protocolVersion: z.number().int().positive(), heartbeatIntervalMs: z.number().int().positive(), threadRelay: z.boolean().optional(), notifications: z.boolean().optional(), sharedOrganizationIds: z.array(z.string().min(1)).max(100).optional() }),
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

/// What someone pastes into `remy login`: which Remy, which account, who owns
/// the computer, and one approved authorization. One string so a headless
/// machine needs no questions answered and no browser.
export const computerConnectionKeySchema = z.object({
  v: z.literal(1),
  url: z.string().url(),
  organizationId: z.string().min(1).max(200),
  ownership: computerOwnershipSchema,
  key: z.string().min(32).max(512),
});
export type ComputerConnectionKey = z.infer<typeof computerConnectionKeySchema>;
export const COMPUTER_CONNECTION_KEY_PREFIX = "remy_" as const;

export function encodeComputerConnectionKey(value: ComputerConnectionKey): string {
  const json = JSON.stringify(computerConnectionKeySchema.parse(value));
  const bytes = new TextEncoder().encode(json);
  return `${COMPUTER_CONNECTION_KEY_PREFIX}${btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
}

export function decodeComputerConnectionKey(value: string): ComputerConnectionKey {
  const trimmed = value.trim();
  if (!trimmed.startsWith(COMPUTER_CONNECTION_KEY_PREFIX)) throw new Error("That is not a Remy connection key.");
  const encoded = trimmed.slice(COMPUTER_CONNECTION_KEY_PREFIX.length).replaceAll("-", "+").replaceAll("_", "/");
  let json: string;
  try {
    json = new TextDecoder().decode(Uint8Array.from(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")), (c) => c.charCodeAt(0)));
  } catch {
    throw new Error("That connection key is incomplete; create another one.");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error("That connection key is incomplete; create another one."); }
  const result = computerConnectionKeySchema.safeParse(parsed);
  if (!result.success) throw new Error("That connection key is incomplete; create another one.");
  return result.data;
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
export const organizationSchema = z.object({ personal: z.boolean().optional(), id: z.string().min(1), name: z.string().min(1), role: organizationRoleSchema, createdAt: z.number().int(), updatedAt: z.number().int() });
export type Organization = z.infer<typeof organizationSchema>;
export const organizationMemberSchema = z.object({ id: z.string().min(1), organizationId: z.string().min(1), userId: z.string().min(1), role: organizationRoleSchema, createdAt: z.number().int(), updatedAt: z.number().int() });
export type OrganizationMember = z.infer<typeof organizationMemberSchema>;
export const organizationTeamSchema = z.object({ id: z.string().min(1), organizationId: z.string().min(1), name: z.string().min(1), createdAt: z.number().int(), updatedAt: z.number().int() });
export type OrganizationTeam = z.infer<typeof organizationTeamSchema>;
export const organizationInviteSchema = z.object({ id: z.string().min(1), organizationId: z.string().min(1), email: z.string().email().optional(), role: z.enum(["admin", "member"]), expiresAt: z.number().int(), token: z.string().min(32).optional() });
export type OrganizationInvite = z.infer<typeof organizationInviteSchema>;
export const organizationWorkspaceSchema = z.object({ icon: z.string().optional(), tint: z.string().optional(), id: z.string().min(1), organizationId: z.string().min(1), name: z.string().min(1), origin: z.string().min(1), createdAt: z.number().int(), updatedAt: z.number().int() });
export type OrganizationWorkspace = z.infer<typeof organizationWorkspaceSchema>;
/// Environment variable names a workspace may set. Remy's own settings and
/// the variables that steer a provider's runtime stay out of reach.
export const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
export const ENVIRONMENT_BLOCKED_KEY = /^(?:__proto__$|constructor$|prototype$|MC_|REMY_|NODE_OPTIONS$|CODEX_HOME$|CLAUDE_CONFIG_DIR$)/;
export const ENVIRONMENT_VALUE_LIMIT = 32_768;
export const isEnvironmentKey = (key: string) => ENVIRONMENT_KEY_PATTERN.test(key) && !ENVIRONMENT_BLOCKED_KEY.test(key);
export const environmentValueKindSchema = z.enum(["variable", "secret"]);
export const environmentValueScopeSchema = z.enum(["workspace", "personal"]);
/// One value as a browser sees it. A secret never carries its value.
export const workspaceEnvironmentValueSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  kind: environmentValueKindSchema,
  scope: environmentValueScopeSchema,
  value: z.string().optional(),
  createdBy: z.object({ id: z.string(), name: z.string() }),
  createdAt: z.number().int(),
  /// A Personal value whose key this workspace already sets; the Workspace value wins.
  overridden: z.boolean().optional(),
  /// Whether the viewer may delete it: any Workspace value, and only their own Personal ones.
  removable: z.boolean(),
});
export type WorkspaceEnvironmentValue = z.infer<typeof workspaceEnvironmentValueSchema>;
export const workspaceEnvironmentSchema = z.object({ values: z.array(workspaceEnvironmentValueSchema) });
export type WorkspaceEnvironment = z.infer<typeof workspaceEnvironmentSchema>;
export const workspaceEnvironmentWriteSchema = z.object({
  values: z.array(z.object({
    key: z.string().refine(isEnvironmentKey),
    value: z.string().max(ENVIRONMENT_VALUE_LIMIT),
    kind: environmentValueKindSchema,
    scope: environmentValueScopeSchema,
  })).min(1).max(100),
});
export type WorkspaceEnvironmentWrite = z.infer<typeof workspaceEnvironmentWriteSchema>;
export const organizationDeletionImpactSchema = z.object({ organizationId: z.string().min(1), name: z.string().min(1), members: z.number().int().nonnegative(), teams: z.number().int().nonnegative(), invites: z.number().int().nonnegative(), workspaces: z.number().int().nonnegative(), deletes: z.array(z.string().min(1)) });
export type OrganizationDeletionImpact = z.infer<typeof organizationDeletionImpactSchema>;


export const hubRoutes = {
  health: { method: "GET", path: "/health", response: hubHealthSchema },
  profile: { method: "GET", path: "/api/profile", response: accountProfileSchema },
  sessions: { method: "GET", path: "/api/sessions", response: z.object({ sessions: z.array(accountSessionSchema) }) },
  startDeviceAuthorization: { method: "POST", path: "/api/device/authorization", response: deviceAuthorizationSchema },
  refreshSession: { method: "POST", path: "/api/sessions/refresh", response: tokenPairSchema },
  personal: { method: "GET", path: "/api/personal", response: z.object({ personal: organizationSchema }) },
  organizations: { method: "GET", path: "/api/organizations", response: z.object({ organizations: z.array(organizationSchema) }) },
  organizationMembers: { method: "GET", path: "/api/organizations/:organizationId/members", response: z.object({ members: z.array(organizationMemberSchema) }) },
  organizationTeams: { method: "GET", path: "/api/organizations/:organizationId/teams", response: z.object({ teams: z.array(organizationTeamSchema) }) },
  organizationWorkspaces: { method: "GET", path: "/api/organizations/:organizationId/workspaces", response: z.object({ workspaces: z.array(organizationWorkspaceSchema) }) },
  registerComputer: { method: "POST", path: "/api/organizations/:organizationId/computers", response: computerRegistrationSchema },
  organizationComputers: { method: "GET", path: "/api/organizations/:organizationId/computers", response: z.object({ computers: z.array(computerSummarySchema) }) },
  connectComputer: { method: "GET", path: "/api/organizations/:organizationId/computers/connect", response: hubToComputerFrameSchema },
  organizationWorkspace: { method: "GET", path: "/api/organizations/:organizationId/workspaces/:workspaceId", response: organizationWorkspaceSchema },
  workspaceEnvironment: { method: "GET", path: "/api/organizations/:organizationId/workspaces/:workspaceId/environment", response: workspaceEnvironmentSchema },
  organizationDeletionImpact: { method: "GET", path: "/api/organizations/:organizationId/deletion-impact", response: organizationDeletionImpactSchema },
} as const;

export const CLOUD_COMPUTER_PROVIDERS = ["fly-sprites", "modal", "cursor-cloud"] as const;
export type CloudComputerProvider = (typeof CLOUD_COMPUTER_PROVIDERS)[number];
export const GUEST_CLOUD_PROVIDERS = ["fly-sprites", "modal"] as const;
export type GuestCloudProvider = (typeof GUEST_CLOUD_PROVIDERS)[number];
export const isGuestCloudProvider = (provider: string | undefined | null): provider is GuestCloudProvider =>
  provider === "fly-sprites" || provider === "modal";
export const isCursorCloudProvider = (provider: string | undefined | null): provider is "cursor-cloud" =>
  provider === "cursor-cloud";

export const hostedSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(CLOUD_COMPUTER_PROVIDERS).default("fly-sprites"),
  region: z.string().regex(/^[a-z0-9-]{0,40}$/).default(""),
  cpu: z.number().min(0.25).max(16).default(1),
  memoryMiB: z.number().int().min(512).max(32768).default(2048),
  maxComputers: z.number().int().min(1).max(100).default(5),
  idleMinutes: z.number().int().min(10).max(15).default(12),
});
export type HostedSettings = z.infer<typeof hostedSettingsSchema>;
export type HostedClaudeAccount = {
  phase: "signedOut" | "pending" | "connected" | "error";
  verificationUrl?: string;
  subscription?: string;
  error?: string;
};
/// A person's ChatGPT sign-in for cloud Codex, as the browser sees it: never tokens.
export type ChatGPTAccount = {
  phase: "signedOut" | "pending" | "connected" | "error";
  email?: string;
  userCode?: string;
  verificationUrl?: string;
  error?: string;
};
export type HostedCodexAccount = {
  phase: "signedOut" | "pending" | "connected" | "error";
  email?: string;
  userCode?: string;
  verificationUrl?: string;
  error?: string;
  apiKeyConfigured: boolean;
};
export type HostedComputerState = {
  taskId?: string;
  workspaceId: string; computerId: string; provider: HostedSettings["provider"];
  phase: "allocating" | "restoring" | "starting_runtime" | "connecting" | "ready" | "checkpointing" | "asleep" | "failed";
  lastUsedAt: number; error?: string;
  usage: { activeMs: number; warmIdleMs: number; snapshotByteMs: number };
  timing: { allocationMs?: number; restoreMs?: number; readyMs?: number; warmRequestMs?: number; firstResponseMs?: number };
};

export const CLOUD_COMPUTERS = [
  { id: "cloud:fly-sprites", provider: "fly-sprites", name: "Cloud · Fly.io Sprites" },
  { id: "cloud:modal", provider: "modal", name: "Cloud · Modal" },
  { id: "cloud:cursor-cloud", provider: "cursor-cloud", name: "Cloud · Cursor" },
] as const;
export const CURSOR_CLOUD_COMPUTER_ID = "cloud:cursor-cloud";
export const cloudComputerProvider = (id: string | undefined | null) => CLOUD_COMPUTERS.find(c => c.id === id)?.provider;
export const cloudComputerName = (id: string | undefined | null) => CLOUD_COMPUTERS.find(c => c.id === id)?.name;

// ---- Review agent -----------------------------------------------------------
// A review is an ordinary thread with a pull request attached. Rules are
// personal: one person's, never shared, the same in every organization.

export const REVIEW_RULE_TEXT_MAX = 500;
export const REVIEW_RULES_ENABLED_MAX = 100;
export const REVIEW_FINDINGS_PER_REPORT = 50;
export const REVIEW_FINDINGS_PER_REVIEW = 200;
export const REVIEW_PROPOSALS_PENDING_MAX = 20;

/// owner/name, compared and stored in lower case.
export const reviewRepositorySchema = z.string().max(200).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).transform((value) => value.toLowerCase());
export const reviewCommitSchema = z.string().regex(/^[0-9a-f]{7,40}$/i).transform((value) => value.toLowerCase());
export const reviewSeveritySchema = z.enum(["must", "should", "note"]);
export type ReviewSeverity = z.infer<typeof reviewSeveritySchema>;
export const reviewSideSchema = z.enum(["RIGHT", "LEFT"]);
/// `resolved` is the agent saying a later commit fixed it; the others are yours.
export const reviewFindingStatusSchema = z.enum(["open", "dismissed", "added-to-github", "resolved"]);
export type ReviewFindingStatus = z.infer<typeof reviewFindingStatusSchema>;
export const reviewRuleScopeSchema = z.enum(["repository", "all"]);
export type ReviewRuleScope = z.infer<typeof reviewRuleScopeSchema>;

export const reviewRuleSourceSchema = z.object({
  repository: z.string(),
  number: z.number().int().positive(),
  findingId: z.string().nullable(),
});
export const reviewRuleSchema = z.object({
  id: z.string(),
  /// null applies to all your workspaces.
  repository: z.string().nullable(),
  text: z.string(),
  enabled: z.boolean(),
  /// Where it was learned; null when you wrote it with Add rule.
  source: reviewRuleSourceSchema.nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type ReviewRule = z.infer<typeof reviewRuleSchema>;
export const reviewRuleInputSchema = z.object({
  text: z.string().trim().min(1).max(REVIEW_RULE_TEXT_MAX),
  repository: reviewRepositorySchema.nullable(),
  enabled: z.boolean().optional(),
});
export const reviewRulePatchSchema = z.object({
  text: z.string().trim().min(1).max(REVIEW_RULE_TEXT_MAX).optional(),
  repository: reviewRepositorySchema.nullable().optional(),
  enabled: z.boolean().optional(),
}).refine((value) => value.text !== undefined || value.repository !== undefined || value.enabled !== undefined, "Choose what to change.");

export const reviewFindingInputSchema = z.object({
  /// An earlier finding's id updates it in place; without one it is new.
  id: z.string().max(64).optional(),
  path: z.string().min(1).max(1000),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  side: reviewSideSchema.default("RIGHT"),
  severity: reviewSeveritySchema,
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8000),
  suggestion: z.string().max(8000).optional(),
  ruleIds: z.array(z.string().max(64)).max(10).optional(),
  /// A lower pull request in the stack this finding depends on.
  dependsOn: z.number().int().positive().optional(),
}).refine((value) => value.startLine <= value.endLine, "A finding's startLine comes before its endLine.");
export type ReviewFindingInput = z.infer<typeof reviewFindingInputSchema>;
export const reviewFindingsReportSchema = z.object({
  /// The commit that was reviewed.
  commit: reviewCommitSchema,
  summary: z.string().trim().max(4000).optional(),
  findings: z.array(reviewFindingInputSchema).max(REVIEW_FINDINGS_PER_REPORT),
  /// Earlier findings a later commit fixed.
  resolvedIds: z.array(z.string().max(64)).max(REVIEW_FINDINGS_PER_REVIEW).optional(),
});
export const reviewRuleProposalInputSchema = z.object({
  text: z.string().trim().min(1).max(REVIEW_RULE_TEXT_MAX),
  scope: reviewRuleScopeSchema,
  reason: z.string().trim().min(1).max(1000),
  findingId: z.string().max(64).optional(),
});

export const reviewFindingSchema = z.object({
  id: z.string(),
  path: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  side: reviewSideSchema,
  severity: reviewSeveritySchema,
  title: z.string(),
  body: z.string(),
  suggestion: z.string().nullable(),
  /// The rules it follows that still exist, for "Follows your rule: …".
  rules: z.array(z.object({ id: z.string(), text: z.string() })),
  dependsOn: z.number().int().nullable(),
  commit: z.string(),
  status: reviewFindingStatusSchema,
  /// The pending GitHub review comment it became.
  githubCommentId: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export const reviewRuleProposalSchema = z.object({
  id: z.string(),
  text: z.string(),
  scope: reviewRuleScopeSchema,
  reason: z.string(),
  findingId: z.string().nullable(),
  status: z.enum(["pending", "accepted", "discarded"]),
  ruleId: z.string().nullable(),
  createdAt: z.number().int(),
});
export type ReviewRuleProposal = z.infer<typeof reviewRuleProposalSchema>;
export const reviewStateSchema = z.object({
  computerId: z.string(),
  threadId: z.string(),
  workspaceId: z.string(),
  repository: z.string(),
  number: z.number().int(),
  title: z.string(),
  baseRef: z.string(),
  headRef: z.string(),
  /// The head when the review started, the commit the latest turn is about,
  /// and the last commit findings were reported for.
  startedSha: z.string(),
  headSha: z.string(),
  reviewedSha: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  rulesApplied: z.number().int(),
  summary: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  findings: z.array(reviewFindingSchema),
  /// Pending proposals only; accepted and discarded ones are history.
  proposals: z.array(reviewRuleProposalSchema),
});
export type ReviewState = z.infer<typeof reviewStateSchema>;

/// A pull request to review, sent with a hosted thread start.
export const reviewStartSchema = z.object({
  repository: reviewRepositorySchema,
  number: z.number().int().positive(),
});
/// What a computer receives about a review thread: at start, and with every
/// message so a saved rule or new commits reach the next turn.
export const hubReviewRuleSchema = z.object({ id: z.string().max(64), text: z.string().max(REVIEW_RULE_TEXT_MAX), scope: reviewRuleScopeSchema });
export const hubReviewSchema = z.object({
  repository: z.string().max(200),
  number: z.number().int().positive(),
  title: z.string().max(500),
  baseRef: z.string().min(1).max(255),
  headRef: z.string().min(1).max(255),
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  /// The stack in merge order; the members before this one are below it.
  stack: z.array(z.object({ number: z.number().int().positive(), title: z.string().max(500), headRef: z.string().max(255), baseRef: z.string().max(255) })).max(20).default([]),
  rules: z.array(hubReviewRuleSchema).max(REVIEW_RULES_ENABLED_MAX),
});
export type HubReview = z.infer<typeof hubReviewSchema>;
