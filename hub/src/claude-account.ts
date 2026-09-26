import { ComputerAccountStore } from "./computer-accounts.js";
import type { HostedClaudeAccount } from "@remy/contract";

/// Claude Code's public OAuth client. A connected computer signs in the same
/// way Claude Code does on that machine; Remy never mints a second client.
export const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const CLAUDE_OAUTH_AUTH_URL = "https://claude.ai/oauth/authorize";
export const CLAUDE_OAUTH_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
export const CLAUDE_OAUTH_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
export const CLAUDE_OAUTH_SCOPES = [
  "org:create_api_key",
  "user:inference",
  "user:mcp_servers",
  "user:profile",
  "user:sessions:claude_code",
];
export const CLAUDE_ACCOUNT_SECRET = "account:claude";
export const CLAUDE_PENDING_SECRET = "account:claude:pending";
const REFRESH_BUFFER_MS = 5 * 60_000;

type StoredClaude = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  subscription?: string;
};
type PendingClaude = { state: string; codeVerifier: string; expiresAt: number; verificationUrl: string };

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function parseStored(saved: string | undefined): StoredClaude | undefined {
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved) as Partial<StoredClaude>;
    if (typeof parsed.accessToken !== "string" || typeof parsed.refreshToken !== "string" || typeof parsed.expiresAt !== "number")
      return;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes.filter((scope): scope is string => typeof scope === "string") : CLAUDE_OAUTH_SCOPES,
      ...(typeof parsed.subscription === "string" ? { subscription: parsed.subscription } : {}),
    };
  } catch {
    return;
  }
}

function parsePending(saved: string | undefined): PendingClaude | undefined {
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved) as Partial<PendingClaude>;
    if (typeof parsed.state !== "string" || typeof parsed.codeVerifier !== "string" || typeof parsed.expiresAt !== "number")
      return;
    return {
      state: parsed.state,
      codeVerifier: parsed.codeVerifier,
      expiresAt: parsed.expiresAt,
      verificationUrl: typeof parsed.verificationUrl === "string" ? parsed.verificationUrl : `${CLAUDE_OAUTH_AUTH_URL}?code=true`,
    };
  } catch {
    return;
  }
}

function credentialsJson(stored: StoredClaude) {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresAt: stored.expiresAt,
      scopes: stored.scopes,
      subscriptionType: stored.subscription ?? "unknown",
    },
  });
}

function publicAccount(stored: StoredClaude | undefined, pending: PendingClaude | undefined, now: number): HostedClaudeAccount {
  if (pending && pending.expiresAt > now) {
    return { phase: "pending", verificationUrl: pending.verificationUrl };
  }
  if (stored) {
    return {
      phase: "connected",
      ...(stored.subscription ? { subscription: stored.subscription } : {}),
    };
  }
  return { phase: "signedOut" };
}

export function publicClaudeAccount(secrets: Record<string, string>, now = Date.now()): HostedClaudeAccount {
  return publicAccount(parseStored(secrets[CLAUDE_ACCOUNT_SECRET]), parsePending(secrets[CLAUDE_PENDING_SECRET]), now);
}

async function tokenRequest(body: Record<string, string>) {
  const response = await fetch(CLAUDE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
    subscription_type?: unknown;
    error?: unknown;
    error_description?: unknown;
  };
  if (!response.ok) {
    const description = typeof payload.error_description === "string" ? payload.error_description : undefined;
    if (payload.error === "invalid_grant") throw Error(description ?? "Reconnect Claude Code; this sign-in has expired.");
    throw Error(description ?? "Claude Code could not connect; try again.");
  }
  if (typeof payload.access_token !== "string" || typeof payload.refresh_token !== "string" || typeof payload.expires_in !== "number")
    throw Error("Claude Code could not connect; try again.");
  const scopes = typeof payload.scope === "string"
    ? payload.scope.split(" ").filter(Boolean)
    : Array.isArray(payload.scope) ? payload.scope.filter((scope): scope is string => typeof scope === "string") : CLAUDE_OAUTH_SCOPES;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
    scopes: scopes.length ? scopes : CLAUDE_OAUTH_SCOPES,
    ...(typeof payload.subscription_type === "string" ? { subscription: payload.subscription_type } : {}),
  } satisfies StoredClaude;
}

async function persist(store: ComputerAccountStore, computerId: string, stored: StoredClaude) {
  await store.setSecret(computerId, CLAUDE_ACCOUNT_SECRET, JSON.stringify(stored));
  await store.setSecret(computerId, CLAUDE_PENDING_SECRET, null);
}

