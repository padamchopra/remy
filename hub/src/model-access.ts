import { z } from "zod";
import { HostedSettingsStore } from "./hosted-settings.js";
import { routerModels } from "./router-connection.js";

export const modelAccessIds = ["anthropic", "openai", "router", "openrouter"] as const;
export type ModelAccessId = typeof modelAccessIds[number];
const connection = z.object({apiKey:z.string().trim().max(8192), enabled:z.boolean(), models:z.array(z.string())});
export const modelAccessPatch = z.object({enabled:z.boolean().optional(), apiKey:z.string().trim().min(1).max(8192).optional()}).strict();
export const namedModelKeyWrite = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  apiKey: z.string().trim().min(1).max(8192).optional(),
  active: z.boolean().optional(),
}).strict();
const namedModelKey = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  apiKey: z.string().trim().min(1).max(8192),
  models: z.array(z.string()),
}).strict();
const namedModelSet = z.object({
  keys: z.array(namedModelKey).max(20),
  activeKeyId: z.string().min(1).max(80).optional(),
}).strict();
const keys = {anthropic:"ANTHROPIC_API_KEY",openai:"OPENAI_API_KEY",router:"RAMP_ROUTER_API_KEY",openrouter:"OPENROUTER_API_KEY"};
/// Named keys live beside `access:` so execution still reads the active key.
export const namedAccessSecret = (id: string) => `named-access:${id}`;
export type PublicNamedModelKey = { id: string; name: string; active: boolean };
function parsedAccess(saved:string | undefined) {
  if(!saved)return;
  try {
    const parsed=connection.safeParse(JSON.parse(saved));
    return parsed.success ? parsed.data : undefined;
  } catch { return; }
}
function parsedLegacy(saved:string | undefined) {
  if(!saved)return;
  try {
    const value=JSON.parse(saved) as {apiKey?:unknown;model?:unknown};
    if(typeof value.apiKey !== "string")return;
    return {apiKey:value.apiKey, ...(typeof value.model === "string" ? {model:value.model} : {})};
  } catch { return; }
}
export function modelAccess(secrets:Record<string,string>) {
  return modelAccessIds.map(id => {
    const fromAccess=parsedAccess(secrets[`access:${id}`]);
    const legacy=id === "router" || id === "openrouter" ? parsedLegacy(secrets[`model:${id}`]) : undefined;
    const envKey=secrets[keys[id]] ?? "";
    const apiKey=(fromAccess?.apiKey || legacy?.apiKey || envKey).trim();
    const models=fromAccess?.models.length ? fromAccess.models : legacy?.model ? [legacy.model] : [];
    const enabled=fromAccess ? fromAccess.enabled : !!(legacy || envKey);
    return {id,apiKey,enabled,models};
  });
}
function parseNamedModelSet(saved: string | undefined) {
  if (!saved) return;
  try {
    const parsed = namedModelSet.safeParse(JSON.parse(saved));
    return parsed.success ? parsed.data : undefined;
  } catch { return; }
}

export function publicModelKeys(id: ModelAccessId, secrets: Record<string, string>): PublicNamedModelKey[] {
  const stored = parseNamedModelSet(secrets[namedAccessSecret(id)]);
  if (stored?.keys.length) {
    const active = stored.activeKeyId && stored.keys.some((key) => key.id === stored.activeKeyId)
      ? stored.activeKeyId
      : stored.keys[0].id;
    return stored.keys.map((key) => ({ id: key.id, name: key.name, active: key.id === active }));
  }
  return modelAccess(secrets).find((entry) => entry.id === id)?.apiKey
    ? [{ id: "legacy", name: "Default", active: true }]
    : [];
}

