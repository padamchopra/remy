import { z } from "zod";
import { HostedSettingsStore } from "./hosted-settings.js";
import { routerModels } from "./router-connection.js";

export const modelAccessIds = ["anthropic", "openai", "router", "openrouter"] as const;
export type ModelAccessId = typeof modelAccessIds[number];
const connection = z.object({apiKey:z.string().trim().max(8192), enabled:z.boolean(), models:z.array(z.string())});
export const modelAccessPatch = z.object({enabled:z.boolean().optional(), apiKey:z.string().trim().min(1).max(8192).optional()}).strict();
const keys = {anthropic:"ANTHROPIC_API_KEY",openai:"OPENAI_API_KEY",router:"RAMP_ROUTER_API_KEY",openrouter:"OPENROUTER_API_KEY"};
export function modelAccess(secrets:Record<string,string>) {
  return modelAccessIds.map(id => {
    const saved=secrets[`access:${id}`];
    if(saved) return {id,...connection.parse(JSON.parse(saved))};
    if(id === "router" || id === "openrouter") {
      const legacy=secrets[`model:${id}`];
      if(legacy) {const value=JSON.parse(legacy);return {id,apiKey:value.apiKey as string,enabled:true,models:[value.model as string]};}
    }
    return {id,apiKey:secrets[keys[id]] ?? "",enabled:!!secrets[keys[id]],models:[] as string[]};
  });
}
export function publicModelAccess(secrets:Record<string,string>) {
  return modelAccess(secrets).map(({apiKey,...value})=>({...value,configured:!!apiKey}));
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
