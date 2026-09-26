import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import {
  Connections,
  ConnectionVault,
  connectionHash,
  ingestConnectionWebhook,
  type ConnectionProvider,
  type ConnectionJob,
} from "./connections.js";
import { connectionProviders } from "./connection-providers.js";
import type { OrganizationService } from "./organizations.js";
import type { Env } from "./worker.js";
import { sqliteD1 } from "../test/sqlite-d1.js";

function fixture() {
  const { db, sqlite } = sqliteD1(
    `CREATE TABLE organizations(id TEXT PRIMARY KEY,personal_owner_id TEXT);CREATE TABLE user(id TEXT PRIMARY KEY);CREATE TABLE memberships(organization_id TEXT,user_id TEXT,PRIMARY KEY(organization_id,user_id));INSERT INTO organizations VALUES('studio',NULL),('other',NULL),('personal','ada');INSERT INTO memberships VALUES('studio','ada'),('studio','grace'),('personal','ada');${readFileSync(new URL("../migrations/0012_connections.sql", import.meta.url), "utf8")}${readFileSync(new URL("../migrations/0029_linear_accounts.sql", import.meta.url), "utf8")}`,
  );
  let now = 1_000_000,
    fail = false,
    calls = 0;
  const bodies: URLSearchParams[] = [];
  let beforeReply: (() => Promise<void>) | undefined;
  const provider: ConnectionProvider = {
    id: "sample",
    name: "Sample",
    subjects: ["organization", "member"],
    clientId: "client",
    clientSecret: async () => "client-secret",
    authorizeUrl: "https://provider.example/authorize",
    tokenUrl: "https://provider.example/token",
    scope: "read",
    identity: async () => ({ id: "external", label: "Studio" }),
    verifyWebhook: async () => ({ id: "delivery", event: "update" }),
  };
  const send = (async (_input: unknown, init: RequestInit) => {
    calls++;
    bodies.push(new URLSearchParams(init.body as string));
    await beforeReply?.();
    return fail
      ? new Response("private provider response", { status: 401 })
      : Response.json({
          access_token: "secret-access",
          refresh_token: "secret-refresh",
          expires_in: 120,
        });
  }) as typeof fetch;
  const auth = {
    member: async (org: string, user: string) => {
      if (
        !sqlite
          .prepare(
            "SELECT 1 FROM memberships WHERE organization_id=? AND user_id=?",
          )
          .get(org, user)
      )
        throw Error("No membership");
      return { role: user === "ada" ? "admin" : "member" };
    },
  } as unknown as OrganizationService;
  const changes: string[] = [];
  const service = new Connections(
    db,
    [provider],
    async () => "root-secret",
    auth,
    async (org) => {
      changes.push(org);
    },
    send,
    () => now,
  );
  const begin = async (subject = "", org = "studio") =>
    new URL(
      (
        await service.begin(
          org,
          "ada",
          "sample",
          subject,
          "https://hub.example",
        )
      ).url,
    );
  const finish = async (url: URL) =>
    service.finish(
      "ada",
      "sample",
      url.searchParams.get("state")!,
      "authorization-code",
      "https://hub.example",
    );
  return {
    db,
    sqlite,
    service,
    provider,
    begin,
    finish,
    bodies,
    changes,
    tick: () => {
      now += 100_000;
    },
    fail: () => {
      fail = true;
    },
    calls: () => calls,
    before: (fn: () => Promise<void>) => {
      beforeReply = fn;
    },
  };
}

test("OAuth binds PKCE and single-use state to the current member and encrypts tokens", async () => {
  const f = fixture(),
    url = await f.begin();
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  await assert.rejects(
    f.service.finish(
      "grace",
      "sample",
      url.searchParams.get("state")!,
      "code",
      "https://hub.example",
    ),
  );
  await f.finish(url);
  assert.equal(
    await connectionHash(f.bodies[0]!.get("code_verifier")!),
    url.searchParams.get("code_challenge"),
  );
  assert.equal(
    f.bodies[0]!.get("redirect_uri"),
    "https://hub.example/api/connections/sample/callback",
  );
  await assert.rejects(f.finish(url));
  assert.equal(f.calls(), 1);
  assert.ok(
    !JSON.stringify(await f.service.list("studio", "grace")).includes("secret"),
  );
  assert.ok(
    !JSON.stringify(
      f.sqlite.prepare("SELECT * FROM connections").all(),
    ).includes("secret-access"),
  );
  assert.equal(await f.service.token("studio", "sample"), "secret-access");
  await assert.rejects(
    f.service.begin("studio", "grace", "sample", "", "https://hub.example"),
  );
});

test("vault ciphertext cannot be copied to a different organization or record", async () => {
  const vault = new ConnectionVault(async () => "key"),
    value = await vault.seal({ access_token: "secret" }, "studio:sample:one");
  await assert.rejects(vault.open(value, "other:sample:one"));
  await assert.rejects(vault.open(value, "studio:sample:two"));
});

