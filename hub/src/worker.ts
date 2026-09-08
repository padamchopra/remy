import { ScopedAgents } from "./scoped-agents.js";
import { resolveComputer } from "./routing.js";
import { routingRuleSchema } from "@remy/contract";
import { GitCapabilities, GithubInstallation, githubRepository, proxyGit } from "./hosted-git.js";
import { HostedSettingsStore } from "./hosted-settings.js";
import { HostedLifecycle } from "./hosted-lifecycle.js";
import { HttpRuntimeProvider } from "./computer-runtime.js";
import { hostedSettingsSchema } from "@remy/contract";
import { BoardAccess } from "./board-access.js";
import { HubNotifications, type ApplePushConfig } from "./notifications.js";
import { canReadThread, canWriteThread, threadMemberSchema, threadSnapshotSchema, type ThreadLiveFrame, type ThreadMember } from "@remy/contract";
import { ThreadStore } from "./thread-store.js";
import {
  CONTRACT_VERSION,
  COMPUTER_HEARTBEAT_INTERVAL_MS,
  COMPUTER_HEARTBEAT_TIMEOUT_MS,
  COMPUTER_PROTOCOL_VERSION,
  computerRegistrationInputSchema,
  computerAccessSchema,
  computerToHubFrameSchema,
  boardActorSchema,
  boardLogEventSchema,
  boardAppendInputSchema,
  boardProjectionEntitySchema,
  boardVersionVectorSchema,
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
import { authenticateComputer } from "./computer-auth.js";
import { D1ComputerStore, type ComputerStore } from "./computer-store.js";
import { ComputerService, versionBefore } from "./computers.js";
import { D1OrganizationStore, type OrganizationStore } from "./organization-store.js";
import { DurableBoardStorage, OrganizationBoard } from "./organization-board.js";
import { OrganizationError, OrganizationService } from "./organizations.js";

export interface Env extends ApplePushConfig {
  ASSETS?: Fetcher;
  HOSTED_CONTROL_URL?: string;
  HOSTED_CONTROL_TOKEN?: SecretsStoreSecret;
  HOSTED_IMAGE?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: SecretsStoreSecret;
  HOSTED_ARCHIVE?: string;
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
  MINIMUM_DAEMON_VERSION?: string;
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
  computerStore?: (env: Env) => ComputerStore;
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

function encodeWireBody(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value); let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeWireBody(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized); const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function limitedBody(request: Request, limit: number): Promise<ArrayBuffer | undefined> {
  const reader = request.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel(); return undefined; }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
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
  const origin = request.headers.get("origin");
  if (!request.headers.get("authorization") && request.headers.has("cookie") && origin && origin !== new URL(request.url).origin) return undefined;
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
  const computerStore = (dependencies.computerStore ?? ((current) => new D1ComputerStore(current.DB)))(env);
  const computers = new ComputerService(computerStore, Date.now, env.MINIMUM_DAEMON_VERSION ?? "0.1.0", organizationStore);

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

  if (url.pathname === "/api/runtime" && request.method === "GET") return Response.json({ mode: "hub", auth: { magicLink: !!env.EMAILS, google: !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET, github: !!env.GITHUB_CLIENT_ID && !!env.GITHUB_CLIENT_SECRET, sso: true } }, { headers: { "cache-control": "no-store" } });
  const protectedRoute = url.pathname === "/api/device/approve"
    || url.pathname === "/api/sessions"
    || url.pathname === "/api/sessions/revoke-all"
    || url.pathname === "/api/profile"
    || /^\/api\/sessions\/[^/]+$/.test(url.pathname)
    || url.pathname === "/api/invitations/accept"
    || url.pathname === "/api/organizations"
    || url.pathname.startsWith("/api/organizations/");
  if (!protectedRoute) {
    if (request.method === "GET" && /^\/invite\/[^/]+$/.test(url.pathname)) return Response.redirect(new URL(`/?invite=${encodeURIComponent(decodeURIComponent(url.pathname.slice(8)))}`, url.origin), 302);
    if (env.ASSETS && request.method === "GET" && !url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    return Response.json(hubErrorSchema.parse({ error: "Not found" }), { status: 404 });
  }

  const agentToolRoute=/^\/api\/organizations\/([^/]+)\/computers\/agent-tools\/([^/]+)$/.exec(url.pathname);
  if(agentToolRoute && request.method==="POST") {
    const org=decodeURIComponent(agentToolRoute[1]),computer=await authenticateComputer(request,org,computerStore);
    if(!computer)return jsonError("This computer cannot use agent tools.",403);
    return env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${org}`)).fetch(new Request(`https://internal/agent-tools/${agentToolRoute[2]}`,{method:"POST",headers:{"x-organization-id":org,"x-computer-id":computer.computerId,"content-type":"application/json"},body:request.body}));
  }
  const gitRoute = /^\/api\/organizations\/([^/]+)\/git\/([^/]+)(?:\/(token|info\/refs|git-upload-pack|git-receive-pack))?$/.exec(url.pathname);
  if (gitRoute) {
    const org=decodeURIComponent(gitRoute[1]), workspaceId=decodeURIComponent(gitRoute[2]), action=gitRoute[3];
    const workspace=await organizationStore.workspace(org,workspaceId);
    const repository=workspace && githubRepository(workspace.origin);
    const installation=await env.DB.prepare("SELECT installation_id,account FROM organization_git_installations WHERE organization_id=?").bind(org).first<{installation_id:number;account:string}>();
    if(!repository || !installation || repository.split("/")[0]!==installation.account.toLowerCase())return jsonError("Connect this workspace to GitHub first.",404);
    const capabilities=new GitCapabilities(()=>env.AUTH_SECRET.get());
    const policy=await env.DB.prepare("SELECT branches FROM workspace_git_policies WHERE organization_id=? AND workspace_id=?").bind(org,workspaceId).first<{branches:string}>();
    const branches=JSON.parse(policy?.branches??"[]") as string[];
    if(action==="token" && request.method==="POST") {
      const computer=await authenticateComputer(request,org,computerStore);
      if(!computer || computer.ownership!=="hosted" || !computer.capabilities.workspaces.some(w=>githubRepository(w.origin??"")===repository))return jsonError("This computer cannot use this workspace.",403);
      if(!await env.DB.prepare("SELECT 1 FROM hosted_workspace_bindings WHERE organization_id=? AND workspace_id=? AND computer_id=?").bind(org,workspaceId,computer.computerId).first())return jsonError("This computer cannot use this workspace.",403);
      const input=await body<{write?:boolean}>(request);
      return Response.json(await capabilities.issue({organizationId:org,computerId:computer.computerId,workspaceId,repository,branches,write:input?.write===true && branches.length>0}),{headers:{"cache-control":"no-store"}});
    }
    if(action && action!=="token") {
      let token="";try{const auth=request.headers.get("authorization")??"";if(auth.startsWith("Basic "))token=atob(auth.slice(6)).split(":").slice(1).join(":");}catch{}
      const grant=await capabilities.read(token);
      if(!grant)return new Response(null,{status:401,headers:{"www-authenticate":'Basic realm="Remy Git"'}});
      const computer=await computerStore.computer(org,grant.computerId);
      if(grant.organizationId!==org || grant.workspaceId!==workspaceId || grant.repository!==repository || !computer || computer.ownership!=="hosted" || !computer.capabilities.workspaces.some(w=>githubRepository(w.origin??"")===repository))return jsonError("This computer cannot use this workspace.",403);
      if(!await env.DB.prepare("SELECT 1 FROM hosted_workspace_bindings WHERE organization_id=? AND workspace_id=? AND computer_id=?").bind(org,workspaceId,grant.computerId).first())return jsonError("This computer cannot use this workspace.",403);
      grant.branches=grant.branches.filter(b=>branches.includes(b));
      if(!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY)return jsonError("GitHub access is unavailable.",503);
      const github=new GithubInstallation(env.GITHUB_APP_ID,()=>env.GITHUB_APP_PRIVATE_KEY!.get());
      return proxyGit(request,grant,action,()=>github.token(installation.installation_id,repository,grant.write));
    }
  }
  const boardSyncMatch = /^\/api\/organizations\/([^/]+)\/computers\/board-sync$/.exec(url.pathname);
  if (boardSyncMatch && request.method === "POST") {
    const organizationId = decodeURIComponent(boardSyncMatch[1]);
    const computer = await authenticateComputer(request, organizationId, computerStore);
    if (!computer || computer.ownership === "hosted") return jsonError("This computer cannot synchronize your Tasks.", 403);
    const grant = await env.DB.prepare(`SELECT g.granted_by FROM organization_board_computers g JOIN memberships m ON m.organization_id=g.organization_id AND m.user_id=g.granted_by WHERE g.organization_id=? AND g.computer_id=? AND m.role IN ('owner','admin')`).bind(organizationId, computer.computerId).first();
    if (!grant) return jsonError("Allow Tasks synchronization in Computers settings.", 403);
    const input = await body<{ version?: unknown; events?: unknown }>(request);
    const version = boardVersionVectorSchema.safeParse(input?.version ?? {});
    if (!version.success || !Array.isArray(input?.events) || input.events.length > 500 || JSON.stringify(input).length > 2_000_000) return jsonError("Choose a valid Tasks update.", 400);
    const events = [];
    for (const value of input.events) {
      const parsed = boardLogEventSchema.safeParse(value);
      if (!parsed.success) return jsonError("Choose a valid Tasks update.", 400);
      events.push({ ...parsed.data, actor: { kind: "computer", id: computer.computerId, label: computer.name } });
    }
    const coordinator = env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${organizationId}`));
    return coordinator.fetch(new Request("https://internal/board/sync", { method: "POST", headers:{"x-organization-id":organizationId,"x-user-id":String((grant as {granted_by:string}).granted_by)}, body: JSON.stringify({ version: version.data, events }) }));
  }
  const detachMatch = /^\/api\/organizations\/([^/]+)\/computers\/detach$/.exec(url.pathname);
  if (detachMatch && request.method === "POST") {
    const org = decodeURIComponent(detachMatch[1]);
    const computer = await authenticateComputer(request, org, computerStore);
    if (!computer) return jsonError("This computer could not be authenticated.", 401);
    await computerStore.remove(org, computer.computerId);
    await env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${org}`)).fetch(new Request("https://internal/computers/changed", { method: "POST", headers: { "x-organization-id": org, "x-removed-computer": computer.computerId } }));
    return Response.json({ ok: true });
  }
  const computerConnectMatch = /^\/api\/organizations\/([^/]+)\/computers\/connect$/.exec(url.pathname);
  if (computerConnectMatch && request.method === "GET") {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return jsonError("Open a WebSocket connection.", 426);
    const organizationId = decodeURIComponent(computerConnectMatch[1]);
    const computer = await authenticateComputer(request, organizationId, computerStore);
    if (!computer) return jsonError("This computer could not be authenticated.", 401);
    const coordinator = env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${organizationId}`));
    const internal = new Request("https://internal/computers/connect", {
      headers: { upgrade: "websocket", "x-computer-id": computer.computerId, "x-organization-id": organizationId, "x-minimum-daemon-version": env.MINIMUM_DAEMON_VERSION ?? "0.1.0" },
    });
    return coordinator.fetch(internal);
  }

  const attachmentDownload = /^\/api\/organizations\/([^/]+)\/computers\/([^/]+)\/thread-attachments\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (attachmentDownload && request.method === "GET") {
    const [, org, computerId, threadId, attachmentId] = attachmentDownload;
    const computer = await authenticateComputer(request, decodeURIComponent(org), computerStore);
    if (!computer || computer.computerId !== decodeURIComponent(computerId)) return jsonError("Image not found.", 404);
    const object = await env.OBJECTS.get(`thread-attachments/${encodeURIComponent(computer.organizationId)}/${encodeURIComponent(computer.computerId)}/${threadId}/${attachmentId}`);
    if (!object) return jsonError("Image not found.", 404);
    return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType ?? "application/octet-stream", "content-length": String(object.size), "x-filename": object.customMetadata?.name ?? "image" } });
  }

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
      const board = () => env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${organizationId}`));
      if (tail === "computers" && request.method === "POST") {
        await organizations.member(organizationId, identity.userId);
        if (identity.clientKind !== "computer") return jsonError("Use a computer authorization.", 403);
        const input = computerRegistrationInputSchema.safeParse(await body(request));
        if (!input.success) return jsonError("Choose valid computer details.", 400);
        const registration = await computers.register(organizationId, identity.userId, input.data);
        await board().fetch(new Request("https://internal/computers/changed", { method: "POST", headers: { "x-organization-id": organizationId } }));
        return Response.json(registration, { status: 201 });
      }
      if (tail === "computers" && request.method === "GET") {
        await organizations.member(organizationId, identity.userId);
        return Response.json({ computers: await computers.list(organizationId, identity.userId) });
      }
      if (tail === "notifications/devices" && (request.method === "GET" || request.method === "POST")) {
        await organizations.member(organizationId, identity.userId);
        if (request.method === "GET") {
          const devices = await env.DB.prepare("SELECT id,name,enabled FROM member_push_devices WHERE organization_id=? AND user_id=?").bind(organizationId, identity.userId).all();
          return Response.json({ devices: devices.results });
        }
        if (identity.clientKind !== "phone") return jsonError("Register Apple Push from your phone.", 403);
        const input = await body<{ token?: string; environment?: string; name?: string }>(request);
        if (!input || !/^[a-fA-F0-9]{64,200}$/.test(input.token ?? "") || !["production", "sandbox"].includes(input.environment ?? "") || typeof input.name !== "string" || !input.name.trim() || input.name.length > 80) return jsonError("Choose valid phone details.", 400);
        const id = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO member_push_devices (id,organization_id,user_id,session_id,token,environment,name) VALUES (?,?,?,?,?,?,?) ON CONFLICT(organization_id,token) DO UPDATE SET user_id=excluded.user_id,session_id=excluded.session_id,environment=excluded.environment,name=excluded.name,enabled=1").bind(id, organizationId, identity.userId, identity.sessionId, input.token!.toLowerCase(), input.environment, input.name.trim()).run();
        await board().fetch(new Request("https://internal/notifications/changed", { method: "POST", headers: { "x-organization-id": organizationId, "x-user-id": identity.userId } }));
        return Response.json({ ok: true }, { status: 201 });
      }
      const pushDevice = /^notifications\/devices\/([^/]+)$/.exec(tail);
      if (pushDevice && ["PATCH", "DELETE"].includes(request.method)) {
        await organizations.member(organizationId, identity.userId);
        if (request.headers.get("origin") && request.headers.get("origin") !== url.origin) return jsonError("Open notifications in Remy.", 403);
        if (request.method === "DELETE") await env.DB.prepare("DELETE FROM member_push_devices WHERE organization_id=? AND user_id=? AND id=?").bind(organizationId, identity.userId, decodeURIComponent(pushDevice[1])).run();
        else {
          const input = await body<{ enabled?: boolean }>(request);
          if (typeof input?.enabled !== "boolean") return jsonError("Choose whether this phone receives notifications.", 400);
          await env.DB.prepare("UPDATE member_push_devices SET enabled=? WHERE organization_id=? AND user_id=? AND id=?").bind(Number(input.enabled), organizationId, identity.userId, decodeURIComponent(pushDevice[1])).run();
        }
        await board().fetch(new Request("https://internal/notifications/changed", { method: "POST", headers: { "x-organization-id": organizationId, "x-user-id": identity.userId } }));
        return Response.json({ ok: true });
      }
      if (tail === "notifications" || tail === "notifications/live" || /^notifications\/[0-9a-f-]{36}\/read$/.test(tail)) {
        await organizations.member(organizationId, identity.userId);
        if (request.method !== "GET" && request.headers.get("origin") && request.headers.get("origin") !== url.origin) return jsonError("Open notifications in Remy.", 403);
        return board().fetch(new Request(`https://internal/${tail}`, { method: request.method, headers: { "x-organization-id": organizationId, "x-user-id": identity.userId, "x-session-id": identity.sessionId, upgrade: request.headers.get("upgrade") ?? "" } }));
      }
      if (tail === "computers/options" && request.method === "GET") {
        const member = await organizations.member(organizationId, identity.userId);
        const members = await organizations.members(organizationId, identity.userId);
        return Response.json({ role: member.role, members: await Promise.all(members.map(async (m) => ({ id: m.userId, label: (await store.profile(m.userId))?.name || "Member" }))), teams: await organizations.teams(organizationId, identity.userId) });
      }
      if (tail === "computers/live" && request.method === "GET") {
        await organizations.member(organizationId, identity.userId);
        return board().fetch(new Request("https://internal/computers/live", { headers: { upgrade: request.headers.get("upgrade") ?? "", "x-organization-id": organizationId, "x-user-id": identity.userId, "x-session-id": identity.sessionId } }));
      }
      const computerMatch = /^computers\/([^/]+)$/.exec(tail);
      if (computerMatch && ["PATCH", "DELETE"].includes(request.method)) {
        await organizations.member(organizationId, identity.userId);
        if (request.headers.get("origin") && request.headers.get("origin") !== url.origin) return jsonError("Open this computer in Remy.", 403);
        const id = decodeURIComponent(computerMatch[1]);
        if (request.method === "DELETE") {
          const current=await computerStore.computer(organizationId,id);
          if(current?.ownership==="hosted") {
            if(!await computers.canManage(current,identity.userId)) return jsonError("Computer not found.",404);
            const removed=await board().fetch(new Request(`https://internal/hosted-computers/${encodeURIComponent(id)}`,{method:"DELETE",headers:{"x-organization-id":organizationId}}));
            if(!removed.ok) return removed;
          }
          await computers.remove(organizationId, id, identity.userId);
        }
        else {
          const input = await body<{ name?: unknown; icon?: unknown; access?: unknown }>(request);
          if (!input || (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim() || input.name.length > 120)) || (input.icon !== undefined && (typeof input.icon !== "string" || input.icon.length > 40))) return jsonError("Choose valid computer details.", 400);
          const access = input.access === undefined ? undefined : computerAccessSchema.safeParse(input.access);
          if (access && !access.success) return jsonError("Choose who can use this computer.", 400);
          await computers.update(organizationId, id, identity.userId, { ...(typeof input.name === "string" ? { name: input.name.trim() } : {}), ...(typeof input.icon === "string" ? { icon: input.icon } : {}), ...(access?.success ? { access: access.data } : {}) });
        }
        await board().fetch(new Request("https://internal/computers/changed", { method: "POST", headers: { "x-organization-id": organizationId, ...(request.method === "DELETE" ? { "x-removed-computer": id } : {}) } }));
        return Response.json({ ok: true });
      }
      if (/^computers\/[^/]+\/(proxy|stream)(\/|$)/.test(tail)) {
        await organizations.member(organizationId, identity.userId);
        return jsonError("Use the thread's own address.", 403);
      }
      const hostedMatch = /^hosted(?:\/([^/]+)(?:\/(prewarm|settings))?)?$/.exec(tail);
      if (hostedMatch) {
        const member = await organizations.member(organizationId, identity.userId);
        const workspaceId = hostedMatch[1] ? decodeURIComponent(hostedMatch[1]) : "";
        if (workspaceId) await organizations.workspace(organizationId, identity.userId, workspaceId);
        const settings = new HostedSettingsStore(env.DB, () => env.AUTH_SECRET.get());
        if (request.method === "GET" && (!workspaceId || hostedMatch[2] === "settings")) return Response.json({ settings: await settings.settings(organizationId,workspaceId), secretNames: member.role !== "member" ? await settings.secretNames(organizationId) : [], available: !!env.HOSTED_CONTROL_URL && !!env.HOSTED_CONTROL_TOKEN && !!env.HOSTED_IMAGE });
        if (request.method === "PUT" && (!workspaceId || hostedMatch[2] === "settings")) {
          if (member.role === "member") return jsonError("Ask an admin to change hosted computers.",403);
          const input = await body<{settings?:unknown;secret?:{name?:unknown;value?:unknown}}>(request);
          if (input?.secret) {
            const {name,value}=input.secret;
            if (workspaceId || !["ANTHROPIC_API_KEY","OPENAI_API_KEY"].includes(String(name)) || (value!==null && (typeof value!=="string" || !value || value.length>8192))) return jsonError("Choose a valid model key.",400);
            await settings.setSecret(organizationId,String(name),value as string|null);
          } else {
            const parsed=hostedSettingsSchema.safeParse(input?.settings);
            if(!parsed.success && !(workspaceId && input?.settings===null)) return jsonError("Choose valid hosted computer settings.",400);
            await settings.save(organizationId,workspaceId,input!.settings);
          }
          await board().fetch(new Request("https://internal/organization/changed",{method:"POST",headers:{"x-organization-id":organizationId}}));
          return Response.json({ok:true});
        }
        if(workspaceId && (request.method === "GET" || (request.method === "POST" && hostedMatch[2] === "prewarm"))) {
          return board().fetch(new Request(`https://internal/hosted/${encodeURIComponent(workspaceId)}`,{method:request.method,headers:{"x-organization-id":organizationId}}));
        }
      }
      if (tail === "threads" || tail === "threads/live" || /^computers\/[^/]+\/threads(?:\/|$)/.test(tail)) {
        await organizations.member(organizationId, identity.userId);
        const profile = await store.profile(identity.userId);
        const actor = threadMemberSchema.parse({ id: identity.userId, label: profile?.name || "Member" });
        if (request.method !== "GET" && request.headers.get("origin") && request.headers.get("origin") !== url.origin) return jsonError("Open this thread in Remy.", 403);
        const computerId = /^computers\/([^/]+)\/threads/.exec(tail)?.[1];
        if (computerId) await computers.requireUse(organizationId, decodeURIComponent(computerId), identity.userId);
        const headers = new Headers({ "x-thread-member": encodeURIComponent(JSON.stringify(actor)), "x-thread-session": identity.sessionId, "x-organization-id": organizationId });
        if (request.headers.get("upgrade") === "websocket") headers.set("upgrade", "websocket");
        if (request.headers.has("content-type")) headers.set("content-type", request.headers.get("content-type")!);
        if (request.headers.has("x-filename")) headers.set("x-filename", request.headers.get("x-filename")!);
        const internal = new URL(`https://internal/${tail}`); internal.search = url.search;
        return board().fetch(new Request(internal, { method: request.method, headers, body: request.body, ...(request.body ? { duplex: "half" } : {}) }));
      }
      if(/^agents(?:\/[^/]+(?:\/(?:conversation|message))?)?$/.test(tail)) {
        await organizations.member(organizationId,identity.userId);
        return board().fetch(new Request(`https://internal/${tail}`,{method:request.method,headers:{"x-organization-id":organizationId,"x-user-id":identity.userId,"content-type":"application/json"},body:request.body}));
      }
      if(tail==="routing" || tail==="routing/resolve" || tail==="routing/preference") {
        const member=await organizations.member(organizationId,identity.userId);
        const stored=await env.DB.prepare("SELECT rules FROM organization_routing WHERE organization_id=?").bind(organizationId).first<{rules:string}>();
        const rules=routingRuleSchema.array().parse(JSON.parse(stored?.rules??"[]"));
        if(tail==="routing" && request.method==="GET")return Response.json({rules,canEdit:member.role!=="member"});
        if(tail==="routing" && request.method==="PUT") {
          if(member.role==="member")return jsonError("Only an administrator can change routing.",403);
          const input=await body<{rules?:unknown}>(request);const parsed=routingRuleSchema.array().max(100).safeParse(input?.rules);
          if(!parsed.success)return jsonError("Choose valid routing rules.",400);
          for(const rule of parsed.data) {
            if(!rule.target.computerId && !rule.target.class)return jsonError("Choose a computer or computer type.",400);
            if(rule.workspaceId)await organizations.workspace(organizationId,identity.userId,rule.workspaceId);
            if(rule.teamId && !await organizationStore.team(organizationId,rule.teamId))return jsonError("Choose a team in your organization.",400);
            if(rule.target.computerId && !await computerStore.computer(organizationId,rule.target.computerId))return jsonError("Choose a computer in your organization.",400);
          }
          await env.DB.prepare("INSERT INTO organization_routing(organization_id,rules) VALUES(?,?) ON CONFLICT(organization_id) DO UPDATE SET rules=excluded.rules").bind(organizationId,JSON.stringify(parsed.data)).run();
          return Response.json({rules:parsed.data});
        }
        if(tail==="routing/preference" && request.method==="GET") {
          const workspaceId=url.searchParams.get("workspaceId");
          if(!workspaceId)return jsonError("Choose a workspace.",400);
          await organizations.workspace(organizationId,identity.userId,workspaceId);
          const preference=await env.DB.prepare("SELECT computer_id FROM member_computer_preferences WHERE organization_id=? AND user_id=? AND workspace_id=?").bind(organizationId,identity.userId,workspaceId).first<{computer_id:string}>();
          return Response.json({computerId:preference?.computer_id??null});
        }
        if(request.method==="POST") {
          const input=await body<{workspaceId?:string;trigger?:string;computerId?:string|null;prewarm?:boolean;usePreference?:boolean}>(request);
          if(!input?.workspaceId)return jsonError("Choose a workspace.",400);
          const workspace=await organizations.workspace(organizationId,identity.userId,input.workspaceId);
          const all=await computers.list(organizationId,identity.userId);
          if(tail==="routing/preference") {
            if(input.computerId) {
              const choice=resolveComputer([],all,{workspaceId:workspace.id,origin:workspace.origin,teamIds:[],trigger:"manual",override:input.computerId});
              if(!choice.computerId)return jsonError(choice.reason,409);
              await env.DB.prepare("INSERT INTO member_computer_preferences(organization_id,user_id,workspace_id,computer_id) VALUES(?,?,?,?) ON CONFLICT(organization_id,user_id,workspace_id) DO UPDATE SET computer_id=excluded.computer_id").bind(organizationId,identity.userId,workspace.id,input.computerId).run();
            }else await env.DB.prepare("DELETE FROM member_computer_preferences WHERE organization_id=? AND user_id=? AND workspace_id=?").bind(organizationId,identity.userId,workspace.id).run();
            return Response.json({ok:true});
          }
          const teams=await organizationStore.teams(organizationId),teamIds:string[]=[];
          for(const team of teams)if((await organizationStore.teamMembers(organizationId,team.id)).includes(identity.userId))teamIds.push(team.id);
          const preference=input.usePreference?await env.DB.prepare("SELECT computer_id FROM member_computer_preferences WHERE organization_id=? AND user_id=? AND workspace_id=?").bind(organizationId,identity.userId,workspace.id).first<{computer_id:string}>():null;
          const choice=resolveComputer(rules,all,{workspaceId:workspace.id,origin:workspace.origin,teamIds,trigger:input.trigger??"manual",...(preference?{override:preference.computer_id}:{})});
          if(choice.hostedWorkspaceId && input.prewarm) {
            const response=await board().fetch(new Request(`https://internal/hosted/${workspace.id}`,{method:"POST",headers:{"x-organization-id":organizationId}}));
            if(!response.ok)return response;
          }
          return Response.json(choice);
        }
        return jsonError("This routing action is unavailable.",405);
      }
      const gitPolicy = /^workspaces\/([^/]+)\/git$/.exec(tail);
      if(gitPolicy && ["GET","PUT"].includes(request.method)) {
        const member=await organizations.member(organizationId,identity.userId);
        const workspace=await organizations.workspace(organizationId,identity.userId,decodeURIComponent(gitPolicy[1]));
        if(member.role==="member")return jsonError("Only an administrator can change Git access.",403);
        if(request.method==="PUT") {
          const input=await body<{branches?:unknown}>(request);
          if(!Array.isArray(input?.branches) || input.branches.length>100 || !input.branches.every(b=>typeof b==="string" && /^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,199}$/.test(b)))return jsonError("Enter the branches this computer can push.",400);
          await env.DB.prepare("INSERT INTO workspace_git_policies(organization_id,workspace_id,branches) VALUES(?,?,?) ON CONFLICT(organization_id,workspace_id) DO UPDATE SET branches=excluded.branches").bind(organizationId,workspace.id,JSON.stringify(input.branches)).run();
        }
        const policy=await env.DB.prepare("SELECT branches FROM workspace_git_policies WHERE organization_id=? AND workspace_id=?").bind(organizationId,workspace.id).first<{branches:string}>();
        return Response.json({branches:JSON.parse(policy?.branches??"[]")});
      }
      const boardGrant = /^computers\/([^/]+)\/board-access$/.exec(tail);
      if (boardGrant && ["GET", "PUT", "DELETE"].includes(request.method)) {
        const member = await organizations.member(organizationId, identity.userId);
        const computerId = decodeURIComponent(boardGrant[1]);
        const computer = await computerStore.computer(organizationId, computerId);
        if (!computer || computer.ownership === "hosted" || member.role === "member" || !await computers.canManage(computer, identity.userId)) return jsonError("Computer not found.", 404);
        if (request.method === "PUT") await env.DB.prepare("INSERT INTO organization_board_computers (organization_id,computer_id,granted_by,created_at) VALUES (?,?,?,?) ON CONFLICT(organization_id,computer_id) DO UPDATE SET granted_by=excluded.granted_by").bind(organizationId, computerId, identity.userId, Date.now()).run();
        if (request.method === "DELETE") await env.DB.prepare("DELETE FROM organization_board_computers WHERE organization_id=? AND computer_id=?").bind(organizationId, computerId).run();
        return Response.json({ enabled: !!await env.DB.prepare("SELECT 1 FROM organization_board_computers WHERE organization_id=? AND computer_id=?").bind(organizationId, computerId).first() });
      }
      if (!tail && request.method === "GET") {
        const member = await organizations.member(organizationId, identity.userId);
        const organization = await organizationStore.organization(organizationId);
        return Response.json({ organization: { ...organization, role: member.role } });
      }
      if (tail === "live" && request.method === "GET") {
        await organizations.member(organizationId, identity.userId);
        return board().fetch(new Request("https://internal/organization/live", { headers: { upgrade: request.headers.get("upgrade") ?? "", "x-organization-id": organizationId, "x-user-id": identity.userId, "x-session-id": identity.sessionId } }));
      }
      if (tail === "board/events" && request.method === "POST") {
        await organizations.member(organizationId, identity.userId);
        const input = boardAppendInputSchema.safeParse(await body(request));
        if (!input.success) return jsonError("Choose a valid change.", 400);
        const profile = await store.profile(identity.userId);
        const actor = boardActorSchema.parse({ kind: "member", id: identity.userId, label: profile?.name ?? "Member" });
        return board().fetch("https://internal/board/append", { method: "POST", headers: { "x-organization-id": organizationId, "x-user-id": identity.userId }, body: JSON.stringify({ input: input.data, actor }) });
      }
      if (tail === "board/live" && request.method === "GET") {
        await organizations.member(organizationId, identity.userId);
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return jsonError("Open a WebSocket connection.", 426);
        const cursor = url.searchParams.get("cursor");
        const live = new URL("https://internal/board/live");
        if (cursor !== null) live.searchParams.set("cursor", cursor);
        return board().fetch(new Request(live, { headers: { upgrade: "websocket", "x-organization-id": organizationId, "x-user-id": identity.userId, "x-session-id": identity.sessionId } }));
      }
      const boardMatch = /^board\/(tickets|agents|memories|routines)(?:\/([^/]+))?$/.exec(tail);
      if (boardMatch && request.method === "GET") {
        await organizations.member(organizationId, identity.userId);
        const entity = boardProjectionEntitySchema.parse(boardMatch[1]);
        const entityId = boardMatch[2] ? decodeURIComponent(boardMatch[2]) : undefined;
        return board().fetch(new Request(`https://internal/board/projections/${entity}${entityId ? `/${encodeURIComponent(entityId)}` : ""}`, { headers: { "x-organization-id": organizationId, "x-user-id": identity.userId } }));
      }
      if (tail === "members" && request.method === "GET") {
        const members = await organizations.members(organizationId, identity.userId);
        return Response.json({ members: await Promise.all(members.map(async (m) => ({ ...m, name: (await store.profile(m.userId))?.name ?? "Member" }))) });
      }
      if (tail === "invites" && request.method === "POST") {
        const input = await body<{ email?: string; role?: "admin" | "member" }>(request);
        if (input?.role !== "admin" && input?.role !== "member") return jsonError("Choose admin or member access.", 400);
        if (input.email !== undefined && (!/^\S+@\S+\.\S+$/.test(input.email) || input.email.length > 254)) return jsonError("Enter a valid email address.", 400);
        if (input.email && !env.EMAILS) return jsonError("Email invitations are unavailable.", 503);
        const invite = await organizations.createInvite(organizationId, identity.userId, { ...(input.email ? { email: input.email } : {}), role: input.role });
        if (input.email) { await env.EMAILS!.send({ kind: "organization.invite", recipient: input.email, url: `${url.origin}/?invite=${encodeURIComponent(invite.token)}` }); const { token: _, ...delivered } = invite; return Response.json(delivered, { status: 201 }); }
        return Response.json(invite, { status: 201 });
      }
      if (tail === "teams" && request.method === "GET") return Response.json({ teams: await organizations.teams(organizationId, identity.userId) });
      if (tail === "teams" && request.method === "POST") { const input = await body<{ name?: string }>(request); const name = input?.name?.trim(); if (!name || name.length > 120) return jsonError("Enter a team name.", 400); return Response.json(await organizations.createTeam(organizationId, identity.userId, name), { status: 201 }); }
      if (tail === "workspaces" && request.method === "GET") return Response.json({ workspaces: await organizations.workspaces(organizationId, identity.userId) });
      if (tail === "workspaces" && request.method === "POST") {
        const input = await body<{ name?: string; origin?: string; access?: { teamIds?: unknown; userIds?: unknown } }>(request); const name = input?.name?.trim(); const origin = input?.origin?.trim();
        if (!name || name.length > 120) return jsonError("Enter a workspace name.", 400);
        if (!origin || origin.length > 512) return jsonError("Enter the repository origin.", 400);
        if (input?.access && (!Array.isArray(input.access.teamIds) || !input.access.teamIds.every((id) => typeof id === "string") || !Array.isArray(input.access.userIds) || !input.access.userIds.every((id) => typeof id === "string"))) return jsonError("Choose valid workspace access.", 400);
        return Response.json(await organizations.createWorkspace(organizationId, identity.userId, { name, origin, ...(input?.access ? { access: input.access as { teamIds: string[]; userIds: string[] } } : {}) }), { status: 201 });
      }
      if (tail === "leave" && request.method === "POST") { await organizations.leave(organizationId, identity.userId); await board().fetch(new Request("https://internal/computers/changed", { method: "POST", headers: { "x-organization-id": organizationId } })); return new Response(null, { status: 204 }); }
      if (tail === "transfer" && request.method === "POST") { const input = await body<{ userId?: string }>(request); if (!input?.userId) return jsonError("Choose a new owner.", 400); await organizations.transfer(organizationId, identity.userId, input.userId); return new Response(null, { status: 204 }); }
      if (tail === "deletion-impact" && request.method === "GET") return Response.json(await organizations.deletionImpact(organizationId, identity.userId));
      if (!tail && request.method === "PATCH") { const input = await body<{ name?: string }>(request); const name = input?.name?.trim(); if (!name || name.length > 120) return jsonError("Enter an organization name.", 400); await organizations.rename(organizationId, identity.userId, name); return new Response(null, { status: 204 }); }
      if (!tail && request.method === "DELETE") {
        const input = await body<{ confirmation?: string }>(request);
        const impact = await organizations.deletionImpact(organizationId, identity.userId);
        if (input?.confirmation !== impact.name) return jsonError("Enter the organization name to confirm deletion.", 400);
        const response = await board().fetch("https://internal/board", { method: "DELETE" });
        if (!response.ok) throw new Error("Organization board deletion failed");
        await organizations.delete(organizationId, identity.userId, input?.confirmation ?? "");
        return new Response(null, { status: 204 });
      }
      const memberMatch = /^members\/([^/]+)$/.exec(tail);
      if (memberMatch && request.method === "PATCH") { const input = await body<{ role?: "admin" | "member" }>(request); if (input?.role !== "admin" && input?.role !== "member") return jsonError("Choose admin or member access.", 400); await organizations.changeRole(organizationId, identity.userId, decodeURIComponent(memberMatch[1]), input.role); return new Response(null, { status: 204 }); }
      if (memberMatch && request.method === "DELETE") { await organizations.removeMember(organizationId, identity.userId, decodeURIComponent(memberMatch[1])); await board().fetch(new Request("https://internal/computers/changed", { method: "POST", headers: { "x-organization-id": organizationId } })); return new Response(null, { status: 204 }); }
      const teamMatch = /^teams\/([^/]+)$/.exec(tail);
      if (teamMatch && request.method === "PATCH") { const input = await body<{ name?: string }>(request); const name = input?.name?.trim(); if (!name || name.length > 120) return jsonError("Enter a team name.", 400); await organizations.renameTeam(organizationId, identity.userId, decodeURIComponent(teamMatch[1]), name); return new Response(null, { status: 204 }); }
      if (teamMatch && request.method === "DELETE") { await organizations.deleteTeam(organizationId, identity.userId, decodeURIComponent(teamMatch[1])); await board().fetch(new Request("https://internal/computers/changed", { method: "POST", headers: { "x-organization-id": organizationId } })); return new Response(null, { status: 204 }); }
      const teamMemberMatch = /^teams\/([^/]+)\/members\/([^/]+)$/.exec(tail);
      if (teamMemberMatch && (request.method === "PUT" || request.method === "DELETE")) { await organizations.changeTeamMember(organizationId, identity.userId, decodeURIComponent(teamMemberMatch[1]), decodeURIComponent(teamMemberMatch[2]), request.method === "PUT"); await board().fetch(new Request("https://internal/computers/changed", { method: "POST", headers: { "x-organization-id": organizationId } })); return new Response(null, { status: 204 }); }
      const teamMembersMatch = /^teams\/([^/]+)\/members$/.exec(tail);
      if (teamMembersMatch && request.method === "GET") return Response.json({ userIds: await organizations.teamMembers(organizationId, identity.userId, decodeURIComponent(teamMembersMatch[1])) });
      const workspaceMatch = /^workspaces\/([^/]+)$/.exec(tail);
      if (workspaceMatch && request.method === "GET") return Response.json(await organizations.workspace(organizationId, identity.userId, decodeURIComponent(workspaceMatch[1])));
      if (workspaceMatch && request.method === "PATCH") {
        const input = await body<{ name?: unknown; access?: null | { teamIds?: unknown; userIds?: unknown } }>(request);
        if (!input || (input.name === undefined && input.access === undefined)) return jsonError("Choose a workspace change.", 400);
        if (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim() || input.name.length > 120)) return jsonError("Enter a workspace name.", 400);
        if (input.access !== undefined && input.access !== null && (!Array.isArray(input.access.teamIds) || !input.access.teamIds.every((id) => typeof id === "string") || !Array.isArray(input.access.userIds) || !input.access.userIds.every((id) => typeof id === "string"))) return jsonError("Choose valid workspace access.", 400);
        return Response.json(await organizations.updateWorkspace(organizationId, identity.userId, decodeURIComponent(workspaceMatch[1]), { ...(typeof input.name === "string" ? { name: input.name.trim() } : {}), ...(input.access !== undefined ? { access: input.access as { teamIds: string[]; userIds: string[] } | null } : {}) }));
      }
      if (workspaceMatch && request.method === "DELETE") { if ((await organizations.member(organizationId, identity.userId)).role === "member") return jsonError("Only an administrator can remove a workspace.", 403); const cleanup = await board().fetch(new Request(`https://internal/hosted-workspace/${workspaceMatch[1]}`, {method:"DELETE"})); if (!cleanup.ok) return jsonError("This hosted computer could not be removed; try again.", 502); await organizations.deleteWorkspace(organizationId, identity.userId, decodeURIComponent(workspaceMatch[1])); return new Response(null, { status: 204 }); }
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
  if (url.pathname === "/api/sessions/current" && request.method === "DELETE") {
    await service.revokeSession(identity.userId, identity.sessionId);
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
    const route = new URL(request.url).pathname.replace(/^\/invite\/[^/]+$/, "/invite/:token");
    let response: Response;
    let outcome: RequestOutcome["outcome"] = "success";
    try {
      response = await dependencies.route(request, env);
      if (response.status >= 500) outcome = "error";
      const changed = /^\/api\/organizations\/([^/]+)(?:\/(members|teams|workspaces|invites|leave|transfer)(?:\/.*)?)?$/.exec(route);
      if (response.ok && changed && ["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) await env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${decodeURIComponent(changed[1])}`)).fetch(new Request("https://internal/organization/changed", { method: "POST", headers: { "x-organization-id": decodeURIComponent(changed[1]) } }));
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
      ...(response.webSocket ? { webSocket: response.webSocket } : {}),
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
  private readonly board: OrganizationBoard;
  private readonly threads: ThreadStore;
  private threadPublishing = Promise.resolve();
  private hosted?: HostedLifecycle;
  private readonly computers: D1ComputerStore;
  private readonly notifications: HubNotifications;
  private readonly pending = new Map<string, { computerId: string; resolve: (response: Response) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly ctx: DurableObjectState, readonly env: Env) {
    this.computers = new D1ComputerStore(env.DB);
    this.notifications = new HubNotifications(env.DB, (computerId, threadId) => this.threads.get(computerId, threadId), (id,user)=>this.canReadAgentThread(id,user));
    this.threads = new ThreadStore(new DurableBoardStorage(ctx.storage), (frame) => { this.threadPublishing = this.threadPublishing.then(() => this.publishThreadFrame(frame)).catch(() => undefined); });
    this.board = new OrganizationBoard(new DurableBoardStorage(ctx.storage), {
      publish: (frames) => {
        for (const socket of this.ctx.getWebSockets()) {
          const attachment = socket.deserializeAttachment() as { kind?: string; boardSync?: boolean } | null;
          if (attachment?.kind === "computer" && attachment.boardSync) { try { socket.send(JSON.stringify({ kind: "board.changed" })); } catch { socket.close(); } }
          if (attachment?.kind !== "board") continue;
          try {
            void this.sendOrganizationReset(socket, frames.at(-1)?.cursor ?? 0);
            const cursor = frames.at(-1)?.cursor;
            if (cursor !== undefined) socket.serializeAttachment({ ...attachment, cursor });
          } catch {
            socket.close(1011, "Live updates stopped; reconnect to continue.");
          }
        }
      },
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return Response.json({ status: "ok" });
    const org = request.headers.get("x-organization-id");
    const user = request.headers.get("x-user-id");
    if (org) await this.ctx.storage.put("organizationId", org);
    if (url.pathname === "/organization/changed") {
      if(org){await this.scopedAgents(org).departures();await this.cleanAgentThreads();}
      this.invalidateComputers();
      for (const socket of this.ctx.getWebSockets()) void this.sendOrganizationReset(socket);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/organization/live") {
      if (!org || !user || request.headers.get("upgrade")?.toLowerCase() !== "websocket") return jsonError("Open a live connection.", 426);
      const [client, server] = Object.values(new WebSocketPair()); this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ kind: "organization", userId: user, sessionId: request.headers.get("x-session-id") });
      await this.sendOrganizationReset(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname.startsWith("/notifications")) {
      const org = request.headers.get("x-organization-id"); const user = request.headers.get("x-user-id");
      if (!org || !user) return jsonError("Sign in again.", 401);
      await this.ctx.storage.put("organizationId", org);
      if (url.pathname === "/notifications/changed" && request.method === "POST") { this.invalidateNotifications(user); return Response.json({ ok: true }); }
      if (url.pathname === "/notifications" && request.method === "GET") {
        const devices = await this.env.DB.prepare("SELECT id,name,enabled FROM member_push_devices WHERE organization_id=? AND user_id=?").bind(org, user).all();
        return Response.json({ notifications: await this.notifications.list(org, user), devices: devices.results });
      }
      if (url.pathname === "/notifications/live" && request.method === "GET") {
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return jsonError("Open a WebSocket connection.", 426);
        const [client, server] = Object.values(new WebSocketPair()); this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ kind: "notifications", userId: user, sessionId: request.headers.get("x-session-id") });
        server.send(JSON.stringify({ kind: "reset" }));
        return new Response(null, { status: 101, webSocket: client });
      }
      const read = /^\/notifications\/([0-9a-f-]{36})\/read$/.exec(url.pathname);
      if (read && request.method === "POST") { await this.notifications.read(org, user, read[1]); this.invalidateNotifications(user); return Response.json({ ok: true }); }
      return jsonError("This action is not available.", 404);
    }
    if (url.pathname === "/computers/changed" && request.method === "POST") {
      await this.ctx.storage.put("organizationId", request.headers.get("x-organization-id"));
      const removed = request.headers.get("x-removed-computer");
      if (removed) {
        this.computerSocket(removed)?.close(1008, "This computer was removed.");
        await this.threads.manifest(removed, []);
      }
      this.invalidateComputers();
      return Response.json({ ok: true });
    }
    if (url.pathname === "/computers/live" && request.method === "GET") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return jsonError("Open a WebSocket connection.", 426);
      await this.ctx.storage.put("organizationId", request.headers.get("x-organization-id"));
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ kind: "computers", userId: request.headers.get("x-user-id"), sessionId: request.headers.get("x-session-id") });
      server.send(JSON.stringify({ kind: "reset" }));
      return new Response(null, { status: 101, webSocket: client });
    }
    if (request.method === "GET" && url.pathname === "/computers/connect") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return jsonError("Expected WebSocket", 426);
      const computerId = request.headers.get("x-computer-id");
      if (!computerId) return jsonError("Computer not found", 404);
      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as { kind?: string; computerId?: string } | null;
        if (attachment?.kind === "computer" && attachment.computerId === computerId) socket.close(1000, "A newer connection replaced this one.");
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      await this.ctx.storage.put("organizationId", request.headers.get("x-organization-id") ?? "");
      server.serializeAttachment({ kind: "computer", computerId, lastSeenAt: Date.now(), minimumDaemonVersion: request.headers.get("x-minimum-daemon-version") ?? "0.1.0" });
      server.send(JSON.stringify({ kind: "welcome", protocolVersion: COMPUTER_PROTOCOL_VERSION, heartbeatIntervalMs: COMPUTER_HEARTBEAT_INTERVAL_MS, threadRelay: true, notifications: true }));
      await this.scheduleAlarm(Date.now() + COMPUTER_HEARTBEAT_TIMEOUT_MS);
      return new Response(null, { status: 101, webSocket: client });
    }
    const agentRoute=/^\/agents(?:\/([^/]+)(?:\/(conversation|message))?)?$/.exec(url.pathname);
    if(agentRoute && org && user) {
      const agents=this.scopedAgents(org);
      try {
        if(!agentRoute[1] && request.method==="GET")return Response.json({agents:await agents.visible(user)});
        const id=decodeURIComponent(agentRoute[1]??"");
        if(agentRoute[2]==="conversation" && request.method==="GET")return Response.json({messages:await agents.conversation(id,user)});
        if(agentRoute[2]==="message" && request.method==="POST") {const input=await body<{text?:string;messageId?:string}>(request);if(typeof input?.text!=="string" || typeof input.messageId!=="string")return jsonError("Enter a message.",400);const messages=await agents.message(id,user,input.text,input.messageId);this.invalidateComputers();return Response.json({messages});}
      }catch{return jsonError("Agent not found.",404);}
      return jsonError("This agent action is unavailable.",405);
    }
    const agentTool=/^\/agent-tools\/([^/]+)$/.exec(url.pathname);
    if(agentTool && request.method==="POST" && org) {
      const binding=await this.ctx.storage.get<{computerId:string;userId:string;agentId:string;orchestrator:boolean}>(`agent-run:${decodeURIComponent(agentTool[1])}`);
      if(!binding || binding.computerId!==request.headers.get("x-computer-id") || !binding.orchestrator)return jsonError("This agent cannot change routing.",403);
      const member=await new D1OrganizationStore(this.env.DB).membership(org,binding.userId);
      if(!member || member.role==="member")return jsonError("Only an administrator can change routing.",403);
      const input=await body<{action?:string;input?:{rules?:unknown}}>(request);
      if(input?.action==="edit_routing") {
        const parsed=routingRuleSchema.array().max(100).safeParse(input.input?.rules);
        if(!parsed.success)return jsonError("Choose valid routing rules.",400);
        const organizations=new D1OrganizationStore(this.env.DB);
        for(const r of parsed.data)if((!r.target.computerId && !r.target.class) || (r.target.computerId && !await this.computers.computer(org,r.target.computerId)) || (r.workspaceId && !await organizations.workspace(org,r.workspaceId)) || (r.teamId && !await organizations.team(org,r.teamId)))return jsonError("Choose routing within your organization.",400);
        await this.env.DB.prepare("INSERT INTO organization_routing(organization_id,rules) VALUES(?,?) ON CONFLICT(organization_id) DO UPDATE SET rules=excluded.rules").bind(org,JSON.stringify(parsed.data)).run();
      }else if(input?.action!=="read_routing")return jsonError("This agent tool is unavailable.",403);
      const row=await this.env.DB.prepare("SELECT rules FROM organization_routing WHERE organization_id=?").bind(org).first<{rules:string}>();
      return Response.json({rules:JSON.parse(row?.rules??"[]")});
    }
    const removeWorkspace = /^\/hosted-workspace\/([^/]+)$/.exec(url.pathname);
    if(removeWorkspace && request.method === "DELETE") { const state = await this.hostedService().get(decodeURIComponent(removeWorkspace[1])); if(state) await this.hostedService().remove(state.computerId); return new Response(null,{status:204}); }
    const removeHosted=/^\/hosted-computers\/([^/]+)$/.exec(url.pathname);
    if(removeHosted && request.method==="DELETE") {try{await this.hostedService().remove(decodeURIComponent(removeHosted[1]));return Response.json({ok:true});}catch{return jsonError("This hosted computer could not be removed; try again.",502);}}
    const hostedMatch=/^\/hosted\/([^/]+)$/.exec(url.pathname);
    if(hostedMatch && org){
      const workspace=decodeURIComponent(hostedMatch[1]);
      const safe=(state:Awaited<ReturnType<HostedLifecycle["get"]>>)=>state?{workspaceId:state.workspaceId,computerId:state.computerId,provider:state.provider,phase:state.phase,lastUsedAt:state.lastUsedAt,error:state.error,usage:state.usage,timing:state.timing}:null;
      if(request.method==="POST") {
        const settings=await new HostedSettingsStore(this.env.DB,()=>this.env.AUTH_SECRET.get()).settings(org,workspace);
        if(!settings.enabled) return jsonError("Enable hosted computers for this workspace.",409);
        this.ctx.waitUntil(this.hostedService().ensure(workspace,settings).catch(()=>undefined).finally(()=>this.invalidateComputers()));
        await this.scheduleAlarm(Date.now()+60_000);
        return Response.json({state:safe(await this.hostedService().get(workspace))},{status:202});
      }
      if(request.method==="GET") return Response.json({state:safe(await this.hostedService().get(workspace))});
    }
    const threadResponse = await this.threadRequest(request);
    if (threadResponse) return threadResponse;
    const proxyMatch = /^\/computers\/([^/]+)\/proxy(\/.*)$/.exec(url.pathname);
    if (proxyMatch) {
      const computerId = decodeURIComponent(proxyMatch[1]);
      const socket = this.ctx.getWebSockets().find((candidate) => {
        const attachment = candidate.deserializeAttachment() as { kind?: string; computerId?: string } | null;
        return attachment?.kind === "computer" && attachment.computerId === computerId;
      });
      if (!socket) return jsonError("Computer unavailable", 503);
      const id = crypto.randomUUID();
      const response = new Promise<Response>((resolve) => {
        const timer = setTimeout(() => { this.pending.delete(id); resolve(jsonError("Computer did not answer", 504)); }, 30_000);
        this.pending.set(id, { computerId, resolve, timer });
      });
      const headers: Record<string, string> = {};
      request.headers.forEach((value, key) => { if (!["authorization", "cookie", "host"].includes(key)) headers[key] = value; });
      socket.send(JSON.stringify({ kind: "request", id, method: request.method, path: proxyMatch[2] + url.search, headers, body: request.body ? encodeWireBody(await request.arrayBuffer()) : "" }));
      return response;
    }
    const streamMatch = /^\/computers\/([^/]+)\/stream(\/.*)$/.exec(url.pathname);
    if (streamMatch && request.method === "GET") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return jsonError("Expected WebSocket", 426);
      const computerId = decodeURIComponent(streamMatch[1]);
      const computerSocket = this.ctx.getWebSockets().find((candidate) => {
        const attachment = candidate.deserializeAttachment() as { kind?: string; computerId?: string } | null;
        return attachment?.kind === "computer" && attachment.computerId === computerId;
      });
      if (!computerSocket) return jsonError("Computer unavailable", 503);
      const pair = new WebSocketPair(); const [client, server] = Object.values(pair); const subscriptionId = crypto.randomUUID();
      this.ctx.acceptWebSocket(server); server.serializeAttachment({ kind: "proxy-stream", computerId, subscriptionId });
      computerSocket.send(JSON.stringify({ kind: "subscribe", id: subscriptionId, path: streamMatch[2] + url.search }));
      return new Response(null, { status: 101, webSocket: client });
    }
    if (request.method === "POST" && url.pathname === "/uptime") {
      const frame = uptimeCheckFrameSchema.parse(await request.json());
      await this.ctx.storage.put("uptime.latest", frame);
      return new Response(null, { status: 204 });
    }
    if (request.method === "POST" && url.pathname === "/board/sync") {
      const input = await request.json() as { events: unknown[]; version: Record<string, number> };
      const rows=input.events.map(v=>boardLogEventSchema.parse(v));
      if(rows.some(e=>!["project","ticket"].includes(e.entity)))return jsonError("Agents and their memories stay in your organization’s Inbox.",403);
      if(!org || !user)return jsonError("Tasks access is unavailable.",403);
      const access=new BoardAccess(new D1OrganizationStore(this.env.DB),this.board,org,user);
      for(const e of rows)if(e.entity==="ticket") {const existing=await this.board.detail("tickets",e.entityId);if(existing && !await access.canRead(existing))return jsonError("Ticket not found.",404);const assigned=e.payload.assigneeAgentId??e.payload.toAgentId;if(assigned && !["you","workspace"].includes(String(assigned)))return jsonError("Assign organization agents from Inbox.",403);}
      await this.board.mergeRemote(rows);
      const outgoing=await this.board.eventsSince(input.version,500,true);
      return Response.json({events:outgoing.filter(e=>["project","ticket"].includes(e.entity)),version:await this.board.versionVector()});
    }
    if (request.method === "POST" && url.pathname === "/board/append") {
      const input = await body<{ input?: unknown; actor?: unknown }>(request);
      const actor = boardActorSchema.safeParse(input?.actor);
      if (!actor.success) return jsonError("Invalid board actor", 400);
      try {
        const parsed = boardAppendInputSchema.parse(input?.input);
        if (org && user && !await new BoardAccess(new D1OrganizationStore(this.env.DB), this.board, org, user).canWrite(parsed)) return jsonError("Ticket not found.", 404);
        if(parsed.entity==="agent" && parsed.kind==="tombstone" && org) {await this.scopedAgents(org).remove(parsed.entityId,actor.data);return Response.json({ok:true},{status:201});}
        if(parsed.entity==="agent" && parsed.kind==="create" && user)parsed.payload.createdByUserId=user;
        const event=await this.board.append(parsed, actor.data);
        if(parsed.entity==="ticket" && parsed.payload.assigneeAgentId) {
          const ticket=await this.board.detail("tickets",parsed.entityId);
          if(typeof ticket?.fields.projectId==="string") this.ctx.waitUntil(this.prewarmWorkspace(ticket.fields.projectId));
        }
        return Response.json(event, { status: 201 });
      } catch {
        return jsonError("Invalid board event", 400);
      }
    }
    if (request.method === "POST" && url.pathname === "/board/merge") {
      const input = await body<{ events?: unknown }>(request);
      return Response.json(await this.board.mergeRemote(input?.events));
    }
    if (request.method === "POST" && url.pathname === "/board/events") {
      const input = await body<{ version?: unknown; limit?: unknown }>(request);
      const version = boardVersionVectorSchema.safeParse(input?.version ?? {});
      if (!version.success) return jsonError("Invalid board version", 400);
      const limit = typeof input?.limit === "number" ? input.limit : 500;
      return Response.json({ events: await this.board.eventsSince(version.data, limit), version: await this.board.versionVector() });
    }
    if (request.method === "DELETE" && url.pathname === "/board") {
      for (const socket of this.ctx.getWebSockets()) socket.close(1001, "This organization was deleted.");
      for (const state of await this.hostedService().list()) await this.hostedService().remove(state.computerId);
      await this.ctx.storage.deleteAll();
      return new Response(null, { status: 204 });
    }
    const projectionMatch = /^\/board\/projections\/(tickets|agents|memories|routines)(?:\/([^/]+))?$/.exec(url.pathname);
    if (request.method === "GET" && projectionMatch) {
      const entity = boardProjectionEntitySchema.parse(projectionMatch[1]);
      const access = org && user ? new BoardAccess(new D1OrganizationStore(this.env.DB), this.board, org, user) : undefined;
      if (!projectionMatch[2]) {
        const result = await this.board.list(entity);
        if (access) result.items = (await Promise.all(result.items.map(async (p) => await access.canRead(p) ? p : undefined))).filter((p): p is NonNullable<typeof p> => !!p);
        return Response.json({ ...result, cursor: (await this.board.liveFramesAfter()).cursor });
      }
      const projection = await this.board.detail(entity, decodeURIComponent(projectionMatch[2]));
      return projection && (!access || await access.canRead(projection)) ? Response.json(projection) : jsonError("Not found", 404);
    }
    if (request.method === "GET" && url.pathname === "/board/live") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return jsonError("Expected WebSocket", 426);
      const rawCursor = url.searchParams.get("cursor");
      const cursor = rawCursor === null ? undefined : Number(rawCursor);
      if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 0)) return jsonError("Invalid cursor", 400);
      const replay = await this.board.liveFramesAfter(cursor);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ kind: "board", cursor: replay.cursor, userId: user, sessionId: request.headers.get("x-session-id") });
      if (user) await this.sendOrganizationReset(server, replay.cursor);
      else for (const frame of replay.frames) server.send(JSON.stringify(frame));
      return new Response(null, { status: 101, webSocket: client });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  private readonly computerMessages = new WeakMap<WebSocket, Promise<void>>();
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const pending = (this.computerMessages.get(socket) ?? Promise.resolve()).then(() => this.handleSocketMessage(socket, message));
    this.computerMessages.set(socket, pending.catch(() => { socket.close(1011, "Reconnect to continue."); }));
    await pending;
  }

  private async handleSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string" && new TextEncoder().encode(message).byteLength > 256_000) { socket.close(1009, "Send a smaller update."); return; }
    if (message === "ping") { socket.send("pong"); return; }
    const attachment = socket.deserializeAttachment() as { kind?: string; computerId?: string; minimumDaemonVersion?: string; ready?: boolean } | null;
    if (attachment?.kind !== "computer" || !attachment.computerId || typeof message !== "string") return;
    let frame: ReturnType<typeof computerToHubFrameSchema.parse>;
    try { frame = computerToHubFrameSchema.parse(JSON.parse(message)); } catch { socket.close(1003, "Invalid computer frame."); return; }
    const organizationId = String((await this.ctx.storage.get<string>("organizationId")) ?? "");
    const registeredOrg = await this.ctx.storage.get<string>("organizationId");
    if (!registeredOrg || !await this.computers.computer(registeredOrg, attachment.computerId)) { socket.close(1008, "This computer was removed."); return; }
    if (frame.kind === "hello") {
      if (frame.protocolVersion !== COMPUTER_PROTOCOL_VERSION || versionBefore(frame.daemonVersion, attachment.minimumDaemonVersion ?? "0.1.0")) {
        socket.send(JSON.stringify({ kind: "update_required", minimumDaemonVersion: attachment.minimumDaemonVersion ?? "0.1.0" }));
        socket.close(1008, "Update Remy to reconnect.");
        return;
      }
      const now = Date.now();
      socket.serializeAttachment({ ...attachment, ready: true, boardSync: frame.boardSync === true, lastSeenAt: now });
      await this.cleanAgentThreads();
      if (organizationId) await this.computers.seen(organizationId, attachment.computerId, now, frame.capabilities, frame.daemonVersion);
      this.invalidateComputers();
      return;
    }
    if (!attachment.ready) { socket.close(1008, "Introduce this computer first."); return; }
    if (this.computerSocket(attachment.computerId) !== socket) return;
    if (frame.kind === "notification") {
      const recipients = await this.notifications.raise(registeredOrg, attachment.computerId, frame.notification);
      if (!recipients) return;
      socket.send(JSON.stringify({ kind: "notification.ack", id: frame.notification.id }));
      for (const userId of recipients) this.invalidateNotifications(userId);
      await this.scheduleAlarm(Date.now() + 1_000);
      return;
    }
    if (frame.kind === "thread.snapshot") {
      if (frame.snapshot.access.organizationId !== organizationId) { socket.close(1008, "Invalid organization."); return; }
      await this.threads.snapshot(attachment.computerId, frame.snapshot);
      const running=(await this.threads.list()).some(t=>t.computerId===attachment.computerId && ["working","running","busy","needs_input"].includes(String(t.detail.state)));
      await this.hostedService().activity(attachment.computerId,running,frame.snapshot.detail.entries.some(e=>e.kind==="assistant"));
      return;
    }
    if (frame.kind === "thread.manifest") { await this.threads.manifest(attachment.computerId, frame.ids); return; }
    if (frame.kind === "heartbeat") {
      const now = Date.now();
      socket.serializeAttachment({ ...attachment, lastSeenAt: now });
      if (organizationId) await this.computers.seen(organizationId, attachment.computerId, now);
      await this.scheduleAlarm(now + COMPUTER_HEARTBEAT_TIMEOUT_MS);
      return;
    }
    if (frame.kind === "response") {
      const pending = this.pending.get(frame.id);
      if (!pending || pending.computerId !== attachment.computerId) return;
      clearTimeout(pending.timer);
      this.pending.delete(frame.id);
      const binary = decodeWireBody(frame.body);
      pending.resolve(new Response([204, 205, 304].includes(frame.status) ? null : binary, { status: frame.status, headers: frame.headers }));
    }
    if (frame.kind === "stream" || frame.kind === "stream.end") {
      const subscriber = this.ctx.getWebSockets().find((candidate) => (() => { const meta = candidate.deserializeAttachment() as { subscriptionId?: string; computerId?: string } | null; return meta?.subscriptionId === frame.id && meta.computerId === attachment.computerId; })());
      if (!subscriber) return;
      if (frame.kind === "stream") subscriber.send(frame.payload);
      else subscriber.close(1000, frame.reason ?? "Stream ended.");
    }
  }

  private computerSocket(computerId: string): WebSocket | undefined {
    return this.ctx.getWebSockets().find((socket) => {
      const meta = socket.deserializeAttachment() as { kind?: string; computerId?: string; ready?: boolean; lastSeenAt?: number } | null;
      return meta?.kind === "computer" && meta.ready && meta.computerId === computerId && Date.now() - (meta.lastSeenAt ?? 0) <= COMPUTER_HEARTBEAT_TIMEOUT_MS && socket.readyState === 1;
    });
  }

  private async computerOffline(socket: WebSocket): Promise<void> {
    const meta = socket.deserializeAttachment() as { kind?: string; computerId?: string } | null;
    if (meta?.kind !== "computer" || !meta.computerId) return;
    const newer = this.computerSocket(meta.computerId);
    if (newer && newer !== socket) return;
    const org = await this.ctx.storage.get<string>("organizationId");
    if (org) await this.computers.seen(org, meta.computerId, 0);
    await this.threads.offline(meta.computerId);
    this.invalidateComputers();
    for (const [id, pending] of this.pending) if (pending.computerId === meta.computerId) {
      clearTimeout(pending.timer); this.pending.delete(id); pending.resolve(jsonError("This computer is offline; try again when it reconnects.", 503));
    }
  }

  private invalidateNotifications(userId?: string): void {
    for (const socket of this.ctx.getWebSockets()) {
      const meta = socket.deserializeAttachment() as { kind?: string; userId?: string } | null;
      if (meta?.kind === "notifications" && (!userId || meta.userId === userId)) {
        try { socket.send(JSON.stringify({ kind: "reset" })); } catch { socket.close(); }
      }
    }
  }

  private invalidateComputers(): void {
    this.invalidateNotifications();
    for (const socket of this.ctx.getWebSockets()) {
      const kind = (socket.deserializeAttachment() as { kind?: string } | null)?.kind;
      if (kind === "computers" || kind === "threads") {
        try { socket.send(JSON.stringify({ kind: "reset", cursor: 0 })); } catch { socket.close(); }
      }
    }
  }

  private scopedAgents(org:string) {return new ScopedAgents(this.board,new DurableBoardStorage(this.ctx.storage),new D1OrganizationStore(this.env.DB),org);}

  private async prewarmWorkspace(workspaceId:string):Promise<void> {
    const org=await this.ctx.storage.get<string>("organizationId");if(!org || !await new D1OrganizationStore(this.env.DB).workspace(org,workspaceId))return;
    const settings=await new HostedSettingsStore(this.env.DB,()=>this.env.AUTH_SECRET.get()).settings(org,workspaceId);
    if(!settings.enabled)return;
    try{await this.hostedService().ensure(workspaceId,settings);}catch{}finally{this.invalidateComputers();await this.scheduleAlarm(Date.now()+60_000);}
  }

  private hostedService(): HostedLifecycle {
    if(this.hosted) return this.hosted;
    const settings=new HostedSettingsStore(this.env.DB,()=>this.env.AUTH_SECRET.get());
    this.hosted=new HostedLifecycle(new DurableBoardStorage(this.ctx.storage),id=>{
      if(!this.env.HOSTED_CONTROL_URL || !this.env.HOSTED_CONTROL_TOKEN) throw new Error("Hosted computers are not configured.");
      return new HttpRuntimeProvider(id,this.env.HOSTED_CONTROL_URL,()=>this.env.HOSTED_CONTROL_TOKEN!.get());
    }, async state=>{
      const org=(await this.ctx.storage.get<string>("organizationId"))!;
      const workspace=await new D1OrganizationStore(this.env.DB).workspace(org,state.workspaceId);
      if(!workspace || !this.env.HOSTED_IMAGE) throw new Error("Hosted workspace unavailable.");
      const encoded=(buffer:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
      let keys=await this.ctx.storage.get<{publicKey:string;privateKey:string}>(`hosted-key:${state.computerId}`);
      if(!keys){const pair=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]) as CryptoKeyPair;keys={publicKey:encoded(await crypto.subtle.exportKey("spki",pair.publicKey)),privateKey:encoded(await crypto.subtle.exportKey("pkcs8",pair.privateKey))};await this.ctx.storage.put(`hosted-key:${state.computerId}`,keys);}
      const now=Date.now();
      const registration={computerId:state.computerId,organizationId:org,ownerUserId:null,ownership:"hosted" as const,name:`Hosted ${workspace.name}`,icon:"cloud",platform:"linux" as const,daemonVersion:this.env.MINIMUM_DAEMON_VERSION??"0.1.0",protocol:{minimum:1,maximum:1},publicKey:keys.publicKey,capabilities:{providers:[],workspaces:[{id:workspace.id,name:workspace.name,path:"/workspace",origin:workspace.origin}],worktrees:true,terminals:true,emulator:false},access:{mode:"organization" as const,userIds:[],teamIds:[]},registeredAt:now,updatedAt:now};
      if(!await this.computers.computer(org,state.computerId)) await this.computers.register({...registration,lastSeenAt:null});
      await this.env.DB.prepare("INSERT INTO hosted_workspace_bindings(computer_id,organization_id,workspace_id) VALUES(?,?,?) ON CONFLICT(computer_id) DO NOTHING").bind(state.computerId,org,state.workspaceId).run();
      const actual=await this.computers.computer(org,state.computerId);
      const environment={...await settings.secrets(org),MC_CONFIG_DIR:"/data/remy",REMY_HOSTED_BOOTSTRAP:JSON.stringify({registration:{...actual,hubUrl:this.env.BETTER_AUTH_URL},privateKey:keys.privateKey,workspace:{id:workspace.id,name:workspace.name,origin:workspace.origin}})};
      const domains=[new URL(this.env.BETTER_AUTH_URL).hostname,"api.anthropic.com","api.openai.com","github.com","api.github.com","objects.githubusercontent.com","release-assets.githubusercontent.com","registry.npmjs.org"];
      return {organizationId:org,computerId:state.computerId,settings:state.settings,image:this.env.HOSTED_IMAGE,archive:this.env.HOSTED_ARCHIVE??"",environment,allowedDomains:domains};
    }, async id=>{
      for(let attempt=0;attempt<300;attempt++){if(this.computerSocket(id))return;await new Promise(resolve=>setTimeout(resolve,100));}
      throw new Error("Hosted computer did not connect.");
    }, Date.now, id => !!this.computerSocket(id));return this.hosted;
  }

  private computerService(): ComputerService {
    return new ComputerService(this.computers, Date.now, this.env.MINIMUM_DAEMON_VERSION ?? "0.1.0", new D1OrganizationStore(this.env.DB));
  }

  private async cleanAgentThreads() {
    for(const [key,run] of await this.ctx.storage.list<{agentId:string;computerId:string}>({prefix:"agent-run:"})) {
      if(await this.board.detail("agents",run.agentId))continue;
      const id=key.slice("agent-run:".length);
      this.computerSocket(run.computerId)?.send(JSON.stringify({kind:"agent.deleted",threadIds:[id]}));
    }
  }
  private async canReadAgentThread(id:string,userId:string):Promise<boolean> {
    const run=await this.ctx.storage.get<{agentId:string}>(`agent-run:${id}`);
    if(!run)return true;
    const org=await this.ctx.storage.get<string>("organizationId");if(!org)return false;
    try{await this.scopedAgents(org).get(run.agentId,userId);return true;}catch{return false;}
  }
  private async visibleThreads(userId: string) {
    const org = await this.ctx.storage.get<string>("organizationId");
    const computers = org ? await this.computerService().list(org, userId) : [];
    const allowed = new Set(computers.filter((c) => c.canUse).map((c) => c.computerId));
    const visible = [];
    for (const thread of await this.threads.list(userId)) {
      const computer = org && await this.computers.computer(org, thread.computerId);
      if (computer && await this.canReadAgentThread(thread.id,userId) && allowed.has(thread.computerId) && await this.computerService().canReadWorkspace(computer, userId, thread.detail.cwd)) visible.push(thread);
    }
    return visible;
  }

  private async sendOrganizationReset(socket: WebSocket, cursor = 0): Promise<void> {
    const meta = socket.deserializeAttachment() as { kind?: string; userId?: string; sessionId?: string } | null;
    if (!meta || !["board", "organization"].includes(meta.kind ?? "")) return;
    const org = await this.ctx.storage.get<string>("organizationId");
    if (meta.userId) {
      const member = org && await new D1OrganizationStore(this.env.DB).membership(org, meta.userId);
      const session = (await new D1AccountStore(this.env.DB).sessionsFor(meta.userId)).find((s) => s.id === meta.sessionId);
      if (!member || !session || session.revokedAt || session.accessExpiresAt <= Date.now()) { socket.close(1008, "Sign in again."); return; }
    }
    try { socket.send(JSON.stringify({ kind: "reset", cursor, reason: "cursor_unavailable" })); } catch { socket.close(); }
  }

  private async sendThreadFrame(socket: WebSocket, frame: ThreadLiveFrame): Promise<void> {
    const meta = socket.deserializeAttachment() as { kind?: string; userId?: string; computerId?: string; threadId?: string; subscriptionId?: string; sessionId?: string } | null;
    if (meta?.kind !== "threads" || !meta.userId) return;
    const organizationId = await this.ctx.storage.get<string>("organizationId");
    if (!organizationId || !await new D1OrganizationStore(this.env.DB).membership(organizationId, meta.userId)) { socket.close(1008, "Sign in again."); return; }
    const session = (await new D1AccountStore(this.env.DB).sessionsFor(meta.userId)).find((candidate) => candidate.id === meta.sessionId);
    if (!session || session.revokedAt || session.accessExpiresAt <= Date.now()) { socket.close(1008, "Sign in again."); return; }
    if (frame.kind === "snapshot" || frame.kind === "remove") {
      const computerId = frame.kind === "snapshot" ? frame.thread.computerId : frame.computerId;
      const threadId = frame.kind === "snapshot" ? frame.thread.id : frame.threadId;
      if (meta.threadId && (meta.threadId !== threadId || meta.computerId !== computerId)) return;
      const current = await this.threads.get(computerId, threadId);
      const key = `threads:viewer:${meta.subscriptionId}:${computerId}:${threadId}`;
      const computer = await this.computers.computer(organizationId, computerId);
      if (!current || !await this.canReadAgentThread(threadId,meta.userId) || !computer || !await this.computerService().canUse(computer, meta.userId) || !canReadThread(current.access, meta.userId) || !await this.computerService().canReadWorkspace(computer, meta.userId, current.detail.cwd)) {
        if (await this.ctx.storage.get<boolean>(key)) {
          socket.send(JSON.stringify({ kind: "remove", cursor: frame.cursor, computerId, threadId }));
          await this.ctx.storage.delete(key);
        }
        return;
      }
      await this.ctx.storage.put(key, true);
      // Replays use the current access decision, never the historical visibility.
      if (frame.kind === "snapshot" && (!await this.canReadAgentThread(frame.thread.id,meta.userId) || !canReadThread(frame.thread.access, meta.userId) || !await this.computerService().canReadWorkspace(computer, meta.userId, frame.thread.detail.cwd))) return;
    }
    socket.send(JSON.stringify(frame));
  }

  private async publishThreadFrame(frame: ThreadLiveFrame): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      try { await this.sendThreadFrame(socket, frame); } catch { socket.close(1011, "Reconnect to continue reading this thread."); }
    }
  }

  private async threadRequest(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    const match = /^\/computers\/([^/]+)\/threads(?:\/([0-9a-f-]{36})(?:\/(join|message|approval|question|interrupt|stop|visibility|attachments)(?:\/([0-9a-f-]{36}))?)?)?$/.exec(url.pathname);
    if (!match && url.pathname !== "/threads" && url.pathname !== "/threads/live") return undefined;
    let actor: ThreadMember;
    try { actor = threadMemberSchema.parse(JSON.parse(decodeURIComponent(request.headers.get("x-thread-member") ?? "null"))); } catch { return jsonError("Sign in again.", 401); }
    const computerId = match ? decodeURIComponent(match[1]) : undefined;
    const id = match?.[2]; const action = match?.[3]; const attachmentId = match?.[4];
    if (url.pathname === "/threads" && request.method === "GET") {
      const cursor = (await this.threads.replay()).cursor;
      const threads = await this.visibleThreads(actor.id);
      return Response.json({ threads: threads.map((thread) => ({ ...thread, stale: thread.stale || !this.computerSocket(thread.computerId) })), cursor, member: actor });
    }
    if (url.pathname === "/threads/live" && request.method === "GET") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return jsonError("Open a WebSocket connection.", 426);
      const rawCursor = url.searchParams.get("cursor"); const cursor = rawCursor === null ? undefined : Number(rawCursor);
      if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 0)) return jsonError("Reconnect to continue reading this thread.", 400);
      const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      const subscriptionId = crypto.randomUUID();
      server.serializeAttachment({ kind: "threads", userId: actor.id, sessionId: request.headers.get("x-thread-session"), subscriptionId, computerId: url.searchParams.get("computerId"), threadId: url.searchParams.get("threadId") });
      for (const thread of await this.visibleThreads(actor.id)) await this.ctx.storage.put(`threads:viewer:${subscriptionId}:${thread.computerId}:${thread.id}`, true);
      const replay = await this.threads.replay(cursor);
      for (const frame of replay.frames) await this.sendThreadFrame(server, frame);
      server.send(JSON.stringify({ kind: "ready", cursor: replay.cursor }));
      return new Response(null, { status: 101, webSocket: client });
    }
    if (!computerId) return jsonError("This action is not available.", 404);
    let target;
    try { target = await this.computerService().requireUse(request.headers.get("x-organization-id")!, computerId, actor.id); } catch { return jsonError("This computer is not available to you.", 404); }
    const snapshot = id ? await this.threads.get(computerId, id) : undefined;
    if (id && (!await this.canReadAgentThread(id,actor.id) || !snapshot || !canReadThread(snapshot.access, actor.id) || !await this.computerService().canReadWorkspace(target, actor.id, snapshot.detail.cwd))) return jsonError("This thread is no longer available.", 404);
    if (id && !action && request.method === "GET" && !this.computerSocket(computerId)) return Response.json({ ...snapshot!, stale: true, member: actor });
    if (id && action !== "join" && request.method !== "GET" && !canWriteThread(snapshot!.access, actor.id)) return jsonError("Join this thread before replying.", 403);
    if (action === "attachments" && id) {
      const org = request.headers.get("x-organization-id")!;
      const prefix = `thread-attachments/${encodeURIComponent(org)}/${encodeURIComponent(computerId)}/${id}/`;
      if (attachmentId && request.method === "GET") {
        const object = await this.env.OBJECTS.get(prefix + attachmentId);
        if (!object) return jsonError("This image is no longer available.", 404);
        return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType ?? "application/octet-stream", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
      }
      if (!attachmentId && request.method === "POST") {
        if (!this.computerSocket(computerId)) return jsonError("This computer is offline; try again when it reconnects.", 503);
        const contentType = request.headers.get("content-type") ?? "";
        if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(contentType)) return jsonError("Choose a PNG, JPEG, GIF, or WebP image.", 400);
        const data = await limitedBody(request, 10 * 1024 * 1024);
        if (!data || !data.byteLength) return jsonError("Choose an image smaller than 10 MB.", 413);
        const attachment = crypto.randomUUID();
        await this.env.OBJECTS.put(prefix + attachment, data, { httpMetadata: { contentType }, customMetadata: { name: (request.headers.get("x-filename") ?? "image").replace(/[\r\n]/g, "").slice(0, 120) } });
        return Response.json({ id: attachment }, { status: 201 });
      }
      return jsonError("This action is not available.", 404);
    }
    const allowed = id ? ((request.method === "GET" || request.method === "PATCH") && !action) || (request.method === "POST" && !!action) : request.method === "POST";
    if (!allowed) return jsonError("This action is not available.", 404);
    const socket = this.computerSocket(computerId);
    if (!socket) return jsonError("This computer is offline; try again when it reconnects.", 503);
    const payload = await limitedBody(request, 96_000);
    if (!payload) return jsonError("Send a shorter message.", 413);
    if (!id) {
      let input;
      try { input = JSON.parse(new TextDecoder().decode(payload)); } catch { return jsonError("Choose a workspace.", 400); }
      if (typeof input.workspaceId !== "string" || !await this.computerService().canUseWorkspace(target, actor.id, input.workspaceId)) return jsonError("This workspace is not available to you.", 404);
    }
    const requestId = crypto.randomUUID();
    const response = new Promise<Response>((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); resolve(jsonError("This computer did not answer; check the thread before retrying.", 504)); }, 30_000);
      this.pending.set(requestId, { computerId, resolve, timer });
    });
    socket.send(JSON.stringify({ kind: "request", id: requestId, method: request.method, path: `/hub/threads${id ? `/${id}` : ""}${action ? `/${action}` : ""}`, headers: {}, actor, body: encodeWireBody(payload) }));
    const answer = await response;
    if (answer.ok) {
      const updated = threadSnapshotSchema.safeParse(await answer.clone().json());
      if (updated.success && updated.data.access.organizationId === request.headers.get("x-organization-id")) await this.threads.snapshot(computerId, updated.data);
    }
    return answer;
  }

  private async scheduleAlarm(at: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || at < current) await this.ctx.storage.setAlarm(at);
  }

  async alarm(): Promise<void> {
    await this.hostedService().idle();
    const hostedDue=(await this.hostedService().list()).length ? Date.now()+60_000 : undefined;

    const notificationOrg = await this.ctx.storage.get<string>("organizationId");
    if (notificationOrg) await this.notifications.deliver(notificationOrg, this.env);
    const now = Date.now();
    const pushDue = notificationOrg ? await this.env.DB.prepare("SELECT MIN(next_attempt_at) AS due FROM notification_pushes WHERE organization_id=?").bind(notificationOrg).first<{ due: number | null }>() : null;
    let next: number | undefined = pushDue?.due ? Math.max(Date.now() + 1000, pushDue.due) : undefined;
    if(hostedDue) next=Math.min(next ?? hostedDue,hostedDue);
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as { kind?: string; lastSeenAt?: number } | null;
      if (attachment?.kind !== "computer" || !attachment.lastSeenAt) continue;
      const expiresAt = attachment.lastSeenAt + COMPUTER_HEARTBEAT_TIMEOUT_MS;
      if (expiresAt <= now) { await this.computerOffline(socket); socket.close(1001, "Heartbeat missed."); }
      else next = Math.min(next ?? expiresAt, expiresAt);
    }
    if (next) await this.ctx.storage.setAlarm(next);
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    const attachment = socket.deserializeAttachment() as { kind?: string; computerId?: string; subscriptionId?: string } | null;
    if (attachment?.kind === "threads" && attachment.subscriptionId) {
      const keys = [...(await this.ctx.storage.list({ prefix: `threads:viewer:${attachment.subscriptionId}:` })).keys()];
      if (keys.length) await this.ctx.storage.delete(keys);
    }
    if (attachment?.kind === "proxy-stream" && attachment.computerId && attachment.subscriptionId) {
      const computer = this.ctx.getWebSockets().find((candidate) => (candidate.deserializeAttachment() as { computerId?: string } | null)?.computerId === attachment.computerId);
      computer?.send(JSON.stringify({ kind: "unsubscribe", id: attachment.subscriptionId }));
    }
    await this.computerOffline(socket);
    socket.close(code, reason);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.computerOffline(socket);
    socket.close(1011, "Live updates stopped; reconnect to continue.");
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
