import { createPrivateKey, sign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { connect, type ClientHttp2Session } from "node:http2";
import { join } from "node:path";
import { configDir } from "./paths.js";

/// Apple Push credentials for this machine. The key never lives in the
/// database: it is a file next to remy.db, or environment variables, so a
/// clone of the repo cannot ship it.

export interface ApnsCredentials {
  keyId: string;
  teamId: string;
  bundleId: string;
  key: string;
  production: boolean;
}

export interface ApnsNotification {
  token: string;
  title: string;
  body: string;
  /// Where tapping should land, typically `remy://chat/<id>`.
  click?: string;
  session?: string;
  deviceId?: string;
  highPriority?: boolean;
}

export type ApnsResult = { ok: true } | { ok: false; status: number; reason: string };

const KEY_ID = /^[A-Z0-9]{10}$/;
const TEAM_ID = /^[A-Z0-9]{10}$/;
/// Native device tokens are 32 bytes (64 hex). Apple has used other lengths;
/// anything that is not even-length hex is garbage.
const DEVICE_TOKEN = /^[0-9a-f]{64,200}$/i;

let cached: ApnsCredentials | undefined | null;
let jwt: { token: string; at: number } | undefined;
let session: { client: ClientHttp2Session; production: boolean } | undefined;

export function apnsDeviceToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const token = value.trim();
  return DEVICE_TOKEN.test(token) ? token.toLowerCase() : undefined;
}

/// Reads credentials once. `null` means they are absent, so callers skip Push
/// rather than retrying a file that is not there.
export function apnsCredentials(): ApnsCredentials | undefined {
  if (cached !== undefined) return cached ?? undefined;
  cached = loadCredentials();
  return cached ?? undefined;
}

/// Tests inject credentials without writing ~/.remy/apns.json.
export function setApnsCredentialsForTest(next: ApnsCredentials | null): void {
  cached = next;
  jwt = undefined;
  if (session) {
    session.client.close();
    session = undefined;
  }
}

function loadCredentials(): ApnsCredentials | null {
  const fromEnv = fromEnvironment();
  if (fromEnv) return fromEnv;
  const path = join(configDir, "apns.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return credentialsFrom(parsed);
  } catch (error) {
    console.error("apns.json is not usable:", error);
    return null;
  }
}

function fromEnvironment(): ApnsCredentials | null {
  const keyId = process.env.REMY_APNS_KEY_ID;
  const teamId = process.env.REMY_APNS_TEAM_ID;
  const bundleId = process.env.REMY_APNS_BUNDLE_ID;
  const key = process.env.REMY_APNS_KEY ?? (process.env.REMY_APNS_KEY_PATH
    ? readFileSync(process.env.REMY_APNS_KEY_PATH, "utf8")
    : undefined);
  if (!keyId && !teamId && !bundleId && !key) return null;
  return credentialsFrom({
    keyId,
    teamId,
    bundleId,
    key,
    production: process.env.REMY_APNS_PRODUCTION === "1" || process.env.REMY_APNS_PRODUCTION === "true",
  });
}

function credentialsFrom(parsed: Record<string, unknown>): ApnsCredentials | null {
  const keyId = typeof parsed.keyId === "string" ? parsed.keyId.trim() : "";
  const teamId = typeof parsed.teamId === "string" ? parsed.teamId.trim() : "";
  const bundleId = typeof parsed.bundleId === "string" ? parsed.bundleId.trim() : "";
  let key = typeof parsed.key === "string" ? parsed.key.trim() : "";
  if (!key && typeof parsed.keyPath === "string" && parsed.keyPath.trim()) {
    try {
      key = readFileSync(parsed.keyPath.trim(), "utf8").trim();
    } catch {
      return null;
    }
  }
  key = key.replace(/\\n/g, "\n");
  if (!KEY_ID.test(keyId) || !TEAM_ID.test(teamId) || !bundleId || !key.includes("PRIVATE KEY")) {
    return null;
  }
  return {
    keyId,
    teamId,
    bundleId,
    key,
    production: parsed.production === true,
  };
}

/// ES256 JWT Apple accepts for an hour. Minted lazily and reused.
export function apnsJwt(creds: ApnsCredentials, now = Math.floor(Date.now() / 1000)): string {
  if (jwt && now - jwt.at < 50 * 60) return jwt.token;
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: creds.keyId })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: creds.teamId, iat: now })).toString("base64url");
  const unsigned = `${header}.${claims}`;
  const signature = sign("SHA256", Buffer.from(unsigned), {
    key: createPrivateKey(creds.key),
    dsaEncoding: "ieee-p1363",
  });
  const token = `${unsigned}.${signature.toString("base64url")}`;
  jwt = { token, at: now };
  return token;
}

export function apnsHost(production: boolean): string {
  return production ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
}

export function apnsPayload(evt: ApnsNotification): Record<string, unknown> {
  return {
    aps: {
      alert: { title: evt.title, body: evt.body },
      sound: evt.highPriority ? "default" : undefined,
      "thread-id": evt.session,
    },
    click: evt.click,
    session: evt.session,
    deviceId: evt.deviceId,
  };
}

export async function sendApns(evt: ApnsNotification): Promise<ApnsResult> {
  const creds = apnsCredentials();
  if (!creds) return { ok: false, status: 0, reason: "not-configured" };
  const token = apnsDeviceToken(evt.token);
  if (!token) return { ok: false, status: 400, reason: "BadDeviceToken" };

  const client = sessionFor(creds);
  const payload = JSON.stringify(apnsPayload(evt));
  return await new Promise((resolve) => {
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${apnsJwt(creds)}`,
      "apns-topic": creds.bundleId,
      "apns-push-type": "alert",
      "apns-priority": evt.highPriority ? "10" : "5",
      "content-type": "application/json",
    });
    let status = 0;
    const chunks: Buffer[] = [];
    req.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("error", (error) => {
      resolve({ ok: false, status: 0, reason: error.message });
    });
    req.on("end", () => {
      if (status === 200) {
        resolve({ ok: true });
        return;
      }
      let reason = "unknown";
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { reason?: string };
        if (typeof body.reason === "string") reason = body.reason;
      } catch {
        // Apple's error body is JSON; if it is not, the status is enough.
      }
      resolve({ ok: false, status, reason });
    });
    req.end(payload);
  });
}

function sessionFor(creds: ApnsCredentials): ClientHttp2Session {
  if (session && !session.client.closed && session.production === creds.production) return session.client;
  if (session) session.client.close();
  const client = connect(apnsHost(creds.production));
  client.on("error", () => {
    if (session?.client === client) session = undefined;
  });
  session = { client, production: creds.production };
  return client;
}