/// `secrets` is the execution view (own plus shared source keys). `keySecrets`
/// is this account's store, so an org does not list or rewrite someone else's
/// named keys.
export function publicModelAccess(secrets:Record<string,string>, keySecrets = secrets) {
  return modelAccess(secrets).map(({apiKey,...value})=>({...value,configured:!!apiKey,keys:publicModelKeys(value.id, keySecrets)}));
}
/// Maps a composer or stored gateway choice onto Codex plus a `remy:` model.
/// OpenRouter auto and other defaults are not a second catalogue allowlist.
export function hostedStartChoice(provider:string | undefined, model:string | undefined): {provider?: string; model?: string} {
  const routed=/^remy:(router|openrouter|openai):(.+)$/.exec(model ?? "");
  if(routed && model)return {provider:"codex", model};
  if(provider==="anthropic")return {provider:"claude", ...(model !== undefined ? {model} : {})};
  if(provider==="openai" || provider==="router" || provider==="openrouter") {
    if(!model)return {provider:"codex"};
    return {provider:"codex", model: model.startsWith("remy:") ? model : `remy:${provider}:${model}`};
  }
  return {
    ...(provider !== undefined ? {provider} : {}),
    ...(model !== undefined ? {model} : {}),
  };
}
/// Cloud thread start honors the computer's enabled gateways. The fetched
/// catalogue is for picking, not a second allowlist that can reject an
/// enabled OpenRouter or Router model the composer already showed.
export function hostedGatewayError(provider:string | undefined, model:string | undefined, secrets:Record<string,string>): string | undefined {
  const choice=hostedStartChoice(provider, model);
  const routed=/^remy:(router|openrouter|openai):(.+)$/.exec(choice.model ?? "");
  if(!routed)return;
  if(choice.provider && choice.provider!=="codex")return "Choose an enabled provider and model.";
  const access=publicModelAccess(secrets).find(entry=>entry.id===routed[1]);
  if(!access?.enabled || !access.configured)return "Choose an enabled provider and model.";
}
export function modelEnvironment(secrets:Record<string,string>) {
  const result:Record<string,string>={};
  for(const value of modelAccess(secrets)) {
    if(!value.enabled || !value.apiKey)continue;
    result[keys[value.id]]=value.apiKey;
    if(value.id === "router" || value.id === "openrouter") result[value.id === "router" ? "RAMP_ROUTER_MODELS" : "OPENROUTER_MODELS"]=JSON.stringify(value.models);
  }
  return result;
}
export async function saveModelAccess(store:HostedSettingsStore, org:string, id:ModelAccessId, input:unknown) {
  const patch=modelAccessPatch.parse(input);
  const previous=modelAccess(await store.secrets(org)).find(value=>value.id===id)!;
  const apiKey=patch.apiKey ?? previous.apiKey;
  let models=previous.models;
  if(patch.apiKey && (id==="router" || id==="openrouter")) models=await routerModels(apiKey,fetch,id);
  if(patch.apiKey && !models.length && (id==="router" || id==="openrouter"))throw Error("No models are available to this key.");
  const enabled=patch.enabled ?? previous.enabled;
  if(enabled && !apiKey)throw Error("Enter your API key.");
  await store.setSecret(org,`access:${id}`,JSON.stringify({apiKey,enabled,models}));
  const named = parseNamedModelSet((await store.secrets(org))[namedAccessSecret(id)]);
  if (named?.keys.length && patch.apiKey) {
    const active = named.keys.find((key) => key.id === named.activeKeyId) ?? named.keys[0];
    active.apiKey = apiKey;
    active.models = models;
    await store.setSecret(org, namedAccessSecret(id), JSON.stringify(named));
  }
  return publicModelAccess(await store.secrets(org));
}

function unusedModelName(keys: { name: string }[], wanted: string) {
  const used = new Set(keys.map((key) => key.name.toLowerCase()));
  if (!used.has(wanted.toLowerCase())) return wanted;
  for (let n = 2; n < 100; n += 1) {
    const next = `${wanted} ${n}`;
    if (!used.has(next.toLowerCase())) return next;
  }
  throw Error("Choose a different name.");
}

