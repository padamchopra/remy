import { validProfileImage } from "./profile-image.js";
import { HostedStartupError } from "./hosted-startup-error.js";
import { modelDefaults } from "./model-defaults.js";
import { modelFavorites } from "./model-favorites.js";
import { hostedGatewayError, hostedStartChoice, modelAccessIds, publicModelAccess, removeNamedModelKey, saveModelAccess, saveNamedModelKey, type ModelAccessId } from "./model-access.js";
import { routerConnectionSchema, routerModels } from "./router-connection.js";
import { CLOUD_COMPUTER_PROVIDERS, CURSOR_CLOUD_COMPUTER_ID, cloudComputerProvider, isCursorCloudProvider, isGuestCloudProvider, type HostedSettings } from "@remy/contract";
import { managementCredential } from "./cloud-connection.js";
import { cloudToggleSchema, cloudConnectionForKey, cloudConnectionSchema, cloudConnectionKey, modelSecrets, publicCloudKeys, publicProviderKeys, removeNamedCloudKey, saveNamedCloudKey } from "./cloud-connection.js";
import { CursorCloudThreads, verifyCursorCloudKey } from "./cursor-cloud.js";
import { allowedRequestOrigin } from "./request-origin.js";
import { emailAvailable, sendAccountEmail, type AccountEmail } from "./email.js";
import { EnvironmentError, EnvironmentStore } from "./environments.js";
import { ComputerModelKeyStore, computerModelKeyName, computerModelKeyWrite, publicComputerModelKeys } from "./computer-model-keys.js";
import { ComputerAccountStore } from "./computer-accounts.js";
import { cancelClaudeAccount, claudeAccountStatus, claudeComputerEnvironment, completeClaudeAccount, logoutClaudeAccount, startClaudeAccount } from "./claude-account.js";
import { encodeComputerConnectionKey } from "@remy/contract";
import { personalSpace } from "./personal-space.js";
import { ChatGPTAccounts, RECONNECT_CODEX, chatgptConnected, chatgptEnabled, isChatGPTModel } from "./chatgpt-account.js";
import { OWN_MODEL_CLOUD_ONLY, OWN_MODEL_THREAD, OwnModelAccessError, isOwnKeyProvider, isOwnModelId, ownModelAccess, ownModelEnvironment, ownModelError, ownModelSecrets, setOwnModelAccess, type OwnModelTask } from "./own-model-access.js";
import {linearAccountRoute, linearAccountsFor} from "./linear-routes.js";
import { githubFor, githubRoute } from "./github-routes.js";
import { connectionRoute, connectionWebhook, isGitHubConnectionCallback } from "./connection-routes.js";
import { connectionProviders } from "./connection-providers.js";
import { ConnectionError, type ConnectionDelivery, type ConnectionJob } from "./connections.js";
import { chooseComputer } from "./computer-choice.js";
import { advertisedCloudProvidersFor, advertisedProviderIds, parseStartProviderInput, parseStartProviders, providersFromCapabilities, publicStartProviders, serializeStartProviders, START_PROVIDER_DENIED } from "./computer-start-access.js";
import { GitCapabilities, GithubInstallation, githubRepository, proxyGit } from "./hosted-git.js";
import { HostedSettingsStore } from "./hosted-settings.js";
import { HostedLifecycle } from "./hosted-lifecycle.js";
import { hostedComputerName } from "./hosted-computer-name.js";
import { threadStartProgress, type ManualThreadStart } from "./thread-start-progress.js";
import { HttpRuntimeProvider } from "./computer-runtime.js";
import { hostedSettingsSchema } from "@remy/contract";
import { HubNotifications, type ApplePushConfig } from "./notifications.js";
import { canReadThread, canWriteThread, threadMemberSchema, threadSnapshotSchema, type ThreadLiveFrame, type ThreadMember } from "@remy/contract";
import { ThreadStore } from "./thread-store.js";
import {
  CONTRACT_VERSION,
  COMPUTER_HEARTBEAT_INTERVAL_MS,
  COMPUTER_HEARTBEAT_TIMEOUT_MS,
  COMPUTER_PROTOCOL_VERSION,
  THREAD_MESSAGE_MAX_CHARACTERS,
  THREAD_REQUEST_MAX_BYTES,
  computerRegistrationSchema,
  computerRegistrationInputSchema,
  computerAccessSchema,
  computerToHubFrameSchema,
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
import { developmentBridge } from "./development-bridge.js";
import { D1ComputerStore, type ComputerStore } from "./computer-store.js";
import { ComputerService, versionBefore } from "./computers.js";
import { D1OrganizationStore, type OrganizationStore } from "./organization-store.js";
import { clearRetiredTasks, DurableStorage } from "./durable-storage.js";
import { repositoryOrigin, OrganizationError, OrganizationService } from "./organizations.js";
import { codeReferencesError } from "./code-references.js";
import { ReviewAgent } from "./review-agent.js";
import { reviewRequest, reviewRulesRoute } from "./review-routes.js";
import { hubReviewSchema, reviewStartSchema, type HubReview } from "@remy/contract";

export interface Env extends ApplePushConfig {
  ASSETS?: Fetcher;
  WEB_APP_URL?: string;
  PREVIEW_ORIGINS?: string;
  DEVELOPMENT_COMPUTER_IDS?: string;
  /// Only the local development launcher supplies this in-process connection.
  DEVELOPMENT_EXECUTION?: Fetcher;
  PROVIDER_RUNTIME?: DurableObjectNamespace;
  HOSTED_CONTROL_URL?: string;
  HOSTED_CONTROL_TOKEN?: SecretsStoreSecret;
  HOSTED_IMAGE?: string;
  GITHUB_CONNECTION_CLIENT_ID?: string;
  GITHUB_CONNECTION_CLIENT_SECRET?: SecretsStoreSecret;
  GITHUB_WEBHOOK_SECRET?: SecretsStoreSecret;
  LINEAR_CLIENT_ID?: string;
  LINEAR_CLIENT_SECRET?: SecretsStoreSecret;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: SecretsStoreSecret;
  HOSTED_ARCHIVE?: string;
  AUTH_SECRET: SecretsStoreSecret;
  BETTER_AUTH_URL: string;
  COORDINATOR: DurableObjectNamespace;
  DB: D1Database;
  EMAIL?: SendEmail;
  EMAIL_FROM?: string;
  EMAILS?: Queue<AccountEmail>;
  ENVIRONMENT: HubEnvironment;
  JOBS: Queue<UptimeCheckFrame | ConnectionJob>;
  OBJECTS: R2Bucket;
  RELEASE: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string | SecretsStoreSecret;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string | SecretsStoreSecret;
  MINIMUM_DAEMON_VERSION?: string;
  /// Only the disposable QA hub points this at a fake OpenAI auth server.
  CHATGPT_AUTH_ISSUER?: string;
}

type LogEvent = RequestOutcome | HubErrorEvent;
type ManualThreadStartCommand = {
  actor: ThreadMember;
  workspaceId: string;
  requestId: string;
  message: string;
  title?: string;
  computerId?: string | null;
  branch?: string;
  visibility?: string;
  provider?: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  review?: HubReview;
  chatgpt?: boolean;
  ownModel?: OwnModelTask;
  cloudTask?: CloudConnectionTask;
};
type DurableManualThreadStart = ManualThreadStart & {
  command: ManualThreadStartCommand;
  reviewRecorded?: boolean;
};
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

function storedIds(value: string | null): string[] | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed : [];
  } catch { return []; }
}

function selectedPublicKeys(keys: { id: string; name: string; active: boolean }[], saved: string | null) {
  const ids = storedIds(saved);
  if (ids) return keys.map((key) => ({ ...key, selected: ids.includes(key.id) }));
  const active = keys.find((key) => key.active) ?? keys[0];
  return keys.map((key) => ({ ...key, selected: key.id === active?.id }));
}

type CloudConnectionTask = { sourceOrganizationId: string; provider: HostedSettings["provider"]; keyId: string };
function cloudConnectionTask(id: string | null | undefined): CloudConnectionTask | undefined {
  const provider = cloudComputerProvider(id);
  if (!provider || !id?.startsWith(`cloud:${provider}:`)) return;
  const rest = id.slice(`cloud:${provider}:`.length);
  const split = rest.indexOf(":");
  if (split < 1 || split === rest.length - 1) return;
  return { provider, sourceOrganizationId: rest.slice(0, split), keyId: rest.slice(split + 1) };
}

async function cloudTaskConnection(db: D1Database, settings: HostedSettingsStore, org: string, userId: string, task: CloudConnectionTask) {
  const personal = await personalSpace(db, userId);
  const direct = task.sourceOrganizationId === personal.id || task.sourceOrganizationId === org;
  if (!direct) {
    const share = await db.prepare("SELECT key_ids FROM organization_cloud_shares WHERE organization_id=? AND source_organization_id=? AND provider=?")
      .bind(org, task.sourceOrganizationId, task.provider).first<{ key_ids: string | null }>();
    if (!share) return;
    const sourceSecrets = await settings.secrets(task.sourceOrganizationId);
    const selected = selectedPublicKeys(publicCloudKeys(task.provider, sourceSecrets), share.key_ids).filter((key) => key.selected);
    if (!selected.some((key) => key.id === task.keyId)) return;
  }
  const secrets = await settings.secrets(task.sourceOrganizationId);
  const connection = cloudConnectionForKey(task.provider, secrets, task.keyId);
  return connection?.enabled ? connection : undefined;
}

async function cloudStartGrant(
  settings: HostedSettingsStore,
  org: string,
  provider: HostedSettings["provider"],
  userId: string,
) {
  if (await settings.ownConnection(org, provider)) {
    return { owner: true, available: true, advertised: [], stored: null };
  }
  const share = await settings.cloudShare(org, provider);
  if (!share) return { owner: false, available: false, advertised: [], stored: null };
  return {
    owner: share.shared_by === userId,
    available: true,
    advertised: [],
    stored: null,
  };
}

async function cursorCloudApiKey(
  db: D1Database,
  settings: HostedSettingsStore,
  org: string,
  userId?: string,
  task?: CloudConnectionTask,
): Promise<string | undefined> {
  const connection = task && userId
    ? await cloudTaskConnection(db, settings, org, userId, task)
    : await settings.connection(org, "cursor-cloud");
  return connection?.provider === "cursor-cloud" && connection.enabled ? connection.token : undefined;
}

/// What a task sends when Codex asks again after a rejection: a reason, and a
/// SHA-256 of the access token that was rejected. Anything else is ignored.
function codexTokenRefresh(payload: ArrayBuffer | undefined): { reason: string; rejected?: string } | undefined {
  if (!payload?.byteLength) return;
  try {
    const input = JSON.parse(new TextDecoder().decode(payload)) as { reason?: unknown; rejected?: unknown };
    if (typeof input.reason !== "string" || input.reason.length > 64) return;
    return { reason: input.reason, ...(typeof input.rejected === "string" && /^[0-9a-f]{64}$/.test(input.rejected) ? { rejected: input.rejected } : {}) };
  } catch { return; }
}

/// Any member of an organization with a cloud computer can run the threads
/// they start on their own ChatGPT sign-in.
async function chatgptReady(db: D1Database, org: string, userId: string) {
  return await chatgptConnected(db, userId) && await chatgptEnabled(db, org, userId);
}
const CHATGPT_SIGN_IN = "Sign in to ChatGPT in Personal model access.";
const CHATGPT_THREAD = "This thread’s starter is no longer signed in to ChatGPT. Choose a model with an API key.";

