import { sso } from "@better-auth/sso";
import { betterAuth, type BetterAuthOptions } from "better-auth";

import type { Env } from "./worker.js";

export function authOptionsFor(
  env: Pick<Env, "BETTER_AUTH_URL" | "DB">,
  authSecret: string,
): BetterAuthOptions {
  return {
    baseURL: env.BETTER_AUTH_URL,
    database: env.DB,
    secret: authSecret,
    plugins: [sso()],
  };
}

export async function authFor(env: Pick<Env, "AUTH_SECRET" | "BETTER_AUTH_URL" | "DB">) {
  return betterAuth(authOptionsFor(env, await env.AUTH_SECRET.get()));
}
