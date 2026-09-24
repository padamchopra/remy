import { CLOUD_COMPUTER_PROVIDERS, type HostedSettings } from "@remy/contract";
import { z } from "zod";
import type { HostedSettingsStore } from "./hosted-settings.js";
export const cloudConnectionSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("fly-sprites"), enabled: z.boolean().default(false), token: z.string().trim().min(1).max(8192) }).strict(),
  z.object({ provider: z.literal("modal"), enabled: z.boolean().default(false), tokenId: z.string().trim().min(1).max(8192), tokenSecret: z.string().trim().min(1).max(8192) }).strict(),
  z.object({ provider: z.literal("cursor-cloud"), enabled: z.boolean().default(false), token: z.string().trim().min(1).max(8192) }).strict(),
]);
export type CloudConnection = z.infer<typeof cloudConnectionSchema>;
export const cloudConnectionKey = (provider: string) => `cloud:${provider}`;
/// Named keys live in a second secret so execution still reads the active
/// `cloud:` connection. The name avoids the `cloud:` prefix used for those.
export const namedCloudSecret = (provider: string) => `named-cloud:${provider}`;
export { modelEnvironment as modelSecrets } from "./model-access.js";

export const cloudToggleSchema = z.object({ provider: z.enum(CLOUD_COMPUTER_PROVIDERS), enabled: z.boolean() }).strict();
export const namedCloudKeyWrite = z.object({
  provider: z.enum(CLOUD_COMPUTER_PROVIDERS),
  name: z.string().trim().min(1).max(80).optional(),
  token: z.string().trim().min(1).max(8192).optional(),
  tokenId: z.string().trim().min(1).max(8192).optional(),
  tokenSecret: z.string().trim().min(1).max(8192).optional(),
  active: z.boolean().optional(),
}).strict();
const namedCloudKey = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  token: z.string().trim().min(1).max(8192).optional(),
  tokenId: z.string().trim().min(1).max(8192).optional(),
  tokenSecret: z.string().trim().min(1).max(8192).optional(),
}).strict();
const namedCloudSet = z.object({
  keys: z.array(namedCloudKey).max(20),
  activeKeyId: z.string().min(1).max(80).optional(),
}).strict();
export type PublicNamedKey = { id: string; name: string; active: boolean };

function parseNamedCloudSet(saved: string | undefined) {
  if (!saved) return;
  try {
    const parsed = namedCloudSet.safeParse(JSON.parse(saved));
    return parsed.success ? parsed.data : undefined;
  } catch { return; }
}

function parseConnection(saved: string | undefined) {
  if (!saved) return;
  try {
    const parsed = cloudConnectionSchema.safeParse(JSON.parse(saved));
    return parsed.success ? parsed.data : undefined;
  } catch { return; }
}

function credentialsFrom(connection: CloudConnection) {
  return connection.provider === "modal"
    ? { tokenId: connection.tokenId, tokenSecret: connection.tokenSecret }
    : { token: connection.token };
}

function connectionFrom(provider: CloudConnection["provider"], enabled: boolean, key: z.infer<typeof namedCloudKey>): CloudConnection {
  if (provider === "modal") {
    if (!key.tokenId || !key.tokenSecret) throw Error("Enter your token ID and secret.");
    return { provider, enabled, tokenId: key.tokenId, tokenSecret: key.tokenSecret };
  }
  if (!key.token) throw Error("Enter your API key.");
  return { provider, enabled, token: key.token };
}

function unusedName(keys: { name: string }[], wanted: string) {
  const used = new Set(keys.map((key) => key.name.toLowerCase()));
  if (!used.has(wanted.toLowerCase())) return wanted;
  for (let n = 2; n < 100; n += 1) {
    const next = `${wanted} ${n}`;
    if (!used.has(next.toLowerCase())) return next;
  }
  throw Error("Choose a different name.");
}

export function publicCloudKeys(provider: string, secrets: Record<string, string>): PublicNamedKey[] {
  const stored = parseNamedCloudSet(secrets[namedCloudSecret(provider)]);
  if (stored?.keys.length) {
    const active = stored.activeKeyId && stored.keys.some((key) => key.id === stored.activeKeyId)
      ? stored.activeKeyId
      : stored.keys[0].id;
    return stored.keys.map((key) => ({ id: key.id, name: key.name, active: key.id === active }));
  }
  return parseConnection(secrets[cloudConnectionKey(provider)])
    ? [{ id: "legacy", name: "Default", active: true }]
    : [];
}

