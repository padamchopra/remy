import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../test/sqlite-d1.js";
import { EnvironmentError, EnvironmentStore } from "./environments.js";

function database() {
  const { db, sqlite } = sqliteD1("PRAGMA foreign_keys=OFF");
  for (const name of readdirSync(new URL("../migrations", import.meta.url)).sort())
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  sqlite.exec("PRAGMA foreign_keys=ON");
  const at = Date.now();
  for (const user of ["ada", "ben"]) sqlite.prepare("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES(?,?,?,?,?)").run(user, user === "ada" ? "Ada Lovelace" : "Ben Ng", `${user}@example.test`, at, at);
  for (const org of ["org", "other"]) sqlite.prepare("INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES(?,?,?,?)").run(org, org, at, at);
  for (const [org, id] of [["org", "api"], ["org", "web"], ["other", "api-2"]]) sqlite.prepare("INSERT INTO organization_workspaces(id,organization_id,name,origin,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(id, org, id, `github.com/example/${id}`, at, at);
  return { db, sqlite, store: new EnvironmentStore(db, async () => "disposable-root-secret") };
}
const people = async (id: string) => id === "ada"
  ? { name: "Ada Lovelace", image: "https://example.test/ada.jpg" }
  : { name: "Ben Ng" };

test("the migration drops named environments and creates one table per scope", () => {
  const { sqlite } = database();
  const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((row) => row.name);
  assert.ok(!tables.includes("reusable_environments"));
  assert.ok(!tables.includes("workspace_environment_bindings"));
  assert.ok(tables.includes("workspace_environment_values"));
  assert.ok(tables.includes("personal_environment_values"));
  sqlite.close();
});

test("another member's thread gets Ada's Workspace secret but never her Personal one", async () => {
  const { sqlite, store } = database();
  await store.add("org", "api", "ada", { values: [
    { key: "DATABASE_URL", value: "test-shared-secret", kind: "secret", scope: "workspace" },
    { key: "OPENAI_API_KEY", value: "test-ada-personal", kind: "secret", scope: "personal" },
    { key: "LOG_LEVEL", value: "debug", kind: "variable", scope: "workspace" },
  ] });
  assert.deepEqual((await store.forThread("org", "api", "ben")).values, { DATABASE_URL: "test-shared-secret", LOG_LEVEL: "debug" });
  assert.deepEqual((await store.forThread("org", "api", "ada")).values, { OPENAI_API_KEY: "test-ada-personal", DATABASE_URL: "test-shared-secret", LOG_LEVEL: "debug" });
  // Personal values follow Ada into another workspace and another organization.
  assert.deepEqual((await store.forThread("org", "web", "ada")).values, { OPENAI_API_KEY: "test-ada-personal" });
  assert.deepEqual((await store.forThread("other", "api-2", "ada")).values, { OPENAI_API_KEY: "test-ada-personal" });
  assert.deepEqual((await store.forThread("other", "api-2", "ben")).values, {});
  assert.deepEqual((await store.forThread("org", "api", "ada")).secrets.sort(), ["DATABASE_URL", "OPENAI_API_KEY"]);

  const seenByBen = await store.list("org", "api", "ben", people);
  assert.deepEqual(seenByBen.map((value) => value.key), ["DATABASE_URL", "LOG_LEVEL"]);
  assert.ok(!JSON.stringify(seenByBen).includes("test-shared-secret"));
  assert.equal(seenByBen.find((value) => value.key === "LOG_LEVEL")?.value, "debug");
  assert.equal(seenByBen[0].createdBy.name, "Ada Lovelace");
  assert.equal(seenByBen[0].createdBy.image, "https://example.test/ada.jpg");
  const seenByAda = await store.list("org", "api", "ada", people);
  assert.ok(!JSON.stringify(seenByAda).includes("test-ada-personal"));
  assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM workspace_environment_values").all()).includes("test-shared-secret"));
  assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM personal_environment_values").all()).includes("test-ada-personal"));
  sqlite.close();
});

test("anyone removes a Workspace value, but only its owner removes a Personal one", async () => {
  const { sqlite, store } = database();
  await store.add("org", "api", "ada", { values: [
    { key: "SHARED", value: "one", kind: "variable", scope: "workspace" },
    { key: "MINE", value: "two", kind: "variable", scope: "personal" },
  ] });
  const [shared, mine] = await store.list("org", "api", "ada", people);
  assert.equal(shared.removable, true);
  assert.equal(mine.removable, true);
  assert.equal((await store.list("org", "api", "ben", people))[0].removable, true);
  await assert.rejects(store.remove("org", "api", "ben", mine.id), (error: unknown) => error instanceof EnvironmentError && error.status === 404);
  assert.deepEqual((await store.forThread("org", "web", "ada")).values, { MINE: "two" });
  assert.equal(await store.remove("org", "api", "ben", shared.id), "workspace");
  assert.equal(await store.remove("org", "api", "ada", mine.id), "personal");
  assert.deepEqual(await store.list("org", "api", "ada", people), []);
  sqlite.close();
});

test("a Workspace value wins over a Personal one with the same key, and a key repeats only by replacing", async () => {
  const { sqlite, store } = database();
  await store.add("org", "api", "ada", { values: [{ key: "API_URL", value: "https://mine.test", kind: "variable", scope: "personal" }] });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await store.add("org", "api", "ben", { values: [{ key: "API_URL", value: "https://shared.test", kind: "variable", scope: "workspace" }] });
  assert.equal((await store.forThread("org", "api", "ada")).values.API_URL, "https://shared.test");
  assert.equal((await store.forThread("org", "web", "ada")).values.API_URL, "https://mine.test");
  const listed = await store.list("org", "api", "ada", people);
  assert.deepEqual(listed.map((value) => [value.scope, value.overridden ?? false]), [["personal", true], ["workspace", false]]);
  assert.equal((await store.list("org", "web", "ada", people))[0].overridden, undefined);

  await store.add("org", "api", "ada", { values: [{ key: "API_URL", value: "test-replaced", kind: "secret", scope: "workspace" }] });
  const replaced = (await store.list("org", "api", "ben", people)).filter((value) => value.key === "API_URL");
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].kind, "secret");
  assert.equal(replaced[0].value, undefined);
  assert.equal(replaced[0].createdBy.id, "ada");
  await assert.rejects(store.add("org", "api", "ada", { values: [
    { key: "TWICE", value: "a", kind: "variable", scope: "workspace" },
    { key: "TWICE", value: "b", kind: "variable", scope: "workspace" },
  ] }), /twice/);
  sqlite.close();
});

