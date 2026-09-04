import {
  CONTRACT_VERSION,
  hubErrorSchema,
  hubHealthSchema,
  requestOutcomeSchema,
  uptimeCheckFrameSchema,
  type HubEnvironment,
  type HubErrorEvent,
  type HubHealth,
  type RequestOutcome,
  type UptimeCheckFrame,
} from "@remy/contract";

export interface Env {
  AUTH_SECRET: SecretsStoreSecret;
  BETTER_AUTH_URL: string;
  COORDINATOR: DurableObjectNamespace;
  DB: D1Database;
  ENVIRONMENT: HubEnvironment;
  JOBS: Queue<UptimeCheckFrame>;
  OBJECTS: R2Bucket;
  RELEASE: string;
}

type LogEvent = RequestOutcome | HubErrorEvent;
type HandlerDependencies = {
  log: (event: LogEvent) => void;
  now: () => number;
  requestId: () => string;
  route: (request: Request, env: Env) => Promise<Response>;
};

async function statusOf(check: () => Promise<unknown>): Promise<"ready" | "unavailable"> {
  try {
    await check();
    return "ready";
  } catch {
    return "unavailable";
  }
}

export async function healthFor(env: Env): Promise<HubHealth> {
  const dependencies: HubHealth["dependencies"] = {
    database: await statusOf(() => env.DB.prepare("SELECT 1").first()),
    coordinator: await statusOf(async () => {
      const stub = env.COORDINATOR.get(env.COORDINATOR.idFromName("health"));
      if (!(await stub.fetch("https://internal/health")).ok) throw new Error("Coordinator unavailable");
    }),
    objectStore: await statusOf(() => env.OBJECTS.head("health/probe")),
    queue: env.JOBS ? "ready" : "unavailable",
    secrets: await statusOf(async () => {
      if (!(await env.AUTH_SECRET.get())) throw new Error("Secret unavailable");
    }),
  };
  return hubHealthSchema.parse({
    contractVersion: CONTRACT_VERSION,
    dependencies,
    environment: env.ENVIRONMENT,
    release: env.RELEASE,
    status: Object.values(dependencies).every((status) => status === "ready") ? "ok" : "degraded",
  });
}

async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    const health = await healthFor(env);
    return Response.json(health, { status: health.status === "ok" ? 200 : 503 });
  }
  return Response.json(hubErrorSchema.parse({ error: "Not found" }), { status: 404 });
}

function requestIdFor(request: Request, generate: () => string): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && supplied.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(supplied) ? supplied : generate();
}

export function createHandler(overrides: Partial<HandlerDependencies> = {}) {
  const dependencies: HandlerDependencies = {
    log: (event) => console.log(JSON.stringify(event)),
    now: () => performance.now(),
    requestId: () => crypto.randomUUID(),
    route: routeRequest,
    ...overrides,
  };
  return async (request: Request, env: Env): Promise<Response> => {
    const startedAt = dependencies.now();
    const requestId = requestIdFor(request, dependencies.requestId);
    const route = new URL(request.url).pathname;
    let response: Response;
    let outcome: RequestOutcome["outcome"] = "success";
    try {
      response = await dependencies.route(request, env);
      if (response.status >= 500) outcome = "error";
    } catch (error) {
      outcome = "error";
      dependencies.log({
        event: "error.unhandled",
        environment: env.ENVIRONMENT,
        errorType: error instanceof Error ? error.name : "UnknownError",
        method: request.method,
        release: env.RELEASE,
        requestId,
        route,
      });
      response = Response.json(hubErrorSchema.parse({ error: "Internal server error" }), { status: 500 });
    }
    const headers = new Headers(response.headers);
    headers.set("x-request-id", requestId);
    const correlatedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    dependencies.log(requestOutcomeSchema.parse({
      event: "request.outcome",
      environment: env.ENVIRONMENT,
      release: env.RELEASE,
      requestId,
      method: request.method,
      route,
      status: correlatedResponse.status,
      durationMs: Math.max(0, dependencies.now() - startedAt),
      outcome,
    }));
    return correlatedResponse;
  };
}

export class HubCoordinator {
  constructor(private readonly ctx: DurableObjectState, readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return Response.json({ status: "ok" });
    if (request.method === "POST" && url.pathname === "/uptime") {
      const frame = uptimeCheckFrameSchema.parse(await request.json());
      await this.ctx.storage.put("uptime.latest", frame);
      return new Response(null, { status: 204 });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  }
}

export const handleRequest = createHandler();

export async function runUptimeCheck(env: Env, fetchHealth: typeof fetch = fetch): Promise<void> {
  let statusCode = 0;
  let status: UptimeCheckFrame["status"] = "failed";
  try {
    const response = await fetchHealth(new URL("/health", env.BETTER_AUTH_URL));
    statusCode = response.status;
    if (response.ok) {
      const health = hubHealthSchema.parse(await response.json());
      if (health.environment === env.ENVIRONMENT && health.release === env.RELEASE && health.status === "ok") {
        status = "ok";
      }
    }
  } catch {
    status = "failed";
  }
  await env.JOBS.send(uptimeCheckFrameSchema.parse({
    checkedAt: new Date().toISOString(),
    contractVersion: CONTRACT_VERSION,
    environment: env.ENVIRONMENT,
    kind: "uptime.check",
    release: env.RELEASE,
    status,
    statusCode,
  }));
}

export async function consumeUptimeChecks(batch: MessageBatch<UptimeCheckFrame>, env: Env): Promise<void> {
  const coordinator = env.COORDINATOR.get(env.COORDINATOR.idFromName("uptime"));
  for (const message of batch.messages) {
    const frame = uptimeCheckFrameSchema.parse(message.body);
    const [, coordinatorResponse] = await Promise.all([
      env.OBJECTS.put("uptime/latest.json", JSON.stringify(frame), { httpMetadata: { contentType: "application/json" } }),
      coordinator.fetch("https://internal/uptime", { method: "POST", body: JSON.stringify(frame) }),
    ]);
    if (!coordinatorResponse.ok) throw new Error("Coordinator rejected uptime check");
    if (frame.status === "failed") throw new Error(`Uptime check failed with status ${frame.statusCode}`);
    message.ack();
  }
}

export default {
  fetch: handleRequest,
  queue: consumeUptimeChecks,
  scheduled: (_controller, env, context) => context.waitUntil(runUptimeCheck(env)),
} satisfies ExportedHandler<Env, UptimeCheckFrame>;