export function publicProviderKeys(secrets: Record<string, string>) {
  return Object.fromEntries(
    CLOUD_COMPUTER_PROVIDERS.map((provider) => [provider, publicCloudKeys(provider, secrets)]),
  ) as Record<HostedSettings["provider"], PublicNamedKey[]>;
}

export async function saveNamedCloudKey(store: HostedSettingsStore, org: string, input: unknown, keyId?: string) {
  const patch = namedCloudKeyWrite.parse(input);
  const secrets = await store.secrets(org);
  const connection = parseConnection(secrets[cloudConnectionKey(patch.provider)]);
  const stored = parseNamedCloudSet(secrets[namedCloudSecret(patch.provider)]) ?? { keys: [] as z.infer<typeof namedCloudKey>[] };
  if (!stored.keys.length && connection) {
    stored.keys.push({ id: crypto.randomUUID(), name: "Default", ...credentialsFrom(connection) });
    stored.activeKeyId = stored.keys[0].id;
  }
  const targetId = keyId && keyId !== "legacy" ? keyId : undefined;
  let key = targetId ? stored.keys.find((entry) => entry.id === targetId) : undefined;
  if (targetId && !key) throw Error("This key is unavailable.");
  const name = (patch.name ?? key?.name ?? unusedName(stored.keys, "Default")).trim();
  if (!name) throw Error("Name this key.");
  if (stored.keys.some((entry) => entry.id !== key?.id && entry.name.toLowerCase() === name.toLowerCase()))
    throw Error("Choose a different name.");
  if (!key) {
    if (stored.keys.length >= 20) throw Error("Remove a key before adding another.");
    key = { id: crypto.randomUUID(), name };
    stored.keys.push(key);
  }
  key.name = name;
  if (patch.token) key.token = patch.token;
  if (patch.tokenId) key.tokenId = patch.tokenId;
  if (patch.tokenSecret) key.tokenSecret = patch.tokenSecret;
  if (patch.active || !stored.activeKeyId || !stored.keys.some((entry) => entry.id === stored.activeKeyId))
    stored.activeKeyId = key.id;
  const active = stored.keys.find((entry) => entry.id === stored.activeKeyId) ?? key;
  await store.setSecret(org, namedCloudSecret(patch.provider), JSON.stringify(stored));
  await store.setSecret(org, cloudConnectionKey(patch.provider), JSON.stringify(connectionFrom(patch.provider, connection?.enabled ?? true, active)));
  return publicCloudKeys(patch.provider, await store.secrets(org));
}

export async function removeNamedCloudKey(store: HostedSettingsStore, org: string, provider: HostedSettings["provider"], keyId: string) {
  const secrets = await store.secrets(org);
  const connection = parseConnection(secrets[cloudConnectionKey(provider)]);
  const stored = parseNamedCloudSet(secrets[namedCloudSecret(provider)]);
  if (keyId === "legacy" && !stored?.keys.length) {
    await store.setSecret(org, cloudConnectionKey(provider), null);
    return [];
  }
  if (!stored) throw Error("This key is unavailable.");
  const next = stored.keys.filter((key) => key.id !== keyId);
  if (next.length === stored.keys.length) throw Error("This key is unavailable.");
  if (!next.length) {
    await store.setSecret(org, namedCloudSecret(provider), null);
    await store.setSecret(org, cloudConnectionKey(provider), null);
    return [];
  }
  const activeKeyId = stored.activeKeyId === keyId || !next.some((key) => key.id === stored.activeKeyId)
    ? next[0].id
    : stored.activeKeyId;
  const active = next.find((key) => key.id === activeKeyId)!;
  await store.setSecret(org, namedCloudSecret(provider), JSON.stringify({ keys: next, activeKeyId }));
  await store.setSecret(org, cloudConnectionKey(provider), JSON.stringify(connectionFrom(provider, connection?.enabled ?? true, active)));
  return publicCloudKeys(provider, await store.secrets(org));
}

export async function managementCredential(secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("remy-provider-management-v1"));
  return Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, "0")).join("");
}
