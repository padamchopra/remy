import type { ChatGPTAccount } from "@remy/contract";
import { HostedSettingsStore } from "./hosted-settings.js";
import { personalSpace } from "./personal-space.js";
import type { KeyValueStorage } from "./durable-storage.js";

// Mirrors the official Codex CLI's ChatGPT device-code login and token refresh:
// openai/codex codex-rs/login/src/device_code_auth.rs (user code, polling),
// codex-rs/login/src/server.rs `exchange_code_for_tokens` (form-encoded code exchange),
// codex-rs/login/src/auth/manager.rs `request_chatgpt_token_refresh` and `CLIENT_ID`
// (JSON refresh grant), and codex-rs/login/src/oauth/client.rs (grant parameters).
export const CHATGPT_ISSUER = "https://auth.openai.com";
export const CHATGPT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
/// Codex waits 15 minutes for the person to enter the code.
const DEVICE_CODE_LIFETIME_MS = 15 * 60_000;
/// A token served to a task stays valid at least this long.
const REFRESH_MARGIN_MS = 5 * 60_000;
const PENDING = "chatgpt:pending";
const FAILED = "chatgpt:error";
export const RECONNECT_CODEX = "Reconnect Codex to continue.";

type Stored = {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  accountId: string;
  email?: string;
  expiresAt: number;
  refreshedAt: number;
};
type Pending = { deviceAuthId: string; userCode: string; intervalMs: number; nextPollAt: number; expiresAt: number };

