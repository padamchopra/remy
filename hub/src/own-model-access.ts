import { chatgptConnected, chatgptEnabled } from "./chatgpt-account.js";
import { HostedSettingsStore } from "./hosted-settings.js";
import { modelAccess, modelAccessForKey, modelAccessIds, modelEnvironment, publicModelKeys, type ModelAccessId } from "./model-access.js";
import { D1OrganizationStore } from "./organization-store.js";
import { personalSpace } from "./personal-space.js";

export const ownModelIds = ["chatgpt", ...modelAccessIds] as const;
export type OwnModelId = typeof ownModelIds[number];
export type OwnModelKey = { id: string; name: string; active: boolean; enrolled: boolean; models: string[] };
export type EnrolledModelAccess = { connectionId: string; provider: ModelAccessId; owner: string; keyId: string; keyName: string; models: string[] };
export type OwnModelAccess = {
  personal: boolean;
  providers: { id: OwnModelId; configured: boolean; allowed: boolean; keyName: string | null; keys: OwnModelKey[]; models: string[] }[];
  enrolled: EnrolledModelAccess[];
};
export type OwnModelTask = { userId: string; provider: ModelAccessId; keyId?: string; enrolled?: boolean };

const labels: Record<OwnModelId, string> = { chatgpt: "ChatGPT", anthropic: "Anthropic", openai: "OpenAI", router: "Router.com", openrouter: "OpenRouter" };
export const ownModelLabel = (id: OwnModelId) => labels[id];
export const isOwnModelId = (value: unknown): value is OwnModelId => typeof value === "string" && (ownModelIds as readonly string[]).includes(value);
export const isOwnKeyProvider = (value: unknown): value is ModelAccessId => typeof value === "string" && (modelAccessIds as readonly string[]).includes(value);

export const OWN_MODEL_CLOUD_ONLY = "Your own keys run only on a cloud computer; choose one.";
export const OWN_MODEL_THREAD = "This thread’s model connection is no longer available. Choose another model.";
export const ownModelMissing = (id: OwnModelId) => id === "chatgpt"
  ? "Sign in to ChatGPT in Model access first."
  : `Add your ${labels[id]} key in Model access first.`;
export const ownModelOff = (id: OwnModelId) => `This ${labels[id]} connection is no longer enrolled in this organization.`;

function parseIds(value: string | null | undefined): string[] | null {
  if (value == null) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed : [];
  } catch { return []; }
}

function selectedKeys<T extends { id: string; active: boolean }>(keys: T[], stored: string | null | undefined): T[] {
  const ids = parseIds(stored);
  if (ids) return keys.filter((key) => ids.includes(key.id));
  const active = keys.find((key) => key.active) ?? keys[0];
  return active ? [active] : [];
}

async function enrollment(db: D1Database, org: string, userId: string, provider: ModelAccessId) {
  return db.prepare("SELECT key_ids FROM organization_own_model_access WHERE organization_id=? AND user_id=? AND provider=?")
    .bind(org, userId, provider).first<{ key_ids: string | null }>();
}

async function personalKey(db: D1Database, store: HostedSettingsStore, userId: string, provider: ModelAccessId, keyId?: string) {
  const personal = await personalSpace(db, userId);
  const secrets = await store.secrets(personal.id);
  const entry = modelAccessForKey(provider, secrets, keyId);
  if (!entry?.enabled || !entry.apiKey) return;
  return { entry };
}

async function validEnrolledKey(db: D1Database, store: HostedSettingsStore, org: string, task: OwnModelTask) {
  const row = await enrollment(db, org, task.userId, task.provider);
  if (!row) return;
  const personal = await personalSpace(db, task.userId);
  const secrets = await store.secrets(personal.id);
  const keys = selectedKeys(publicModelKeys(task.provider, secrets), row.key_ids);
  const key = task.keyId ? keys.find((item) => item.id === task.keyId) : keys.find((item) => item.active) ?? keys[0];
  return key ? personalKey(db, store, task.userId, task.provider, key.id) : undefined;
}

