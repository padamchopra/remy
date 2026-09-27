import { chatgptConnected, chatgptEnabled, setChatGPTEnabled } from "./chatgpt-account.js";
import { HostedSettingsStore } from "./hosted-settings.js";
import { modelAccess, modelAccessIds, modelEnvironment, publicModelKeys, type ModelAccessId } from "./model-access.js";
import { D1OrganizationStore } from "./organization-store.js";
import { personalSpace } from "./personal-space.js";

export const ownModelIds = ["chatgpt", ...modelAccessIds] as const;
export type OwnModelId = typeof ownModelIds[number];
export type OwnModelAccess = {
  personal: boolean;
  providers: { id: OwnModelId; configured: boolean; allowed: boolean; keyName: string | null; models: string[] }[];
};
/// What a thread started on its starter's own key remembers for its life.
export type OwnModelTask = { userId: string; provider: ModelAccessId };

const labels: Record<OwnModelId, string> = { chatgpt: "ChatGPT", anthropic: "Anthropic", openai: "OpenAI", router: "Router.com", openrouter: "OpenRouter" };
export const ownModelLabel = (id: OwnModelId) => labels[id];
export const isOwnModelId = (value: unknown): value is OwnModelId => typeof value === "string" && (ownModelIds as readonly string[]).includes(value);
export const isOwnKeyProvider = (value: unknown): value is ModelAccessId => typeof value === "string" && (modelAccessIds as readonly string[]).includes(value);

export const OWN_MODEL_CLOUD_ONLY = "Your own keys run only on a cloud computer; choose one.";
export const OWN_MODEL_THREAD = "This thread’s starter hasn’t turned on their own key here. Choose another model.";
export const ownModelMissing = (id: OwnModelId) => id === "chatgpt"
  ? "Sign in to ChatGPT in Personal model access first."
  : `Add your ${labels[id]} key in Personal model access first.`;
export const ownModelOff = (id: OwnModelId) => `Turn on your own ${labels[id]} key for this organization first.`;

async function switched(db: D1Database, org: string, userId: string, provider: ModelAccessId) {
  return !!await db.prepare("SELECT 1 AS present FROM organization_own_model_access WHERE organization_id=? AND user_id=? AND provider=?").bind(org, userId, provider).first();
}

/// Your key for one provider from your Personal model access, when it is on
/// there and holds a key. Never another person's, and never an organization's.
async function personalKey(db: D1Database, store: HostedSettingsStore, userId: string, provider: ModelAccessId) {
  const personal = await personalSpace(db, userId);
  const secrets = await store.secrets(personal.id);
  const entry = modelAccess(secrets).find((value) => value.id === provider)!;
  if (!entry.enabled || !entry.apiKey) return;
  return { secrets, entry };
}

/// Each of your own keys, whether it can run here and whether you turned it on
/// for this organization. Names and model lists only, never a value.
export async function ownModelAccess(db: D1Database, store: HostedSettingsStore, org: string, userId: string): Promise<OwnModelAccess> {
  const personal = await personalSpace(db, userId);
  if (personal.id === org) return { personal: true, providers: [] };
  const secrets = await store.secrets(personal.id);
  const access = modelAccess(secrets);
  const providers: OwnModelAccess["providers"] = [{
    id: "chatgpt",
    configured: await chatgptConnected(db, userId),
    allowed: await chatgptEnabled(db, org, userId),
    keyName: null,
    models: [],
  }];
  for (const entry of access) {
    const configured = entry.enabled && !!entry.apiKey;
    providers.push({
      id: entry.id,
      configured,
      allowed: await switched(db, org, userId, entry.id),
      keyName: configured ? publicModelKeys(entry.id, secrets).find((key) => key.active)?.name ?? null : null,
      models: entry.id === "router" || entry.id === "openrouter" ? entry.models : [],
    });
  }
  return { personal: false, providers };
}

export class OwnModelAccessError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/// Turns one of your own keys on or off for an organization. ChatGPT keeps its
/// own switch; the API keys are off until you turn them on.
export async function setOwnModelAccess(db: D1Database, store: HostedSettingsStore, org: string, userId: string, id: OwnModelId, allowed: boolean, now = Date.now()) {
  if ((await personalSpace(db, userId)).id === org) throw new OwnModelAccessError("Your own keys always run your Personal threads.", 409);
  if (id === "chatgpt") {
    if (allowed && !await chatgptConnected(db, userId)) throw new OwnModelAccessError(ownModelMissing(id), 409);
    await setChatGPTEnabled(db, org, userId, allowed, now);
  } else if (allowed) {
    if (!await personalKey(db, store, userId, id)) throw new OwnModelAccessError(ownModelMissing(id), 409);
    await db.prepare("INSERT INTO organization_own_model_access(organization_id,user_id,provider,updated_at) VALUES(?,?,?,?) ON CONFLICT(organization_id,user_id,provider) DO UPDATE SET updated_at=excluded.updated_at").bind(org, userId, id, now).run();
  } else {
    await db.prepare("DELETE FROM organization_own_model_access WHERE organization_id=? AND user_id=? AND provider=?").bind(org, userId, id).run();
  }
  return ownModelAccess(db, store, org, userId);
}

/// Why a person cannot run a thread on their own key here, or nothing when
/// they can. Checked at start and again whenever the task computer boots, so a
/// removed membership, a switch turned off, or a removed key stops it.
export async function ownModelError(db: D1Database, store: HostedSettingsStore, org: string, userId: string, provider: ModelAccessId): Promise<string | undefined> {
  if ((await personalSpace(db, userId)).id === org) return "Choose a model from your model access.";
  if (!await new D1OrganizationStore(db).membership(org, userId)) return OWN_MODEL_THREAD;
  if (!await personalKey(db, store, userId, provider)) return ownModelMissing(provider);
  if (!await switched(db, org, userId, provider)) return ownModelOff(provider);
}

/// The starter's Personal model access, for validating a gateway model
/// against their own key rather than the organization's.
export async function ownModelSecrets(db: D1Database, store: HostedSettingsStore, userId: string, provider: ModelAccessId) {
  const key = await personalKey(db, store, userId, provider);
  if (!key) return {};
  return Object.fromEntries(Object.entries(key.secrets).filter(([name]) => name === `access:${provider}` || name === `named-access:${provider}`));
}

const variables: Record<ModelAccessId, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  router: ["RAMP_ROUTER_API_KEY", "RAMP_ROUTER_MODELS"],
  openrouter: ["OPENROUTER_API_KEY", "OPENROUTER_MODELS"],
};

/// A task computer's model environment: the organization's, with the one
/// provider the starter picked replaced by their own key.
export async function ownModelEnvironment(db: D1Database, store: HostedSettingsStore, base: Record<string, string>, task: OwnModelTask) {
  const key = await personalKey(db, store, task.userId, task.provider);
  if (!key) throw new Error(ownModelMissing(task.provider));
  const environment = { ...base };
  for (const name of variables[task.provider]) delete environment[name];
  const own = modelEnvironment({ [`access:${task.provider}`]: JSON.stringify({ apiKey: key.entry.apiKey, enabled: true, models: key.entry.models }) });
  for (const name of variables[task.provider]) if (own[name] !== undefined) environment[name] = own[name];
  return environment;
}
