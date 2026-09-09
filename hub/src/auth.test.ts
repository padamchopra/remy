import assert from "node:assert/strict";
import test from "node:test";

import { authOptionsFor, authFor, readOAuthSecret } from "./auth.js";

test("configures magic-link, Google, GitHub, and SSO sign-in", () => {
  const options = authOptionsFor({
    BETTER_AUTH_URL: "https://hub.example",
    DB: {} as D1Database,
    GOOGLE_CLIENT_ID: "google-id",
    GITHUB_CLIENT_ID: "github-id",
  }, "test-secret-with-at-least-thirty-two-characters", { google: "google-secret", github: "github-secret" });

  assert.deepEqual(options.plugins?.map((plugin) => plugin.id), ["magic-link", "sso"]);
  assert.deepEqual(Object.keys(options.socialProviders ?? {}).sort(), ["github", "google"]);
  assert.equal(options.account?.accountLinking?.allowDifferentEmails, false);
  assert.equal(options.account?.accountLinking?.requireLocalEmailVerified, true);
});

test("resolves OAuth credentials from Worker secrets and Secrets Store bindings", async () => {
  assert.equal(await readOAuthSecret("worker-secret"), "worker-secret");
  assert.equal(await readOAuthSecret({ get: async () => "store-secret" }), "store-secret");
  assert.equal(await readOAuthSecret(undefined), undefined);
  await assert.rejects(readOAuthSecret({ get: async () => { throw new Error("unavailable"); } }), /unavailable/);
});

test("initializes both OAuth providers with ordinary production Worker secrets", async () => {
  const auth = await authFor({
    AUTH_SECRET: { get: async () => "test-secret-with-at-least-thirty-two-characters" },
    BETTER_AUTH_URL: "https://hub.example",
    DB: { batch: async () => [], exec: async () => ({}), prepare: () => { throw new Error("Unexpected database query"); } } as unknown as D1Database,
    GOOGLE_CLIENT_ID: "google-id",
    GOOGLE_CLIENT_SECRET: "google-secret",
    GITHUB_CLIENT_ID: "github-id",
    GITHUB_CLIENT_SECRET: "github-secret",
  });
  await auth.$context;
  assert.deepEqual(Object.keys(auth.options.socialProviders ?? {}).sort(), ["github", "google"]);
});