async function canStartOnCloud(
  settings: HostedSettingsStore,
  org: string,
  userId: string,
  provider: HostedSettings["provider"],
  runtimeProvider?: string,
  model?: string,
) {
  const grant = await cloudStartGrant(settings, org, provider, userId);
  if (!grant.available) return false;
  if (provider === "cursor-cloud") return !runtimeProvider || runtimeProvider === "cursor";
  return true;
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

/// What a connected computer running an older daemon answers Connect Codex with.
export const CODEX_NEEDS_UPDATE = "Run remy update on this computer, then connect Codex again.";
const REVIEW_ON_CURSOR_CLOUD = "A review agent needs Remy's tools, which Cursor Cloud threads do not have. Choose another computer.";

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

  if ((url.pathname === "/api/auth/sign-in/magic-link" || url.pathname === "/api/auth/sign-in/email" || url.pathname === "/api/auth/sign-up/email") && request.method === "POST") {
    const cloned = request.clone();
    const input = await body<{ email?: string }>(cloned);
    const domain = typeof input?.email === "string" ? domainOf(input.email) : undefined;
    const policy = domain ? await store.ssoPolicyForDomain(domain) : undefined;
    if (policy?.enforced && policy.verified) {
      return Response.json({ error: "Use your organization’s single sign-on.", providerId: policy.providerId }, { status: 403 });
    }
  }
  if (env.WEB_APP_URL && url.origin !== new URL(env.WEB_APP_URL).origin && /^\/api\/auth\/(callback\/(google|github)|magic-link\/verify|verify-email)$/.test(url.pathname)) return Response.redirect(new URL(`${url.pathname}${url.search}`, env.WEB_APP_URL), 307);
  if (url.pathname.startsWith("/api/auth/") && !isGitHubConnectionCallback(url)) {
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

  if (url.pathname === "/api/runtime" && request.method === "GET") return Response.json({ mode: "hub", auth: { magicLink: emailAvailable(env), google: !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET, github: !!env.GITHUB_CLIENT_ID && !!env.GITHUB_CLIENT_SECRET, sso: true, password: true } }, { headers: { "cache-control": "no-store" } });
  const protectedRoute = isGitHubConnectionCallback(url)
    || url.pathname.startsWith("/api/development/")
    || url.pathname === "/api/device/approve"
    || url.pathname === "/api/sessions"
    || url.pathname === "/api/sessions/revoke-all"
    || url.pathname === "/api/profile"
    || url.pathname === "/api/review-rules"
    || /^\/api\/review-rules\/[^/]+$/.test(url.pathname)
    || url.pathname === "/api/personal"
    || url.pathname === "/api/chatgpt-account"
    || url.pathname.startsWith("/api/chatgpt-account/")
    || /^\/api\/sessions\/[^/]+$/.test(url.pathname)
    || url.pathname === "/api/invitations/accept"
    || url.pathname === "/api/invitations/preview"
    || url.pathname === "/api/organizations"
    || url.pathname.startsWith("/api/organizations/")
    || url.pathname.startsWith("/api/connections/");
  if (!protectedRoute) {
    const appOrigin = env.WEB_APP_URL ? new URL(env.WEB_APP_URL).origin : url.origin;
    if (request.method === "GET" && url.origin !== appOrigin && (url.pathname === "/app" || url.pathname.startsWith("/app/"))) return Response.redirect(new URL(`${url.pathname.slice(4) || "/"}${url.search}`, appOrigin), 302);
    if (request.method === "GET" && url.pathname === "/" && url.origin !== appOrigin && (url.searchParams.has("signin") || url.searchParams.has("invite"))) return Response.redirect(new URL(`/${url.search}`, appOrigin), 302);
    if (request.method === "GET" && /^\/invite\/[^/]+$/.test(url.pathname)) return Response.redirect(new URL(`/?invite=${encodeURIComponent(decodeURIComponent(url.pathname.slice(8)))}`, appOrigin), 302);
    if (env.ASSETS && (request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/api/")) {
      const assetUrl = new URL(request.url);
      if (env.WEB_APP_URL && url.origin === appOrigin) {
        const leaf = url.pathname.split("/").pop() ?? "";
        const appDocument = request.headers.get("accept")?.includes("text/html") || !leaf.includes(".");
        assetUrl.pathname = appDocument ? "/app/" : url.pathname.startsWith("/app/") ? url.pathname : `/app${url.pathname}`;
      }
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }
    return Response.json(hubErrorSchema.parse({ error: "Not found" }), { status: 404 });
  }

  const agentToolRoute=/^\/api\/organizations\/([^/]+)\/computers\/organization-tools\/([^/]+)$/.exec(url.pathname);
  if(agentToolRoute && request.method==="POST") {
    const org=decodeURIComponent(agentToolRoute[1]),computer=await authenticateComputer(request,org,computerStore);
    if(!computer)return jsonError("This computer cannot use organization tools.",403);
    return env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${org}`)).fetch(new Request(`https://internal/organization-tools/${agentToolRoute[2]}`,{method:"POST",headers:{"x-organization-id":org,"x-computer-id":computer.computerId,"content-type":"application/json"},body:request.body}));
  }
  const modelKeySync=/^\/api\/organizations\/([^/]+)\/computers\/model-keys$/.exec(url.pathname);
  if(modelKeySync && request.method==="POST") {
    const org=decodeURIComponent(modelKeySync[1]),computer=await authenticateComputer(request,org,computerStore);
    if(!computer)return jsonError("This computer cannot read its provider keys.",403);
    const keys=new ComputerModelKeyStore(env.DB,()=>env.AUTH_SECRET.get());
    const accounts=new ComputerAccountStore(env.DB,()=>env.AUTH_SECRET.get());
    const claude=computer.ownership==="hosted" ? {} : await claudeComputerEnvironment(accounts,computer.computerId);
    return Response.json({values:await keys.values(computer.computerId),claudeCredentials:claude.CLAUDE_CREDENTIALS_JSON??null},{headers:{"cache-control":"no-store"}});
  }
  const codexTokens=/^\/api\/organizations\/([^/]+)\/computers\/codex-tokens$/.exec(url.pathname);
  if(codexTokens && request.method==="POST") {
    const org=decodeURIComponent(codexTokens[1]),computer=await authenticateComputer(request,org,computerStore);
    if(!computer || computer.ownership!=="hosted")return jsonError("This computer cannot use Codex.",403);
    const refresh=codexTokenRefresh(await limitedBody(request,1024));
    return env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${org}`)).fetch(new Request("https://internal/codex-tokens",{method:"POST",headers:{"x-organization-id":org,"x-computer-id":computer.computerId,"content-type":"application/json"},body:JSON.stringify(refresh ?? {})}));
  }
  const gitRoute = /^\/api\/organizations\/([^/]+)\/git\/([^/]+)(?:\/(token|info\/refs|git-upload-pack|git-receive-pack))?$/.exec(url.pathname);
  if (gitRoute) {
    const org=decodeURIComponent(gitRoute[1]), workspaceId=decodeURIComponent(gitRoute[2]), action=gitRoute[3];
    const workspace=await organizationStore.workspace(org,workspaceId);
    const repository=workspace && githubRepository(workspace.origin);
    const installation=await env.DB.prepare("SELECT installation_id,account FROM organization_git_installations WHERE organization_id=?").bind(org).first<{installation_id:number;account:string}>();
    if(!repository)return jsonError("Connect this workspace to GitHub first.",404);
    const installationSelected = installation && repository.split("/")[0] === installation.account.toLowerCase() && !!await env.DB.prepare("SELECT 1 FROM github_repositories WHERE organization_id=? AND workspace_id=? AND installation_id=?").bind(org,workspaceId,installation.installation_id).first();
    const repositoryToken = async (computerId: string, write: boolean) => {
      if (installationSelected && env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY) {
        return new GithubInstallation(env.GITHUB_APP_ID, () => env.GITHUB_APP_PRIVATE_KEY!.get()).token(installation!.installation_id, repository, write);
      }
      const response = await env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${org}`)).fetch(new Request(`https://internal/internal/hosted-git-owner?computer=${encodeURIComponent(computerId)}`, {headers:{"x-organization-id":org}}));
      const owner = await response.json() as {userId?: string; workspaceId?: string};
      if (!owner.userId || owner.workspaceId !== workspaceId) throw new Error("Reconnect GitHub before starting this cloud thread.");
      return githubFor(env).workspaceGitToken(org, owner.userId, workspaceId);
    };
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
      return proxyGit(request,grant,action,()=>repositoryToken(grant.computerId,grant.write));
    }
  }
  const detachMatch = /^\/api\/organizations\/([^/]+)\/computers\/detach$/.exec(url.pathname);
  if (detachMatch && request.method === "POST") {
    const org = decodeURIComponent(detachMatch[1]);
    const computer = await authenticateComputer(request, org, computerStore);
    if (!computer) return jsonError("This computer could not be authenticated.", 401);
    await computerStore.remove(org, computer.computerId);
    await new ComputerModelKeyStore(env.DB, () => env.AUTH_SECRET.get()).forget(computer.computerId);
    await env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${org}`)).fetch(new Request("https://internal/computers/changed", { method: "POST", headers: { "x-organization-id": org, "x-removed-computer": computer.computerId } }));
    return Response.json({ ok: true });
  }
  const computerConnectMatch = /^\/api\/organizations\/([^/]+)\/computers\/connect$/.exec(url.pathname);
  if (computerConnectMatch && request.method === "GET") {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return jsonError("Open a WebSocket connection.", 426);
    const organizationId = decodeURIComponent(computerConnectMatch[1]);
    const computer = await authenticateComputer(request, organizationId, computerStore);
    if (!computer) return jsonError("This computer could not be authenticated.", 401);
    const sharedOrganizationIds = await computerStore.sharedOrganizationIds?.(organizationId, computer.computerId) ?? [];
    const coordinator = env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${organizationId}`));
    const internal = new Request("https://internal/computers/connect", {
      headers: { upgrade: "websocket", "x-computer-id": computer.computerId, "x-organization-id": organizationId, "x-minimum-daemon-version": env.MINIMUM_DAEMON_VERSION ?? "0.1.0", "x-shared-organizations": JSON.stringify(sharedOrganizationIds) },
    });
    return coordinator.fetch(internal);
  }

  const attachmentDownload = /^\/api\/organizations\/([^/]+)\/computers\/([^/]+)\/thread-attachments\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (attachmentDownload && request.method === "GET") {
    const [, org, computerId, threadId, attachmentId] = attachmentDownload;
    const organizationId = decodeURIComponent(org), decodedComputerId = decodeURIComponent(computerId);
    const stored = await computerStore.computer(organizationId, decodedComputerId);
    const computer = await authenticateComputer(request, stored?.organizationId ?? organizationId, computerStore);
    if (!computer || computer.computerId !== decodeURIComponent(computerId)) return jsonError("Image not found.", 404);
    const object = await env.OBJECTS.get(`thread-attachments/${encodeURIComponent(organizationId)}/${encodeURIComponent(computer.computerId)}/${threadId}/${attachmentId}`);
    if (!object) return jsonError("Image not found.", 404);
    return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType ?? "application/octet-stream", "content-length": String(object.size), "x-filename": object.customMetadata?.name ?? "image" } });
  }

  const developmentResponse = await developmentBridge(request, {
    allowedComputerIds: env.DEVELOPMENT_COMPUTER_IDS,
    authenticate: (incoming, org) => authenticateComputer(incoming, org, computerStore),
    bootstrap: async userId => {
      const profile = await store.profile(userId);
      if (!profile) throw new Error("Your account is unavailable.");
      const scopes = await organizations.list(userId);
      const personal = await personalSpace(env.DB, userId);
      const accounts = [personal, ...scopes.filter(scope => scope.id !== personal.id)];
      return { profile, accounts: await Promise.all(accounts.map(async account => ({...account, workspaces: await organizations.workspaces(account.id, userId)}))) };
    },
    threadAccess: async (userId, organizationId, workspaceId) => {
      const workspace = await organizations.workspace(organizationId, userId, workspaceId);
      return {
        hubEnvironment: await new EnvironmentStore(env.DB, () => env.AUTH_SECRET.get()).forThread(organizationId, workspace.id, userId),
        hubLinear: await linearAccountsFor(env).forThread(organizationId, userId),
      };
    },
  });
  if (developmentResponse) return developmentResponse;
  const webhookResponse = await connectionWebhook(request, env);
  if (webhookResponse) return webhookResponse;
  const identity = await identityFor(request, service);
  if (!identity) return jsonError("Sign in again.", 401);
  const connectionResponse = await connectionRoute(request, env, identity.userId, identity.clientKind);
  if (connectionResponse) return connectionResponse;
  const githubResponse=await githubRoute(request,env,identity.userId,identity.clientKind);if(githubResponse)return githubResponse;
  const linearAccountResponse=await linearAccountRoute(request,env,identity.userId,identity.clientKind);if(linearAccountResponse)return linearAccountResponse;
  const reviewRulesResponse=await reviewRulesRoute(request,env,identity.userId,identity.clientKind);if(reviewRulesResponse)return reviewRulesResponse;
  try {
    if (url.pathname === "/api/personal" && request.method === "GET") return Response.json({ personal: await personalSpace(env.DB, identity.userId) }, { headers: { "cache-control": "no-store" } });
    const chatgptAccount = /^\/api\/chatgpt-account(?:\/(start|cancel|logout))?$/.exec(url.pathname);
    if (chatgptAccount) {
      // Your own ChatGPT sign-in for cloud Codex. Nobody else, and no computer, can read or change it.
      if (identity.clientKind === "computer") return jsonError("Connect Codex from Remy.", 403);
      if (!(request.method === "GET" && !chatgptAccount[1]) && !(request.method === "POST" && chatgptAccount[1])) return jsonError("This account action is unavailable.", 405);
      if (request.method === "POST" && !allowedRequestOrigin(request, env.PREVIEW_ORIGINS)) return jsonError("Connect Codex from Remy.", 403);
      const response = await env.COORDINATOR.get(env.COORDINATOR.idFromName(`chatgpt:${identity.userId}`)).fetch(new Request(`https://internal/chatgpt-account/${chatgptAccount[1] ?? "status"}`, { method: "POST", headers: { "x-chatgpt-user": identity.userId } }));
      return new Response(response.body, { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    if (url.pathname === "/api/organizations" && request.method === "GET") return Response.json({ organizations: await organizations.list(identity.userId) });
    if (url.pathname === "/api/organizations" && request.method === "POST") {
      const input = await body<{ name?: string }>(request); const name = input?.name?.trim();
      if (!name || name.length > 120) return jsonError("Enter an organization name.", 400);
      const created=await organizations.create(identity.userId,name);
      await env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${created.id}`)).fetch(new Request("https://internal/organization/changed",{method:"POST",headers:{"x-organization-id":created.id}}));
      return Response.json(created,{status:201});
    }
    if (url.pathname === "/api/invitations/preview" && request.method === "POST") {
      const input = await body<{ token?: string }>(request);
      if (typeof input?.token !== "string" || !input.token) return jsonError("Open a valid invitation link.", 400);
      const profile = await store.profile(identity.userId);
      const { invite, organizationName } = await organizations.inspectInvite(input.token, profile?.verifiedEmails ?? []);
      const inviter = await store.profile(invite.createdByUserId);
      return Response.json({ organizationName, inviterName: inviter?.name ?? "An organization administrator", role: invite.role, accountName: profile?.name ?? "Your account" }, { headers: { "cache-control": "no-store" } });
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
      const organizationObject = () => env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${organizationId}`));
      if (tail === "github/profile" && request.method === "GET") {
        const github = await githubFor(env).api<{avatar_url:string}>(organizationId, identity.userId, "/user");
        const image = new URL(github.avatar_url);
        if (image.protocol !== "https:" || image.hostname !== "avatars.githubusercontent.com") return jsonError("Your GitHub picture is unavailable.", 502);
        return Response.json({ image: image.href });
      }
      if (tail === "model-defaults" && (request.method === "GET" || request.method === "PATCH")) {
        if(request.method === "PATCH" && !allowedRequestOrigin(request,env.PREVIEW_ORIGINS)) return jsonError("Open settings in Remy.",403);
        const response=await modelDefaults(env.DB,organizationId,identity.userId,request);
        if(request.method === "PATCH" && response.ok) {
          const memberships=await env.DB.prepare("SELECT organization_id FROM memberships WHERE user_id=?").bind(identity.userId).all<{organization_id:string}>();
          await Promise.all(memberships.results.map(row=>env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${row.organization_id}`)).fetch(new Request("https://internal/model-defaults/changed",{method:"POST",headers:{"x-organization-id":row.organization_id,"x-user-id":identity.userId}}))));
        }
        return response;
      }
      if (tail === "model-favorites" && (request.method === "GET" || request.method === "PATCH")) {
        await organizations.member(organizationId, identity.userId);
        const response = await modelFavorites(env.DB, organizationId, identity.userId, request);
        if (request.method === "PATCH" && response.ok) await organizationObject().fetch(new Request("https://internal/model-favorites/changed", { method: "POST", headers: { "x-organization-id": organizationId, "x-user-id": identity.userId } }));
        return response;
      }
      if (tail === "computers" && request.method === "POST") {
        await organizations.member(organizationId, identity.userId);
        if (identity.clientKind !== "computer") return jsonError("Use a computer authorization.", 403);
        const input = computerRegistrationInputSchema.safeParse(await body(request));
        if (!input.success) return jsonError("Choose valid computer details.", 400);
        const registration = await computers.register(organizationId, identity.userId, input.data);
        await organizationObject().fetch(new Request("https://internal/computers/changed", { method: "POST", headers: { "x-organization-id": organizationId } }));
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
        await organizationObject().fetch(new Request("https://internal/notifications/changed", { method: "POST", headers: { "x-organization-id": organizationId, "x-user-id": identity.userId } }));
        return Response.json({ ok: true }, { status: 201 });
      }
      const pushDevice = /^notifications\/devices\/([^/]+)$/.exec(tail);
      if (pushDevice && ["PATCH", "DELETE"].includes(request.method)) {
        await organizations.member(organizationId, identity.userId);
        if (!allowedRequestOrigin(request, env.PREVIEW_ORIGINS)) return jsonError("Open notifications in Remy.", 403);
        if (request.method === "DELETE") await env.DB.prepare("DELETE FROM member_push_devices WHERE organization_id=? AND user_id=? AND id=?").bind(organizationId, identity.userId, decodeURIComponent(pushDevice[1])).run();
        else {
          const input = await body<{ enabled?: boolean }>(request);
          if (typeof input?.enabled !== "boolean") return jsonError("Choose whether this phone receives notifications.", 400);
          await env.DB.prepare("UPDATE member_push_devices SET enabled=? WHERE organization_id=? AND user_id=? AND id=?").bind(Number(input.enabled), organizationId, identity.userId, decodeURIComponent(pushDevice[1])).run();
        }
        await organizationObject().fetch(new Request("https://internal/notifications/changed", { method: "POST", headers: { "x-organization-id": organizationId, "x-user-id": identity.userId } }));
        return Response.json({ ok: true });
      }
      if (tail === "notifications" || tail === "notifications/live" || /^notifications\/[0-9a-f-]{36}\/read$/.test(tail)) {
        await organizations.member(organizationId, identity.userId);
        if (request.method !== "GET" && !allowedRequestOrigin(request, env.PREVIEW_ORIGINS)) return jsonError("Open notifications in Remy.", 403);
        return organizationObject().fetch(new Request(`https://internal/${tail}`, { method: request.method, headers: { "x-organization-id": organizationId, "x-user-id": identity.userId, "x-session-id": identity.sessionId, upgrade: request.headers.get("upgrade") ?? "" } }));
      }
      if (tail === "chatgpt") {
        // Your own ChatGPT sign-in runs the cloud threads you start everywhere.
        await organizations.member(organizationId, identity.userId);
        if (identity.clientKind === "computer") return jsonError("Open organization settings in Remy.", 403);
        const personal = (await personalSpace(env.DB, identity.userId)).id === organizationId;
        if (request.method !== "GET") return jsonError("Your ChatGPT subscription is already available to your threads.", 405);
        const connected = await chatgptConnected(env.DB, identity.userId);
        const enabled = await chatgptEnabled(env.DB, organizationId, identity.userId);
        return Response.json({ connected, enabled, personal, available: connected && enabled }, { headers: { "cache-control": "no-store" } });
      }
      const ownModel = /^own-model-access(?:\/([^/]+))?$/.exec(tail);
      if (ownModel) {
        // Personal keys always work for their owner. These routes enroll exact
        // named keys so every member of the organization may choose them.
        await organizations.member(organizationId, identity.userId);
        if (identity.clientKind === "computer") return jsonError("Open organization settings in Remy.", 403);
        const settings = new HostedSettingsStore(env.DB, () => env.AUTH_SECRET.get());
        if (!ownModel[1]) {
          if (request.method !== "GET") return jsonError("This action is unavailable.", 405);
          return Response.json(await ownModelAccess(env.DB, settings, organizationId, identity.userId), { headers: { "cache-control": "no-store" } });
        }
        const id = decodeURIComponent(ownModel[1]);
        if (!isOwnModelId(id) || (request.method !== "PUT" && request.method !== "DELETE")) return jsonError("This model action is unavailable.", 405);
        if (!allowedRequestOrigin(request, env.PREVIEW_ORIGINS)) return jsonError("Open organization settings in Remy.", 403);
        try {
          const input = request.method === "PUT" ? await body<{ keyIds?: unknown }>(request) : undefined;
          const keyIds = input?.keyIds === undefined ? undefined : Array.isArray(input.keyIds) && input.keyIds.every((keyId) => typeof keyId === "string") ? input.keyIds : null;
          if (keyIds === null) return jsonError("Choose the keys to enroll.", 400);
          const access = await setOwnModelAccess(env.DB, settings, organizationId, identity.userId, id, request.method === "PUT", keyIds);
          await organizationObject().fetch(new Request("https://internal/computers/changed", { method: "POST", headers: { "x-organization-id": organizationId } }));
          return Response.json(access, { headers: { "cache-control": "no-store" } });
        } catch (error) {
          if (error instanceof OwnModelAccessError) return jsonError(error.message, error.status);
          throw error;
        }
      }
      if (tail === "compute-shares" && request.method === "GET") {
        const member = await organizations.member(organizationId, identity.userId);
        const personal = await personalSpace(env.DB, identity.userId);
        const ownComputers = (await computers.list(personal.id, identity.userId)).filter(computer => computer.ownerUserId === identity.userId && computer.ownership === "personal");
        const computerShares = (await env.DB.prepare(`SELECT s.computer_id,s.shared_by,s.start_providers,c.name,c.icon,c.platform,c.last_seen_at,c.capabilities,c.owner_user_id
          FROM organization_computer_shares s JOIN organization_computers c ON c.id=s.computer_id
          WHERE s.organization_id=? ORDER BY lower(c.name),c.id`).bind(organizationId).all<{computer_id:string;shared_by:string;start_providers:string|null;name:string;icon:string;platform:string;last_seen_at:number|null;capabilities:string;owner_user_id:string|null}>()).results;
        const cloudShares = (await env.DB.prepare("SELECT source_organization_id,provider,shared_by,start_providers,key_ids FROM organization_cloud_shares WHERE organization_id=? ORDER BY provider,created_at").bind(organizationId).all<{source_organization_id:string;provider:HostedSettings["provider"];shared_by:string;start_providers:string|null;key_ids:string|null}>()).results;
        const settings = new HostedSettingsStore(env.DB, () => env.AUTH_SECRET.get());
        const personalSecrets = await settings.secrets(personal.id);
        const ownCloud = Object.entries(personalSecrets).flatMap(([name, value]) => {
          if (!name.startsWith("cloud:")) return [];
          const parsed = cloudConnectionSchema.safeParse(JSON.parse(value));
          return parsed.success && parsed.data.enabled ? [parsed.data.provider] : [];
        });
        const cloudSecretCache = new Map<string, Record<string, string>>([[personal.id, personalSecrets]]);
        const cloudSecrets = async (org: string) => {
          const cached = cloudSecretCache.get(org);
          if (cached) return cached;
          const next = await settings.secrets(org);
          cloudSecretCache.set(org, next);
          return next;
        };
        const sharedCloudAvailability = new Map<string, boolean>();
        const sharedCloudKeys = new Map<string, ReturnType<typeof publicProviderKeys>[HostedSettings["provider"]]>();
        for (const share of cloudShares) {
          const sourceSecrets = await cloudSecrets(share.source_organization_id);
          const availableKeys = publicProviderKeys(sourceSecrets)[share.provider];
          const selected = selectedPublicKeys(availableKeys, share.key_ids).filter((key) => key.selected);
          sharedCloudAvailability.set(`${share.source_organization_id}:${share.provider}`, selected.some((key) => cloudConnectionForKey(share.provider, sourceSecrets, key.id)?.enabled));
          sharedCloudKeys.set(`${share.source_organization_id}:${share.provider}`, availableKeys);
        }
        const names = new Map<string,string>();
        for (const userId of new Set([...computerShares.map(share => share.shared_by), ...cloudShares.map(share => share.shared_by)])) names.set(userId, (await store.profile(userId))?.name ?? "Member");
        const admin = member.role !== "member";
        return Response.json({
          canManage: admin,
          computers: [
            ...computerShares.map(share => {
              const canShare = share.owner_user_id === identity.userId;
              return { id: share.computer_id, name: share.name, icon: share.icon, platform: share.platform, shared: true, available: share.last_seen_at !== null && Date.now() - share.last_seen_at <= COMPUTER_HEARTBEAT_TIMEOUT_MS, sharedBy: names.get(share.shared_by) ?? "Member", canShare, canRevoke: admin, providers: publicStartProviders(providersFromCapabilities(share.capabilities), parseStartProviders(share.start_providers)) };
            }),
            ...ownComputers.filter(computer => !computerShares.some(share => share.computer_id === computer.computerId)).map(computer => ({ id: computer.computerId, name: computer.name, icon: computer.icon, platform: computer.platform, shared: false, available: computer.availability !== "offline", sharedBy: (null as string | null), canShare: true, canRevoke: false, providers: publicStartProviders(advertisedProviderIds(computer), null) })),
          ],
          cloudConnections: [
            ...cloudShares.map(share => {
              const canShare = share.shared_by === identity.userId || share.source_organization_id === personal.id;
              const keys = canShare ? selectedPublicKeys(sharedCloudKeys.get(`${share.source_organization_id}:${share.provider}`) ?? [], share.key_ids) : [];
              return { id: `${share.source_organization_id}:${share.provider}`, provider: share.provider, shared: true, available: sharedCloudAvailability.get(`${share.source_organization_id}:${share.provider}`) ?? false, sharedBy: names.get(share.shared_by) ?? "Member", canShare, canRevoke: admin, keys, providers: [] };
            }),
            ...ownCloud.filter(provider => !cloudShares.some(share => share.source_organization_id === personal.id && share.provider === provider)).map(provider => ({ id: `${personal.id}:${provider}`, provider, shared: false, available: true, sharedBy: (null as string | null), canShare: true, canRevoke: false, keys: selectedPublicKeys(publicProviderKeys(personalSecrets)[provider], null), providers: [] })),
          ],
        });
      }
      const computerShare = /^compute-shares\/computers\/([^/]+)$/.exec(tail);
      const cloudShare = /^compute-shares\/cloud\/([^/]+)$/.exec(tail);
      if ((computerShare && ["PUT", "PATCH", "DELETE"].includes(request.method)) || (cloudShare && ["PUT", "PATCH", "DELETE"].includes(request.method))) {
        const member = await organizations.member(organizationId, identity.userId);
        const admin = member.role !== "member";
        if (!allowedRequestOrigin(request, env.PREVIEW_ORIGINS)) return jsonError("Open organization settings in Remy.", 403);
        const personal = await personalSpace(env.DB, identity.userId);
        let sourceOrganizationId = personal.id;
        let computerId: string | undefined;
        if (computerShare) {
          computerId = decodeURIComponent(computerShare[1]);
          const existing = await env.DB.prepare("SELECT source_organization_id,shared_by FROM organization_computer_shares WHERE organization_id=? AND computer_id=?").bind(organizationId, computerId).first<{source_organization_id:string;shared_by:string}>();
          const computer = await computerStore.computer(personal.id, computerId) ?? (existing ? await computerStore.computer(organizationId, computerId) : undefined);
          const owns = !!computer && computer.organizationId === personal.id && computer.ownerUserId === identity.userId && computer.ownership === "personal";
          if (request.method === "PUT") {
            if (!owns || !computer) return jsonError("Choose one of your personal computers.", 404);
            const advertised = advertisedProviderIds(computer);
            let startProviders;
            try { startProviders = parseStartProviderInput((await body<{startProviders?:unknown}>(request))?.startProviders, advertised); }
            catch (error) { return jsonError(error instanceof Error ? error.message : "Choose the providers others may start.", 400); }
            await env.DB.prepare("INSERT INTO organization_computer_shares(organization_id,source_organization_id,computer_id,shared_by,created_at,start_providers) VALUES(?,?,?,?,?,?) ON CONFLICT(organization_id,computer_id) DO UPDATE SET start_providers=excluded.start_providers").bind(organizationId, personal.id, computerId, identity.userId, Date.now(), startProviders === undefined ? null : serializeStartProviders(startProviders)).run();
          } else if (request.method === "PATCH") {
            if (!owns || !computer) return jsonError("Choose one of your personal computers.", 404);
            if (!existing) return jsonError("Share this computer first.", 409);
            const advertised = advertisedProviderIds(computer);
            let startProviders;
            try { startProviders = parseStartProviderInput((await body<{startProviders?:unknown}>(request))?.startProviders, advertised); }
            catch (error) { return jsonError(error instanceof Error ? error.message : "Choose the providers others may start.", 400); }
            if (startProviders === undefined) return jsonError("Choose the providers others may start.", 400);
            await env.DB.prepare("UPDATE organization_computer_shares SET start_providers=? WHERE organization_id=? AND computer_id=?").bind(serializeStartProviders(startProviders), organizationId, computerId).run();
          } else {
            if (!existing) return Response.json({ ok: true });
            if (!owns && !admin) return jsonError("Ask an organization admin to change this computer’s sharing.", 403);
            sourceOrganizationId = existing.source_organization_id;
            await organizationObject().fetch(new Request("https://internal/shared-threads/manifest", { method: "POST", headers: { "content-type": "application/json", "x-organization-id": organizationId, "x-source-organization-id": sourceOrganizationId, "x-computer-id": computerId }, body: JSON.stringify({ ids: [] }) }));
            await env.DB.prepare("DELETE FROM organization_computer_shares WHERE organization_id=? AND computer_id=?").bind(organizationId, computerId).run();
          }
        } else {
          const cloudId = decodeURIComponent(cloudShare![1]);
          const separator = cloudId.lastIndexOf(":");
          const sourceOrganizationId = separator === -1 ? personal.id : cloudId.slice(0, separator);
          const provider = (separator === -1 ? cloudId : cloudId.slice(separator + 1)) as HostedSettings["provider"];
          if (!(CLOUD_COMPUTER_PROVIDERS as readonly string[]).includes(provider)) return jsonError("Choose a cloud connection.", 400);
          const settings = new HostedSettingsStore(env.DB, () => env.AUTH_SECRET.get());
          const existing = await env.DB.prepare("SELECT source_organization_id,shared_by FROM organization_cloud_shares WHERE organization_id=? AND source_organization_id=? AND provider=?").bind(organizationId, sourceOrganizationId, provider).first<{source_organization_id:string;shared_by:string}>();
          const owns = sourceOrganizationId === personal.id && !!(await settings.ownConnection(personal.id, provider));
          if (request.method === "PUT") {
            if (!owns) return jsonError("Enable this cloud provider in Personal first.", 409);
            const personalSecrets = await settings.secrets(personal.id);
            const input = await body<{keyIds?:unknown}>(request);
            const availableKeys = publicProviderKeys(personalSecrets)[provider];
            const keyIds = input?.keyIds === undefined ? selectedPublicKeys(availableKeys, null).filter(key => key.selected).map(key => key.id) : Array.isArray(input.keyIds) && input.keyIds.every(key => typeof key === "string") ? [...new Set(input.keyIds)] : [];
            if (!keyIds.length || keyIds.some(keyId => !availableKeys.some(key => key.id === keyId))) return jsonError("Choose the cloud keys to enroll.", 400);
            await env.DB.prepare("INSERT INTO organization_cloud_shares(organization_id,source_organization_id,provider,shared_by,created_at,start_providers,key_ids) VALUES(?,?,?,?,?,?,?) ON CONFLICT(organization_id,source_organization_id,provider) DO UPDATE SET key_ids=excluded.key_ids").bind(organizationId, personal.id, provider, identity.userId, Date.now(), null, JSON.stringify(keyIds)).run();
          } else if (request.method === "PATCH") {
            if (!owns) return jsonError("Choose one of your cloud connections.", 404);
            if (!existing) return jsonError("Share this connection first.", 409);
            const personalSecrets = await settings.secrets(personal.id);
            const input = await body<{keyIds?:unknown}>(request);
            const availableKeys = publicProviderKeys(personalSecrets)[provider];
            const keyIds = input?.keyIds === undefined ? undefined : Array.isArray(input.keyIds) && input.keyIds.every(key => typeof key === "string") ? [...new Set(input.keyIds)] : [];
            if (keyIds === undefined) return jsonError("Choose what to enroll.", 400);
            if (keyIds && (!keyIds.length || keyIds.some(keyId => !availableKeys.some(key => key.id === keyId)))) return jsonError("Choose the cloud keys to enroll.", 400);
            await env.DB.prepare("UPDATE organization_cloud_shares SET key_ids=? WHERE organization_id=? AND source_organization_id=? AND provider=?").bind(JSON.stringify(keyIds), organizationId, personal.id, provider).run();
          } else if (existing && (owns || admin)) {
            await env.DB.prepare("DELETE FROM organization_cloud_shares WHERE organization_id=? AND source_organization_id=? AND provider=?").bind(organizationId, sourceOrganizationId, provider).run();
          } else if (!existing) {
            return Response.json({ ok: true });
          } else return jsonError("Ask an organization admin to change this computer’s sharing.", 403);
        }
        await organizationObject().fetch(new Request("https://internal/computers/changed", { method: "POST", headers: { "x-organization-id": organizationId } }));
        if (computerId) await env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${sourceOrganizationId}`)).fetch(new Request("https://internal/shared-computers/changed", { method: "POST", headers: { "x-organization-id": sourceOrganizationId, "x-computer-id": computerId } }));
        return Response.json({ ok: true });
      }
      if (tail === "computers/options" && request.method === "GET") {
        const member = await organizations.member(organizationId, identity.userId);
        const members = await organizations.members(organizationId, identity.userId);
        return Response.json({ role: member.role, members: await Promise.all(members.map(async (m) => ({ id: m.userId, label: (await store.profile(m.userId))?.name || "Member" }))), teams: await organizations.teams(organizationId, identity.userId) });
      }
      if (tail === "computers/live" && request.method === "GET") {
        await organizations.member(organizationId, identity.userId);
        return organizationObject().fetch(new Request("https://internal/computers/live", { headers: { upgrade: request.headers.get("upgrade") ?? "", "x-organization-id": organizationId, "x-user-id": identity.userId, "x-session-id": identity.sessionId } }));
      }
      if (tail === "computers/connection-keys" && request.method === "POST") {
        const member = await organizations.member(organizationId, identity.userId);
        if (identity.clientKind !== "web") return jsonError("Create a connection key in Remy.", 403);
        if (!allowedRequestOrigin(request, env.PREVIEW_ORIGINS)) return jsonError("Create a connection key in Remy.", 403);
        const input = await body<{ ownership?: unknown; name?: unknown }>(request);
        const ownership = input?.ownership === undefined ? "personal" : input.ownership;
        if (ownership !== "personal" && ownership !== "organization") return jsonError("Choose who owns this computer.", 400);
        if (ownership === "organization" && member.role === "member") return jsonError("Ask an admin to add a shared computer.", 403);
        const name = typeof input?.name === "string" && input.name.trim() ? input.name.trim().slice(0, 120) : "Remy CLI";
        // An approved authorization, so a machine with no browser needs only
        // this one string. It is single-use, expiring, and can register a
        // computer and nothing else.
        const authorization = await service.startDeviceAuthorization("computer", name);
        if (await service.approveDevice(identity.userId, authorization.userCode) !== "approved") return jsonError("Your connection key could not be created; try again.", 502);
        return Response.json({
          key: encodeComputerConnectionKey({ v: 1, url: url.origin, organizationId, ownership, key: authorization.deviceCode }),
          expiresIn: authorization.expiresIn,
        }, { headers: { "cache-control": "no-store" } });
      }
      const computerModelKeys = /^computers\/([^/]+)\/model-keys$/.exec(tail);
      if (computerModelKeys && ["GET", "PUT"].includes(request.method)) {
        await organizations.member(organizationId, identity.userId);
        const id = decodeURIComponent(computerModelKeys[1]);
        const computer = await computerStore.computer(organizationId, id);
        if (!computer || computer.ownership === "hosted" || identity.clientKind === "computer" || !await computers.canManage(computer, identity.userId, organizationId)) return jsonError("Computer not found.", 404);
        const keys = new ComputerModelKeyStore(env.DB, () => env.AUTH_SECRET.get());
        if (request.method === "GET") return Response.json({ providers: publicComputerModelKeys(await keys.names(id)) }, { headers: { "cache-control": "no-store" } });
        if (!allowedRequestOrigin(request, env.PREVIEW_ORIGINS)) return jsonError("Set provider keys in Remy.", 403);
        const input = computerModelKeyWrite.safeParse(await body(request));
        if (!input.success) return jsonError("Enter an API key for this provider.", 400);
        await keys.set(id, computerModelKeyName(input.data.id), input.data.apiKey);
        await organizationObject().fetch(new Request("https://internal/computer-model-keys/changed", { method: "POST", headers: { "x-organization-id": organizationId, "x-computer-id": id } }));
        return Response.json({ providers: publicComputerModelKeys(await keys.names(id)) });
      }
      const computerMatch = /^computers\/([^/]+)$/.exec(tail);
      if (computerMatch && ["PATCH", "DELETE"].includes(request.method)) {
        await organizations.member(organizationId, identity.userId);
        if (!allowedRequestOrigin(request, env.PREVIEW_ORIGINS)) return jsonError("Open this computer in Remy.", 403);
        const id = decodeURIComponent(computerMatch[1]);
        if (request.method === "DELETE") {
          const current=await computerStore.computer(organizationId,id);
          const sharedOrganizationIds = current?.organizationId === organizationId ? await computerStore.sharedOrganizationIds?.(organizationId, id) ?? [] : [];
          for (const targetOrganizationId of sharedOrganizationIds) await env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${targetOrganizationId}`)).fetch(new Request("https://internal/shared-threads/manifest", { method: "POST", headers: { "content-type": "application/json", "x-organization-id": targetOrganizationId, "x-source-organization-id": organizationId, "x-computer-id": id }, body: JSON.stringify({ ids: [] }) }));
          if(current?.ownership==="hosted") {
            if(!await computers.canManage(current,identity.userId,organizationId)) return jsonError("Computer not found.",404);
            const removed=await organizationObject().fetch(new Request(`https://internal/hosted-computers/${encodeURIComponent(id)}`,{method:"DELETE",headers:{"x-organization-id":organizationId}}));
            if(!removed.ok) return removed;
          }
          await computers.remove(organizationId, id, identity.userId);
          await new ComputerModelKeyStore(env.DB, () => env.AUTH_SECRET.get()).forget(id);
          await new ComputerAccountStore(env.DB, () => env.AUTH_SECRET.get()).forget(id);
          for (const targetOrganizationId of sharedOrganizationIds) await env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${targetOrganizationId}`)).fetch(new Request("https://internal/computers/changed", { method: "POST", headers: { "x-organization-id": targetOrganizationId, "x-removed-computer": id } }));
        }
        else {
          const input = await body<{ name?: unknown; icon?: unknown; access?: unknown }>(request);
          if (!input || (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim() || input.name.length > 120)) || (input.icon !== undefined && (typeof input.icon !== "string" || input.icon.length > 40))) return jsonError("Choose valid computer details.", 400);
          const access = input.access === undefined ? undefined : computerAccessSchema.safeParse(input.access);
          if (access && !access.success) return jsonError("Choose who can use this computer.", 400);
          await computers.update(organizationId, id, identity.userId, { ...(typeof input.name === "string" ? { name: input.name.trim() } : {}), ...(typeof input.icon === "string" ? { icon: input.icon } : {}), ...(access?.success ? { access: access.data } : {}) });
        }
        await organizationObject().fetch(new Request("https://internal/computers/changed", { method: "POST", headers: { "x-organization-id": organizationId, ...(request.method === "DELETE" ? { "x-removed-computer": id } : {}) } }));
        return Response.json({ ok: true });
      }
      if (/^computers\/[^/]+\/(proxy|stream)(\/|$)/.test(tail)) {
        await organizations.member(organizationId, identity.userId);
        return jsonError("Use the thread's own address.", 403);
      }
      const environmentPath = /^workspaces\/([^/]+)\/environment(?:\/([^/]+))?$/.exec(tail);
      if (environmentPath) {
        if (identity.clientKind === "computer") return jsonError("Manage workspace values in Remy.", 403);
        const workspaceId = decodeURIComponent(environmentPath[1]);
        await organizations.workspace(organizationId, identity.userId, workspaceId);
        const envs = new EnvironmentStore(env.DB, () => env.AUTH_SECRET.get());
        const list = async () => Response.json({ values: await envs.list(organizationId, workspaceId, identity.userId, async (id) => (await store.profile(id))?.name || "Former member") }, { headers: { "cache-control": "no-store" } });
        if (!environmentPath[2] && request.method === "GET") return list();
        if (!allowedRequestOrigin(request, env.PREVIEW_ORIGINS)) return jsonError("Manage workspace values in Remy.", 403);
        let changed: { workspace: boolean; personal: boolean };
        try {
          if (!environmentPath[2] && request.method === "POST") changed = await envs.add(organizationId, workspaceId, identity.userId, await body(request));
          else if (environmentPath[2] && request.method === "DELETE") { const scope = await envs.remove(organizationId, workspaceId, identity.userId, decodeURIComponent(environmentPath[2])); changed = { workspace: scope === "workspace", personal: scope === "personal" }; }
          else return jsonError("This environment action is unavailable.", 405);
        } catch (error) {
          if (error instanceof EnvironmentError) return jsonError(error.message, error.status);
          throw error;
        }
        // Content-free: open views read the list again with their own access.
        if (changed.workspace) await organizationObject().fetch(new Request("https://internal/environment/changed", { method: "POST" }));
        if (changed.personal) {
          const orgs = (await env.DB.prepare("SELECT organization_id FROM memberships WHERE user_id=?").bind(identity.userId).all<{ organization_id: string }>()).results;
          await Promise.all(orgs.map(({ organization_id }) => env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${organization_id}`)).fetch(new Request("https://internal/environment/changed", { method: "POST", headers: { "x-user-id": identity.userId } }))));
        }
        return list();
      }
      const claudeAccount = /^claude-account(?:\/(start|complete|cancel|logout))?$/.exec(tail);
      if (claudeAccount) {
        return jsonError("Connect Claude Code on a computer you own.", 403);
      }
      const computerClaude = /^computers\/([^/]+)\/claude-account(?:\/(start|complete|cancel|logout))?$/.exec(tail);
      if (computerClaude) {
        await organizations.member(organizationId, identity.userId);
        const id = decodeURIComponent(computerClaude[1]);
        const computer = await computerStore.computer(organizationId, id);
        if (!computer || identity.clientKind === "computer" || !await computers.canManage(computer, identity.userId, organizationId)) return jsonError("Computer not found.", 404);
        if (computer.ownership === "hosted") return jsonError("Connect Claude Code on a computer you own.", 403);
        const accounts = new ComputerAccountStore(env.DB, () => env.AUTH_SECRET.get());
        if (request.method === "GET" && !computerClaude[2]) {
          return Response.json(await claudeAccountStatus(accounts, id), { headers: { "cache-control": "no-store" } });
        }
        if (!allowedRequestOrigin(request, env.PREVIEW_ORIGINS)) return jsonError("Connect Claude Code from Remy.", 403);
        if (request.method !== "POST" || !computerClaude[2]) return jsonError("This account action is unavailable.", 405);
        try {
          const account = computerClaude[2] === "start" ? await startClaudeAccount(accounts, id)
            : computerClaude[2] === "complete" ? await completeClaudeAccount(accounts, id, await body(request))
            : computerClaude[2] === "cancel" ? await cancelClaudeAccount(accounts, id)
            : await logoutClaudeAccount(accounts, id);
          if (computerClaude[2] === "complete" || computerClaude[2] === "logout") {
            await organizationObject().fetch(new Request("https://internal/computer-model-keys/changed", { method: "POST", headers: { "x-organization-id": organizationId, "x-computer-id": id } }));
          }
          return Response.json(account, { headers: { "cache-control": "no-store" } });
        } catch (error) {
          return jsonError(error instanceof Error ? error.message : "Claude Code could not connect; try again.", 400);
        }
      }
      const computerCodex = /^computers\/([^/]+)\/codex(?:\/(start|cancel|logout))?$/.exec(tail);
      if (computerCodex) {
        await organizations.member(organizationId, identity.userId);
        const id = decodeURIComponent(computerCodex[1]);
        const computer = await computerStore.computer(organizationId, id);
        if (!computer || identity.clientKind === "computer" || !await computers.canManage(computer, identity.userId, organizationId)) return jsonError("Computer not found.", 404);
        if (computer.ownership === "hosted") return jsonError("Connect Codex on a computer you own.", 403);
        if (!(request.method === "GET" && !computerCodex[2]) && !(request.method === "POST" && computerCodex[2])) return jsonError("This account action is unavailable.", 405);
        if (request.method === "POST" && !allowedRequestOrigin(request, env.PREVIEW_ORIGINS)) return jsonError("Connect Codex from Remy.", 403);
        return organizationObject().fetch(new Request(`https://internal/computer-account/${encodeURIComponent(id)}/codex${computerCodex[2] ? `/${computerCodex[2]}` : ""}`, {
          method: request.method, headers: { "x-organization-id": organizationId, "x-user-id": identity.userId },
        }));
      }
      if (tail === "model-access" || tail.startsWith("model-access/")) {
        const member=await organizations.member(organizationId,identity.userId);
        const store=new HostedSettingsStore(env.DB,()=>env.AUTH_SECRET.get());
        if(tail === "model-access" && request.method === "GET") return Response.json({providers:publicModelAccess(await store.executionSecrets(organizationId), await store.secrets(organizationId))});
        const namedModel = /^model-access\/([^/]+)\/keys(?:\/([^/]+))?$/.exec(tail);
        if (namedModel) {
          const id = namedModel[1] as ModelAccessId;
          if (!modelAccessIds.includes(id)) return jsonError("This model action is unavailable.",405);
          if (member.role === "member" || identity.clientKind === "computer") return jsonError("Only an administrator can configure model access.",403);
          if (!allowedRequestOrigin(request,env.PREVIEW_ORIGINS)) return jsonError("Configure model access from Remy.",403);
          try {
            const providers = namedModel[2] && request.method === "DELETE"
              ? await removeNamedModelKey(store, organizationId, id, decodeURIComponent(namedModel[2]))
              : (namedModel[2] ? ["PATCH"] : ["POST"]).includes(request.method)
                ? await saveNamedModelKey(store, organizationId, id, await body(request), namedModel[2] ? decodeURIComponent(namedModel[2]) : undefined)
                : null;
            if (!providers) return jsonError("This model action is unavailable.",405);
            await organizationObject().fetch(new Request("https://internal/organization/changed",{method:"POST",headers:{"x-organization-id":organizationId}}));
            return Response.json({providers});
          } catch { return jsonError("Your model access could not be saved; check your key and try again.",400); }
        }
        const id=tail.slice("model-access/".length) as ModelAccessId;
        if(!modelAccessIds.includes(id) || request.method !== "PATCH") return jsonError("This model action is unavailable.",405);
        if(member.role === "member" || identity.clientKind === "computer") return jsonError("Only an administrator can configure model access.",403);
        if(!allowedRequestOrigin(request,env.PREVIEW_ORIGINS)) return jsonError("Configure model access from Remy.",403);
        try {
          const providers=await saveModelAccess(store,organizationId,id,await body(request));
          await organizationObject().fetch(new Request("https://internal/organization/changed",{method:"POST",headers:{"x-organization-id":organizationId}}));
          return Response.json({providers});
        } catch {return jsonError("Your model access could not be saved; check your key and try again.",400);}
      }
      if (["router-models", "router-connection", "openrouter-models", "openrouter-connection"].includes(tail) && ["POST", "PUT", "DELETE"].includes(request.method)) {
        const provider = tail.startsWith("openrouter-") ? "openrouter" : "router";
        const label = provider === "openrouter" ? "OpenRouter" : "Router";
        const secretName = `model:${provider}`;
        if (tail === `${provider}-models` ? request.method !== "POST" : !["PUT", "DELETE"].includes(request.method)) return jsonError("This model action is unavailable.",405);
        const member=await organizations.member(organizationId,identity.userId);
        if(member.role === "member" || identity.clientKind === "computer") return jsonError("Only an administrator can configure model access.",403);
        if(!allowedRequestOrigin(request,env.PREVIEW_ORIGINS)) return jsonError("Configure model access from Remy.",403);
        const store=new HostedSettingsStore(env.DB,()=>env.AUTH_SECRET.get());
        if(tail === `${provider}-connection` && request.method === "DELETE") await store.setSecret(organizationId,secretName,null);
        else {
          const input=await body<{apiKey?:string;model?:string}>(request);
          if(!input || typeof input.apiKey !== "string" || !input.apiKey.trim() || input.apiKey.length > 8192) return jsonError(`Enter your ${label} API key.`,400);
          try {
            const models=await routerModels(input.apiKey.trim(), fetch, provider);
            if(tail === `${provider}-models` && request.method === "POST") return Response.json({models});
            const parsed=routerConnectionSchema.safeParse(input);
            if(request.method !== "PUT" || !parsed.success || !models.includes(parsed.data.model)) return jsonError(`Choose a model available to your ${label} key.`,400);
            await store.setSecret(organizationId,secretName,JSON.stringify(parsed.data));
          } catch(e) {return jsonError(e instanceof Error ? e.message : `${label} could not connect.`,502);}
        }
        await organizationObject().fetch(new Request("https://internal/organization/changed",{method:"POST",headers:{"x-organization-id":organizationId}}));
        return Response.json({saved:true});
      }
      if (tail === "cloud-connection/status" && request.method === "GET") {
        await organizations.member(organizationId, identity.userId);
        if (!env.PROVIDER_RUNTIME) return jsonError("Cloud connection service is unavailable.", 503);
        const response = await env.PROVIDER_RUNTIME.get(env.PROVIDER_RUNTIME.idFromName("provider-management")).fetch(new Request("https://provider.internal/health", {
          headers: { authorization: `Bearer ${await managementCredential(await env.AUTH_SECRET.get())}` },
        }));
        return new Response(response.body, { status: response.status, headers: { "content-type": "application/json" } });
      }
      const namedCloud = /^cloud-connection\/keys(?:\/([^/]+))?$/.exec(tail);
      if (namedCloud && ["POST", "PATCH", "DELETE"].includes(request.method)) {
        const member = await organizations.member(organizationId, identity.userId);
        if (member.role === "member" || identity.clientKind === "computer") return jsonError("Ask an administrator to connect a cloud provider.", 403);
        if (!allowedRequestOrigin(request, env.PREVIEW_ORIGINS)) return jsonError("Connect your cloud provider from Remy.", 403);
        const store = new HostedSettingsStore(env.DB, () => env.AUTH_SECRET.get());
        try {
          if (namedCloud[1] && request.method === "DELETE") {
            const provider = (await body<{provider?:unknown}>(request))?.provider;
            if (typeof provider !== "string" || !(CLOUD_COMPUTER_PROVIDERS as readonly string[]).includes(provider)) return jsonError("Choose a cloud provider.", 400);
            const keys = await removeNamedCloudKey(store, organizationId, provider as HostedSettings["provider"], decodeURIComponent(namedCloud[1]));
            await organizationObject().fetch(new Request("https://internal/organization/changed", { method: "POST", headers: { "x-organization-id": organizationId } }));
            return Response.json({ keys });
          }
          if ((namedCloud[1] && request.method === "PATCH") || (!namedCloud[1] && request.method === "POST")) {
            const keys = await saveNamedCloudKey(store, organizationId, await body(request), namedCloud[1] ? decodeURIComponent(namedCloud[1]) : undefined);
            await organizationObject().fetch(new Request("https://internal/organization/changed", { method: "POST", headers: { "x-organization-id": organizationId } }));
            return Response.json({ keys });
          }
        } catch { return jsonError("Enter the credentials for your cloud provider.", 400); }
        return jsonError("This cloud action is unavailable.", 405);
      }
      if (tail === "cloud-connection" && ["PUT", "PATCH"].includes(request.method)) {
        const member = await organizations.member(organizationId, identity.userId);
        if (member.role === "member" || identity.clientKind === "computer") return jsonError("Ask an administrator to connect a cloud provider.", 403);
        if (!allowedRequestOrigin(request, env.PREVIEW_ORIGINS)) return jsonError("Connect your cloud provider from Remy.", 403);
        const input = await body(request);
        const store = new HostedSettingsStore(env.DB, () => env.AUTH_SECRET.get());
        if (request.method === "PATCH") {
          const toggle = cloudToggleSchema.safeParse(input);
          if (!toggle.success) return jsonError("Choose a cloud provider to enable or disable.", 400);
          const saved = (await store.secrets(organizationId))[cloudConnectionKey(toggle.data.provider)];
          if (!saved) return jsonError("Save this provider’s credentials first.", 409);
          const connection = cloudConnectionSchema.parse(JSON.parse(saved));
          await store.setSecret(organizationId, cloudConnectionKey(connection.provider), JSON.stringify({ ...connection, enabled: toggle.data.enabled }));
        } else {
          const parsed = cloudConnectionSchema.safeParse(input);
          if (!parsed.success) return jsonError("Enter the credentials for your cloud provider.", 400);
          if (parsed.data.provider === "cursor-cloud") {
            try { await verifyCursorCloudKey(parsed.data.token); }
            catch (error) { return jsonError(error instanceof Error ? error.message : "Enter a valid Cursor API key.", 400); }
          }
          const saved = (await store.secrets(organizationId))[cloudConnectionKey(parsed.data.provider)];
          const enabled = saved ? cloudConnectionSchema.parse(JSON.parse(saved)).enabled : parsed.data.enabled;
          await store.setSecret(organizationId, cloudConnectionKey(parsed.data.provider), JSON.stringify({ ...parsed.data, enabled }));
        }
        await organizationObject().fetch(new Request("https://internal/organization/changed", { method: "POST", headers: { "x-organization-id": organizationId } }));
        return Response.json({ saved: true });
      }
      const hostedMatch = /^hosted(?:\/([^/]+)(?:\/(prewarm|settings))?)?$/.exec(tail);
      if (hostedMatch) {
        const member = await organizations.member(organizationId, identity.userId);
        const workspaceId = hostedMatch[1] ? decodeURIComponent(hostedMatch[1]) : "";
        if (workspaceId) await organizations.workspace(organizationId, identity.userId, workspaceId);
        const settings = new HostedSettingsStore(env.DB, () => env.AUTH_SECRET.get());
        if (request.method === "GET" && (!workspaceId || hostedMatch[2] === "settings")) {
          // Every read here is independent; awaiting them one after another made
          // this the slowest thing the new-thread composer waits on.
          const [names, enabledProviders, executionSecrets, hostedSettings, secrets] = await Promise.all([
            settings.secretNames(organizationId),
            settings.enabledProviders(organizationId),
            settings.executionSecrets(organizationId),
            settings.settings(organizationId, workspaceId),
            settings.secrets(organizationId),
          ]);
          const access = publicModelAccess(executionSecrets);
          const cloudStart: Record<string, { owner: boolean; providers: ReturnType<typeof publicStartProviders> }> = {};
          const grants = await Promise.all(enabledProviders.map((provider) => cloudStartGrant(settings, organizationId, provider, identity.userId)));
          enabledProviders.forEach((provider, index) => {
            const grant = grants[index]!;
            cloudStart[provider] = { owner: grant.owner, providers: publicStartProviders(grant.advertised, grant.stored) };
          });
          const profile = await env.DB.prepare("SELECT name FROM user WHERE id=?").bind(identity.userId).first<{ name: string }>();
          const personal = profile ? await personalSpace(env.DB, identity.userId) : undefined;
          const personalSecrets = personal ? await settings.secrets(personal.id) : {};
          const placements: { id: string; provider: HostedSettings["provider"]; owner: string; keyName: string; own: boolean }[] = [];
          for (const provider of CLOUD_COMPUTER_PROVIDERS) {
            if (!personal || !await settings.ownConnection(personal.id, provider)) continue;
            for (const key of publicCloudKeys(provider, personalSecrets)) placements.push({ id: `cloud:${provider}:${personal.id}:${key.id}`, provider, owner: "You", keyName: key.name, own: true });
          }
          if (organizationId !== personal?.id) {
            for (const provider of CLOUD_COMPUTER_PROVIDERS) {
              if (!await settings.ownConnection(organizationId, provider)) continue;
              for (const key of publicCloudKeys(provider, secrets)) placements.push({ id: `cloud:${provider}:${organizationId}:${key.id}`, provider, owner: "Organization", keyName: key.name, own: false });
            }
          }
          const sharedRows = (await env.DB.prepare("SELECT source_organization_id,provider,shared_by,key_ids FROM organization_cloud_shares WHERE organization_id=? ORDER BY created_at")
            .bind(organizationId).all<{ source_organization_id: string; provider: HostedSettings["provider"]; shared_by: string; key_ids: string | null }>()).results;
          for (const share of sharedRows) {
            if (share.source_organization_id === personal?.id) continue;
            const sourceSecrets = await settings.secrets(share.source_organization_id);
            const owner = (await env.DB.prepare("SELECT name FROM user WHERE id=?").bind(share.shared_by).first<{ name: string }>())?.name ?? "Member";
            for (const key of selectedPublicKeys(publicCloudKeys(share.provider, sourceSecrets), share.key_ids).filter(key => key.selected)) placements.push({ id: `cloud:${share.provider}:${share.source_organization_id}:${key.id}`, provider: share.provider, owner, keyName: key.name, own: false });
          }
          return Response.json({ settings: hostedSettings, secretNames: member.role !== "member" ? names.filter(name => !name.startsWith("cloud:") && !name.startsWith("model:") && !name.startsWith("access:") && !name.startsWith("named-")) : [], enabledProviders, cloudStart, cloudPlacements: placements, routerConfigured: !!access.find(entry => entry.id === "router")?.configured, openrouterConfigured: !!access.find(entry => entry.id === "openrouter")?.configured, connections: names.filter(name => name.startsWith("cloud:")).map(name => name.slice(6)), providerKeys: publicProviderKeys(secrets), available: enabledProviders.includes("cursor-cloud") || (!!env.HOSTED_IMAGE && (!!env.PROVIDER_RUNTIME || (!!env.HOSTED_CONTROL_URL && !!env.HOSTED_CONTROL_TOKEN))) });
        }
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
          await organizationObject().fetch(new Request("https://internal/organization/changed",{method:"POST",headers:{"x-organization-id":organizationId}}));
          return Response.json({ok:true});
        }
        if(workspaceId && (request.method === "GET" || (request.method === "POST" && hostedMatch[2] === "prewarm"))) {
          return organizationObject().fetch(new Request(`https://internal/hosted/${encodeURIComponent(workspaceId)}`,{method:request.method,headers:{"x-organization-id":organizationId}}));
        }
      }
      if (tail === "threads" || tail === "threads/live" || /^threads\/starts\/[0-9a-f-]{36}$/.test(tail) || /^computers\/[^/]+\/workspaces\/[^/]+\/branches$/.test(tail) || /^computers\/[^/]+\/threads(?:\/|$)/.test(tail)) {
        await organizations.member(organizationId, identity.userId);
        const profile = await store.profile(identity.userId);
        const actor = threadMemberSchema.parse({ id: identity.userId, label: profile?.name || "Member" });
        if (request.method !== "GET" && !allowedRequestOrigin(request, env.PREVIEW_ORIGINS)) return jsonError("Open this thread in Remy.", 403);
        const computerId = /^computers\/([^/]+)\/threads/.exec(tail)?.[1];
        if (computerId) await computers.requireUse(organizationId, decodeURIComponent(computerId), identity.userId);
        const headers = new Headers({ "x-thread-member": encodeURIComponent(JSON.stringify(actor)), "x-thread-session": identity.sessionId, "x-organization-id": organizationId });
        if (request.headers.get("upgrade") === "websocket") headers.set("upgrade", "websocket");
        if (request.headers.has("content-type")) headers.set("content-type", request.headers.get("content-type")!);
        if (request.headers.has("x-filename")) headers.set("x-filename", request.headers.get("x-filename")!);
        const internal = new URL(`https://internal/${tail}`); internal.search = url.search;
        return organizationObject().fetch(new Request(internal, { method: request.method, headers, body: request.body, ...(request.body ? { duplex: "half" } : {}) }));
      }
      // A review's findings and proposals are its owner's, read and decided in
      // Remy; a computer session never reaches them.
      if (tail === "reviews" || tail.startsWith("reviews/")) {
        await organizations.member(organizationId, identity.userId);
        if (identity.clientKind === "computer") return jsonError("Review pull requests in Remy.", 403);
        if (request.method !== "GET" && !allowedRequestOrigin(request, env.PREVIEW_ORIGINS)) return jsonError("Open this review in Remy.", 403);
        const profile = await store.profile(identity.userId);
        const actor = threadMemberSchema.parse({ id: identity.userId, label: profile?.name || "Member" });
        const headers = new Headers({ "x-thread-member": encodeURIComponent(JSON.stringify(actor)), "x-thread-session": identity.sessionId, "x-organization-id": organizationId });
        if (request.headers.get("upgrade") === "websocket") headers.set("upgrade", "websocket");
        if (request.headers.has("content-type")) headers.set("content-type", request.headers.get("content-type")!);
        const internal = new URL(`https://internal/${tail}`); internal.search = url.search;
        return organizationObject().fetch(new Request(internal, { method: request.method, headers, body: request.body, ...(request.body ? { duplex: "half" } : {}) }));
      }
      if(tail==="computers/choice" || tail==="computers/preference") {
        await organizations.member(organizationId,identity.userId);
        // Reading your saved preference needs no cloud settings; the composer
        // asks for it first, so it stays one query.
        if(tail==="computers/preference" && request.method==="GET") {
          const workspaceId=url.searchParams.get("workspaceId");
          if(!workspaceId)return jsonError("Choose a workspace.",400);
          await organizations.workspace(organizationId,identity.userId,workspaceId);
          const preference=await env.DB.prepare("SELECT computer_id FROM member_computer_preferences WHERE organization_id=? AND user_id=? AND workspace_id=?").bind(organizationId,identity.userId,workspaceId).first<{computer_id:string}>();
          return Response.json({computerId:preference?.computer_id??null});
        }
        if(request.method==="POST") {
          const enabledProviders=await new HostedSettingsStore(env.DB,()=>env.AUTH_SECRET.get()).enabledProviders(organizationId);
          const input=await body<{workspaceId?:string;computerId?:string|null;prewarm?:boolean;usePreference?:boolean}>(request);
          if(!input?.workspaceId)return jsonError("Choose a workspace.",400);
          const workspace=await organizations.workspace(organizationId,identity.userId,input.workspaceId);
          const all=await computers.list(organizationId,identity.userId);
          if(tail==="computers/preference") {
            if(input.computerId) {
              const choice=chooseComputer(all,{workspaceId:workspace.id,origin:workspace.origin,override:input.computerId,enabledProviders});
              if(!choice.computerId && !choice.hostedProvider)return jsonError(choice.reason,409);
              await env.DB.prepare("INSERT INTO member_computer_preferences(organization_id,user_id,workspace_id,computer_id) VALUES(?,?,?,?) ON CONFLICT(organization_id,user_id,workspace_id) DO UPDATE SET computer_id=excluded.computer_id").bind(organizationId,identity.userId,workspace.id,input.computerId).run();
            }else await env.DB.prepare("DELETE FROM member_computer_preferences WHERE organization_id=? AND user_id=? AND workspace_id=?").bind(organizationId,identity.userId,workspace.id).run();
            return Response.json({ok:true});
          }
          const preference=input.usePreference?await env.DB.prepare("SELECT computer_id FROM member_computer_preferences WHERE organization_id=? AND user_id=? AND workspace_id=?").bind(organizationId,identity.userId,workspace.id).first<{computer_id:string}>():null;
          const override=input.computerId !== undefined ? input.computerId ?? undefined : preference?.computer_id;
          const choice=chooseComputer(all,{workspaceId:workspace.id,origin:workspace.origin,enabledProviders,...(override?{override}:{})});
          if(choice.hostedWorkspaceId && input.prewarm) {
            const response=await organizationObject().fetch(new Request(`https://internal/hosted/${workspace.id}`,{method:"POST",headers:{"x-organization-id":organizationId},body:JSON.stringify({provider:choice.hostedProvider})}));
            if(!response.ok)return response;
          }
          return Response.json({...choice,recommendedVisibility:choice.computerId && all.find(computer=>computer.computerId===choice.computerId)?.shared ? "open" : "private"});
        }
        return jsonError("This computer action is unavailable.",405);
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
      if (!tail && request.method === "GET") {
        const member = await organizations.member(organizationId, identity.userId);
        const organization = await organizationStore.organization(organizationId);
        return Response.json({ organization: { ...organization, role: member.role } });
      }
      if (tail === "live" && request.method === "GET") {
        await organizations.member(organizationId, identity.userId);
        return organizationObject().fetch(new Request("https://internal/organization/live", { headers: { upgrade: request.headers.get("upgrade") ?? "", "x-organization-id": organizationId, "x-user-id": identity.userId, "x-session-id": identity.sessionId } }));
      }
      if (tail === "members" && request.method === "GET") {
        const members = await organizations.members(organizationId, identity.userId);
        return Response.json({ members: await Promise.all(members.map(async (m) => { const profile = await store.profile(m.userId); return {...m, name: profile?.name ?? "Member", image: profile?.image ?? null}; })) });
      }
      if (tail === "invites" && request.method === "POST") {
        const input = await body<{ email?: string; role?: "admin" | "member" }>(request);
        if (input?.role !== "admin" && input?.role !== "member") return jsonError("Choose admin or member access.", 400);
        if (input.email !== undefined && (!/^\S+@\S+\.\S+$/.test(input.email) || input.email.length > 254)) return jsonError("Enter a valid email address.", 400);
        if (input.email && !emailAvailable(env)) return jsonError("Email invitations are unavailable.", 503);
        const invite = await organizations.createInvite(organizationId, identity.userId, { ...(input.email ? { email: input.email } : {}), role: input.role });
        if (input.email) { await sendAccountEmail(env, { kind: "organization.invite", recipient: input.email, url: `${url.origin}/?invite=${encodeURIComponent(invite.token)}` }); const { token: _, ...delivered } = invite; return Response.json(delivered, { status: 201 }); }
        return Response.json(invite, { status: 201 });
      }
      if (tail === "teams" && request.method === "GET") return Response.json({ teams: await organizations.teams(organizationId, identity.userId) });
      if (tail === "teams" && request.method === "POST") { const input = await body<{ name?: string }>(request); const name = input?.name?.trim(); if (!name || name.length > 120) return jsonError("Enter a team name.", 400); return Response.json(await organizations.createTeam(organizationId, identity.userId, name), { status: 201 }); }
      if (tail === "workspaces" && request.method === "GET") return Response.json({ workspaces: await organizations.workspaces(organizationId, identity.userId) });
      if (tail === "workspaces" && request.method === "POST") {
        const input = await body<{ name?: string; origin?: string }>(request); const name = input?.name?.trim(); const origin = input?.origin?.trim();
        if (!name || name.length > 120) return jsonError("Enter a workspace name.", 400);
        if (!origin || origin.length > 512) return jsonError("Enter the repository origin.", 400);
        return Response.json(await organizations.createWorkspace(organizationId, identity.userId, { name, origin }), { status: 201 });
      }
      if (tail === "leave" && request.method === "POST") { await organizations.leave(organizationId, identity.userId); await organizationObject().fetch(new Request("https://internal/computers/changed", { method: "POST", headers: { "x-organization-id": organizationId } })); return new Response(null, { status: 204 }); }
      if (tail === "transfer" && request.method === "POST") { const input = await body<{ userId?: string }>(request); if (!input?.userId) return jsonError("Choose a new owner.", 400); await organizations.transfer(organizationId, identity.userId, input.userId); return new Response(null, { status: 204 }); }
      if (tail === "deletion-impact" && request.method === "GET") return Response.json(await organizations.deletionImpact(organizationId, identity.userId));
      if (!tail && request.method === "PATCH") { const input = await body<{ name?: string }>(request); const name = input?.name?.trim(); if (!name || name.length > 120) return jsonError("Enter an organization name.", 400); await organizations.rename(organizationId, identity.userId, name); return new Response(null, { status: 204 }); }
      if (!tail && request.method === "DELETE") {
        const input = await body<{ confirmation?: string }>(request);
        const impact = await organizations.deletionImpact(organizationId, identity.userId);
        if (input?.confirmation !== impact.name) return jsonError("Enter the organization name to confirm deletion.", 400);
        const response = await organizationObject().fetch("https://internal/storage", { method: "DELETE" });
        if (!response.ok) throw new Error("Organization storage deletion failed");
        await organizations.delete(organizationId, identity.userId, input?.confirmation ?? "");
        return new Response(null, { status: 204 });
      }
      const memberMatch = /^members\/([^/]+)$/.exec(tail);
      if (memberMatch && request.method === "PATCH") { const input = await body<{ role?: "admin" | "member" }>(request); if (input?.role !== "admin" && input?.role !== "member") return jsonError("Choose admin or member access.", 400); await organizations.changeRole(organizationId, identity.userId, decodeURIComponent(memberMatch[1]), input.role); return new Response(null, { status: 204 }); }
      if (memberMatch && request.method === "DELETE") { await organizations.removeMember(organizationId, identity.userId, decodeURIComponent(memberMatch[1])); await organizationObject().fetch(new Request("https://internal/computers/changed", { method: "POST", headers: { "x-organization-id": organizationId } })); return new Response(null, { status: 204 }); }
      const teamMatch = /^teams\/([^/]+)$/.exec(tail);
      if (teamMatch && request.method === "PATCH") { const input = await body<{ name?: string }>(request); const name = input?.name?.trim(); if (!name || name.length > 120) return jsonError("Enter a team name.", 400); await organizations.renameTeam(organizationId, identity.userId, decodeURIComponent(teamMatch[1]), name); return new Response(null, { status: 204 }); }
      if (teamMatch && request.method === "DELETE") { await organizations.deleteTeam(organizationId, identity.userId, decodeURIComponent(teamMatch[1])); await organizationObject().fetch(new Request("https://internal/computers/changed", { method: "POST", headers: { "x-organization-id": organizationId } })); return new Response(null, { status: 204 }); }
      const teamMemberMatch = /^teams\/([^/]+)\/members\/([^/]+)$/.exec(tail);
      if (teamMemberMatch && (request.method === "PUT" || request.method === "DELETE")) { await organizations.changeTeamMember(organizationId, identity.userId, decodeURIComponent(teamMemberMatch[1]), decodeURIComponent(teamMemberMatch[2]), request.method === "PUT"); await organizationObject().fetch(new Request("https://internal/computers/changed", { method: "POST", headers: { "x-organization-id": organizationId } })); return new Response(null, { status: 204 }); }
      const teamMembersMatch = /^teams\/([^/]+)\/members$/.exec(tail);
      if (teamMembersMatch && request.method === "GET") return Response.json({ userIds: await organizations.teamMembers(organizationId, identity.userId, decodeURIComponent(teamMembersMatch[1])) });
      const workspaceMatch = /^workspaces\/([^/]+)$/.exec(tail);
      if (workspaceMatch && request.method === "GET") return Response.json(await organizations.workspace(organizationId, identity.userId, decodeURIComponent(workspaceMatch[1])));
      if (workspaceMatch && request.method === "PATCH") {
        const input = await body<{ name?: unknown; icon?: unknown; tint?: unknown }>(request);
        if (!input || (input.name === undefined && input.icon === undefined && input.tint === undefined)) return jsonError("Choose a workspace change.", 400);
        if (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim() || input.name.length > 120)) return jsonError("Enter a workspace name.", 400);
        const updated = await organizations.updateWorkspace(organizationId, identity.userId, decodeURIComponent(workspaceMatch[1]), { ...(input.icon !== undefined ? {icon: String(input.icon)} : {}), ...(input.tint !== undefined ? {tint: String(input.tint)} : {}), ...(typeof input.name === "string" ? { name: input.name.trim() } : {}) });
        await organizationObject().fetch(new Request("https://internal/connections/changed", {method:"POST",headers:{"x-organization-id":organizationId}}));
        return Response.json(updated);
      }
      if (workspaceMatch && request.method === "DELETE") { if ((await organizations.member(organizationId, identity.userId)).role === "member") return jsonError("Only an administrator can remove a workspace.", 403); const cleanup = await organizationObject().fetch(new Request(`https://internal/hosted-workspace/${workspaceMatch[1]}`, {method:"DELETE"})); if (!cleanup.ok) return jsonError("This hosted computer could not be removed; try again.", 502); await organizations.deleteWorkspace(organizationId, identity.userId, decodeURIComponent(workspaceMatch[1])); await organizationObject().fetch(new Request("https://internal/connections/changed", {method:"POST",headers:{"x-organization-id":organizationId}})); return new Response(null, { status: 204 }); }
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
    if (input.image !== undefined && input.image !== null && !validProfileImage(input.image)) return jsonError("Choose a valid profile picture.", 400);
    const profile = await store.updateProfile(identity.userId, { ...(input.name !== undefined ? { name: input.name.trim() } : {}), ...(input.image !== undefined ? { image: input.image } : {}) });
    const memberships = await env.DB.prepare("SELECT organization_id FROM memberships WHERE user_id=?").bind(identity.userId).all<{organization_id:string}>();
    await Promise.all(memberships.results.map(row => env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${row.organization_id}`)).fetch(new Request("https://internal/profile/changed", { method:"POST", headers:{"x-organization-id":row.organization_id,"x-user-id":identity.userId} }))));
    return Response.json(profile);
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
    const durationMs = Math.max(0, dependencies.now() - startedAt);
    if (route.startsWith("/api/") && response.status !== 101) headers.append("server-timing", `app;dur=${durationMs}`);
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
      durationMs,
      outcome,
    }));
    return correlatedResponse;
  };
}

export class HubCoordinator {
  private readonly connectionDeliveries = new Map<string,Promise<void>>();
  private readonly threads: ThreadStore;
  private threadPublishing = Promise.resolve();
  private hosted?: HostedLifecycle;
  private chatgpt?: ChatGPTAccounts;
  private cursorCloud?: CursorCloudThreads;
  private readonly computers: D1ComputerStore;
  private readonly notifications: HubNotifications;
  private readonly pending = new Map<string, { computerId: string; resolve: (response: Response) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly manualStarts = new Map<string, Promise<void>>();

  constructor(private readonly ctx: DurableObjectState, readonly env: Env) {
    this.computers = new D1ComputerStore(env.DB);
    this.notifications = new HubNotifications(env.DB, (computerId, threadId) => this.threads.get(computerId, threadId));
    this.threads = new ThreadStore(new DurableStorage(ctx.storage), (frame) => { this.threadPublishing = this.threadPublishing.then(() => this.publishThreadFrame(frame)).catch(() => undefined); });
    // Tasks left the organization board and Linear sync bindings in this object's storage.
    void ctx.blockConcurrencyWhile(() => clearRetiredTasks(new DurableStorage(ctx.storage)).then(() => undefined, (error) => { console.error("Retired Tasks storage was not cleared", error); }));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return Response.json({ status: "ok" });
    const org = request.headers.get("x-organization-id");
    const user = request.headers.get("x-user-id");
    if (org) await this.ctx.storage.put("organizationId", org);
    const chatgptPath = /^\/chatgpt-account\/(status|start|cancel|logout|tokens)$/.exec(url.pathname);
    if (chatgptPath && request.method === "POST") {
      // One object per person holds and refreshes that person's ChatGPT sign-in.
      const person = request.headers.get("x-chatgpt-user");
      if (!person) return jsonError("Choose an account.", 400);
      const bound = await this.ctx.storage.get<string>("chatgpt:user");
      if (bound && bound !== person) return jsonError("This account is unavailable.", 403);
      if (!bound) await this.ctx.storage.put("chatgpt:user", person);
      const accounts = this.chatgpt ??= new ChatGPTAccounts(this.env.DB, new HostedSettingsStore(this.env.DB, () => this.env.AUTH_SECRET.get()), new DurableStorage(this.ctx.storage), undefined, this.env.CHATGPT_AUTH_ISSUER ?? undefined);
      try {
        if (chatgptPath[1] === "tokens") {
          const refresh = codexTokenRefresh(await request.arrayBuffer());
          const tokens = await accounts.tokens(person, refresh ? { rejected: refresh.rejected } : undefined);
          return tokens ? Response.json(tokens, { headers: { "cache-control": "no-store" } }) : jsonError(RECONNECT_CODEX, 409);
        }
        const account = chatgptPath[1] === "start" ? await accounts.start(person)
          : chatgptPath[1] === "cancel" ? await accounts.cancel(person)
          : chatgptPath[1] === "logout" ? await accounts.logout(person)
          : await accounts.status(person);
        return Response.json(account, { headers: { "cache-control": "no-store" } });
      } catch (error) {
        return jsonError(error instanceof Error ? error.message : "ChatGPT could not connect; try again.", 502);
      }
    }
    if (url.pathname === "/shared-computers/changed" && request.method === "POST" && org) {
      const computerId = request.headers.get("x-computer-id") ?? "";
      const organizationIds = await this.computers.sharedOrganizationIds?.(org, computerId) ?? [];
      this.computerSocket(computerId)?.send(JSON.stringify({ kind: "sharing.changed", organizationIds }));
      this.invalidateComputers();
      return Response.json({ ok: true });
    }
    if (url.pathname === "/shared-computers/request" && request.method === "POST" && org) {
      const targetOrganizationId = request.headers.get("x-target-organization-id") ?? "";
      const computerId = request.headers.get("x-computer-id") ?? "";
      const input = await body<{ actor?: unknown; method?: unknown; path?: unknown; input?: unknown }>(request);
      const actor = threadMemberSchema.safeParse(input?.actor);
      if (!actor.success || typeof input?.method !== "string" || typeof input.path !== "string" || !input.path.startsWith("/")) return jsonError("This computer request is invalid.", 400);
      if (!await this.canRelayComputer(org, targetOrganizationId, computerId, actor.data.id)) return jsonError("This computer is no longer shared.", 403);
      return this.sendComputerRequest(computerId, targetOrganizationId, actor.data, input.method, input.path, input.input);
    }
    if (url.pathname === "/shared-threads/snapshot" && request.method === "POST" && org) {
      const sourceOrganizationId = request.headers.get("x-source-organization-id") ?? "";
      const computerId = request.headers.get("x-computer-id") ?? "";
      const parsed = threadSnapshotSchema.safeParse(await request.json());
      if (!await this.canRelayComputer(sourceOrganizationId, org, computerId) || !parsed.success || parsed.data.access.organizationId !== org) return jsonError("This shared thread is unavailable.", 403);
      await this.threads.snapshot(computerId, parsed.data);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/shared-threads/manifest" && request.method === "POST" && org) {
      const sourceOrganizationId = request.headers.get("x-source-organization-id") ?? "";
      const computerId = request.headers.get("x-computer-id") ?? "";
      const input = await body<{ ids?: unknown }>(request);
      if (!await this.canRelayComputer(sourceOrganizationId, org, computerId) || !Array.isArray(input?.ids) || !input.ids.every(id => typeof id === "string")) return jsonError("This shared thread list is unavailable.", 403);
      await this.threads.manifest(computerId, input.ids);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/shared-notification" && request.method === "POST" && org) {
      const sourceOrganizationId = request.headers.get("x-source-organization-id") ?? "";
      const computerId = request.headers.get("x-computer-id") ?? "";
      const input = await body<import("@remy/contract").HubNotificationInput>(request);
      if (!await this.canRelayComputer(sourceOrganizationId, org, computerId) || !input) return jsonError("This shared notification is unavailable.", 403);
      const recipients = await this.notifications.raise(org, computerId, input);
      for (const userId of recipients ?? []) this.invalidateNotifications(userId);
      if (recipients) await this.scheduleAlarm(Date.now() + 1_000);
      return Response.json({ accepted: !!recipients });
    }
    if (url.pathname === "/internal/hosted-git-owner" && request.method === "GET") {
      const owner = await this.ctx.storage.get<{userId: string; workspaceId: string}>(`hosted-git-owner:${url.searchParams.get("computer")}`);
      return Response.json(owner ?? {});
    }
    if (url.pathname === "/profile/changed" || url.pathname === "/model-favorites/changed" || url.pathname === "/model-defaults/changed") {
      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as { kind?: string; userId?: string };
        if (attachment.kind === "organization" && (url.pathname === "/profile/changed" || attachment.userId === user) && org && attachment.userId && await new D1OrganizationStore(this.env.DB).membership(org, attachment.userId)) socket.send(JSON.stringify({ kind: url.pathname === "/profile/changed" ? "profile.changed" : url.pathname === "/model-defaults/changed" ? "model-defaults.changed" : "model-favorites.changed" }));
      }
      return Response.json({ ok: true });
    }
    if (url.pathname === "/connections/changed") {
      for (const socket of this.ctx.getWebSockets()) {
        const a=socket.deserializeAttachment() as {kind?:string;userId?:string};
        if(a.kind==="organization" && org && a.userId && await new D1OrganizationStore(this.env.DB).membership(org,a.userId)) socket.send(JSON.stringify({kind:"connections.changed"}));
      }
      return Response.json({ok:true});
    }
    if(url.pathname.startsWith("/connections/delivery/")) {
      const id=url.pathname.split("/").at(-1)!;
      let work=this.connectionDeliveries.get(id);
      if(!work) {
        work=(async()=>{
          const delivery=await this.env.DB.prepare("SELECT * FROM connection_deliveries WHERE id=?").bind(id).first<ConnectionDelivery>();
          if(!delivery || delivery.status==="done")return;
          const provider=connectionProviders(this.env).find(p=>p.id===delivery.provider);
          await provider?.receive?.(delivery);
          await this.env.DB.prepare("UPDATE connection_deliveries SET status='done' WHERE id=?").bind(id).run();
        })();
        this.connectionDeliveries.set(id,work);
      }
      try {await work;return Response.json({ok:true});} finally {if(this.connectionDeliveries.get(id)===work)this.connectionDeliveries.delete(id);}
    }
    if (url.pathname === "/organization/changed") {
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
      const sharedOrganizationIds = JSON.parse(request.headers.get("x-shared-organizations") ?? "[]") as string[];
      server.serializeAttachment({ kind: "computer", computerId, lastSeenAt: Date.now(), minimumDaemonVersion: request.headers.get("x-minimum-daemon-version") ?? "0.1.0" });
      server.send(JSON.stringify({ kind: "welcome", protocolVersion: COMPUTER_PROTOCOL_VERSION, heartbeatIntervalMs: COMPUTER_HEARTBEAT_INTERVAL_MS, threadRelay: true, notifications: true, sharedOrganizationIds }));
      await this.scheduleAlarm(Date.now() + COMPUTER_HEARTBEAT_TIMEOUT_MS);
      return new Response(null, { status: 101, webSocket: client });
    }
    const agentTool=/^\/organization-tools\/([^/]+)$/.exec(url.pathname);
    if(agentTool && request.method==="POST" && org) {
      const binding=await this.ctx.storage.get<{computerId:string;userId:string}>(`thread-run:${decodeURIComponent(agentTool[1])}`);
      if(!binding || binding.computerId!==request.headers.get("x-computer-id"))return jsonError("This thread cannot use organization tools.",403);
      const member=await new D1OrganizationStore(this.env.DB).membership(org,binding.userId);
      if(!member)return jsonError("This thread is unavailable.",403);
      const input=await body<{action?:string;input?:Record<string,unknown>}>(request);
      const action=input?.action,asked=input?.input??{},store=new D1OrganizationStore(this.env.DB);
      const threadId=decodeURIComponent(agentTool[1]);
      const reviews=new ReviewAgent(this.env.DB);
      const review=await reviews.review(org,binding.computerId,threadId);
      if(action==="report_review_findings" || action==="propose_review_rule") {
        if(!review || review.user_id!==binding.userId)return jsonError("This thread is not reviewing a pull request.",403);
        try {
          if(action==="propose_review_rule") {
            const proposal=await reviews.propose(review,asked);
            this.reviewsChanged(review.user_id,{kind:"review",computerId:review.computer_id,threadId});
            return Response.json({proposal,artifact:{kind:"review-rule",organizationId:org,computerId:review.computer_id,id:proposal.id,title:proposal.text.slice(0,200),detail:proposal.scope==="repository"?review.repository:"All workspaces"}});
          }
          const {files}=await githubFor(this.env).pullRequestFiles(org,review.user_id,review.repository,review.pull_number);
          const reported=await reviews.report(review,asked,files);
          this.reviewsChanged(review.user_id,{kind:"review",computerId:review.computer_id,threadId});
          const state=await reviews.state((await reviews.review(org,binding.computerId,threadId))!,review.user_id);
          const open=state.findings.filter(finding=>finding.status==="open");
          const count=(severity:string)=>open.filter(finding=>finding.severity===severity).length;
          return Response.json({findings:reported.ids,resolved:reported.resolved,commit:reported.commit,open:open.length,artifact:{kind:"review-findings",organizationId:org,computerId:review.computer_id,id:threadId,title:`${open.length} open finding${open.length===1?"":"s"}`,detail:[`${count("must")} must fix`,`${count("should")} should fix`,`${count("note")} note${count("note")===1?"":"s"}`].join(" · ")}});
        } catch(error) {
          return jsonError(error instanceof ConnectionError?error.message:"Your review could not be saved; try again.",error instanceof ConnectionError?error.status:500);
        }
      }
      // The review agent never posts to GitHub; its owner does, from Remy.
      if(review && action==="github_action")return jsonError("A review agent does not post to GitHub. Report findings with report_review_findings; the person adds them to their GitHub review.",403);
      if(action==="github_action") {
        const githubInput=asked as Record<string,unknown>;
        // What a thread posts carries a signed marker naming it, so Activity
        // says which thread wrote it.
        try{return Response.json(await githubFor(this.env).action(org,binding.userId,String(githubInput.workspaceId),String(githubInput.action),githubInput,{computerId:binding.computerId,threadId}));}catch{return jsonError("Your GitHub action could not complete.",400);}
      }
      if(action==="list_organization_workspaces")return Response.json({workspaces:await new OrganizationService(store).workspaces(org,binding.userId)});
      if(action==="list_organization_computers") {const threads=await this.visibleThreads(binding.userId);return Response.json({computers:(await this.computerService().list(org,binding.userId)).map(c=>({...c,activeThreads:threads.filter(t=>t.computerId===c.computerId && ["working","running","busy"].includes(String(t.detail.state))).length}))});}
      return jsonError("This organization tool is unavailable.",403);
    }
    if(url.pathname==="/codex-tokens" && request.method==="POST") {
      const computer=request.headers.get("x-computer-id");
      const task=(await this.hostedService().list()).find(s=>s.computerId===computer && s.taskId);
      if(!task?.taskId || !org)return jsonError("This computer cannot use Codex.",403);
      // A thread runs on its starter's ChatGPT for its whole life, whoever replies.
      if(!await this.ctx.storage.get<boolean>(`hosted-task-chatgpt:${task.taskId}`))return new Response(null,{status:204});
      const starter=await this.ctx.storage.get<string>(`hosted-task-owner:${task.taskId}`);
      if(!starter || !await new D1OrganizationStore(this.env.DB).membership(org,starter) || !await chatgptEnabled(this.env.DB,org,starter))return jsonError(RECONNECT_CODEX,409);
      const refresh=codexTokenRefresh(await request.arrayBuffer());
      const response=await this.env.COORDINATOR.get(this.env.COORDINATOR.idFromName(`chatgpt:${starter}`)).fetch(new Request("https://internal/chatgpt-account/tokens",{method:"POST",headers:{"x-chatgpt-user":starter,"content-type":"application/json"},body:JSON.stringify(refresh ?? {})}));
      return new Response(response.body,{status:response.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
    }
    if(url.pathname==="/computer-model-keys/changed" && request.method==="POST") {
      const computerId=request.headers.get("x-computer-id") ?? "";
      try{this.computerSocket(computerId)?.send(JSON.stringify({kind:"board.changed"}));}catch{}
      return new Response(null,{status:204});
    }
    if(url.pathname==="/environment/changed" && request.method==="POST") {
      const user=request.headers.get("x-user-id");
      for(const socket of this.ctx.getWebSockets()){const meta=socket.deserializeAttachment() as {kind?:string;userId?:string}|null;if(meta?.kind==="organization" && (!user || meta.userId===user))try{socket.send(JSON.stringify({kind:"environment.changed"}));}catch{}}
      return new Response(null,{status:204});
    }
    const removeWorkspace = /^\/hosted-workspace\/([^/]+)$/.exec(url.pathname);
    if(removeWorkspace && request.method === "DELETE") { for (const state of (await this.hostedService().list()).filter(s => s.workspaceId === decodeURIComponent(removeWorkspace[1]))) await this.hostedService().remove(state.computerId); return new Response(null,{status:204}); }
    const removeHosted=/^\/hosted-computers\/([^/]+)$/.exec(url.pathname);
    if(removeHosted && request.method==="DELETE") {try{await this.hostedService().remove(decodeURIComponent(removeHosted[1]));return Response.json({ok:true});}catch{return jsonError("This hosted computer could not be removed; try again.",502);}}
    const computerCodex = /^\/computer-account\/([^/]+)\/codex(?:\/(start|cancel|logout))?$/.exec(url.pathname);
    if (computerCodex && org && user) {
      const computerId = decodeURIComponent(computerCodex[1]);
      const computer = await this.computers.computer(org, computerId);
      if (!computer || computer.ownership === "hosted" || !await this.computerService().canManage(computer, user, org)) return jsonError("Computer not found.", 404);
      if (!(request.method === "GET" && !computerCodex[2]) && !(request.method === "POST" && computerCodex[2])) return jsonError("This account action is unavailable.", 405);
      const response = await this.dispatchComputer(computerId, { id: user, label: "Admin" }, request.method,
        `/hub/codex-account${computerCodex[2] ? `/${computerCodex[2]}` : ""}`, {});
      // A daemon from before Codex sign-in on your own computers refuses
      // anything but a hosted task; a current one never refuses a connected computer.
      if (response.status === 403) return jsonError(CODEX_NEEDS_UPDATE, 403);
      return new Response(response.body, { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    const hostedMatch=/^\/hosted\/([^/]+)$/.exec(url.pathname);
    if(hostedMatch && org){
      const workspace=decodeURIComponent(hostedMatch[1]);
      const safe=(state:Awaited<ReturnType<HostedLifecycle["get"]>>)=>state?{workspaceId:state.workspaceId,computerId:state.computerId,provider:state.provider,phase:state.phase,lastUsedAt:state.lastUsedAt,error:state.error,usage:state.usage,timing:state.timing}:null;
      if(request.method==="POST") {
        const input=await body<{provider?:HostedSettings["provider"]}>(request);
        const settings=await new HostedSettingsStore(this.env.DB,()=>this.env.AUTH_SECRET.get()).executionSettings(org,workspace,input?.provider);
        if(!settings.enabled) return jsonError("Enable hosted computers for this workspace.",409);
        if (isCursorCloudProvider(settings.provider)) return Response.json({state:null},{status:202});
        this.ctx.waitUntil(this.hostedService().ensure(workspace,settings).catch(()=>undefined).finally(()=>this.invalidateComputers()));
        await this.scheduleAlarm(Date.now()+60_000);
        return Response.json({state:safe(await this.hostedService().get(workspace))},{status:202});
      }
      if(request.method==="GET") return Response.json({state:safe(await this.hostedService().get(workspace))});
    }
    if (url.pathname === "/review-rules/changed" && request.method === "POST" && user) { this.reviewsChanged(user, { kind: "rules" }); return new Response(null, { status: 204 }); }
    const reviewResponse = await this.reviewRoute(request);
    if (reviewResponse) return reviewResponse;
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
    if (request.method === "DELETE" && url.pathname === "/storage") {
      for (const socket of this.ctx.getWebSockets()) socket.close(1001, "This organization was deleted.");
      for (const state of await this.hostedService().list()) await this.hostedService().remove(state.computerId);
      await this.ctx.storage.deleteAll();
      return new Response(null, { status: 204 });
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
      if (organizationId) await this.computers.seen(organizationId, attachment.computerId, now, frame.capabilities, frame.daemonVersion);
      socket.serializeAttachment({ ...attachment, ready: true, lastSeenAt: now });
      this.invalidateComputers();
      await this.pushRetiredHostedThreads(attachment.computerId, socket);
      return;
    }
    if (!attachment.ready) { socket.close(1008, "Introduce this computer first."); return; }
    if (this.computerSocket(attachment.computerId) !== socket) return;
    if (frame.kind === "account.changed") { this.invalidateComputers(); return; }
    if (frame.kind === "notification") {
      const targetOrganizationId = frame.organizationId ?? registeredOrg;
      if (targetOrganizationId !== registeredOrg) {
        const forwarded = await this.env.COORDINATOR.get(this.env.COORDINATOR.idFromName(`organization:${targetOrganizationId}`)).fetch(new Request("https://internal/shared-notification", { method: "POST", headers: { "content-type": "application/json", "x-organization-id": targetOrganizationId, "x-source-organization-id": registeredOrg, "x-computer-id": attachment.computerId }, body: JSON.stringify(frame.notification) }));
        if (forwarded.ok && (await forwarded.json() as {accepted?:boolean}).accepted) socket.send(JSON.stringify({ kind: "notification.ack", id: frame.notification.id }));
        return;
      }
      const recipients = await this.notifications.raise(registeredOrg, attachment.computerId, frame.notification);
      if (!recipients) return;
      socket.send(JSON.stringify({ kind: "notification.ack", id: frame.notification.id }));
      for (const userId of recipients) this.invalidateNotifications(userId);
      await this.scheduleAlarm(Date.now() + 1_000);
      return;
    }
    if (frame.kind === "thread.snapshot") {
      if (await this.ctx.storage.get(`threads:retired:${attachment.computerId}:${frame.snapshot.id}`)) {
        socket.send(JSON.stringify({ kind: "thread.retired", threadIds: [frame.snapshot.id] }));
        return;
      }
      if (frame.snapshot.access.organizationId !== organizationId) {
        const targetOrganizationId = frame.snapshot.access.organizationId;
        if (!await this.canRelayComputer(organizationId, targetOrganizationId, attachment.computerId)) return;
        await this.env.COORDINATOR.get(this.env.COORDINATOR.idFromName(`organization:${targetOrganizationId}`)).fetch(new Request("https://internal/shared-threads/snapshot", { method: "POST", headers: { "content-type": "application/json", "x-organization-id": targetOrganizationId, "x-source-organization-id": organizationId, "x-computer-id": attachment.computerId }, body: JSON.stringify(frame.snapshot) }));
        return;
      }
      await this.threads.snapshot(attachment.computerId, frame.snapshot);
      const running=(await this.threads.list()).some(t=>t.computerId===attachment.computerId && ["working","running","busy","needs_input"].includes(String(t.detail.state)));
      await this.hostedService().activity(attachment.computerId,running,frame.snapshot.detail.entries.some(e=>e.kind==="assistant"));
      return;
    }
    if (frame.kind === "thread.manifest") {
      const targetOrganizationId = frame.organizationId ?? organizationId;
      if (targetOrganizationId === organizationId) await this.threads.manifest(attachment.computerId, frame.ids);
      else {
        if (!await this.canRelayComputer(organizationId, targetOrganizationId, attachment.computerId)) return;
        await this.env.COORDINATOR.get(this.env.COORDINATOR.idFromName(`organization:${targetOrganizationId}`)).fetch(new Request("https://internal/shared-threads/manifest", { method: "POST", headers: { "content-type": "application/json", "x-organization-id": targetOrganizationId, "x-source-organization-id": organizationId, "x-computer-id": attachment.computerId }, body: JSON.stringify({ ids: frame.ids }) }));
      }
      return;
    }
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

  private readonly agentStarts=new Map<string,Promise<unknown>>();
  private async dispatchComputer(computerId:string,actor:ThreadMember,method:string,path:string,input:unknown):Promise<Response> {
    const org = (await this.ctx.storage.get<string>("organizationId"))!;
    const computer = await this.computers.computer(org, computerId);
    if (method === "POST" && path === "/hub/threads" && input && typeof input === "object" && "branch" in input && input.branch !== undefined) {
      if (typeof input.branch !== "string" || !input.branch || input.branch.length > 255) return jsonError("Choose a branch.", 400);
      if (computer?.ownership !== "hosted") {
        const workspaceId = (input as {workspaceId?: string}).workspaceId;
        const checked = await this.dispatchComputer(computerId, actor, "POST", `/workspaces/${encodeURIComponent(workspaceId ?? "")}/checkout`, {branch: input.branch, mode: "main"});
        if (!checked.ok) return checked;
      }
    }
    if(method==="POST" && (path==="/hub/threads" || /^\/hub\/threads\/[^/]+\/message$/.test(path)) && input && typeof input==="object") {
      const threadId=/^\/hub\/threads\/([^/]+)\/message$/.exec(path)?.[1];
      const thread=threadId?await this.threads.get(computerId,threadId):undefined;
      const local=computer?.capabilities.workspaces.find(w=>w.id===(input as {workspaceId?:string}).workspaceId || (thread?.detail.cwd===w.path || typeof thread?.detail.cwd==="string" && thread.detail.cwd.startsWith(w.path.replace(/\/$/,"")+"/")));
      const workspace=local?.origin?await new D1OrganizationStore(this.env.DB).workspaceByOrigin(org,repositoryOrigin(local.origin)):undefined;
      // A thread's environment is its starter's Personal values under the
      // workspace's own, read fresh for every turn so a change reaches the
      // next one. A message from a participant still carries the starter's.
      const starter=thread?.access.owner.id ?? actor.id;
      if (this.env.DEVELOPMENT_EXECUTION) {
        if (!workspace || starter !== actor.id) return jsonError("Use your own development connection in a connected workspace.",403);
        const response = await this.env.DEVELOPMENT_EXECUTION.fetch(new Request("https://internal/thread-access", {
          method:"POST", headers:{"content-type":"application/json"},
          body:JSON.stringify({userId:starter,organizationId:org,workspaceId:workspace.id}),
        }));
        if (!response.ok) return jsonError("Your production connection is unavailable. Check your development access and try again.",response.status);
        const access = await response.json() as {hubEnvironment:unknown;hubLinear:unknown};
        input={...input,hubEnvironment:access.hubEnvironment,hubLinear:access.hubLinear};
      } else {
        input={...input,hubEnvironment:await new EnvironmentStore(this.env.DB,()=>this.env.AUTH_SECRET.get()).forThread(org,workspace?.id,starter)};
        const current=input as Record<string, unknown>;
        try { input={...current, hubLinear: await linearAccountsFor(this.env).forThread(org, actor.id)}; }
        catch { input={...current, hubLinear:{kind:"off"}}; }
      }
      // Every message to a review carries its owner's rules as they are now
      // and the commit it is about, so a rule saved mid-review applies from
      // the next turn and Review new changes reaches the worktree.
      const reviews=new ReviewAgent(this.env.DB);
      const review=threadId?await reviews.review(org,computerId,threadId):undefined;
      if(review) {
        const rules=await reviews.enabledRules(review.user_id,review.repository);
        input={...(input as Record<string,unknown>),hubReview:{repository:review.repository,number:review.pull_number,title:review.title,baseRef:review.base_ref,headRef:review.head_ref,headSha:review.head_sha,stack:[],rules} satisfies HubReview};
        await reviews.rulesSent(review,rules.length);
      }
    }
    if (computer && computer.organizationId !== org) {
      const coordinator = this.env.COORDINATOR.get(this.env.COORDINATOR.idFromName(`organization:${computer.organizationId}`));
      return coordinator.fetch(new Request("https://internal/shared-computers/request", { method: "POST", headers: { "content-type": "application/json", "x-organization-id": computer.organizationId, "x-target-organization-id": org, "x-computer-id": computerId }, body: JSON.stringify({ actor, method, path, input }) }));
    }
    return this.sendComputerRequest(computerId, org, actor, method, path, input);
  }
  private async sendComputerRequest(computerId:string,organizationId:string,actor:ThreadMember,method:string,path:string,input:unknown):Promise<Response> {
    const socket=this.computerSocket(computerId);if(!socket)return jsonError("This computer is offline.",503);
    const id=crypto.randomUUID();const response=new Promise<Response>(resolve=>{const timer=setTimeout(()=>{this.pending.delete(id);resolve(jsonError("This computer did not answer.",504));},30_000);this.pending.set(id,{computerId,resolve,timer});});
    socket.send(JSON.stringify({kind:"request",id,method,path,headers:{"x-organization-id":organizationId},actor,body:input === undefined ? "" : encodeWireBody(new TextEncoder().encode(JSON.stringify(input)).buffer)}));return response;
  }
  private async routeFor(userId:string,workspaceId:string,override?:string|null) {
    const org=(await this.ctx.storage.get<string>("organizationId"))!,store=new D1OrganizationStore(this.env.DB),service=new OrganizationService(store);
    const workspace=await service.workspace(org,userId,workspaceId);
    const enabledProviders=await new HostedSettingsStore(this.env.DB,()=>this.env.AUTH_SECRET.get()).enabledProviders(org);
    const preference=await this.env.DB.prepare("SELECT computer_id FROM member_computer_preferences WHERE organization_id=? AND user_id=? AND workspace_id=?").bind(org,userId,workspaceId).first<{computer_id:string}>();
    return chooseComputer(await this.computerService().list(org,userId),{workspaceId,origin:workspace.origin,enabledProviders,...(override !== undefined ? (override ? {override} : {}) : preference ? {override:preference.computer_id} : {})});
  }
  private async taskComputer(userId:string, workspaceId:string, taskId:string, title?:string, override?:string|null, modelChoice?:{provider?:string;model?:string}, chatgpt=false, ownModel?:OwnModelTask, cloudTask?:CloudConnectionTask) {
    const org = (await this.ctx.storage.get<string>("organizationId"))!;
    let choice = cloudTask
      ? { hostedWorkspaceId: workspaceId, hostedProvider: cloudTask.provider, reason: "Your selected cloud connection." }
      : await this.routeFor(userId, workspaceId, override);
    const target = choice.computerId ? await this.computers.computer(org, choice.computerId) : undefined;
    if(target && target.ownership !== "hosted" && modelChoice?.provider && !target.capabilities.providers.some(p=>p.id===modelChoice.provider && (!modelChoice.model || p.models.includes(modelChoice.model)))) {
      if(override)throw Error("This computer cannot run your selected model; choose another computer.");
      const settings=await new HostedSettingsStore(this.env.DB,()=>this.env.AUTH_SECRET.get()).executionSettings(org,workspaceId);
      choice={reason:"A cloud computer can run your selected model.",hostedWorkspaceId:workspaceId,hostedProvider:settings.provider};
    }
    if(target && target.ownership !== "hosted" && !await this.computerService().canStartWithProvider(target, userId, org, modelChoice?.provider)) {
      if(override)throw Error(START_PROVIDER_DENIED);
      const settings=await new HostedSettingsStore(this.env.DB,()=>this.env.AUTH_SECRET.get()).executionSettings(org,workspaceId);
      choice={reason:START_PROVIDER_DENIED,hostedWorkspaceId:workspaceId,hostedProvider:settings.provider};
    }
    if (choice.hostedWorkspaceId || target?.ownership === "hosted") {
      const settingsStore = new HostedSettingsStore(this.env.DB,()=>this.env.AUTH_SECRET.get());
      const settings = cloudTask
        ? { ...await settingsStore.settings(org, workspaceId), enabled: true, provider: cloudTask.provider }
        : await settingsStore.executionSettings(org,workspaceId,choice.hostedProvider);
      const ownChatGPT = !ownModel && chatgpt && !isCursorCloudProvider(settings.provider);
      if (ownModel) {
        // Personal model credentials remain usable with organization compute.
        if (isCursorCloudProvider(settings.provider)) throw Error(OWN_MODEL_CLOUD_ONLY);
        const ownError = await ownModelError(this.env.DB,new HostedSettingsStore(this.env.DB,()=>this.env.AUTH_SECRET.get()),org,ownModel.userId,ownModel.provider,ownModel.keyId,ownModel.enrolled);
        if (ownError) throw Error(ownError);
      }
      if(ownChatGPT && !await chatgptReady(this.env.DB,org,userId)) throw Error(CHATGPT_SIGN_IN);
      if(!ownChatGPT && !ownModel && !await canStartOnCloud(new HostedSettingsStore(this.env.DB,()=>this.env.AUTH_SECRET.get()),org,userId,settings.provider,modelChoice?.provider,modelChoice?.model)) throw Error(START_PROVIDER_DENIED);
      if (isCursorCloudProvider(settings.provider)) {
        if (modelChoice?.provider && modelChoice.provider !== "cursor") throw Error(START_PROVIDER_DENIED);
        return {computerId:CURSOR_CLOUD_COMPUTER_ID,workspaceId,reason:choice.reason};
      }
      await this.ctx.storage.put(`hosted-task-owner:${taskId}`, userId);
      if (cloudTask) await this.ctx.storage.put(`hosted-task-cloud:${taskId}`, cloudTask);
      else await this.ctx.storage.delete(`hosted-task-cloud:${taskId}`);
      if (ownChatGPT) await this.ctx.storage.put(`hosted-task-chatgpt:${taskId}`, true);
      if (ownModel) await this.ctx.storage.put(`hosted-task-own-model:${taskId}`, ownModel);
      else await this.ctx.storage.delete(`hosted-task-own-model:${taskId}`);
      const spareId = await this.spareTaskId(userId, workspaceId, settings, cloudTask);
      if (await this.hostedService().claimSpare(workspaceId, settings, spareId, taskId, title)) {
        await this.ctx.storage.delete(`hosted-task-owner:${spareId}`);
        await this.ctx.storage.delete(`hosted-task-cloud:${spareId}`);
      }
      const state = await this.hostedService().ensure(workspaceId,settings,taskId,title);
      const computer = await this.computers.computer(org,state.computerId);
      choice = {computerId:state.computerId,workspaceId:computer?.capabilities.workspaces[0]?.id ?? workspaceId,reason:"A separate computer for your task."};
    } else if (ownModel) throw Error(OWN_MODEL_CLOUD_ONLY);
    if (!choice.computerId || !choice.workspaceId) throw Error(choice.reason ?? "No eligible computer is available.");
    return {computerId:choice.computerId,workspaceId:choice.workspaceId,reason:choice.reason};
  }
  private async prewarmWorkspace(workspaceId:string):Promise<void> {
    const org=await this.ctx.storage.get<string>("organizationId");if(!org || !await new D1OrganizationStore(this.env.DB).workspace(org,workspaceId))return;
    const settings=await new HostedSettingsStore(this.env.DB,()=>this.env.AUTH_SECRET.get()).executionSettings(org,workspaceId);
    if(!settings.enabled || isCursorCloudProvider(settings.provider))return;
    try{await this.hostedService().ensure(workspaceId,settings);}catch{}finally{this.invalidateComputers();await this.scheduleAlarm(Date.now()+60_000);}
  }

  private async spareTaskId(userId: string, workspaceId: string, settings: HostedSettings, cloudTask?: CloudConnectionTask) {
    const org = (await this.ctx.storage.get<string>("organizationId"))!;
    const workspace = await new D1OrganizationStore(this.env.DB).workspace(org, workspaceId);
    const fingerprint = JSON.stringify([userId, workspaceId, workspace?.origin, settings, cloudTask, this.env.HOSTED_IMAGE, this.env.HOSTED_ARCHIVE]);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint));
    return `spare:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  private async prepareNextComputer(userId: string, workspaceId: string, taskId: string, cloudTask?: CloudConnectionTask) {
    const state = await this.hostedService().get(workspaceId, taskId);
    if (!state || state.provider !== "fly-sprites") return;
    const spareId = await this.spareTaskId(userId, workspaceId, state.settings, cloudTask);
    try { await this.hostedService().prepareSpare(workspaceId, state.settings, spareId, async () => {
      await this.ctx.storage.put(`hosted-task-owner:${spareId}`, userId);
      if (cloudTask) await this.ctx.storage.put(`hosted-task-cloud:${spareId}`, cloudTask);
    }); }
    finally { await this.scheduleAlarm(Date.now() + 60_000); }
  }

  private cursorCloudThreads(): CursorCloudThreads {
    return this.cursorCloud ??= new CursorCloudThreads(this.threads, this.ctx.storage, work => this.ctx.waitUntil(work));
  }

  private async startCursorCloudThread(org: string, actor: ThreadMember, input: {
    threadId: string;
    workspaceId: string;
    origin: string;
    title?: string;
    visibility?: string;
    branch?: string;
    permissionMode?: unknown;
    text?: string;
    cloudTask?: CloudConnectionTask;
  }): Promise<{ computerId: string; threadId: string }> {
    const settings = new HostedSettingsStore(this.env.DB, () => this.env.AUTH_SECRET.get());
    const apiKey = await cursorCloudApiKey(this.env.DB, settings, org, actor.id, input.cloudTask);
    const snapshot = await this.cursorCloudThreads().create({
      id: input.threadId,
      organizationId: org,
      actor,
      workspaceId: input.workspaceId,
      origin: input.origin,
      ...(input.branch ? { startingRef: input.branch } : {}),
      ...(input.title ? { title: input.title } : {}),
      visibility: input.visibility === "open" ? "open" : "private",
      ...(input.permissionMode !== undefined ? { permissionMode: input.permissionMode } : {}),
      apiKey,
    });
    if (input.text) {
      const sent = await this.cursorCloudThreads().handle(snapshot.id, actor, "POST", "message", { text: input.text }, apiKey);
      if (!sent.ok) {
        const body = await sent.json().catch(() => undefined) as { error?: unknown } | undefined;
        throw new Error(typeof body?.error === "string" && body.error.trim() ? body.error : "This agent's message could not be sent.");
      }
    }
    if (input.cloudTask) await this.ctx.storage.put(`cursor-cloud-connection:${snapshot.id}`, { userId: actor.id, task: input.cloudTask });
    return { computerId: CURSOR_CLOUD_COMPUTER_ID, threadId: snapshot.id };
  }

  private async cursorCloudRequest(request: Request, actor: ThreadMember, id: string, action: string | undefined): Promise<Response> {
    const org = request.headers.get("x-organization-id")!;
    const snapshot = await this.cursorCloudThreads().get(id);
    if (!snapshot || !canReadThread(snapshot.access, actor.id)) return jsonError("This thread is no longer available.", 404);
    if (action !== "join" && request.method !== "GET" && !canWriteThread(snapshot.access, actor.id)) return jsonError("Join this thread before replying.", 403);
    const allowed = ((request.method === "GET" || request.method === "PATCH" || request.method === "DELETE") && !action) || (request.method === "POST" && !!action);
    if (!allowed) return jsonError("This action is not available.", 404);
    const payload = await limitedBody(request, THREAD_REQUEST_MAX_BYTES);
    if (!payload) return jsonError("Send a shorter message.", 413);
    let input: Record<string, unknown> = {};
    if (payload.byteLength) { try { input = JSON.parse(new TextDecoder().decode(payload)); } catch { return jsonError("Send a valid thread request.", 400); } }
    const connection = await this.ctx.storage.get<{ userId: string; task: CloudConnectionTask }>(`cursor-cloud-connection:${id}`);
    const apiKey = await cursorCloudApiKey(this.env.DB, new HostedSettingsStore(this.env.DB, () => this.env.AUTH_SECRET.get()), org, connection?.userId, connection?.task);
    const response = await this.cursorCloudThreads().handle(id, actor, request.method, action, input, apiKey);
    if (response.ok && request.method === "DELETE" && !action) await this.ctx.storage.delete(`cursor-cloud-connection:${id}`);
    return response;
  }

  private hostedService(): HostedLifecycle {
    if(this.hosted) return this.hosted;
    const settings=new HostedSettingsStore(this.env.DB,()=>this.env.AUTH_SECRET.get());
    this.hosted=new HostedLifecycle(new DurableStorage(this.ctx.storage),(id,state)=>{
      if(!isGuestCloudProvider(id)) throw new Error("Hosted computers are not configured.");
      if(!this.env.PROVIDER_RUNTIME && (!this.env.HOSTED_CONTROL_URL || !this.env.HOSTED_CONTROL_TOKEN)) throw new Error("Hosted computers are not configured.");
      return new HttpRuntimeProvider(id,this.env.HOSTED_CONTROL_URL ?? "https://provider.internal",
        () => this.env.PROVIDER_RUNTIME ? this.env.AUTH_SECRET.get().then(managementCredential) : this.env.HOSTED_CONTROL_TOKEN!.get(),
        this.env.PROVIDER_RUNTIME ? (input, init) => this.env.PROVIDER_RUNTIME!.get(this.env.PROVIDER_RUNTIME!.idFromName("provider-management")).fetch(new Request(input, init)) : undefined, async () => {
        const org = (await this.ctx.storage.get<string>("organizationId"))!;
        const cloudTask = state?.taskId ? await this.ctx.storage.get<CloudConnectionTask>(`hosted-task-cloud:${state.taskId}`) : undefined;
        const connection = cloudTask
          ? await cloudTaskConnection(this.env.DB, settings, org, await this.ctx.storage.get<string>(`hosted-task-owner:${state!.taskId}`) ?? "", cloudTask)
          : await settings.connection(org, id as HostedSettings["provider"]);
        if (!connection || !isGuestCloudProvider(connection.provider)) throw new Error("Connect your cloud provider in Computers settings.");
        return connection;
      });
    }, async state=>{
      const org=(await this.ctx.storage.get<string>("organizationId"))!;
      const workspace=await new D1OrganizationStore(this.env.DB).workspace(org,state.workspaceId);
      if(!workspace || !this.env.HOSTED_IMAGE) throw new Error("Hosted workspace unavailable.");
      const encoded=(buffer:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
      let keys=await this.ctx.storage.get<{publicKey:string;privateKey:string}>(`hosted-key:${state.computerId}`);
      if(!keys){const pair=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]) as CryptoKeyPair;keys={publicKey:encoded(await crypto.subtle.exportKey("spki",pair.publicKey)),privateKey:encoded(await crypto.subtle.exportKey("pkcs8",pair.privateKey))};await this.ctx.storage.put(`hosted-key:${state.computerId}`,keys);}
      const now=Date.now();
      const registration=computerRegistrationSchema.parse({computerId:state.computerId,organizationId:org,ownerUserId:null,ownership:"hosted" as const,name:hostedComputerName(workspace.name,state.computerId,state.taskId?{title:state.taskTitle}:undefined),icon:"cloud",platform:"linux" as const,daemonVersion:this.env.MINIMUM_DAEMON_VERSION??"0.1.0",protocol:{minimum:1,maximum:1},publicKey:keys.publicKey,capabilities:{providers:[],workspaces:[{id:workspace.id,name:workspace.name,path:"/workspace",origin:workspace.origin}],worktrees:true,terminals:true,emulator:false},access:{mode:"organization" as const,userIds:[],teamIds:[]},registeredAt:now,updatedAt:now});
      if(!await this.computers.computer(org,state.computerId)) await this.computers.register({...registration,lastSeenAt:null});
      await this.env.DB.prepare("INSERT INTO hosted_workspace_bindings(computer_id,organization_id,workspace_id) VALUES(?,?,?) ON CONFLICT(computer_id) DO NOTHING").bind(state.computerId,org,state.workspaceId).run();
      const taskOwner = state.taskId ? await this.ctx.storage.get<string>(`hosted-task-owner:${state.taskId}`) : undefined;
      if (taskOwner) {
        await new OrganizationService(new D1OrganizationStore(this.env.DB)).workspace(org, taskOwner, workspace.id);
        await this.ctx.storage.put(`hosted-git-owner:${state.computerId}`, {userId: taskOwner, workspaceId: workspace.id});
      }
      const actual=await this.computers.computer(org,state.computerId);
      const secrets=await settings.executionSecrets(org);
      // A thread started on its starter's own key keeps that key for its life,
      // while the starter is still a member and still allows it here.
      const ownModel = state.taskId ? await this.ctx.storage.get<OwnModelTask>(`hosted-task-own-model:${state.taskId}`) : undefined;
      if (ownModel && await ownModelError(this.env.DB,settings,org,ownModel.userId,ownModel.provider,ownModel.keyId,ownModel.enrolled)) throw new HostedStartupError(OWN_MODEL_THREAD);
      const models = state.taskId?.startsWith("spare:") ? {} : ownModel ? await ownModelEnvironment(this.env.DB,settings,org,modelSecrets(secrets),ownModel) : modelSecrets(secrets);
      const environment={...models,MC_CONFIG_DIR:"/data/remy",REMY_HOSTED_BOOTSTRAP:JSON.stringify({registration:{...actual,hubUrl:this.env.BETTER_AUTH_URL},privateKey:keys.privateKey,...(state.taskId?{taskId:state.taskId}:{}),workspace:{id:workspace.id,name:workspace.name,origin:workspace.origin}})};
      const domains=[new URL(this.env.BETTER_AUTH_URL).hostname,"api.anthropic.com","console.anthropic.com","claude.ai","api.openai.com","api.router.com","openrouter.ai","api.openrouter.ai","auth.openai.com","chatgpt.com","ab.chatgpt.com","github.com","api.github.com","codeload.github.com","objects.githubusercontent.com","release-assets.githubusercontent.com","github-releases.githubusercontent.com","ghcr.io","pkg-containers.githubusercontent.com","registry.npmjs.org"];
      return {organizationId:org,computerId:state.computerId,settings:state.settings,image:this.env.HOSTED_IMAGE,archive:this.env.HOSTED_ARCHIVE??"",environment,allowedDomains:domains};
    }, async id=>{
      for(let attempt=0;attempt<900;attempt++){if(this.computerSocket(id))return;await new Promise(resolve=>setTimeout(resolve,100));}
      throw new HostedStartupError("Your cloud computer started but did not connect to Remy. Retry to reconnect.");
    }, Date.now, id => !!this.computerSocket(id), async id => {
      const org = (await this.ctx.storage.get<string>("organizationId"))!;
      await this.computers.remove(org, id);
      await this.env.DB.prepare("DELETE FROM hosted_workspace_bindings WHERE computer_id=? AND organization_id=?").bind(id, org).run();
      this.invalidateComputers();
    });return this.hosted;
  }

  private computerService(): ComputerService {
    return new ComputerService(this.computers, Date.now, this.env.MINIMUM_DAEMON_VERSION ?? "0.1.0", new D1OrganizationStore(this.env.DB));
  }

  private async canRelayComputer(sourceOrganizationId: string, targetOrganizationId: string, computerId: string, userId?: string) {
    const computer = await this.computers.computer(sourceOrganizationId, computerId) ?? await this.computers.computer(targetOrganizationId, computerId);
    return !!computer && await this.computerService().canRelayTo(computer, targetOrganizationId, userId);
  }

  // Hub catalogue of a hosted thread. Archive and delete still succeed when
  // the computer cannot be reached, and a later snapshot must not restore it.
  private async retireHostedThread(computerId: string, threadId: string): Promise<void> {
    const ids = [threadId, ...(await this.threads.list()).filter((thread) => thread.computerId === computerId && thread.detail.parentChatId === threadId).map((thread) => thread.id)];
    for (const id of ids) await this.ctx.storage.put(`threads:retired:${computerId}:${id}`, true);
    await this.threads.removeGroup(computerId, threadId);
    const org = await this.ctx.storage.get<string>("organizationId");
    if (org) await new ReviewAgent(this.env.DB).forget(org, computerId, threadId);
    this.computerSocket(computerId)?.send(JSON.stringify({ kind: "thread.retired", threadIds: ids }));
  }
  private async pushRetiredHostedThreads(computerId: string, socket: WebSocket): Promise<void> {
    const prefix = `threads:retired:${computerId}:`;
    const ids = [...(await this.ctx.storage.list({ prefix })).keys()].map((key) => key.slice(prefix.length)).filter(Boolean);
    if (ids.length) socket.send(JSON.stringify({ kind: "thread.retired", threadIds: ids }));
  }
  private async visibleThreads(userId: string) {
    const org = await this.ctx.storage.get<string>("organizationId");
    const computers = org ? await this.computerService().list(org, userId) : [];
    const allowed = new Set(computers.filter((c) => c.canUse).map((c) => c.computerId));
    const visible = [];
    for (const thread of await this.threads.list(userId)) {
      const computer = org && await this.computers.computer(org, thread.computerId);
      if (computer && allowed.has(thread.computerId) && await this.computerService().canReadWorkspace(computer, userId, thread.detail.cwd, org)) visible.push(thread);
    }
    return visible;
  }

  private async sendOrganizationReset(socket: WebSocket, cursor = 0): Promise<void> {
    const meta = socket.deserializeAttachment() as { kind?: string; userId?: string; sessionId?: string } | null;
    if (meta?.kind !== "organization") return;
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
      const computer = computerId === CURSOR_CLOUD_COMPUTER_ID ? undefined : await this.computers.computer(organizationId, computerId);
      const readable = !!current && canReadThread(current.access, meta.userId)
        && (computerId === CURSOR_CLOUD_COMPUTER_ID || (!!computer && await this.computerService().canUse(computer, meta.userId, organizationId) && await this.computerService().canReadWorkspace(computer, meta.userId, current.detail.cwd, organizationId)));
      if (!readable) {
        if (await this.ctx.storage.get<boolean>(key)) {
          socket.send(JSON.stringify({ kind: "remove", cursor: frame.cursor, computerId, threadId }));
          await this.ctx.storage.delete(key);
        }
        return;
      }
      await this.ctx.storage.put(key, true);
      // Replays use the current access decision, never the historical visibility.
      if (frame.kind === "snapshot" && (!canReadThread(frame.thread.access, meta.userId) || (computer && !await this.computerService().canReadWorkspace(computer, meta.userId, frame.thread.detail.cwd, organizationId)))) return;
    }
    socket.send(JSON.stringify(frame));
  }

  private async publishThreadFrame(frame: ThreadLiveFrame): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      try { await this.sendThreadFrame(socket, frame); } catch { socket.close(1011, "Reconnect to continue reading this thread."); }
    }
  }

  private async manualThreadProgress(userId: string, requestId: string, record?: DurableManualThreadStart) {
    const key = `manual-task:${userId}:${requestId}`;
    const stored = record ?? await this.ctx.storage.get<DurableManualThreadStart>(key);
    if (stored?.command && stored.phase !== "ready" && stored.phase !== "failed") await this.resumeManualThread(key, stored);
    const hosted = stored?.workspaceId
      ? await this.hostedService().get(stored.workspaceId, `${userId}:${requestId}`)
      : undefined;
    const phase = threadStartProgress({ hostedPhase: hosted?.phase, record: stored });
    if (phase === "failed") {
      return { phase, error: stored?.error ?? hosted?.error ?? "Your computer could not start; try again." };
    }
    if (phase === "ready" && stored?.id && stored.computerId) return { phase, id: stored.id, computerId: stored.computerId };
    return { phase };
  }

  private async saveManualThreadStart(key: string, patch: Partial<DurableManualThreadStart>): Promise<DurableManualThreadStart> {
    const current = await this.ctx.storage.get<DurableManualThreadStart>(key);
    if (!current?.command) throw new Error("This thread start is no longer available.");
    const next = { ...current, ...patch, updatedAt: Date.now() } satisfies DurableManualThreadStart;
    await this.ctx.storage.put(key, next);
    return next;
  }

  private async resumeManualThread(key: string, record: DurableManualThreadStart): Promise<void> {
    if (record.phase === "ready" || record.phase === "failed" || this.manualStarts.has(key)) return;
    await this.scheduleAlarm(Date.now() + 15_000);
    const work = this.finishManualThread(key);
    this.manualStarts.set(key, work);
    this.ctx.waitUntil(work.finally(() => { if (this.manualStarts.get(key) === work) this.manualStarts.delete(key); }));
  }

  private async finishManualThread(
    key: string,
  ): Promise<void> {
    try {
      let record = await this.ctx.storage.get<DurableManualThreadStart>(key);
      if (!record?.command || record.phase === "ready") return;
      const input = record.command;
      const org = (await this.ctx.storage.get<string>("organizationId"))!;
      const actor = input.actor;
      const choice = await this.taskComputer(
        actor.id,
        input.workspaceId,
        `${actor.id}:${input.requestId}`,
        input.title,
        record.computerId ?? input.computerId,
        {
          ...(input.provider ? { provider: input.provider } : {}),
          ...(input.model ? { model: input.model } : {}),
        },
        input.chatgpt === true,
        input.ownModel,
        input.cloudTask,
      );
      record = await this.saveManualThreadStart(key, { computerId: choice.computerId });
      const computer = await this.computers.computer(org, choice.computerId);
      // Cursor Cloud threads run without Remy's tools, so a review there could
      // not report what it found.
      if (input.review && choice.computerId === CURSOR_CLOUD_COMPUTER_ID) throw Error(REVIEW_ON_CURSOR_CLOUD);
      if (choice.computerId === CURSOR_CLOUD_COMPUTER_ID) {
        const workspace = await new OrganizationService(new D1OrganizationStore(this.env.DB)).workspace(org, actor.id, input.workspaceId);
        if (!record.id) {
          const started = await this.startCursorCloudThread(org, actor, {
            threadId: input.requestId,
            workspaceId: input.workspaceId,
            origin: workspace.origin,
            ...(input.title ? { title: input.title } : {}),
            ...(input.visibility ? { visibility: input.visibility } : {}),
            ...(input.branch ? { branch: input.branch } : {}),
            permissionMode: input.permissionMode ?? "default",
            ...(input.cloudTask ? { cloudTask: input.cloudTask } : {}),
          });
          record = await this.saveManualThreadStart(key, { computerId: started.computerId, id: started.threadId, phase: "sending" });
        }
      } else if (!record.id) {
        if (input.branch && computer?.ownership !== "hosted") record = await this.saveManualThreadStart(key, { phase: "preparing_branch" });
        const made = await this.dispatchComputer(choice.computerId, actor, "POST", "/hub/threads", {threadId:input.requestId, workspaceId:choice.workspaceId, hubTaskId:key, permissionMode:input.permissionMode ?? "default", branch:input.branch, provider:input.provider, model:input.model, effort:input.effort, visibility:input.visibility ?? "private", title:typeof input.title === "string" ? input.title.slice(0,200) : undefined, ...(input.review ? {hubReview:input.review} : {})});
        if (!made.ok) throw new Error(await this.computerFailure(made));
        const thread = threadSnapshotSchema.parse(await made.json());
        await this.threads.snapshot(choice.computerId, thread);
        record = await this.saveManualThreadStart(key, { computerId: choice.computerId, id: thread.id, phase: "sending" });
      }
      const threadId = record.id;
      if (!threadId) throw new Error("Your computer did not return the new thread.");
      if (input.review && !record.reviewRecorded) {
        const review = input.review;
        await new ReviewAgent(this.env.DB).record({ organization_id: org, computer_id: choice.computerId, thread_id: threadId, user_id: actor.id, workspace_id: input.workspaceId, repository: review.repository, pull_number: review.number, title: review.title, base_ref: review.baseRef, head_ref: review.headRef, started_sha: review.headSha, provider: input.provider ?? null, model: input.model ?? null, rules_applied: review.rules.length });
        this.reviewsChanged(actor.id, { kind: "review", computerId: choice.computerId, threadId });
        record = await this.saveManualThreadStart(key, { reviewRecorded: true });
      }
      if (!record.messageSent) {
        const sent = choice.computerId === CURSOR_CLOUD_COMPUTER_ID
          ? await this.cursorCloudThreads().handle(threadId, actor, "POST", "message", { text: input.message, messageId: `u-${input.requestId}` }, await cursorCloudApiKey(this.env.DB, new HostedSettingsStore(this.env.DB, () => this.env.AUTH_SECRET.get()), org, actor.id, input.cloudTask))
          : await this.dispatchComputer(choice.computerId, actor, "POST", `/hub/threads/${threadId}/message`, { text: input.message, messageId: `u-${input.requestId}`, attachmentIds: [] });
        if (!sent.ok) throw new Error(await this.computerFailure(sent, "Your message could not be sent; retry your thread."));
        const updated = threadSnapshotSchema.safeParse(await sent.clone().json().catch(() => undefined));
        if (updated.success) await this.threads.snapshot(choice.computerId, updated.data);
        record = await this.saveManualThreadStart(key, { messageSent: true });
      }
      await this.saveManualThreadStart(key, { phase: "ready", id: threadId, computerId: choice.computerId, messageSent: true });
      await this.ctx.storage.put(`thread-run:${threadId}`, { computerId: choice.computerId, userId: actor.id });
      this.ctx.waitUntil(this.prepareNextComputer(actor.id, input.workspaceId, `${actor.id}:${input.requestId}`, input.cloudTask).catch(() => undefined));
      this.invalidateComputers();
      await this.scheduleAlarm(Date.now()+60_000);
    } catch (error) {
      const current = await this.ctx.storage.get<DurableManualThreadStart>(key);
      if (!current?.command || current.phase === "ready") return;
      const message = error instanceof Error ? error.message : "Your computer could not start; try again.";
      await this.ctx.storage.put(key, { ...current, started: true, phase: "failed", error: message, updatedAt: Date.now() } satisfies DurableManualThreadStart);
    }
  }

  private async computerFailure(response: Response, fallback = "Your computer could not start; try again."): Promise<string> {
    const body = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
    return typeof body?.error === "string" && body.error.trim() ? body.error : fallback;
  }

  /// The review routes, as the review's owner: their findings, proposals and
  /// Review new changes, plus a live socket that says which review changed.
  private async reviewRoute(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (url.pathname !== "/reviews" && !url.pathname.startsWith("/reviews/")) return undefined;
    let actor: ThreadMember;
    try { actor = threadMemberSchema.parse(JSON.parse(decodeURIComponent(request.headers.get("x-thread-member") ?? "null"))); } catch { return jsonError("Sign in again.", 401); }
    const org = request.headers.get("x-organization-id")!;
    if (url.pathname === "/reviews/live" && request.method === "GET") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return jsonError("Open a WebSocket connection.", 426);
      const [client, server] = Object.values(new WebSocketPair()); this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ kind: "reviews", userId: actor.id, sessionId: request.headers.get("x-thread-session") });
      server.send(JSON.stringify({ kind: "reset" }));
      return new Response(null, { status: 101, webSocket: client });
    }
    return reviewRequest(request, {
      org,
      actor,
      reviews: new ReviewAgent(this.env.DB),
      github: githubFor(this.env),
      thread: async (computerId, threadId) => {
        const snapshot = await this.threads.get(computerId, threadId);
        return snapshot && canReadThread(snapshot.access, actor.id) ? snapshot : undefined;
      },
      send: async (computerId, threadId, text) => (await this.threadRequest(new Request(`https://internal/computers/${encodeURIComponent(computerId)}/threads/${threadId}/message`, {
        method: "POST",
        headers: { "x-thread-member": request.headers.get("x-thread-member")!, "x-organization-id": org, "content-type": "application/json" },
        body: JSON.stringify({ text, messageId: `u-${crypto.randomUUID()}`, attachmentIds: [] }),
      }))) ?? jsonError("This thread is no longer available.", 404),
      changed: (userId, computerId, threadId) => this.reviewsChanged(userId, { kind: "review", computerId, threadId }),
    });
  }

  /// Tells one member's open review panes what changed, so they read it again.
  private reviewsChanged(userId: string, frame: { kind: "review"; computerId: string; threadId: string } | { kind: "rules" }): void {
    for (const socket of this.ctx.getWebSockets()) {
      const meta = socket.deserializeAttachment() as { kind?: string; userId?: string } | null;
      if (meta?.kind === "reviews" && meta.userId === userId) {
        try { socket.send(JSON.stringify(frame)); } catch { socket.close(); }
      }
    }
  }

  private async threadRequest(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    const match = /^\/computers\/([^/]+)\/threads(?:\/([0-9a-f-]{36})(?:\/(join|message|approval|question|interrupt|stop|visibility|options|attachments|archive)(?:\/([0-9a-f-]{36}))?)?)?$/.exec(url.pathname);
    const branchMatch = /^\/computers\/([^/]+)\/workspaces\/([^/]+)\/branches$/.exec(url.pathname);
    const startMatch = /^\/threads\/starts\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (!match && !branchMatch && !startMatch && url.pathname !== "/threads" && url.pathname !== "/threads/live") return undefined;
    let actor: ThreadMember;
    try { actor = threadMemberSchema.parse(JSON.parse(decodeURIComponent(request.headers.get("x-thread-member") ?? "null"))); } catch { return jsonError("Sign in again.", 401); }
    if (branchMatch) {
      if (request.method !== "GET") return jsonError("This action is not available.", 404);
      const org = request.headers.get("x-organization-id")!;
      const computerId = decodeURIComponent(branchMatch[1]), workspaceId = decodeURIComponent(branchMatch[2]);
      const target = await this.computerService().requireUse(org, computerId, actor.id);
      if (!await this.computerService().canUseWorkspace(target, actor.id, workspaceId, org)) return jsonError("This workspace is not available to you.", 404);
      return this.dispatchComputer(computerId, actor, "GET", `/workspaces/${encodeURIComponent(workspaceId)}/branches`, undefined);
    }
    const computerId = match ? decodeURIComponent(match[1]) : undefined;
    const id = match?.[2]; const action = match?.[3]; const attachmentId = match?.[4];
    if (url.pathname === "/threads" && request.method === "GET") {
      // The cursor is read first so no frame between it and the list is lost;
      // the list and the computers it is checked against are independent.
      const cursor = (await this.threads.replay()).cursor;
      const [threads, computers] = await Promise.all([
        this.visibleThreads(actor.id),
        this.computerService().list(request.headers.get("x-organization-id")!, actor.id),
      ]);
      const availability = new Map(computers.map(computer => [computer.computerId, computer.availability]));
      return Response.json({ threads: threads.map((thread) => ({ ...thread, stale: thread.stale || availability.get(thread.computerId) === "offline" })), cursor, member: actor });
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
    if (startMatch) {
      if (request.method !== "GET") return jsonError("This action is not available.", 404);
      const progress = await this.manualThreadProgress(actor.id, startMatch[1]);
      if (progress.phase === "failed") return jsonError(progress.error ?? "Your computer could not start; try again.", 409);
      return Response.json(progress, { status: 200 });
    }
    if (url.pathname === "/threads" && request.method === "POST") {
      const org = request.headers.get("x-organization-id")!;
      const input = await body<{workspaceId?: string; title?: string; message?: string; requestId?: string; computerId?:string|null; provider?:string; model?:string; effort?:unknown; permissionMode?:unknown; modelSource?:unknown; modelProvider?:unknown; modelConnection?:unknown; branch?:string; visibility?:string; review?:unknown}>(request);
      if (!input || typeof input.workspaceId !== "string" || typeof input.requestId !== "string" || !/^[0-9a-f-]{36}$/.test(input.requestId)) return jsonError("Choose a workspace and retry your thread.", 400);
      if (typeof input.message !== "string" || !input.message.trim() || input.message.length > THREAD_MESSAGE_MAX_CHARACTERS) return jsonError("Write a message of up to 64,000 characters.", 400);
      const workspace = await new OrganizationService(new D1OrganizationStore(this.env.DB)).workspace(org, actor.id, input.workspaceId);
      // A review is a thread with a pull request attached. The pull request is
      // read with your own GitHub connection and must be this workspace's.
      let review: HubReview | undefined;
      if (input.review !== undefined) {
        const asked = reviewStartSchema.safeParse(input.review);
        if (!asked.success) return jsonError("Choose a pull request to review.", 400);
        if (input.branch !== undefined) return jsonError("A review starts at the pull request's head; leave the branch out.", 400);
        if (input.computerId === CURSOR_CLOUD_COMPUTER_ID) return jsonError(REVIEW_ON_CURSOR_CLOUD, 409);
        try {
          const target = await githubFor(this.env).reviewTarget(org, actor.id, workspace.id, asked.data.repository, asked.data.number);
          review = hubReviewSchema.parse({ ...target, rules: await new ReviewAgent(this.env.DB).enabledRules(actor.id, target.repository) });
        } catch (error) {
          return jsonError(error instanceof ConnectionError ? error.message : "GitHub could not read this pull request.", error instanceof ConnectionError ? error.status : 502);
        }
        input.title = `Review #${review.number}: ${review.title}`.slice(0, 200);
      }
      if(input.computerId !== undefined && input.computerId !== null && typeof input.computerId !== "string") return jsonError("Choose a computer.",400);
      const start=hostedStartChoice(input.provider,input.model);
      if(start.provider !== undefined && !["claude","codex","cursor"].includes(start.provider))return jsonError("Choose a provider.",400);
      if(start.model !== undefined && (typeof start.model !== "string" || start.model.length>512))return jsonError("Choose a model.",400);
      if(input.effort !== undefined && (typeof input.effort !== "string" || input.effort.length>64))return jsonError("Choose a reasoning level.",400);
      if(input.permissionMode !== undefined && (typeof input.permissionMode !== "string" || !["default", "auto", "acceptEdits", "plan", "bypassPermissions"].includes(input.permissionMode))) return jsonError("Choose a permission mode.",400);
      if(input.branch !== undefined && (typeof input.branch !== "string" || !input.branch || input.branch.length > 255)) return jsonError("Choose a branch.",400);
      if(input.visibility !== undefined && input.visibility !== "private" && input.visibility !== "open") return jsonError("Choose who can read this thread.",400);
      if(input.modelSource !== undefined && input.modelSource !== "own" && input.modelSource !== "enrolled" && input.modelSource !== "organization") return jsonError("Choose where your model comes from.",400);
      const settingsStore=new HostedSettingsStore(this.env.DB,()=>this.env.AUTH_SECRET.get());
      const cloudTask = cloudConnectionTask(input.computerId);
      if (cloudTask && !await cloudTaskConnection(this.env.DB, settingsStore, org, actor.id, cloudTask)) return jsonError("This cloud connection is no longer available.", 409);
      // Personal keys are always available to their owner. An enrolled key is
      // available to every member, but both choices name the exact key id.
      let ownModel: OwnModelTask | undefined;
      if(input.modelSource === "own" || input.modelSource === "enrolled") {
        if(!isOwnKeyProvider(input.modelProvider) || typeof input.modelConnection !== "string" || !input.modelConnection) return jsonError("Choose a model connection.",400);
        const cloud=input.computerId ? cloudComputerProvider(input.computerId) : undefined;
        const hostedTarget=input.computerId && !cloud ? (await this.computers.computer(org,input.computerId))?.ownership === "hosted" : false;
        if(!(cloud && !isCursorCloudProvider(cloud)) && !hostedTarget) return jsonError(OWN_MODEL_CLOUD_ONLY,409);
        if (input.modelSource === "own") ownModel = { userId: actor.id, provider: input.modelProvider, keyId: input.modelConnection };
        else {
          const [sourceUserId, sourceProvider, ...key] = input.modelConnection.split(":");
          if (!sourceUserId || sourceProvider !== input.modelProvider || !key.length) return jsonError("Choose a model connection.", 400);
          ownModel = { userId: sourceUserId, provider: input.modelProvider, keyId: key.join(":"), enrolled: true };
        }
        const ownError=await ownModelError(this.env.DB,settingsStore,org,ownModel.userId,ownModel.provider,ownModel.keyId,ownModel.enrolled);
        if(ownError)return jsonError(ownError,409);
      }
      // Plain Codex on a cloud computer is the starter's own ChatGPT; API keys go through a `remy:` gateway model.
      const chatgpt=!ownModel && input.provider==="codex" && !(input.model ?? "").startsWith("remy:");
      const gatewayError=hostedGatewayError(start.provider,start.model,ownModel ? await ownModelSecrets(this.env.DB,settingsStore,ownModel,org) : await settingsStore.executionSecrets(org));
      if(gatewayError)return jsonError(gatewayError,400);
      if(input.computerId && !ownModel) {
        const cloud=cloudComputerProvider(input.computerId);
        if(cloud) {
          if(isCursorCloudProvider(cloud) && start.provider && start.provider !== "cursor") return jsonError(START_PROVIDER_DENIED,403);
          if(chatgpt && !isCursorCloudProvider(cloud) && !await chatgptReady(this.env.DB,org,actor.id)) return jsonError(CHATGPT_SIGN_IN,409);
          if(!(chatgpt && !isCursorCloudProvider(cloud)) && !await canStartOnCloud(new HostedSettingsStore(this.env.DB,()=>this.env.AUTH_SECRET.get()),org,actor.id,cloud,start.provider,start.model)) return jsonError(START_PROVIDER_DENIED,403);
        } else {
          const target=await this.computers.computer(org,input.computerId);
          if(target && !await this.computerService().canStartWithProvider(target,actor.id,org,start.provider)) return jsonError(START_PROVIDER_DENIED,403);
        }
      }
      const key = `manual-task:${actor.id}:${input.requestId}`;
      const previous = await this.ctx.storage.get<DurableManualThreadStart>(key);
      if (previous?.phase === "ready" && previous.id && previous.computerId && previous.messageSent) return Response.json({computerId: previous.computerId, id: previous.id, phase: "ready"}, {status: 201});
      const command = previous?.command ?? {
        actor,
        workspaceId: workspace.id,
        requestId: input.requestId,
        message: input.message,
        ...(input.title ? { title: input.title } : {}),
        ...(input.computerId !== undefined ? { computerId: input.computerId } : {}),
        ...(input.branch ? { branch: input.branch } : {}),
        ...(input.visibility ? { visibility: input.visibility } : {}),
        ...(start.provider ? { provider: start.provider } : {}),
        ...(start.model ? { model: start.model } : {}),
        ...(input.effort ? { effort: input.effort } : {}),
        ...(typeof input.permissionMode === "string" ? { permissionMode: input.permissionMode } : {}),
        ...(review ? { review } : {}),
        ...(chatgpt ? { chatgpt } : {}),
        ...(ownModel ? { ownModel } : {}),
        ...(cloudTask ? { cloudTask } : {}),
      } satisfies ManualThreadStartCommand;
      const { error: _previousError, ...retryable } = previous ?? {};
      const record = {
        ...retryable,
        command,
        started: true,
        phase: previous?.id ? "sending" : "creating",
        workspaceId: workspace.id,
        at: previous?.at ?? Date.now(),
        updatedAt: Date.now(),
      } satisfies DurableManualThreadStart;
      await this.ctx.storage.put(key, record);
      await this.resumeManualThread(key, record);
      const progress = await this.manualThreadProgress(actor.id, input.requestId, record);
      return Response.json(progress, { status: progress.id ? 201 : 202 });
    }
    if (!computerId) return jsonError("This action is not available.", 404);
    if (computerId === CURSOR_CLOUD_COMPUTER_ID) {
      if (!id) return jsonError("This action is not available.", 404);
      return this.cursorCloudRequest(request, actor, id, action);
    }
    let target;
    try { target = await this.computerService().requireUse(request.headers.get("x-organization-id")!, computerId, actor.id); } catch { return jsonError("This computer is not available to you.", 404); }
    const snapshot = id ? await this.threads.get(computerId, id) : undefined;
    if (id && (!snapshot || !canReadThread(snapshot.access, actor.id) || !await this.computerService().canReadWorkspace(target, actor.id, snapshot.detail.cwd, request.headers.get("x-organization-id")!))) return jsonError("This thread is no longer available.", 404);
    let targetAvailable = target.lastSeenAt !== null && Date.now() - target.lastSeenAt <= COMPUTER_HEARTBEAT_TIMEOUT_MS;
    if (id && !action && request.method === "GET" && !targetAvailable) return Response.json({ ...snapshot!, stale: true, member: actor });
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
        if (!targetAvailable) return jsonError("This computer is offline; try again when it reconnects.", 503);
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
    const allowed = id ? ((request.method === "GET" || request.method === "PATCH" || request.method === "DELETE") && !action) || (request.method === "POST" && !!action) : request.method === "POST";
    if (!allowed) return jsonError("This action is not available.", 404);
    const hostedRetire = Boolean(id && target.ownership === "hosted" && (request.method === "DELETE" || action === "archive"));
    if (hostedRetire) {
      await this.retireHostedThread(computerId, id!);
      return Response.json({ ok: true });
    }
    if(id && !targetAvailable && (request.method==="POST" || request.method==="PATCH" || request.method==="DELETE")) {
      const state=(await this.hostedService().list()).find(s=>s.computerId===computerId);
      if(state){try{await this.hostedService().ensure(state.workspaceId,state.settings,state.taskId);targetAvailable=true;}catch(error){return jsonError(error instanceof Error?error.message:"Your computer could not resume.",409);}}
    }
    if (!targetAvailable) {
      return jsonError("This computer is offline; try again when it reconnects.", 503);
    }
    let payload = await limitedBody(request, THREAD_REQUEST_MAX_BYTES);
    if (!payload) return jsonError("Send a shorter message.", 413);
    if (!id) {
      let input;
      try { input = JSON.parse(new TextDecoder().decode(payload)); } catch { return jsonError("Choose a workspace.", 400); }
      if(input.hubInstructions!==undefined || input.hubInbox!==undefined || input.hubEnvironment!==undefined || input.hubTaskId!==undefined || input.hubLinear!==undefined || input.hubReview!==undefined)return jsonError("This thread configuration is unavailable.",403);
      if (typeof input.workspaceId !== "string" || !await this.computerService().canUseWorkspace(target, actor.id, input.workspaceId, request.headers.get("x-organization-id")!)) return jsonError("This workspace is not available to you.", 404);
      const start=hostedStartChoice(typeof input.provider === "string" ? input.provider : undefined, typeof input.model === "string" ? input.model : undefined);
      if(!await this.computerService().canStartWithProvider(target, actor.id, request.headers.get("x-organization-id")!, start.provider)) return jsonError(START_PROVIDER_DENIED,403);
      if(target.ownership === "hosted") {
        const org=request.headers.get("x-organization-id")!;
        const state=(await this.hostedService().list()).find(s=>s.computerId===computerId);
        if(state?.settings.provider && !await canStartOnCloud(new HostedSettingsStore(this.env.DB,()=>this.env.AUTH_SECRET.get()),org,actor.id,state.settings.provider,start.provider,start.model)) return jsonError(START_PROVIDER_DENIED,403);
        // A computer booted on someone's own key runs only the thread they started.
        const own=state?.taskId ? await this.ctx.storage.get<OwnModelTask>(`hosted-task-own-model:${state.taskId}`) : undefined;
        if(own && own.userId !== actor.id) return jsonError(START_PROVIDER_DENIED,403);
      }
    }
    let input:Record<string,unknown>={};
    if(payload.byteLength){try{input=JSON.parse(new TextDecoder().decode(payload));}catch{return jsonError("Send a valid thread request.",400);}}
    if(input.hubEnvironment!==undefined || input.hubTaskId!==undefined || input.hubLinear!==undefined || input.hubReview!==undefined)return jsonError("This thread configuration is unavailable.",403);
    const referencesError=action==="message"?codeReferencesError(input.codeReferences):undefined;
    if(referencesError)return jsonError(referencesError,400);
    // A cloud Codex thread switched to plain Codex runs on its starter's ChatGPT, never an API key.
    let chatgptTask: string | undefined, chatgptModel = false;
    if (id && action === "options" && "model" in input && target.ownership === "hosted" && snapshot?.detail.provider === "codex") {
      chatgptTask = (await this.hostedService().list()).find(s => s.computerId === computerId && s.taskId)?.taskId;
      chatgptModel = isChatGPTModel("codex", input.model);
      if (chatgptTask && chatgptModel) {
        const org = request.headers.get("x-organization-id")!;
        const starter = await this.ctx.storage.get<string>(`hosted-task-owner:${chatgptTask}`);
        if (!starter || !await new D1OrganizationStore(this.env.DB).membership(org, starter) || !await chatgptReady(this.env.DB, org, starter)) return jsonError(CHATGPT_THREAD, 409);
      }
    }
    const answer=await this.dispatchComputer(computerId,actor,request.method,`/hub/threads${id?`/${id}`:""}${action?`/${action}`:""}`,input);
    if (answer.ok && chatgptTask) {
      if (chatgptModel) await this.ctx.storage.put(`hosted-task-chatgpt:${chatgptTask}`, true);
      else await this.ctx.storage.delete(`hosted-task-chatgpt:${chatgptTask}`);
    }
    if (id && (request.method === "DELETE" || action === "archive")) {
      if (answer.ok) {
        await this.threads.removeGroup(computerId, id);
        await new ReviewAgent(this.env.DB).forget(request.headers.get("x-organization-id")!, computerId, id);
        return answer;
      }
    }
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
    let manualStartDue: number | undefined;
    for (const [key, record] of await this.ctx.storage.list<DurableManualThreadStart>({ prefix: "manual-task:" })) {
      if (!record.command || record.phase === "ready" || record.phase === "failed") continue;
      await this.resumeManualThread(key, record);
      manualStartDue = Date.now() + 15_000;
    }

    await this.hostedService().idle();
    const hostedDue=(await this.hostedService().list()).length ? Date.now()+60_000 : undefined;

    const notificationOrg = await this.ctx.storage.get<string>("organizationId");
    if (notificationOrg) await this.notifications.deliver(notificationOrg, this.env);
    const now = Date.now();
    const pushDue = notificationOrg ? await this.env.DB.prepare("SELECT MIN(next_attempt_at) AS due FROM notification_pushes WHERE organization_id=?").bind(notificationOrg).first<{ due: number | null }>() : null;
    let next: number | undefined = pushDue?.due ? Math.max(Date.now() + 1000, pushDue.due) : undefined;
    if(hostedDue) next=Math.min(next ?? hostedDue,hostedDue);
    if(manualStartDue) next=Math.min(next ?? manualStartDue,manualStartDue);
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
  queue: async (batch,env,ctx) => {
    for(const message of batch.messages) {
      if("kind" in message.body && message.body.kind==="connection.webhook") {
        try {
          const response=await env.COORDINATOR.get(env.COORDINATOR.idFromName(`connection-delivery:${message.body.id}`)).fetch(`https://internal/connections/delivery/${message.body.id}`);
          if(!response.ok)throw Error("Connection delivery failed");
          message.ack();
        } catch {message.retry({delaySeconds:30});}
      } else await consumeUptimeChecks({...batch,messages:[message]} as MessageBatch<UptimeCheckFrame>,env);
    }
  },
  scheduled: (_controller, env, context) => context.waitUntil((async()=>{
    await runUptimeCheck(env);
    const pending=await env.DB.prepare("SELECT id FROM connection_deliveries WHERE status='pending' AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT 100").bind(Date.now()).all<{id:string}>();
    for(const row of pending.results) {
      await env.JOBS.send({kind:"connection.webhook",id:row.id});
      await env.DB.prepare("UPDATE connection_deliveries SET next_attempt_at=? WHERE id=?").bind(Date.now()+300_000,row.id).run();
    }
  })()),
} satisfies ExportedHandler<Env, UptimeCheckFrame | ConnectionJob>;
