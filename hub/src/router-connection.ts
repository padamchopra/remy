import { z } from "zod";
export const routerConnectionSchema = z.object({apiKey:z.string().trim().min(1).max(8192), model:z.string().trim().min(1).max(256)}).strict();
export async function routerModels(apiKey: string, send: typeof fetch = fetch, provider: "router" | "openrouter" = "router"): Promise<string[]> {
  const label = provider === "openrouter" ? "OpenRouter" : "Router";
  const response = await send(provider === "openrouter" ? "https://openrouter.ai/api/v1/models/user" : "https://api.router.com/v1/models", {headers:{authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error(response.status === 401 ? `${label} rejected this key. Check it and try again.` : `${label} models could not be loaded. Try again.`);
  const data = z.object({data:z.array(z.unknown())}).parse(await response.json());
  return [...new Set(data.data.flatMap(m=>{const parsed=z.object({id:z.string().min(1).max(256)}).safeParse(m);return parsed.success?[parsed.data.id]:[];}))];
}
