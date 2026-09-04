import { sso } from "@better-auth/sso";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { magicLink } from "better-auth/plugins";

interface Env {
  AUTH_DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}

let lastMagicLink = "";

function authFor(env: Env) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    database: env.AUTH_DB,
    emailAndPassword: { enabled: true },
    secret: env.BETTER_AUTH_SECRET,
    plugins: [
      magicLink({
        sendMagicLink: async ({ url }) => {
          lastMagicLink = url;
        },
      }),
      sso(),
    ],
  });
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function oidcDocument(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oidc/authorize`,
    token_endpoint: `${origin}/oidc/token`,
    userinfo_endpoint: `${origin}/oidc/userinfo`,
    jwks_uri: `${origin}/oidc/jwks`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_methods_supported: ["none"],
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const auth = authFor(env);

    if (url.pathname === "/__spike/migrate" && request.method === "POST") {
      const migrations = await getMigrations(auth.options);
      await migrations.runMigrations();
      return json({ created: migrations.toBeCreated.length, added: migrations.toBeAdded.length });
    }
    if (url.pathname === "/__spike/magic-link") {
      return json({ url: lastMagicLink });
    }
    if (url.pathname === "/.well-known/openid-configuration") {
      return json(oidcDocument(url.origin));
    }
    if (url.pathname === "/oidc/authorize") {
      const query: Record<string, string> = {};
      url.searchParams.forEach((value, key) => {
        query[key] = value;
      });
      return json({ reached: "test-idp", query });
    }
    if (url.pathname === "/oidc/jwks") {
      return json({ keys: [] });
    }
    if (url.pathname === "/oidc/token" || url.pathname === "/oidc/userinfo") {
      return json({ error: "not_used_by_this_spike" }, 501);
    }
    return auth.handler(request);
  },
} satisfies ExportedHandler<Env>;
