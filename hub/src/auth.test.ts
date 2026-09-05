import assert from "node:assert/strict";
import test from "node:test";

import { authOptionsFor } from "./auth.js";

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
