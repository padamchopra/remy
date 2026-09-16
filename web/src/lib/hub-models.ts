import { PROVIDERS, type Provider } from "./providers";
import type { ModelAccessEntry } from "@/components/HubModelAccess";
export function hostedModels(entries: ModelAccessEntry[], chatgpt = false): Provider[] {
  const cloudModels: Provider[] = entries.filter(p=>p.enabled && p.configured).map(p=>{
    const runtime=PROVIDERS.find(v=>v.id===(p.id==="anthropic"?"claude":"codex"))!;
    return {...runtime,id:p.id,label:({anthropic:"Anthropic",openai:"OpenAI",router:"Router.com",openrouter:"OpenRouter"} as Record<string,string>)[p.id],efforts:[],models:p.id==="router" || p.id==="openrouter" ? p.models.map(value=>({value,label:value})) : p.id==="openai" ? runtime.models.filter(m=>m.value) : runtime.models};
  });
  if(chatgpt) cloudModels.push({...PROVIDERS.find(p=>p.id==="codex")!,label:"ChatGPT"});
  return cloudModels;
}