function claims(jwt: string): Record<string, unknown> {
  try {
    const part = jwt.split(".")[1] ?? "";
    const text = atob(part.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/// The ChatGPT account id and email Codex reads from the id token
/// (codex-rs/login/src/token_data.rs).
function identity(idToken: string) {
  const token = claims(idToken);
  const auth = token["https://api.openai.com/auth"] as { chatgpt_account_id?: unknown } | undefined;
  const profile = token["https://api.openai.com/profile"] as { email?: unknown } | undefined;
  const email = typeof token.email === "string" ? token.email : typeof profile?.email === "string" ? profile.email : undefined;
  return { accountId: typeof auth?.chatgpt_account_id === "string" ? auth.chatgpt_account_id : "", ...(email ? { email } : {}) };
}

async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/// Plain Codex on a cloud computer is the thread starter's ChatGPT; an API key
/// runs through a `remy:` gateway model. `null` is Codex's default model.
export function isChatGPTModel(provider: unknown, model: unknown) {
  return provider === "codex" && (model === null || model === undefined || (typeof model === "string" && !model.startsWith("remy:")));
}

function expiry(accessToken: string, now: number) {
  const exp = claims(accessToken).exp;
  return typeof exp === "number" ? exp * 1000 : now + 55 * 60_000;
}

/// One person's ChatGPT sign-in. The hub is the only holder of the refresh
/// token: it lives sealed in D1 under that person's Personal scope, one
/// Durable Object per person refreshes it, and callers get only a
/// short-lived access token and account id.
export class ChatGPTAccounts {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly db: D1Database,
    private readonly store: HostedSettingsStore,
    private readonly storage: KeyValueStorage,
    // Workers reject a detached `fetch`; call it through a closure.
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
    private readonly issuer = CHATGPT_ISSUER,
    private readonly now: () => number = Date.now,
  ) {}

  /// Everything touching the stored tokens runs one at a time, so a rotated
  /// refresh token is never spent twice.
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async scope(userId: string) {
    const personal = await personalSpace(this.db, userId);
    return personal.id;
  }

  private async load(userId: string): Promise<Stored | undefined> {
    const org = await this.scope(userId);
    const row = await this.db.prepare("SELECT ciphertext FROM personal_chatgpt_accounts WHERE organization_id=? AND user_id=?").bind(org, userId).first<{ ciphertext: string }>();
    if (!row) return;
    return JSON.parse(await this.store.unseal(`${org}:chatgpt`, row.ciphertext)) as Stored;
  }

  private async save(userId: string, value: Stored) {
    const org = await this.scope(userId);
    const sealed = await this.store.seal(`${org}:chatgpt`, JSON.stringify(value));
    await this.db.prepare("INSERT INTO personal_chatgpt_accounts(organization_id,user_id,ciphertext,updated_at) VALUES(?,?,?,?) ON CONFLICT(organization_id) DO UPDATE SET ciphertext=excluded.ciphertext,updated_at=excluded.updated_at")
      .bind(org, userId, sealed, this.now()).run();
  }

  private async forget(userId: string) {
    await this.db.prepare("DELETE FROM personal_chatgpt_accounts WHERE organization_id=? AND user_id=?").bind(await this.scope(userId), userId).run();
  }

  private async post(path: string, body: string, contentType: string) {
    return this.fetcher(`${this.issuer}${path}`, { method: "POST", headers: { "content-type": contentType }, body, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  }

  private public(stored: Stored | undefined, pending: Pending | undefined, error: string | undefined): ChatGPTAccount {
    if (pending) return { phase: "pending", userCode: pending.userCode, verificationUrl: `${this.issuer}/codex/device` };
    if (stored) return { phase: "connected", ...(stored.email ? { email: stored.email } : {}) };
    if (error) return { phase: "error", error };
    return { phase: "signedOut" };
  }

  /// Phase and email only; a pending sign-in is polled here, at Codex's interval.
  status(userId: string): Promise<ChatGPTAccount> {
    return this.serial(async () => {
      let pending = await this.storage.get<Pending>(PENDING);
      if (pending) pending = await this.poll(userId, pending);
      return this.public(await this.load(userId), pending, await this.storage.get<string>(FAILED));
    });
  }

  start(userId: string): Promise<ChatGPTAccount> {
    return this.serial(async () => {
      const response = await this.post("/api/accounts/deviceauth/usercode", JSON.stringify({ client_id: CHATGPT_CLIENT_ID }), "application/json");
      if (response.status === 404) throw new Error("Turn on device code sign-in in your ChatGPT security settings, then try again.");
      if (!response.ok) throw new Error("ChatGPT could not start a sign-in; try again.");
      const value = await response.json() as { device_auth_id?: unknown; user_code?: unknown; usercode?: unknown; interval?: unknown };
      const userCode = typeof value.user_code === "string" ? value.user_code : typeof value.usercode === "string" ? value.usercode : "";
      if (typeof value.device_auth_id !== "string" || !userCode) throw new Error("ChatGPT could not start a sign-in; try again.");
      const interval = Number.parseInt(String(value.interval ?? "5"), 10);
      const now = this.now();
      const pending: Pending = { deviceAuthId: value.device_auth_id, userCode, intervalMs: Math.max(1, Number.isFinite(interval) ? interval : 5) * 1000, nextPollAt: now, expiresAt: now + DEVICE_CODE_LIFETIME_MS };
      await this.storage.put(PENDING, pending);
      await this.storage.delete(FAILED);
      return this.public(await this.load(userId), pending, undefined);
    });
  }

  cancel(userId: string): Promise<ChatGPTAccount> {
    return this.serial(async () => {
      await this.storage.delete(PENDING);
      await this.storage.delete(FAILED);
      return this.public(await this.load(userId), undefined, undefined);
    });
  }

  /// Signing out removes the stored tokens. A running thread fails its next
  /// refresh and asks the person to reconnect.
  logout(userId: string): Promise<ChatGPTAccount> {
    return this.serial(async () => {
      await this.storage.delete(PENDING);
      await this.storage.delete(FAILED);
      await this.forget(userId);
      return { phase: "signedOut" };
    });
  }

  private async poll(userId: string, pending: Pending): Promise<Pending | undefined> {
    const now = this.now();
    if (now >= pending.expiresAt) {
      await this.storage.delete(PENDING);
      await this.storage.put(FAILED, "Your code expired. Connect Codex again.");
      return;
    }
    if (now < pending.nextPollAt) return pending;
    const response = await this.post("/api/accounts/deviceauth/token", JSON.stringify({ device_auth_id: pending.deviceAuthId, user_code: pending.userCode }), "application/json");
    if (response.status === 403 || response.status === 404) {
      const next = { ...pending, nextPollAt: now + pending.intervalMs };
      await this.storage.put(PENDING, next);
      return next;
    }
    await this.storage.delete(PENDING);
    if (!response.ok) {
      await this.storage.put(FAILED, "ChatGPT didn’t approve that sign-in. Connect Codex again.");
      return;
    }
    const code = await response.json() as { authorization_code?: unknown; code_verifier?: unknown };
    if (typeof code.authorization_code !== "string" || typeof code.code_verifier !== "string") {
      await this.storage.put(FAILED, "ChatGPT didn’t approve that sign-in. Connect Codex again.");
      return;
    }
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CHATGPT_CLIENT_ID,
      code: code.authorization_code,
      redirect_uri: `${this.issuer}/deviceauth/callback`,
      code_verifier: code.code_verifier,
    });
    const exchanged = await this.post("/oauth/token", form.toString(), "application/x-www-form-urlencoded");
    const tokens = exchanged.ok ? await exchanged.json() as { id_token?: unknown; access_token?: unknown; refresh_token?: unknown } : {};
    if (typeof tokens.id_token !== "string" || typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string") {
      await this.storage.put(FAILED, "ChatGPT didn’t approve that sign-in. Connect Codex again.");
      return;
    }
    const who = identity(tokens.id_token);
    if (!who.accountId) {
      await this.storage.put(FAILED, "Sign in with a ChatGPT account that has a plan.");
      return;
    }
    await this.save(userId, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, idToken: tokens.id_token, ...who, expiresAt: expiry(tokens.access_token, now), refreshedAt: now });
    await this.storage.delete(FAILED);
    return;
  }

  /// A short-lived access token and account id, refreshed first when it is
  /// close to expiring. `undefined` means the person is signed out.
  ///
  /// `refresh` means Codex was refused. With the SHA-256 of the token it had,
  /// a caller that another request already rotated past gets the newer token;
  /// otherwise the hub really refreshes.
  tokens(userId: string, refresh?: { rejected?: string | undefined }): Promise<{ accessToken: string; chatgptAccountId: string } | undefined> {
    return this.serial(async () => {
      const stored = await this.load(userId);
      if (!stored) return;
      const now = this.now();
      const rotated = !!refresh?.rejected && refresh.rejected !== await sha256(stored.accessToken);
      const fresh = stored.expiresAt - now > REFRESH_MARGIN_MS;
      if (fresh && (!refresh || rotated)) return { accessToken: stored.accessToken, chatgptAccountId: stored.accountId };
      const response = await this.post("/oauth/token", JSON.stringify({ client_id: CHATGPT_CLIENT_ID, grant_type: "refresh_token", refresh_token: stored.refreshToken }), "application/json");
      if (response.status === 400 || response.status === 401) {
        // Codex treats these as permanent: expired, reused or revoked.
        await this.forget(userId);
        await this.storage.put(FAILED, RECONNECT_CODEX);
        return;
      }
      if (!response.ok) throw new Error("ChatGPT could not refresh your sign-in; try again.");
      const next = await response.json() as { id_token?: unknown; access_token?: unknown; refresh_token?: unknown };
      if (typeof next.access_token !== "string") throw new Error("ChatGPT could not refresh your sign-in; try again.");
      const idToken = typeof next.id_token === "string" ? next.id_token : stored.idToken;
      const who = identity(idToken);
      const refreshed: Stored = {
        accessToken: next.access_token,
        refreshToken: typeof next.refresh_token === "string" ? next.refresh_token : stored.refreshToken,
        idToken,
        accountId: who.accountId || stored.accountId,
        ...(who.email ?? stored.email ? { email: who.email ?? stored.email } : {}),
        expiresAt: expiry(next.access_token, now),
        refreshedAt: now,
      };
      await this.save(userId, refreshed);
      return { accessToken: refreshed.accessToken, chatgptAccountId: refreshed.accountId };
    });
  }
}

/// A person's subscription is available to the threads they start in every
/// organization they belong to. Organization enrollment never shares it.
export async function chatgptEnabled(_db: D1Database, _organizationId: string, _userId: string) { return true; }

export async function setChatGPTEnabled(db: D1Database, organizationId: string, userId: string, enabled: boolean, now = Date.now()) {
  await db.prepare("INSERT INTO organization_chatgpt_access(organization_id,user_id,enabled,updated_at) VALUES(?,?,?,?) ON CONFLICT(organization_id,user_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at")
    .bind(organizationId, userId, enabled ? 1 : 0, now).run();
}

/// Whether a person has a stored sign-in, without opening it.
export async function chatgptConnected(db: D1Database, userId: string) {
  return !!await db.prepare("SELECT 1 AS present FROM personal_chatgpt_accounts WHERE user_id=?").bind(userId).first();
}
