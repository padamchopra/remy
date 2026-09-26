import { createHash } from "node:crypto";
import { getKv, setKv } from "./db.js";
import { openSecret, rememberSecrets, sealSecret } from "./environments.js";
import { LINEAR_MCP_URL, type LinearHttpMcp } from "./linear-mcp.js";
import { localLinearAccess, type LocalLinearAccess } from "./linear-accounts.js";

const HUB_THREAD_ACCESS = "hubThreadAccess";

type Sealed = { ciphertext: string; iv: string; tag: string };
type Stored =
  | { kind: "off" }
  | { kind: "notice"; notice: string }
  | { kind: "ready"; sealed: Sealed; url: string; fingerprint: string };

function key(chatId: string) {
  return `hubLinear:${chatId}`;
}

function isHubThread(chatId: string) {
  const rows = getKv<Record<string, unknown>>(HUB_THREAD_ACCESS);
  return !!rows && Object.prototype.hasOwnProperty.call(rows, chatId);
}

/// The hub delivers the starter's token on the computer channel. It is sealed
/// here and never written onto the thread.
export function setHubLinear(chatId: string, value: unknown) {
  const scope = key(chatId);
  if (!value || typeof value !== "object") return;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "off") {
    setKv(scope, { kind: "off" } satisfies Stored);
    rememberSecrets(scope, []);
    return;
  }
  if (kind === "notice" && typeof (value as { notice?: unknown }).notice === "string") {
    const notice = (value as { notice: string }).notice.slice(0, 300);
    setKv(scope, { kind: "notice", notice } satisfies Stored);
    rememberSecrets(scope, []);
    return;
  }
  const ready = value as { token?: unknown; url?: unknown };
  if (kind !== "ready" || typeof ready.token !== "string" || ready.url !== LINEAR_MCP_URL) {
    setKv(scope, { kind: "off" } satisfies Stored);
    rememberSecrets(scope, []);
    return;
  }
  setKv(scope, {
    kind: "ready",
    sealed: sealSecret(ready.token),
    url: LINEAR_MCP_URL,
    fingerprint: createHash("sha256").update(ready.token).digest("hex").slice(0, 16),
  } satisfies Stored);
  rememberSecrets(scope, [ready.token]);
}

function hubAccess(chatId: string): LocalLinearAccess {
  const stored = getKv<Stored>(key(chatId));
  if (!stored || stored.kind === "off") return { kind: "off" };
  if (stored.kind === "notice") return { kind: "notice", notice: stored.notice };
  if (stored.url !== LINEAR_MCP_URL) return { kind: "off" };
  const token = openSecret(stored.sealed);
  if (!token) return { kind: "notice", notice: "Reconnect your account in Connections." };
  rememberSecrets(key(chatId), [token]);
  return { kind: "ready", token, url: LINEAR_MCP_URL, fingerprint: stored.fingerprint };
}

export function linearAccess(chatId: string): LocalLinearAccess {
  return isHubThread(chatId) ? hubAccess(chatId) : localLinearAccess();
}

export function linearNotice(chatId: string) {
  const access = linearAccess(chatId);
  return access.kind === "notice" ? access.notice : undefined;
}

export function linearHttpAttachment(chatId: string): LinearHttpMcp & { fingerprint: string } | undefined {
  const access = linearAccess(chatId);
  if (access.kind !== "ready") return undefined;
  return { name: "linear", url: access.url, token: access.token, fingerprint: access.fingerprint };
}
