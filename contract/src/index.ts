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

export const hubRoutes = {
  health: { method: "GET", path: "/health", response: hubHealthSchema },
} as const;
