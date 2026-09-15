import { routerConnectionSchema } from "./router-connection.js";
import { z } from "zod";
export const cloudConnectionSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("fly-sprites"), enabled: z.boolean().default(false), token: z.string().trim().min(1).max(8192) }).strict(),
  z.object({ provider: z.literal("modal"), enabled: z.boolean().default(false), tokenId: z.string().trim().min(1).max(8192), tokenSecret: z.string().trim().min(1).max(8192) }).strict(),
]);
export type CloudConnection = z.infer<typeof cloudConnectionSchema>;
export const cloudConnectionKey = (provider: string) => `cloud:${provider}`;
export function modelSecrets(secrets: Record<string, string>) {
  const direct = Object.fromEntries(Object.entries(secrets).filter(([key]) => ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"].includes(key)));
  if (!secrets["model:router"]) return direct;
  const router=routerConnectionSchema.parse(JSON.parse(secrets["model:router"]));
  return {...direct,RAMP_ROUTER_API_KEY:router.apiKey,RAMP_ROUTER_MODEL:router.model};
}

export const cloudToggleSchema = z.object({ provider: z.enum(["fly-sprites", "modal"]), enabled: z.boolean() }).strict();

export async function managementCredential(secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("remy-provider-management-v1"));
  return Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, "0")).join("");
}
