import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../test/sqlite-d1.js";
import { personalSpace } from "./personal-space.js";
import { D1OrganizationStore } from "./organization-store.js";
import { OrganizationService } from "./organizations.js";
import { D1AccountStore } from "./account-store.js";
import { AccountService } from "./accounts.js";
import { createRouteHandler, type Env } from "./worker.js";

function fixture() {
  const folder = new URL("../migrations/", import.meta.url);
  const { db, sqlite } = sqliteD1(
    readdirSync(folder)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(new URL(f, folder), "utf8"))
      .join("\n"),
  );
  sqlite.exec(
    "INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('ada','Ada','ada@example.test',1,1),('grace','Grace','grace@example.test',1,1)",
  );
  const store = new D1OrganizationStore(db);
  return { db, sqlite, store, service: new OrganizationService(store) };
}

test("a personal scope is stable, private, and absent from organization lists", async (t) => {
  const { db, sqlite, store, service } = fixture();
  t.after(() => sqlite.close());
  const ada = await personalSpace(db, "ada"),
    grace = await personalSpace(db, "grace");
  assert.equal((await personalSpace(db, "ada")).id, ada.id);
  assert.notEqual(ada.id, grace.id);
  assert.equal(ada.personal, true);
  assert.deepEqual(await store.organizationsFor("ada"), []);
  const workspace = await service.createWorkspace(ada.id, "ada", {
    name: "Notes",
    origin: "https://github.com/example/notes",
  });
  assert.equal((await service.workspaces(ada.id, "ada"))[0]?.id, workspace.id);
  await assert.rejects(service.workspaces(ada.id, "grace"), { status: 404 });
  const shared = await service.create("ada", "Studio");
  assert.deepEqual(
    (await store.organizationsFor("ada")).map((o) => o.id),
    [shared.id],
  );
  assert.equal((await personalSpace(db, "ada")).id, ada.id);
});

test("personal ownership cannot be invited, transferred, downgraded, or deleted as an organization", async (t) => {
  const { db, sqlite, service } = fixture();
  t.after(() => sqlite.close());
  const { id } = await personalSpace(db, "ada");
  for (const action of [
    () => service.createInvite(id, "ada", { role: "member" }),
    () => service.createTeam(id, "ada", "Friends"),
    () => service.transfer(id, "ada", "grace"),
    () => service.changeRole(id, "ada", "ada", "member"),
    () => service.removeMember(id, "ada", "ada"),
    () => service.leave(id, "ada"),
    () => service.rename(id, "ada", "Shared"),
    () => service.delete(id, "ada", "Personal"),
  ])
    await assert.rejects(action(), { status: 403 });
  assert.throws(
    () =>
      sqlite
        .prepare(
          "INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('intruder',?,'grace','owner',1,1)",
        )
        .run(id),
    /Personal access/,
  );
  assert.throws(
    () =>
      sqlite
        .prepare("UPDATE memberships SET role='member' WHERE organization_id=?")
        .run(id),
    /Personal access/,
  );
  assert.throws(
    () =>
      sqlite
        .prepare(
          "UPDATE organizations SET personal_owner_id='grace' WHERE id=?",
        )
        .run(id),
    /Personal ownership/,
  );
  sqlite.prepare("DELETE FROM user WHERE id='ada'").run();
  assert.equal(
    sqlite.prepare("SELECT id FROM organizations WHERE id=?").get(id),
    undefined,
  );
  await assert.rejects(service.member(id, "grace"), { status: 404 });
});

test("the authenticated personal endpoint binds reads, writes and live subscriptions to its account", async (t) => {
  const { db, sqlite } = fixture();
  t.after(() => sqlite.close());
  const accounts = new AccountService(new D1AccountStore(db));
  const ada = await accounts.createSession("ada", "web", "Browser"),
    grace = await accounts.createSession("grace", "web", "Browser");
  const forwarded: Request[] = [];
  const env = {
    DB: db,
    COORDINATOR: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (request: Request) => {
          forwarded.push(request);
          return Response.json({ ok: true });
        },
      }),
    },
  } as unknown as Env;
  const route = createRouteHandler();
  const call = (
    path: string,
    token = ada.accessToken,
    init: RequestInit = {},
  ) =>
    route(
      new Request(`https://hub.example/api/${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...init.headers,
        },
      }),
      env,
    );
  assert.equal((await call("personal", "invalid")).status, 401);
  const response = await call("personal"),
    { personal } = (await response.json()) as { personal: { id: string } };
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await (await call("organizations")).json(), {
    organizations: [],
  });
  assert.equal(
    (
      await call(`organizations/${personal.id}/workspaces`, ada.accessToken, {
        method: "POST",
        body: JSON.stringify({
          name: "Notes",
          origin: "github.com/example/notes",
        }),
      })
    ).status,
    201,
  );
  assert.equal(
    (await call(`organizations/${personal.id}/workspaces`, grace.accessToken))
      .status,
    404,
  );
  const native = await accounts.createSession("ada", "computer", "Personal Mac");
  const registration = {computerId:crypto.randomUUID(),name:"Personal Mac",platform:"darwin",daemonVersion:"1.0.0",protocol:{minimum:1,maximum:1},publicKey:"k".repeat(44),capabilities:{providers:[],workspaces:[],worktrees:true,terminals:true,emulator:false},ownership:"personal"};
  assert.equal((await call(`organizations/${personal.id}/computers`,ada.accessToken,{method:"POST",body:JSON.stringify(registration)})).status,403);
  const registered = await call(`organizations/${personal.id}/computers`,native.accessToken,{method:"POST",body:JSON.stringify(registration)});
  assert.equal(registered.status,201);
  assert.equal((await registered.json() as {ownerUserId:string}).ownerUserId,"ada");
  assert.equal((await call(`organizations/${personal.id}/computers`,grace.accessToken)).status,404);
  const before = forwarded.length;
  assert.equal(
    (
      await call(
        `organizations/${personal.id}/threads?cursor=7`,
        ada.accessToken,
      )
    ).status,
    200,
  );
  assert.equal(
    JSON.parse(
      decodeURIComponent(forwarded.at(-1)!.headers.get("x-thread-member")!),
    ).id,
    "ada",
  );
  assert.equal(forwarded.at(-1)?.headers.get("x-organization-id"), personal.id);
  assert.equal(
    (
      await call(
        `organizations/${personal.id}/threads?cursor=7`,
        grace.accessToken,
      )
    ).status,
    404,
  );
  assert.equal(forwarded.length, before + 1);
  assert.equal(
    (
      await call(
        `organizations/${personal.id}/threads/live?cursor=7`,
        ada.accessToken,
        { headers: { upgrade: "websocket" } },
      )
    ).status,
    200,
  );
  assert.equal(new URL(forwarded.at(-1)!.url).searchParams.get("cursor"), "7");
  assert.equal(
    (
      await call(
        `organizations/${personal.id}/threads/live?cursor=7`,
        grace.accessToken,
        { headers: { upgrade: "websocket" } },
      )
    ).status,
    404,
  );
});
