import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { getKv, setKv } from "./db.js";
import { provider, type ProviderId } from "./providers.js";

const KV_KEY = "external_mcp_capabilities";

function capabilities(): Partial<Record<ProviderId, string>> {
  const saved = getKv<Record<string, unknown>>(KV_KEY) ?? {};
  return Object.fromEntries(Object.entries(saved).flatMap(([id, nonce]) =>
    provider(id) && typeof nonce === "string" && nonce ? [[id, nonce]] : []
  ));
}

function signature(id: ProviderId, nonce: string): string {
  return createHmac("sha256", config.token)
    .update(`remy-external-mcp:${id}:${nonce}`)
    .digest("base64url");
}

/// Enables a separately revocable capability for a provider launched outside
/// Remy. The provider's config holds only its name; the MCP child mints the
/// signed token from Remy's local database when it starts.
export function enableExternalMcp(value: unknown): void {
  const selected = provider(value);
  if (!selected) throw new Error("no such provider");
  const saved = capabilities();
  saved[selected.id] = randomBytes(24).toString("base64url");
  setKv(KV_KEY, saved);
}

export function disableExternalMcp(value: unknown): void {
  const selected = provider(value);
  if (!selected) throw new Error("no such provider");
  const saved = capabilities();
  delete saved[selected.id];
  setKv(KV_KEY, saved);
}

export function externalMcpEnabled(value: unknown): boolean {
  const selected = provider(value);
  return Boolean(selected && capabilities()[selected.id]);
}

/// Mints the bearer token inside the local MCP child, never in provider
/// settings or command-line arguments.
export function externalMcpToken(value: unknown): string | undefined {
  const selected = provider(value);
  if (!selected) return undefined;
  const nonce = capabilities()[selected.id];
  return nonce ? `remy.external.${selected.id}.${signature(selected.id, nonce)}` : undefined;
}

/// Returns the provider named by a valid, currently enabled external MCP
/// capability. Removing the integration deletes its nonce and invalidates every
/// MCP child that was already running.
export function externalMcpProvider(authorization: string | undefined): ProviderId | undefined {
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const match = /^remy\.external\.([a-z]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  const selected = provider(match?.[1]);
  if (!match || !selected) return undefined;
  const nonce = capabilities()[selected.id];
  if (!nonce) return undefined;
  const expected = Buffer.from(signature(selected.id, nonce));
  const received = Buffer.from(match[2]);
  return expected.length === received.length && timingSafeEqual(expected, received)
    ? selected.id
    : undefined;
}
