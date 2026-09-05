import { sso } from "@better-auth/sso";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { magicLink } from "better-auth/plugins";

import type { Env } from "./worker.js";

export function authOptionsFor(
  env: Pick<Env, "BETTER_AUTH_URL" | "DB" | "EMAILS" | "GITHUB_CLIENT_ID" | "GOOGLE_CLIENT_ID">,
  authSecret: string,
  providerSecrets: { github?: string; google?: string } = {},
): BetterAuthOptions {
  const send = async (kind: "auth.magic-link" | "auth.verify-email" | "auth.change-email", recipient: string, url: string) => {
    if (!env.EMAILS) throw new Error("Email delivery is not configured");
    await env.EMAILS.send({ kind, recipient, url });
  };
  const socialProviders: NonNullable<BetterAuthOptions["socialProviders"]> = {};
  if (env.GOOGLE_CLIENT_ID && providerSecrets.google) {
    socialProviders.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: providerSecrets.google };
  }
  if (env.GITHUB_CLIENT_ID && providerSecrets.github) {
    socialProviders.github = { clientId: env.GITHUB_CLIENT_ID, clientSecret: providerSecrets.github };
  }
  return {
    appName: "Remy",
    baseURL: env.BETTER_AUTH_URL,
    database: env.DB,
    secret: authSecret,
    socialProviders,
    account: { accountLinking: { enabled: true, allowDifferentEmails: false, requireLocalEmailVerified: true } },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => send("auth.verify-email", user.email, url),
      sendOnSignUp: true,
    },
    user: {
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({ user, url }) => send("auth.change-email", user.email, url),
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            if (!user.emailVerified) return;
            await env.DB.prepare("INSERT OR IGNORE INTO verified_emails (id,user_id,email,verified_at,is_primary,created_at) VALUES (?,?,?,?,1,?)")
              .bind(crypto.randomUUID(), user.id, user.email.toLowerCase(), Date.now(), Date.now()).run();
          },
        },
        update: {
          after: async (user) => {
            if (!user.emailVerified) return;
            await env.DB.prepare("INSERT OR IGNORE INTO verified_emails (id,user_id,email,verified_at,is_primary,created_at) VALUES (?,?,?,?,1,?)")
              .bind(crypto.randomUUID(), user.id, user.email.toLowerCase(), Date.now(), Date.now()).run();
          },
        },
      },
    },
    plugins: [
      magicLink({
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => send("auth.magic-link", email, url),
      }),
      sso(),
    ],
  };
}

export async function authFor(env: Pick<Env, "AUTH_SECRET" | "BETTER_AUTH_URL" | "DB" | "EMAILS" | "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET">) {
  const [authSecret, github, google] = await Promise.all([
    env.AUTH_SECRET.get(),
    env.GITHUB_CLIENT_SECRET?.get(),
    env.GOOGLE_CLIENT_SECRET?.get(),
  ]);
  return betterAuth(authOptionsFor(env, authSecret, { ...(github ? { github } : {}), ...(google ? { google } : {}) }));
}
