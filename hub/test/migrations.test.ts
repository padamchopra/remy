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

const identityMigration = readFileSync(new URL("../migrations/0001_identity.sql", import.meta.url), "utf8");
const accountsMigration = readFileSync(new URL("../migrations/0002_accounts.sql", import.meta.url), "utf8");
const organizationsMigration = readFileSync(new URL("../migrations/0003_organizations.sql", import.meta.url), "utf8");
const hubRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(identityMigration);
  database.exec(accountsMigration);
  database.exec(organizationsMigration);
  return database;
}

function columns(database: DatabaseSync, table: string): string[] {
  return database.prepare(`SELECT name FROM pragma_table_info(?) ORDER BY cid`).all(table).map((row) => String(row.name));
}

test("the checked-in migration contains the pinned Better Auth schema", () => {
  const database = migratedDatabase();
  const generated = getSchema(
    authOptionsFor({
      BETTER_AUTH_URL: "http://schema.invalid",
      DB: {} as D1Database,
    }, "schema-generation-secret-is-never-deployed"),
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

test("durable client credentials have hash columns and no raw-token columns", () => {
  const database = migratedDatabase();
  const sessionColumns = columns(database, "auth_sessions");
  const deviceColumns = columns(database, "device_authorizations");

  assert.ok(sessionColumns.includes("access_token_hash"));
  assert.ok(sessionColumns.includes("refresh_token_hash"));
  assert.ok(deviceColumns.includes("device_code_hash"));
  assert.ok(deviceColumns.includes("user_code_hash"));
  assert.equal(sessionColumns.includes("access_token"), false);
  assert.equal(sessionColumns.includes("refresh_token"), false);
  assert.equal(deviceColumns.includes("device_code"), false);
});

test("organization teams cannot contain a member from another tenant", () => {
  const database = migratedDatabase();
  database.prepare("INSERT INTO user (id,name,email,createdAt,updatedAt) VALUES ('owner','Owner','owner@example.com',1,1),('other','Other','other@example.com',1,1)").run();
  database.prepare("INSERT INTO organizations (id,name,createdAt,updatedAt) VALUES ('first','First',1,1),('second','Second',1,1)").run();
  database.prepare("INSERT INTO memberships (id,organization_id,user_id,role,createdAt,updatedAt) VALUES ('m1','first','owner','owner',1,1),('m2','second','other','owner',1,1)").run();
  database.prepare("INSERT INTO organization_teams (id,organization_id,name,created_at,updated_at) VALUES ('team','first','Builders',1,1)").run();
  assert.throws(() => database.prepare("INSERT INTO organization_team_members (organization_id,team_id,user_id,created_at) VALUES ('first','team','other',1)").run(), /FOREIGN KEY/);
});

test("Wrangler records the migration and makes a second apply a no-op", (context) => {
  const fixture = mkdtempSync(join(tmpdir(), "remy-hub-migrations-"));
  context.after(() => rmSync(fixture, { force: true, recursive: true }));
  const migrations = join(fixture, "migrations");
  const state = join(fixture, "state");
  mkdirSync(migrations);
  copyFileSync(new URL("../migrations/0001_identity.sql", import.meta.url), join(migrations, "0001_identity.sql"));
  copyFileSync(new URL("../migrations/0002_accounts.sql", import.meta.url), join(migrations, "0002_accounts.sql"));
  copyFileSync(new URL("../migrations/0003_organizations.sql", import.meta.url), join(migrations, "0003_organizations.sql"));
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

  const firstApply = apply();
  assert.match(firstApply, /0001_identity\.sql/);
  assert.match(firstApply, /0002_accounts\.sql/);
  assert.match(firstApply, /0003_organizations\.sql/);
  assert.match(apply(), /No migrations to apply/);
});