test("refresh uses a database lease and failures require reauthentication without leaking the upstream response", async () => {
  const f = fixture();
  await f.finish(await f.begin());
  f.tick();
  const replies = await Promise.allSettled([
    f.service.token("studio", "sample"),
    f.service.token("studio", "sample"),
  ]);
  assert.equal(replies.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.calls(), 2);
  f.tick();
  f.fail();
  await assert.rejects(
    f.service.token("studio", "sample"),
    /Reconnect your account/,
  );
  assert.equal((await f.service.get("studio", "sample"))?.status, "reauth");
});

test("disconnect invalidates a callback already exchanging its code", async () => {
  const f = fixture(),
    url = await f.begin();
  f.before(async () => {
    await f.service.disconnect("studio", "ada", "sample", "");
  });
  await assert.rejects(f.finish(url), /connection changed/);
  assert.equal(await f.service.get("studio", "sample"), null);
});

test("member connections are private and leaving removes their stored credential", async () => {
  const f = fixture();
  await f.finish(await f.begin("ada"));
  assert.equal((await f.service.list("studio", "grace")).connections.length, 0);
  f.sqlite
    .prepare("DELETE FROM memberships WHERE organization_id=? AND user_id=?")
    .run("studio", "ada");
  assert.equal(await f.service.get("studio", "sample", "ada"), null);
});

test("a Personal member connection is available to organizations unless they have their own", async () => {
  const f = fixture();
  await f.finish(await f.begin("ada", "personal"));
  assert.equal(await f.service.token("studio", "sample", "ada"), "secret-access");
  assert.deepEqual(
    (await f.service.list("studio", "ada")).connections.map((connection) => connection.availability),
    ["all"],
  );
  await f.finish(await f.begin("ada", "studio"));
  assert.deepEqual(
    (await f.service.list("studio", "ada")).connections
      .map((connection) => connection.availability)
      .sort(),
    ["all", "studio"],
  );
});

test("webhook signatures, timestamp bounds, durable receipt and queue retry retain a single delivery", async () => {
  const f = fixture(),
    secret = "webhook-secret",
    now = Date.now();
  const provider = connectionProviders({
    LINEAR_WEBHOOK_SECRET: { get: async () => secret },
  } as Env).find((p) => p.id === "linear")!;
  const raw = JSON.stringify({ webhookTimestamp: now, type: "Issue" }),
    signature = createHmac("sha256", secret).update(raw).digest("hex");
  const request = () =>
    new Request("https://hub.example/api/connections/linear/webhook", {
      method: "POST",
      headers: { "linear-signature": signature, "linear-delivery": "one" },
      body: raw,
    });
  let calls = 0;
  const queue = {
    send: async (_job: ConnectionJob) => {
      calls++;
      if (calls === 1) throw Error("Queue temporarily unavailable");
    },
  } as unknown as Queue<ConnectionJob>;
  await assert.rejects(
    ingestConnectionWebhook(request(), provider, f.db, queue, now),
  );
  assert.equal(
    (await ingestConnectionWebhook(request(), provider, f.db, queue, now))
      .status,
    202,
  );
  assert.equal(
    f.sqlite.prepare("SELECT COUNT(*) AS n FROM connection_deliveries").get()!
      .n,
    1,
  );
  await assert.rejects(
    provider.verifyWebhook(request(), raw + " ", secret, now),
  );
  await assert.rejects(
    provider.verifyWebhook(request(), raw, secret, now + 61_000),
  );
});


test("GitHub PATs share encrypted connection storage and cannot reconnect after revocation", async () => {
  const f = fixture();
  f.provider.id = "github";
  f.provider.clientId = undefined;
  f.provider.clientSecret = undefined;
  await f.service.personalToken("studio", "ada", "private-pat");
  assert.equal(await f.service.token("studio", "github", "ada"), "private-pat");
  assert.ok(!JSON.stringify(await f.service.list("studio", "ada")).includes("private-pat"));
  assert.ok(!String(f.sqlite.prepare("SELECT credentials FROM connections").get()?.credentials).includes("private-pat"));
  await assert.rejects(f.service.personalToken("other", "ada", "private-pat"));
  await assert.rejects(f.service.personalToken("studio", "ada", "invalid token"));
  f.provider.identity = async () => {
    await f.service.disconnect("studio", "ada", "github", "ada");
    return {id:"external",label:"Studio"};
  };
  await assert.rejects(f.service.personalToken("studio", "ada", "new-pat"));
  await assert.rejects(f.service.token("studio", "github", "ada"));
});


test("repository OAuth reuses sign-in configuration with isolated callback state", async () => {
  const github = connectionProviders({GITHUB_CLIENT_ID:"signin",GITHUB_CLIENT_SECRET:"secret"} as Env).find(p=>p.id==="github")!;
  assert.equal(github.clientId, "signin");
  assert.equal(await github.clientSecret!(), "secret");
  assert.equal(github.scope, "repo");
  assert.equal(github.callbackPath, "/api/auth/callback/github");
  const f = fixture();
  f.provider.callbackPath = github.callbackPath;
  const url = await f.begin("ada");
  assert.equal(url.searchParams.get("redirect_uri"), "https://hub.example/api/auth/callback/github");
  assert.ok(url.searchParams.get("state")?.startsWith("remy-connection."));
  await f.finish(url);
  assert.equal(f.bodies[0].get("redirect_uri"), url.searchParams.get("redirect_uri"));
  await assert.rejects(f.finish(url));
});
