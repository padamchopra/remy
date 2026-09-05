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

import { D1AccountStore, type AccountStore } from "./account-store.js";
import { AccountService, bearerToken, webSessionCookie } from "./accounts.js";
import { authFor } from "./auth.js";
import { D1OrganizationStore, type OrganizationStore } from "./organization-store.js";
import { OrganizationError, OrganizationService } from "./organizations.js";

export interface Env {
  AUTH_SECRET: SecretsStoreSecret;
  BETTER_AUTH_URL: string;
  COORDINATOR: DurableObjectNamespace;
  DB: D1Database;
  EMAILS?: Queue<{ kind: "auth.magic-link" | "auth.verify-email" | "auth.change-email" | "organization.invite"; recipient: string; url: string }>;
  ENVIRONMENT: HubEnvironment;
  JOBS: Queue<UptimeCheckFrame>;
  OBJECTS: R2Bucket;
  RELEASE: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: SecretsStoreSecret;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: SecretsStoreSecret;
}

type LogEvent = RequestOutcome | HubErrorEvent;
type HandlerDependencies = {
  log: (event: LogEvent) => void;
  now: () => number;
  requestId: () => string;
  route: (request: Request, env: Env) => Promise<Response>;
};

type AccountRouteDependencies = {
  accountStore?: (env: Env) => AccountStore;
  accountService?: (store: AccountStore) => AccountService;
  organizationStore?: (env: Env) => OrganizationStore;
  organizationService?: (store: OrganizationStore) => OrganizationService;
  betterAuth?: typeof authFor;
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

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

async function body<T>(request: { json(): Promise<unknown> }): Promise<T | undefined> {
  try { return await request.json() as T; } catch { return undefined; }
}

function domainOf(email: string): string | undefined {
  const normalized = email.trim().toLowerCase();
  const separator = normalized.lastIndexOf("@");
  return separator > 0 && separator < normalized.length - 1 ? normalized.slice(separator + 1) : undefined;
}

async function identityFor(request: Request, service: AccountService) {
  return service.authenticate(bearerToken(request) ?? "");
}

export function createRouteHandler(dependencies: AccountRouteDependencies = {}) {
  return async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    const health = await healthFor(env);
    return Response.json(health, { status: health.status === "ok" ? 200 : 503 });
  }
  const store = (dependencies.accountStore ?? ((current) => new D1AccountStore(current.DB)))(env);
  const service = (dependencies.accountService ?? ((current) => new AccountService(current)))(store);
  const organizationStore = (dependencies.organizationStore ?? ((current) => new D1OrganizationStore(current.DB)))(env);
  const organizations = (dependencies.organizationService ?? ((current) => new OrganizationService(current)))(organizationStore);

  if (url.pathname === "/api/auth/sign-in/magic-link" && request.method === "POST") {
    const cloned = request.clone();
    const input = await body<{ email?: string }>(cloned);
    const domain = typeof input?.email === "string" ? domainOf(input.email) : undefined;
    const policy = domain ? await store.ssoPolicyForDomain(domain) : undefined;
    if (policy?.enforced && policy.verified) {
      return Response.json({ error: "Use your organization’s single sign-on.", providerId: policy.providerId }, { status: 403 });
    }
  }
  if (url.pathname.startsWith("/api/auth/")) {
    return (await (dependencies.betterAuth ?? authFor)(env)).handler(request);
  }
  if (url.pathname === "/api/sessions/web" && request.method === "POST") {
    const auth = await (dependencies.betterAuth ?? authFor)(env);
    const current = await auth.api.getSession({ headers: request.headers });
    if (!current) return jsonError("Sign in again.", 401);
    const pair = await service.createSession(current.user.id, "web", request.headers.get("user-agent") ?? "Web browser");
    await auth.api.signOut({ headers: request.headers });
    return Response.json({ expiresIn: pair.expiresIn }, { headers: { "set-cookie": webSessionCookie(pair.accessToken, url.protocol === "https:") } });
  }
  if (url.pathname === "/api/sessions/refresh" && request.method === "POST") {
    const input = await body<{ refreshToken?: string }>(request);
    const pair = typeof input?.refreshToken === "string" ? await service.refresh(input.refreshToken) : undefined;
    return pair ? Response.json(pair) : jsonError("Sign in again.", 401);
  }
  if (url.pathname === "/api/device/authorization" && request.method === "POST") {
    const input = await body<{ clientKind?: "phone" | "computer" | "cli"; clientName?: string }>(request);
    if (!input?.clientKind || !["phone", "computer", "cli"].includes(input.clientKind)) return jsonError("Choose a supported client.", 400);
    const clientName = typeof input.clientName === "string" ? input.clientName : input.clientKind;
    return Response.json(await service.startDeviceAuthorization(input.clientKind, clientName));
  }
  if (url.pathname === "/api/device/token" && request.method === "POST") {
    const input = await body<{ deviceCode?: string }>(request);
    if (typeof input?.deviceCode !== "string") return jsonError("Enter a device code.", 400);
    const result = await service.pollDevice(input.deviceCode);
    const status = result.status === "approved" ? 200 : result.status === "pending" ? 202 : result.status === "slow_down" ? 429 : 400;
    return Response.json(result, { status });
  }

  const protectedRoute = url.pathname === "/api/device/approve"
    || url.pathname === "/api/sessions"
    || url.pathname === "/api/sessions/revoke-all"
    || url.pathname === "/api/profile"
    || /^\/api\/sessions\/[^/]+$/.test(url.pathname)
    || url.pathname === "/api/invitations/accept"
    || url.pathname === "/api/organizations"
    || url.pathname.startsWith("/api/organizations/");
  if (!protectedRoute) return Response.json(hubErrorSchema.parse({ error: "Not found" }), { status: 404 });

  const identity = await identityFor(request, service);
  if (!identity) return jsonError("Sign in again.", 401);
  try {
    if (url.pathname === "/api/organizations" && request.method === "GET") return Response.json({ organizations: await organizations.list(identity.userId) });
    if (url.pathname === "/api/organizations" && request.method === "POST") {
      const input = await body<{ name?: string }>(request); const name = input?.name?.trim();
      if (!name || name.length > 120) return jsonError("Enter an organization name.", 400);
      return Response.json(await organizations.create(identity.userId, name), { status: 201 });
    }
    if (url.pathname === "/api/invitations/accept" && request.method === "POST") {
      const input = await body<{ token?: string }>(request);
      if (!input?.token) return jsonError("Open a valid invitation link.", 400);
      const profile = await store.profile(identity.userId);
      return Response.json(await organizations.acceptInvite(identity.userId, input.token, profile?.verifiedEmails ?? []));
    }
    const organizationMatch = /^\/api\/organizations\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (organizationMatch) {
      const organizationId = decodeURIComponent(organizationMatch[1]); const tail = organizationMatch[2] ?? "";
      if (tail === "members" && request.method === "GET") return Response.json({ members: await organizations.members(organizationId, identity.userId) });
      if (tail === "invites" && request.method === "POST") {
        const input = await body<{ email?: string; role?: "admin" | "member" }>(request);
        if (input?.role !== "admin" && input?.role !== "member") return jsonError("Choose admin or member access.", 400);
        if (input.email !== undefined && (!/^\S+@\S+\.\S+$/.test(input.email) || input.email.length > 254)) return jsonError("Enter a valid email address.", 400);
        if (input.email && !env.EMAILS) return jsonError("Email invitations are unavailable.", 503);
        const invite = await organizations.createInvite(organizationId, identity.userId, { ...(input.email ? { email: input.email } : {}), role: input.role });
        if (input.email) { await env.EMAILS!.send({ kind: "organization.invite", recipient: input.email, url: `${url.origin}/invite/${encodeURIComponent(invite.token)}` }); const { token: _, ...delivered } = invite; return Response.json(delivered, { status: 201 }); }
        return Response.json(invite, { status: 201 });
      }
      if (tail === "teams" && request.method === "GET") return Response.json({ teams: await organizations.teams(organizationId, identity.userId) });
      if (tail === "teams" && request.method === "POST") { const input = await body<{ name?: string }>(request); const name = input?.name?.trim(); if (!name || name.length > 120) return jsonError("Enter a team name.", 400); return Response.json(await organizations.createTeam(organizationId, identity.userId, name), { status: 201 }); }
      if (tail === "leave" && request.method === "POST") { await organizations.leave(organizationId, identity.userId); return new Response(null, { status: 204 }); }
      if (tail === "transfer" && request.method === "POST") { const input = await body<{ userId?: string }>(request); if (!input?.userId) return jsonError("Choose a new owner.", 400); await organizations.transfer(organizationId, identity.userId, input.userId); return new Response(null, { status: 204 }); }
      if (tail === "deletion-impact" && request.method === "GET") return Response.json(await organizations.deletionImpact(organizationId, identity.userId));
      if (!tail && request.method === "PATCH") { const input = await body<{ name?: string }>(request); const name = input?.name?.trim(); if (!name || name.length > 120) return jsonError("Enter an organization name.", 400); await organizations.rename(organizationId, identity.userId, name); return new Response(null, { status: 204 }); }
      if (!tail && request.method === "DELETE") { const input = await body<{ confirmation?: string }>(request); await organizations.delete(organizationId, identity.userId, input?.confirmation ?? ""); return new Response(null, { status: 204 }); }
      const memberMatch = /^members\/([^/]+)$/.exec(tail);
      if (memberMatch && request.method === "PATCH") { const input = await body<{ role?: "admin" | "member" }>(request); if (input?.role !== "admin" && input?.role !== "member") return jsonError("Choose admin or member access.", 400); await organizations.changeRole(organizationId, identity.userId, decodeURIComponent(memberMatch[1]), input.role); return new Response(null, { status: 204 }); }
      if (memberMatch && request.method === "DELETE") { await organizations.removeMember(organizationId, identity.userId, decodeURIComponent(memberMatch[1])); return new Response(null, { status: 204 }); }
      const teamMatch = /^teams\/([^/]+)$/.exec(tail);
      if (teamMatch && request.method === "PATCH") { const input = await body<{ name?: string }>(request); const name = input?.name?.trim(); if (!name || name.length > 120) return jsonError("Enter a team name.", 400); await organizations.renameTeam(organizationId, identity.userId, decodeURIComponent(teamMatch[1]), name); return new Response(null, { status: 204 }); }
      if (teamMatch && request.method === "DELETE") { await organizations.deleteTeam(organizationId, identity.userId, decodeURIComponent(teamMatch[1])); return new Response(null, { status: 204 }); }
      const teamMemberMatch = /^teams\/([^/]+)\/members\/([^/]+)$/.exec(tail);
      if (teamMemberMatch && (request.method === "PUT" || request.method === "DELETE")) { await organizations.changeTeamMember(organizationId, identity.userId, decodeURIComponent(teamMemberMatch[1]), decodeURIComponent(teamMemberMatch[2]), request.method === "PUT"); return new Response(null, { status: 204 }); }
      const teamMembersMatch = /^teams\/([^/]+)\/members$/.exec(tail);
      if (teamMembersMatch && request.method === "GET") return Response.json({ userIds: await organizations.teamMembers(organizationId, identity.userId, decodeURIComponent(teamMembersMatch[1])) });
    }
  } catch (error) {
    if (error instanceof OrganizationError) return jsonError(error.message, error.status);
    throw error;
  }
  if (url.pathname === "/api/device/approve" && request.method === "POST") {
    const input = await body<{ userCode?: string }>(request);
    if (typeof input?.userCode !== "string") return jsonError("Enter the code shown on your device.", 400);
    const status = await service.approveDevice(identity.userId, input.userCode);
    return status === "approved" ? Response.json({ status }) : jsonError(status === "expired" ? "This code has expired." : "This code is not valid.", 400);
  }
  if (url.pathname === "/api/sessions" && request.method === "GET") {
    const sessions = (await store.sessionsFor(identity.userId)).map(({ accessTokenHash: _, refreshTokenHash: __, ...session }) => session);
    return Response.json({ sessions });
  }
  if (url.pathname === "/api/sessions/revoke-all" && request.method === "POST") {
    await service.revokeEverywhere(identity.userId);
    return new Response(null, { status: 204, headers: { "set-cookie": webSessionCookie("", url.protocol === "https:").replace(/Max-Age=\d+/, "Max-Age=0") } });
  }
  const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
  if (sessionMatch && request.method === "DELETE") {
    return await service.revokeSession(identity.userId, sessionMatch[1]) ? new Response(null, { status: 204 }) : jsonError("Session not found.", 404);
  }
  if (url.pathname === "/api/profile" && request.method === "GET") {
    const profile = await store.profile(identity.userId);
    return profile ? Response.json(profile) : jsonError("Profile not found.", 404);
  }
  if (url.pathname === "/api/profile" && request.method === "PATCH") {
    const input = await body<{ name?: string; image?: string | null }>(request);
    if (!input || (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim() || input.name.length > 120))) return jsonError("Enter your name.", 400);
    if (input.image !== undefined && input.image !== null) {
      if (typeof input.image !== "string" || input.image.length > 2048 || !URL.canParse(input.image)) return jsonError("Choose a valid image URL.", 400);
      const protocol = new URL(input.image).protocol;
      if (protocol !== "https:" && protocol !== "http:") return jsonError("Choose a valid image URL.", 400);
    }
    return Response.json(await store.updateProfile(identity.userId, { ...(input.name !== undefined ? { name: input.name.trim() } : {}), ...(input.image !== undefined ? { image: input.image } : {}) }));
  }
  return Response.json(hubErrorSchema.parse({ error: "Not found" }), { status: 404 });
  };
}

const routeRequest = createRouteHandler();

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
