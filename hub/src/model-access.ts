import { z } from "zod";
import { HostedSettingsStore } from "./hosted-settings.js";
import { routerModels } from "./router-connection.js";

export const modelAccessIds = ["anthropic", "openai", "router", "openrouter"] as const;
export type ModelAccessId = typeof modelAccessIds[number];
const connection = z.object({apiKey:z.string().trim().max(8192), enabled:z.boolean(), models:z.array(z.string())});
export const modelAccessPatch = z.object({enabled:z.boolean().optional(), apiKey:z.string().trim().min(1).max(8192).optional()}).strict();
const keys = {anthropic:"ANTHROPIC_API_KEY",openai:"OPENAI_API_KEY",router:"RAMP_ROUTER_API_KEY",openrouter:"OPENROUTER_API_KEY"};
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
export function publicModelAccess(secrets:Record<string,string>) {
  return modelAccess(secrets).map(({apiKey,...value})=>({...value,configured:!!apiKey}));
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
  return publicModelAccess(await store.secrets(org));
}