test("keys, sizes and counts are validated, and values go with their workspace", async () => {
  const { sqlite, store } = database();
  for (const key of ["REMY_TOKEN", "MC_CONFIG_DIR", "1ABC", "NODE_OPTIONS", ""])
    await assert.rejects(store.add("org", "api", "ada", { values: [{ key, value: "x", kind: "variable", scope: "workspace" }] }), EnvironmentError);
  await assert.rejects(store.add("org", "api", "ada", { values: [{ key: "BIG", value: "x".repeat(32_769), kind: "variable", scope: "workspace" }] }), /32 KB/);
  await assert.rejects(store.add("org", "api", "ada", { values: [{ key: "KIND", value: "x", kind: "file", scope: "workspace" }] }), EnvironmentError);
  await assert.rejects(store.add("org", "api", "ada", { values: Array.from({ length: 5 }, (_, index) => ({ key: `LARGE_${index}`, value: "x".repeat(30_000), kind: "variable", scope: "workspace" })) }), /128 KB/);
  await store.add("org", "api", "ada", { values: [{ key: "GONE", value: "x", kind: "variable", scope: "workspace" }] });
  sqlite.prepare("DELETE FROM organization_workspaces WHERE id='api'").run();
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM workspace_environment_values").get() as { n: number }).n, 0);
  sqlite.close();
});

test("a sealed value opens only in the scope it was written for", async () => {
  const { sqlite, store } = database();
  await store.add("org", "api", "ada", { values: [{ key: "TOKEN", value: "test-bound-value", kind: "secret", scope: "workspace" }] });
  sqlite.exec("INSERT INTO workspace_environment_values(organization_id,workspace_id,id,key,kind,ciphertext,created_by,created_at) SELECT organization_id,'web',id,key,kind,ciphertext,created_by,created_at FROM workspace_environment_values");
  await assert.rejects(store.forThread("org", "web", "ben"));
  sqlite.close();
});