async function refreshIfNeeded(store: ComputerAccountStore, computerId: string, stored: StoredClaude): Promise<StoredClaude> {
  if (stored.expiresAt - Date.now() > REFRESH_BUFFER_MS) return stored;
  try {
    const next = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
      client_id: CLAUDE_OAUTH_CLIENT_ID,
    });
    const subscription = next.subscription ?? stored.subscription;
    const merged = subscription ? { ...next, subscription } : next;
    await persist(store, computerId, merged);
    return merged;
  } catch (error) {
    if (error instanceof Error && /expired/i.test(error.message)) await store.setSecret(computerId, CLAUDE_ACCOUNT_SECRET, null);
    throw error;
  }
}

export async function claudeAccountStatus(store: ComputerAccountStore, computerId: string): Promise<HostedClaudeAccount> {
  const secrets = await store.secrets(computerId);
  const pending = parsePending(secrets[CLAUDE_PENDING_SECRET]);
  if (pending && pending.expiresAt <= Date.now()) await store.setSecret(computerId, CLAUDE_PENDING_SECRET, null);
  const stored = parseStored(secrets[CLAUDE_ACCOUNT_SECRET]);
  if (!stored) return publicClaudeAccount(await store.secrets(computerId));
  try {
    const fresh = await refreshIfNeeded(store, computerId, stored);
    return publicAccount(fresh, undefined, Date.now());
  } catch {
    return { phase: "error", error: "Reconnect Claude Code; this sign-in has expired." };
  }
}

export async function startClaudeAccount(store: ComputerAccountStore, computerId: string): Promise<HostedClaudeAccount> {
  const state = crypto.randomUUID();
  const codeVerifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier))));
  const params = new URLSearchParams({
    code: "true",
    client_id: CLAUDE_OAUTH_CLIENT_ID,
    response_type: "code",
    redirect_uri: CLAUDE_OAUTH_REDIRECT_URI,
    scope: CLAUDE_OAUTH_SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  const verificationUrl = `${CLAUDE_OAUTH_AUTH_URL}?${params}`;
  await store.setSecret(computerId, CLAUDE_PENDING_SECRET, JSON.stringify({
    state,
    codeVerifier,
    expiresAt: Date.now() + 10 * 60_000,
    verificationUrl,
  } satisfies PendingClaude));
  return { phase: "pending", verificationUrl };
}

export async function completeClaudeAccount(store: ComputerAccountStore, computerId: string, input: unknown): Promise<HostedClaudeAccount> {
  const code = typeof input === "object" && input && "code" in input && typeof input.code === "string" ? input.code.trim() : "";
  if (!code) throw Error("Paste the code Claude shows you.");
  const [authorizationCode, pastedState] = code.split("#");
  const pending = parsePending((await store.secrets(computerId))[CLAUDE_PENDING_SECRET]);
  if (!pending || pending.expiresAt <= Date.now()) {
    await store.setSecret(computerId, CLAUDE_PENDING_SECRET, null);
    throw Error("This sign-in expired. Connect Claude Code again.");
  }
  if (pastedState && pastedState !== pending.state) throw Error("This code does not match this sign-in. Connect Claude Code again.");
  const stored = await tokenRequest({
    grant_type: "authorization_code",
    code: authorizationCode,
    state: pending.state,
    redirect_uri: CLAUDE_OAUTH_REDIRECT_URI,
    client_id: CLAUDE_OAUTH_CLIENT_ID,
    code_verifier: pending.codeVerifier,
  });
  await persist(store, computerId, stored);
  return publicAccount(stored, undefined, Date.now());
}

export async function cancelClaudeAccount(store: ComputerAccountStore, computerId: string): Promise<HostedClaudeAccount> {
  await store.setSecret(computerId, CLAUDE_PENDING_SECRET, null);
  return publicClaudeAccount(await store.secrets(computerId));
}

export async function logoutClaudeAccount(store: ComputerAccountStore, computerId: string): Promise<HostedClaudeAccount> {
  await store.setSecret(computerId, CLAUDE_ACCOUNT_SECRET, null);
  await store.setSecret(computerId, CLAUDE_PENDING_SECRET, null);
  return { phase: "signedOut" };
}

/// Refreshes the connected account and returns the file Claude Code reads.
/// Values stay out of management APIs; only the computer that owns them receives them.
export async function claudeComputerEnvironment(
  store: ComputerAccountStore,
  computerId: string,
): Promise<Record<string, string>> {
  const stored = parseStored((await store.secrets(computerId))[CLAUDE_ACCOUNT_SECRET]);
  if (!stored) return {};
  try {
    const fresh = await refreshIfNeeded(store, computerId, stored);
    return { CLAUDE_CREDENTIALS_JSON: credentialsJson(fresh) };
  } catch {
    return {};
  }
}