export async function saveNamedModelKey(store:HostedSettingsStore, org:string, id:ModelAccessId, input:unknown, keyId?:string) {
  const patch = namedModelKeyWrite.parse(input);
  const secrets = await store.secrets(org);
  const previous = modelAccess(secrets).find((value) => value.id === id)!;
  const stored = parseNamedModelSet(secrets[namedAccessSecret(id)]) ?? { keys: [] as z.infer<typeof namedModelKey>[] };
  if (!stored.keys.length && previous.apiKey) {
    stored.keys.push({ id: crypto.randomUUID(), name: "Default", apiKey: previous.apiKey, models: previous.models });
    stored.activeKeyId = stored.keys[0].id;
  }
  const targetId = keyId && keyId !== "legacy" ? keyId : undefined;
  let key = targetId ? stored.keys.find((entry) => entry.id === targetId) : undefined;
  if (targetId && !key) throw Error("This key is unavailable.");
  const name = (patch.name ?? key?.name ?? unusedModelName(stored.keys, "Default")).trim();
  if (!name) throw Error("Name this key.");
  if (stored.keys.some((entry) => entry.id !== key?.id && entry.name.toLowerCase() === name.toLowerCase()))
    throw Error("Choose a different name.");
  if (!key) {
    if (!patch.apiKey) throw Error("Enter your API key.");
    if (stored.keys.length >= 20) throw Error("Remove a key before adding another.");
    key = { id: crypto.randomUUID(), name, apiKey: patch.apiKey, models: [] };
    stored.keys.push(key);
  }
  key.name = name;
  if (patch.apiKey) {
    key.apiKey = patch.apiKey;
    key.models = (id === "router" || id === "openrouter") ? await routerModels(patch.apiKey, fetch, id) : previous.models;
    if ((id === "router" || id === "openrouter") && !key.models.length) throw Error("No models are available to this key.");
  }
  if (patch.active || !stored.activeKeyId || !stored.keys.some((entry) => entry.id === stored.activeKeyId))
    stored.activeKeyId = key.id;
  const active = stored.keys.find((entry) => entry.id === stored.activeKeyId) ?? key;
  await store.setSecret(org, namedAccessSecret(id), JSON.stringify(stored));
  await store.setSecret(org, `access:${id}`, JSON.stringify({ apiKey: active.apiKey, enabled: previous.enabled || !!patch.apiKey, models: active.models }));
  return publicModelAccess(await store.secrets(org));
}

export async function removeNamedModelKey(store:HostedSettingsStore, org:string, id:ModelAccessId, keyId:string) {
  const secrets = await store.secrets(org);
  const previous = modelAccess(secrets).find((value) => value.id === id)!;
  const stored = parseNamedModelSet(secrets[namedAccessSecret(id)]);
  if (keyId === "legacy" && !stored?.keys.length) {
    await store.setSecret(org, `access:${id}`, JSON.stringify({ apiKey: "", enabled: false, models: [] }));
    return publicModelAccess(await store.secrets(org));
  }
  if (!stored) throw Error("This key is unavailable.");
  const next = stored.keys.filter((key) => key.id !== keyId);
  if (next.length === stored.keys.length) throw Error("This key is unavailable.");
  if (!next.length) {
    await store.setSecret(org, namedAccessSecret(id), null);
    await store.setSecret(org, `access:${id}`, JSON.stringify({ apiKey: "", enabled: false, models: [] }));
    return publicModelAccess(await store.secrets(org));
  }
  const activeKeyId = stored.activeKeyId === keyId || !next.some((key) => key.id === stored.activeKeyId)
    ? next[0].id
    : stored.activeKeyId;
  const active = next.find((key) => key.id === activeKeyId)!;
  await store.setSecret(org, namedAccessSecret(id), JSON.stringify({ keys: next, activeKeyId }));
  await store.setSecret(org, `access:${id}`, JSON.stringify({ apiKey: active.apiKey, enabled: previous.enabled, models: active.models }));
  return publicModelAccess(await store.secrets(org));
}
