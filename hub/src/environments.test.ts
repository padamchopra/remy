import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sqliteD1 } from "../test/sqlite-d1.js";
import { EnvironmentStore } from "./environments.js";
test("reusable environments encrypt values, bind several workspaces, isolate organizations and clear assignments on deletion", async () => {
  const { db, sqlite } = sqliteD1(
    `CREATE TABLE organizations(id TEXT PRIMARY KEY);CREATE TABLE organization_workspaces(id TEXT PRIMARY KEY,organization_id TEXT,UNIQUE(organization_id,id));CREATE TABLE organization_computers(id TEXT PRIMARY KEY);CREATE TABLE hosted_workspace_bindings(computer_id TEXT,organization_id TEXT,workspace_id TEXT,UNIQUE(organization_id,workspace_id));INSERT INTO organizations VALUES('a'),('b');INSERT INTO organization_workspaces VALUES('one','a'),('two','a');` +
      readFileSync(
        new URL("../migrations/0017_environments.sql", import.meta.url),
        "utf8",
      ),
  );
  const store = new EnvironmentStore(db, async () => "disposable-root-secret");
  const profile = await store.create("a", "Development");
  await store.update("a", profile.id, {
    values: { API_TOKEN: "test-secret-value" },
  });
  assert.ok(
    !JSON.stringify(await store.list("a")).includes("test-secret-value"),
  );
  assert.ok(
    !JSON.stringify(
      sqlite.prepare("SELECT * FROM reusable_environments").all(),
    ).includes("test-secret-value"),
  );
  await assert.rejects(store.values("b", profile.id));
  await assert.rejects(
    store.update("a", profile.id, { values: { REMY_HOSTED_TASK: "1" } }),
  );
  await assert.rejects(
    store.update("a", profile.id, {
      name: "Changed",
      values: { REMY_HOSTED_TASK: "1" },
    }),
  );
  assert.equal((await store.list("a"))[0].name, "Development");
  await store.assign("a", "one", profile.id);
  await store.assign("a", "two", profile.id);
  assert.equal(
    (await store.forWorkspace("a", "two"))?.values.API_TOKEN,
    "test-secret-value",
  );
  await store.update("a", profile.id, { remove: "API_TOKEN" });
  assert.deepEqual((await store.forWorkspace("a", "one"))?.values, {});
  await store.remove("a", profile.id);
  assert.deepEqual(await store.assignments("a"), []);
  sqlite.close();
});