export async function ownModelAccess(db: D1Database, store: HostedSettingsStore, org: string, userId: string): Promise<OwnModelAccess> {
  const personal = await personalSpace(db, userId);
  if (personal.id === org) return { personal: true, providers: [], enrolled: [] };
  const organizations = new D1OrganizationStore(db);
  if (!await organizations.membership(org, userId)) throw new OwnModelAccessError("Organization not found.", 404);
  const secrets = await store.secrets(personal.id);
  const ownRows = (await db.prepare("SELECT provider,key_ids FROM organization_own_model_access WHERE organization_id=? AND user_id=?")
    .bind(org, userId).all<{ provider: ModelAccessId; key_ids: string | null }>()).results;
  const ownByProvider = new Map(ownRows.map((row) => [row.provider, row.key_ids]));
  const providers: OwnModelAccess["providers"] = [{ id: "chatgpt", configured: await chatgptConnected(db, userId, store.development), allowed: await chatgptEnabled(db, org, userId), keyName: null, keys: [], models: [] }];
  for (const entry of modelAccess(secrets)) {
    const keys = publicModelKeys(entry.id, secrets);
    const selected = new Set(selectedKeys(keys, ownByProvider.get(entry.id)).map((key) => key.id));
    const configured = entry.enabled && keys.length > 0;
    providers.push({
      id: entry.id,
      configured,
      allowed: configured,
      keyName: configured ? keys.find((key) => key.active)?.name ?? keys[0]?.name ?? null : null,
      keys: keys.map((key) => ({ ...key, enrolled: ownByProvider.has(entry.id) && selected.has(key.id), models: modelAccessForKey(entry.id, secrets, key.id)?.models ?? [] })),
      models: entry.id === "router" || entry.id === "openrouter" ? entry.models : [],
    });
  }
  const grants = (await db.prepare("SELECT user_id,provider,key_ids FROM organization_own_model_access WHERE organization_id=? ORDER BY updated_at,user_id,provider")
    .bind(org).all<{ user_id: string; provider: ModelAccessId; key_ids: string | null }>()).results;
  const enrolled: EnrolledModelAccess[] = [];
  for (const grant of grants) {
    if (grant.user_id === userId) continue;
    const source = await personalSpace(db, grant.user_id);
    const sourceSecrets = await store.secrets(source.id);
    const owner = (await db.prepare("SELECT name FROM user WHERE id=?").bind(grant.user_id).first<{ name: string }>())?.name ?? "Member";
    for (const key of selectedKeys(publicModelKeys(grant.provider, sourceSecrets), grant.key_ids)) {
      const entry = modelAccessForKey(grant.provider, sourceSecrets, key.id);
      if (entry?.enabled && entry.apiKey) enrolled.push({ connectionId: `${grant.user_id}:${grant.provider}:${key.id}`, provider: grant.provider, owner, keyId: key.id, keyName: key.name, models: entry.models });
    }
  }
  return { personal: false, providers, enrolled };
}

export class OwnModelAccessError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function setOwnModelAccess(db: D1Database, store: HostedSettingsStore, org: string, userId: string, id: OwnModelId, allowed: boolean, keyIds?: string[], now = Date.now()) {
  if ((await personalSpace(db, userId)).id === org) throw new OwnModelAccessError("Your own keys already run your Personal threads.", 409);
  if (id === "chatgpt") throw new OwnModelAccessError("Your ChatGPT subscription stays personal.", 409);
  if (allowed) {
    const personal = await personalSpace(db, userId);
    const secrets = await store.secrets(personal.id);
    const available = publicModelKeys(id, secrets);
    const selected = keyIds?.length ? [...new Set(keyIds)] : selectedKeys(available, null).map((key) => key.id);
    if (!selected.length || selected.some((keyId) => !available.some((key) => key.id === keyId)) || !await personalKey(db, store, userId, id, selected[0])) throw new OwnModelAccessError(ownModelMissing(id), 409);
    await db.prepare("INSERT INTO organization_own_model_access(organization_id,user_id,provider,updated_at,key_ids) VALUES(?,?,?,?,?) ON CONFLICT(organization_id,user_id,provider) DO UPDATE SET updated_at=excluded.updated_at,key_ids=excluded.key_ids")
      .bind(org, userId, id, now, JSON.stringify(selected)).run();
  } else await db.prepare("DELETE FROM organization_own_model_access WHERE organization_id=? AND user_id=? AND provider=?").bind(org, userId, id).run();
  return ownModelAccess(db, store, org, userId);
}

export async function ownModelError(db: D1Database, store: HostedSettingsStore, org: string, userId: string, provider: ModelAccessId, keyId?: string, enrolled = false): Promise<string | undefined> {
  if (!await new D1OrganizationStore(db).membership(org, userId)) return OWN_MODEL_THREAD;
  const key = enrolled ? await validEnrolledKey(db, store, org, { userId, provider, ...(keyId ? { keyId } : {}), enrolled }) : await personalKey(db, store, userId, provider, keyId);
  if (!key) return enrolled ? ownModelOff(provider) : ownModelMissing(provider);
}

export async function ownModelSecrets(db: D1Database, store: HostedSettingsStore, task: OwnModelTask, org?: string) {
  const key = task.enrolled && org ? await validEnrolledKey(db, store, org, task) : await personalKey(db, store, task.userId, task.provider, task.keyId);
  return key ? { [`access:${task.provider}`]: JSON.stringify({ apiKey: key.entry.apiKey, enabled: true, models: key.entry.models }) } : {};
}

const variables: Record<ModelAccessId, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"], openai: ["OPENAI_API_KEY"], router: ["RAMP_ROUTER_API_KEY", "RAMP_ROUTER_MODELS"], openrouter: ["OPENROUTER_API_KEY", "OPENROUTER_MODELS"],
};

export async function ownModelEnvironment(db: D1Database, store: HostedSettingsStore, orgOrBase: string | Record<string, string>, baseOrTask: Record<string, string> | OwnModelTask, maybeTask?: OwnModelTask) {
  const org = typeof orgOrBase === "string" ? orgOrBase : "";
  const base = typeof orgOrBase === "string" ? baseOrTask as Record<string, string> : orgOrBase;
  const task = (maybeTask ?? baseOrTask) as OwnModelTask;
  const key = task.enrolled ? await validEnrolledKey(db, store, org, task) : await personalKey(db, store, task.userId, task.provider, task.keyId);
  if (!key) throw new Error(task.enrolled ? ownModelOff(task.provider) : ownModelMissing(task.provider));
  const environment = { ...base };
  for (const name of variables[task.provider]) delete environment[name];
  const selected = modelEnvironment({ [`access:${task.provider}`]: JSON.stringify({ apiKey: key.entry.apiKey, enabled: true, models: key.entry.models }) });
  for (const name of variables[task.provider]) if (selected[name] !== undefined) environment[name] = selected[name];
  return environment;
}
