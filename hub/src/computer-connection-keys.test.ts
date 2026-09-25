import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { decodeComputerConnectionKey } from "@remy/contract";
import { sqliteD1 } from "../test/sqlite-d1.js";
import { D1AccountStore } from "./account-store.js";
import { AccountService } from "./accounts.js";
import { createRouteHandler, type Env } from "./worker.js";

function hub() {
  const folder = new URL("../migrations/", import.meta.url);
  const { db, sqlite } = sqliteD1(readdirSync(folder).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(new URL(f, folder), "utf8")).join("\n"));
  sqlite.exec("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('ada','Ada','ada@test.dev',1,1),('grace','Grace','grace@test.dev',1,1),('outsider','Out','out@test.dev',1,1);");
  sqlite.exec("INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('studio','Studio',1,1);");
  sqlite.exec("INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('m1','studio','ada','owner',1,1),('m2','studio','grace','member',1,1);");
  const accounts = new AccountService(new D1AccountStore(db));
  const env = { DB: db, ENVIRONMENT: "staging", BETTER_AUTH_URL: "https://hub.example", AUTH_SECRET: { get: async () => "disposable-secret-longer-than-thirty-two-chars" }, COORDINATOR: { idFromName: () => "studio", get: () => ({ fetch: async () => Response.json({ ok: true }) }) } } as unknown as Env;
  const route = createRouteHandler({ accountService: () => accounts });
  const call = (token: string | undefined, body: unknown) => route(new Request("https://hub.example/api/organizations/studio/computers/connection-keys", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), env);
  return { accounts, route, env, call, sqlite };
}

test("a connection key carries this account and registers a computer once", async () => {
  const { accounts, route, env, call, sqlite } = hub();
  const web = await accounts.createSession("ada", "web", "Browser");

  const response = await call(web.accessToken, {});
  assert.equal(response.status, 200);
  const result = await response.json() as { key: string; expiresIn: number };
  const connection = decodeComputerConnectionKey(result.key);
  assert.deepEqual({ url: connection.url, organizationId: connection.organizationId, ownership: connection.ownership }, { url: "https://hub.example", organizationId: "studio", ownership: "personal" });
  assert.ok(result.expiresIn > 0);

  // Already approved, so a machine with no browser exchanges it straight away.
  const token = await route(new Request("https://hub.example/api/device/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceCode: connection.key }) }), env);
  assert.equal(token.status, 200);
  const pair = await token.json() as { accessToken: string };
  assert.equal((await accounts.authenticate(pair.accessToken))?.clientKind, "computer");

  // Single use: the same key cannot sign a second computer in.
  const again = await route(new Request("https://hub.example/api/device/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceCode: connection.key }) }), env);
  assert.equal(again.status, 400);
  sqlite.close();
});

test("only a member in front of Remy creates a key, and only an admin shares a computer", async () => {
  const { accounts, call, sqlite } = hub();
  const web = await accounts.createSession("ada", "web", "Browser");
  const member = await accounts.createSession("grace", "web", "Browser");
  const cli = await accounts.createSession("ada", "cli", "Terminal");
  const outsider = await accounts.createSession("outsider", "web", "Browser");

  assert.equal((await call(undefined, {})).status, 401);
  assert.equal((await call(outsider.accessToken, {})).status, 404);
  assert.equal((await call(cli.accessToken, {})).status, 403);
  assert.equal((await call(member.accessToken, { ownership: "organization" })).status, 403);
  assert.equal((await call(member.accessToken, {})).status, 200);
  assert.equal((await call(web.accessToken, { ownership: "hosted" })).status, 400);

  const shared = await call(web.accessToken, { ownership: "organization", name: "Build box" });
  assert.equal(shared.status, 200);
  assert.equal(decodeComputerConnectionKey(((await shared.json()) as { key: string }).key).ownership, "organization");
  sqlite.close();
});
