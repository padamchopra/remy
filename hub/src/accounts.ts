import type { AccountStore, ClientKind, DeviceAuthorizationRecord, SessionRecord } from "./account-store.js";

const ACCESS_LIFETIME_MS = 15 * 60 * 1000;
const REFRESH_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const WEB_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const DEVICE_LIFETIME_MS = 10 * 60 * 1000;
const DEVICE_POLL_SECONDS = 5;

export type TokenPair = {
  tokenType: "Bearer";
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
};

export type AccountIdentity = { sessionId: string; userId: string; clientKind: ClientKind };

type Clock = () => number;
type Random = (bytes: number) => Uint8Array;

function defaultRandom(bytes: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(bytes));
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function tokenHash(token: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
}

function opaqueToken(random: Random): string {
  return base64url(random(32));
}

function userCode(random: Random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = random(8);
  const raw = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export class AccountService {
  constructor(
    private readonly store: AccountStore,
    private readonly now: Clock = Date.now,
    private readonly random: Random = defaultRandom,
  ) {}

  async createSession(userId: string, clientKind: ClientKind, clientName: string): Promise<TokenPair> {
    const now = this.now();
    const accessToken = opaqueToken(this.random);
    const refreshToken = clientKind === "web" ? undefined : opaqueToken(this.random);
    const accessExpiresAt = now + (clientKind === "web" ? WEB_LIFETIME_MS : ACCESS_LIFETIME_MS);
    const record: SessionRecord = {
      id: crypto.randomUUID(), userId, clientKind, clientName: clientName.trim().slice(0, 120) || clientKind,
      accessTokenHash: await tokenHash(accessToken), accessExpiresAt, createdAt: now, lastSeenAt: now,
      ...(refreshToken ? { refreshTokenHash: await tokenHash(refreshToken), refreshExpiresAt: now + REFRESH_LIFETIME_MS } : {}),
    };
    await this.store.createSession(record);
    return { tokenType: "Bearer", accessToken, expiresIn: Math.floor((accessExpiresAt - now) / 1000), ...(refreshToken ? { refreshToken } : {}) };
  }

  async authenticate(accessToken: string): Promise<AccountIdentity | undefined> {
    if (!accessToken) return undefined;
    const record = await this.store.sessionByAccessHash(await tokenHash(accessToken));
    if (!record || record.revokedAt || record.accessExpiresAt <= this.now()) return undefined;
    return { sessionId: record.id, userId: record.userId, clientKind: record.clientKind };
  }

  async refresh(refreshToken: string): Promise<TokenPair | undefined> {
    const record = await this.store.sessionByRefreshHash(await tokenHash(refreshToken));
    const now = this.now();
    if (!record || record.revokedAt || !record.refreshExpiresAt || record.refreshExpiresAt <= now || record.clientKind === "web") return undefined;
    const accessToken = opaqueToken(this.random);
    const nextRefreshToken = opaqueToken(this.random);
    const accessExpiresAt = now + ACCESS_LIFETIME_MS;
    const refreshExpiresAt = now + REFRESH_LIFETIME_MS;
    const rotated = await this.store.rotateSession(record.id, record.refreshTokenHash!, {
      accessTokenHash: await tokenHash(accessToken), refreshTokenHash: await tokenHash(nextRefreshToken),
      accessExpiresAt, refreshExpiresAt, lastSeenAt: now,
    });
    if (!rotated) return undefined;
    return { tokenType: "Bearer", accessToken, refreshToken: nextRefreshToken, expiresIn: Math.floor(ACCESS_LIFETIME_MS / 1000) };
  }

  async revokeEverywhere(userId: string): Promise<void> {
    await this.store.revokeSessions(userId, this.now());
  }

  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    const session = (await this.store.sessionsFor(userId)).find((candidate) => candidate.id === sessionId);
    if (!session) return false;
    await this.store.revokeSession(sessionId, this.now());
    return true;
  }

  async startDeviceAuthorization(clientKind: Exclude<ClientKind, "web">, clientName: string) {
    const now = this.now();
    const deviceCode = opaqueToken(this.random);
    const visibleCode = userCode(this.random);
    const record: DeviceAuthorizationRecord = {
      id: crypto.randomUUID(), deviceCodeHash: await tokenHash(deviceCode), userCodeHash: await tokenHash(visibleCode),
      clientKind, clientName: clientName.trim().slice(0, 120) || clientKind, expiresAt: now + DEVICE_LIFETIME_MS,
      intervalSeconds: DEVICE_POLL_SECONDS, createdAt: now,
    };
    await this.store.createDeviceAuthorization(record);
    return { deviceCode, userCode: visibleCode, expiresIn: DEVICE_LIFETIME_MS / 1000, interval: DEVICE_POLL_SECONDS };
  }

  async approveDevice(userId: string, visibleCode: string): Promise<"approved" | "expired" | "invalid"> {
    const record = await this.store.deviceAuthorizationByUserHash(await tokenHash(visibleCode.trim().toUpperCase()));
    if (!record) return "invalid";
    if (record.expiresAt <= this.now() || record.consumedAt || record.deniedAt) return "expired";
    await this.store.updateDeviceAuthorization(record.id, { approvedUserId: userId });
    return "approved";
  }

  async pollDevice(deviceCode: string): Promise<{ status: "pending" | "slow_down" | "expired" | "denied" } | ({ status: "approved" } & TokenPair)> {
    const record = await this.store.deviceAuthorizationByDeviceHash(await tokenHash(deviceCode));
    const now = this.now();
    if (!record || record.expiresAt <= now || record.consumedAt) return { status: "expired" };
    if (record.deniedAt) return { status: "denied" };
    if (record.lastPolledAt && now - record.lastPolledAt < record.intervalSeconds * 1000) return { status: "slow_down" };
    await this.store.updateDeviceAuthorization(record.id, { lastPolledAt: now });
    if (!record.approvedUserId) return { status: "pending" };
    if (!await this.store.consumeDeviceAuthorization(record.id, now)) return { status: "expired" };
    const pair = await this.createSession(record.approvedUserId, record.clientKind, record.clientName);
    return { status: "approved", ...pair };
  }
}

export function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice(7).trim();
    return token.length <= 512 ? token : undefined;
  }
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("remy_session="));
  if (!cookie) return undefined;
  try {
    const token = decodeURIComponent(cookie.slice("remy_session=".length));
    return token.length <= 512 ? token : undefined;
  } catch {
    return undefined;
  }
}

export function webSessionCookie(token: string, secure = true): string {
  return `remy_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${WEB_LIFETIME_MS / 1000}${secure ? "; Secure" : ""}`;
}
