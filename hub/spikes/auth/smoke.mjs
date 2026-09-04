import assert from "node:assert/strict";

const baseURL = process.env.SPIKE_URL ?? "http://127.0.0.1:8787";
const runId = Date.now().toString(36);
const domain = `${runId}.example.com`;
const email = `owner@${domain}`;
const adminEmail = `admin@${domain}`;

async function request(path, init = {}) {
  return fetch(`${baseURL}${path}`, {
    redirect: "manual",
    ...init,
    headers: { "content-type": "application/json", origin: baseURL, ...init.headers },
  });
}

async function json(path, init = {}) {
  const response = await request(path, init);
  const body = await response.json();
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(body)}`);
  return { body, response };
}

await json("/__spike/migrate", { method: "POST" });

await json("/api/auth/sign-in/magic-link", {
  method: "POST",
  body: JSON.stringify({ email, callbackURL: `${baseURL}/done` }),
});
const magic = await json("/__spike/magic-link");
assert.match(magic.body.url, /^http:\/\/127\.0\.0\.1:8787\/api\/auth\/magic-link\/verify/);
const verifiedMagic = await fetch(magic.body.url, { redirect: "manual" });
assert.equal(verifiedMagic.status, 302);
assert.ok(verifiedMagic.headers.get("set-cookie"), "magic-link verification did not create a session");

const signup = await json("/api/auth/sign-up/email", {
  method: "POST",
  body: JSON.stringify({ email: adminEmail, password: "long-enough-password", name: "Owner" }),
});
const cookie = signup.response.headers.get("set-cookie")?.split(";", 1)[0];
assert.ok(cookie, "email sign-up did not create a session cookie");

await json("/api/auth/sso/register", {
  method: "POST",
  headers: { cookie },
  body: JSON.stringify({
    providerId: `local-oidc-${runId}`,
    issuer: baseURL,
    domain,
    oidcConfig: {
      clientId: "remy-spike",
      clientSecret: "local-secret",
      discoveryEndpoint: `${baseURL}/.well-known/openid-configuration`,
    },
  }),
});

const sso = await json("/api/auth/sign-in/sso", {
  method: "POST",
  body: JSON.stringify({ providerId: `local-oidc-${runId}`, callbackURL: `${baseURL}/done` }),
});
assert.match(sso.body.url, /^http:\/\/127\.0\.0\.1:8787\/oidc\/authorize\?/);
const authorize = await fetch(sso.body.url);
const reached = await authorize.json();
assert.equal(reached.reached, "test-idp");

console.log("D1 migrations, magic links, and OIDC SSO redirect passed.");
