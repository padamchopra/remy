import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { getSchema } from "better-auth/db";

import { authOptionsFor } from "../src/auth.js";

const migration = readFileSync(new URL("../migrations/0001_identity.sql", import.meta.url), "utf8");
const hubRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(migration);
  return database;
}

function columns(database: DatabaseSync, table: string): string[] {
  return database.prepare(`SELECT name FROM pragma_table_info(?) ORDER BY cid`).all(table).map((row) => String(row.name));
}

test("the checked-in migration contains the pinned Better Auth schema", () => {
  const database = migratedDatabase();
  const generated = getSchema(
    authOptionsFor({
      BETTER_AUTH_SECRET: "schema-generation-secret-is-never-deployed",
      BETTER_AUTH_URL: "http://schema.invalid",
      DB: {} as D1Database,
    }),
  );

  for (const [table, definition] of Object.entries(generated)) {
    assert.deepEqual(columns(database, table), ["id", ...Object.keys(definition.fields)]);
  }
  const applicationTables = database
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('organizations', 'memberships') ORDER BY name")
    .all()
    .map((row) => row.name);
  assert.deepEqual(applicationTables, ["memberships", "organizations"]);
});

test("membership rows are tenant-bound and unique", () => {
  const database = migratedDatabase();
  database.prepare("INSERT INTO user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)").run(
    "user-1",
    "Ada",
    "ada@example.com",
    1,
    1,
  );
  database.prepare("INSERT INTO organizations (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)").run(
    "org-1",
    "Example",
    1,
    1,
  );
  database
    .prepare("INSERT INTO memberships (id, organization_id, user_id, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
    .run("member-1", "org-1", "user-1", "owner", 1, 1);

  assert.throws(
    () =>
      database
        .prepare("INSERT INTO memberships (id, organization_id, user_id, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
        .run("member-2", "org-missing", "user-1", "member", 1, 1),
    /FOREIGN KEY/,
  );
  assert.throws(
    () =>
      database
        .prepare("INSERT INTO memberships (id, organization_id, user_id, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
        .run("member-3", "org-1", "user-1", "member", 1, 1),
    /UNIQUE/,
  );
  assert.throws(
    () =>
      database
        .prepare("INSERT INTO memberships (id, organization_id, user_id, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
        .run("member-4", "org-1", "user-1", "superuser", 1, 1),
    /CHECK/,
  );
});

test("Wrangler records the migration and makes a second apply a no-op", (context) => {
  const fixture = mkdtempSync(join(tmpdir(), "remy-hub-migrations-"));
  context.after(() => rmSync(fixture, { force: true, recursive: true }));
  const migrations = join(fixture, "migrations");
  const state = join(fixture, "state");
  mkdirSync(migrations);
  copyFileSync(new URL("../migrations/0001_identity.sql", import.meta.url), join(migrations, "0001_identity.sql"));
  const config = join(fixture, "wrangler.jsonc");
  writeFileSync(
    config,
    JSON.stringify({
      name: "remy-hub-migration-test",
      main: join(hubRoot, "src/worker.ts"),
      compatibility_date: "2026-09-04",
      d1_databases: [
        {
          binding: "DB",
          database_name: "remy-hub-migration-test",
          database_id: "00000000-0000-0000-0000-000000000001",
          migrations_dir: migrations,
        },
      ],
    }),
  );
  const wrangler = join(hubRoot, "node_modules/.bin/wrangler");
  const apply = () =>
    execFileSync(
      wrangler,
      ["d1", "migrations", "apply", "DB", "--local", "--persist-to", state, "--config", config],
      { cwd: hubRoot, encoding: "utf8" },
    );

  assert.match(apply(), /0001_identity\.sql/);
  assert.match(apply(), /No migrations to apply/);
});
