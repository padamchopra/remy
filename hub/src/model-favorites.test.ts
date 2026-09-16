import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../test/sqlite-d1.js";
import { modelFavorites } from "./model-favorites.js";

test("favorites persist independently by member and organization without replacing other stars", async () => {
  const folder = new URL("../migrations/", import.meta.url);
  const { db, sqlite } = sqliteD1(readdirSync(folder).filter(f => f.endsWith(".sql")).sort().map(f => readFileSync(new URL(f, folder), "utf8")).join("\n"));
  sqlite.exec("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('one','One','one@test.dev',1,1),('two','Two','two@test.dev',1,1); INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('org','Org',1,1),('other','Other',1,1);");
  const read = async (org = "org", user = "one") => (await modelFavorites(db, org, user, new Request("https://test.dev"))).json();
  const change = (key: unknown, enabled: unknown) => modelFavorites(db, "org", "one", new Request("https://test.dev", { method: "PATCH", body: JSON.stringify({ key, enabled }) }));
  assert.equal((await change("openrouter:anthropic/model", true)).status, 200);
  await change("openrouter:other/model", true);
  await change("openrouter:anthropic/model", true);
  assert.deepEqual(await read(), { favorites: ["openrouter:anthropic/model", "openrouter:other/model"] });
  assert.deepEqual(await read("org", "two"), { favorites: [] });
  assert.deepEqual(await read("other"), { favorites: [] });
  await change("openrouter:anthropic/model", false);
  assert.deepEqual(await read(), { favorites: ["openrouter:other/model"] });
  assert.equal((await change({}, true)).status, 400);
  assert.equal((await change("openrouter:model", "yes")).status, 400);
  assert.deepEqual(await read(), { favorites: ["openrouter:other/model"] });
  sqlite.close();
});

test("favorite routes require membership and derive the member from the session", async () => {
  const { D1AccountStore } = await import("./account-store.js");
  const { AccountService } = await import("./accounts.js");
  const { createRouteHandler } = await import("./worker.js");
  const folder = new URL("../migrations/", import.meta.url);
  const { db, sqlite } = sqliteD1(readdirSync(folder).filter(f => f.endsWith(".sql")).sort().map(f => readFileSync(new URL(f, folder), "utf8")).join("\n"));
  sqlite.exec("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('one','One','one@test.dev',1,1),('two','Two','two@test.dev',1,1); INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('org','Org',1,1); INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('m','org','one','member',1,1);");
  const accounts = new AccountService(new D1AccountStore(db));
  const member = await accounts.createSession("one", "cli", "Test");
  const outsider = await accounts.createSession("two", "cli", "Test");
  let notices = 0;
  const env = { DB: db, ENVIRONMENT: "staging", BETTER_AUTH_URL: "https://hub.example", COORDINATOR: { idFromName: () => "org", get: () => ({ fetch: async (request: Request) => { assert.equal(request.headers.get("x-user-id"), "one"); notices++; return Response.json({ ok: true }); } }) } } as unknown as import("./worker.js").Env;
  const route = createRouteHandler({ accountService: () => accounts });
  const call = (token?: string) => route(new Request("https://hub.example/api/organizations/org/model-favorites", { method: "PATCH", headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify({ key: "openrouter:model", enabled: true, userId: "two" }) }), env);
  assert.equal((await call()).status, 401);
  assert.equal((await call(outsider.accessToken)).status, 404);
  assert.equal((await call(member.accessToken)).status, 200);
  assert.equal(notices, 1);
  assert.deepEqual(await (await modelFavorites(db, "org", "two", new Request("https://test.dev"))).json(), { favorites: [] });
  sqlite.close();
});
