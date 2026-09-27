import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const workspacesMigration = readFileSync(new URL("../migrations/0004_workspaces.sql", import.meta.url), "utf8");
const computersMigration = readFileSync(new URL("../migrations/0005_computers.sql", import.meta.url), "utf8");
const hubRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(identityMigration);
  database.exec(accountsMigration);
  database.exec(organizationsMigration);
  database.exec(workspacesMigration);
  database.exec(computersMigration);
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

test("removing workspace access opens every workspace to its organization and drops the grants", () => {
  const folder = new URL("../migrations/", import.meta.url);
  const files = readdirSync(folder).filter((file) => file.endsWith(".sql")).sort();
  const removal = files.indexOf("0036_remove_workspace_access_and_defaults.sql");
  assert.ok(removal > 0);
  const database = new DatabaseSync(":memory:");
  for (const file of files.slice(0, removal)) database.exec(readFileSync(new URL(file, folder), "utf8"));
  database.prepare("INSERT INTO organizations (id,name,createdAt,updatedAt) VALUES ('first','First',1,1)").run();
  database.prepare("INSERT INTO organization_workspaces (id,organization_id,name,origin,restricted,created_at,updated_at) VALUES ('workspace','first','Remy','github.com/padam/remy',1,1,1)").run();
  database.exec(readFileSync(new URL(files[removal], folder), "utf8"));
  assert.equal(database.prepare("SELECT restricted FROM organization_workspaces WHERE id='workspace'").get()?.restricted, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('organization_workspace_teams','organization_workspace_members','member_workspace_model_defaults')").get()?.count, 0);
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
  copyFileSync(new URL("../migrations/0004_workspaces.sql", import.meta.url), join(migrations, "0004_workspaces.sql"));
  copyFileSync(new URL("../migrations/0005_computers.sql", import.meta.url), join(migrations, "0005_computers.sql"));
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
  assert.match(firstApply, /0004_workspaces\.sql/);
  assert.match(firstApply, /0005_computers\.sql/);
  assert.match(apply(), /No migrations to apply/);
});

test("removing Tasks drops the board and Linear sync tables and keeps each person's Linear sign-in", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../migrations/", import.meta.url);
  const files = readdirSync(directory).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files.filter((file) => file < "0032")) database.exec(readFileSync(new URL(file, directory), "utf8"));
  database.exec(`INSERT INTO connection_deliveries(id,provider,delivery_id,event,payload,received_at) VALUES ('linear-one','linear','one','Issue','{}',1),('github-one','github','one','issue_comment','{}',1)`);
  database.exec(readFileSync(new URL("0032_remove_tasks.sql", directory), "utf8"));
  const tables = new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map((row) => String(row.name)));
  for (const removed of ["organization_board_computers", "linear_board_settings", "linear_catalog", "linear_workspace_mappings", "linear_member_mappings", "linear_updates"]) assert.equal(tables.has(removed), false, removed);
  for (const kept of ["linear_accounts", "organization_linear_links", "connections", "connection_deliveries"]) assert.equal(tables.has(kept), true, kept);
  assert.deepEqual(database.prepare("SELECT id FROM connection_deliveries").all().map((row) => row.id), ["github-one"]);
});

test("Linear organization choices migrate to one private row per member", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../migrations/", import.meta.url);
  const files = readdirSync(directory).filter((file) => file.endsWith(".sql")).sort();
  const migration = files.indexOf("0038_private_linear_links.sql");
  for (const file of files.slice(0, migration)) database.exec(readFileSync(new URL(file, directory), "utf8"));
  database.exec("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('ada','Ada','ada@example.test',1,1),('grace','Grace','grace@example.test',1,1); INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('studio','Studio',1,1); INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('a','studio','ada','owner',1,1),('g','studio','grace','member',1,1); INSERT INTO linear_accounts(id,user_id,external_id,label,credentials,updated_at) VALUES('la','ada','linear-studio','Studio','secret-a',1),('lg','grace','linear-studio','Studio','secret-g',1); INSERT INTO organization_linear_links(organization_id,external_id,label,updated_at) VALUES('studio','linear-studio','Studio',1)");
  database.exec(readFileSync(new URL(files[migration]!, directory), "utf8"));
  assert.deepEqual(
    database.prepare("SELECT user_id,external_id FROM member_linear_links ORDER BY user_id").all().map((row) => ({ ...row })),
    [{ user_id: "ada", external_id: "linear-studio" }, { user_id: "grace", external_id: "linear-studio" }],
  );
  assert.equal(database.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='organization_linear_links'").get()?.count, 0);
  database.prepare("DELETE FROM memberships WHERE organization_id='studio' AND user_id='ada'").run();
  assert.deepEqual(database.prepare("SELECT user_id FROM member_linear_links").all().map((row) => ({ ...row })), [{ user_id: "grace" }]);
});

test("computer names are bounded without losing a hosted task suffix", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../migrations/", import.meta.url);
  const files = readdirSync(directory).filter((file) => file.endsWith(".sql")).sort();
  const migration = files.indexOf("0039_bound_computer_names.sql");
  for (const file of files.slice(0, migration)) database.exec(readFileSync(new URL(file, directory), "utf8"));
  database.exec("INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('org','Org',1,1)");
  const insert = database.prepare("INSERT INTO organization_computers(id,organization_id,owner_user_id,name,icon,ownership,access,platform,daemon_version,protocol_minimum,protocol_maximum,public_key,capabilities,last_seen_at,registered_at,updated_at) VALUES(?,?,NULL,?,'cloud',?,'{\"mode\":\"organization\",\"userIds\":[],\"teamIds\":[]}','linux','0.1.0',1,1,?,'{\"providers\":[],\"workspaces\":[],\"worktrees\":true,\"terminals\":true,\"emulator\":false}',NULL,1,1)");
  insert.run("task", "org", `${"A".repeat(120)} · abcdef`, "hosted", "k".repeat(32));
  insert.run("shared", "org", "B".repeat(129), "organization", "k".repeat(32));
  database.exec(readFileSync(new URL(files[migration]!, directory), "utf8"));
  const rows = database.prepare("SELECT id,name,length(name) AS length FROM organization_computers ORDER BY id").all();
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { id: "shared", name: "B".repeat(120), length: 120 },
    { id: "task", name: `${"A".repeat(111)} · abcdef`, length: 120 },
  ]);
});

test("monitoring is dropped, Activity gets read marks, and recorded GitHub activity stays", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../migrations/", import.meta.url);
  const files = readdirSync(directory).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files.filter((file) => file < "0034")) database.exec(readFileSync(new URL(file, directory), "utf8"));
  database.exec("INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('org','Org',1,1); INSERT INTO organization_workspaces(id,organization_id,name,origin,created_at,updated_at) VALUES('w','org','Remy','github.com/release/remy',1,1)");
  database.exec("INSERT INTO github_activity(id,organization_id,workspace_id,event,pull_number,summary,created_at) VALUES('a','org','w','issue_comment',7,'Comment updated',1)");
  database.exec(readFileSync(new URL("0034_pull_request_seen.sql", directory), "utf8"));
  const tables = new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map((row) => String(row.name)));
  assert.equal(tables.has("github_monitoring"), false);
  for (const kept of ["pull_request_seen", "github_activity"]) assert.equal(tables.has(kept), true, kept);
  assert.equal(tables.has("pull_request_follows"), false);
  assert.equal(columns(database, "github_activity").includes("delivered_at"), false);
  assert.deepEqual({ ...database.prepare("SELECT id, summary FROM github_activity").get() }, { id: "a", summary: "Comment updated" });
});

test("the review agent's tables keep rules per person and go with their review thread", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) database.exec(readFileSync(new URL(file, directory), "utf8"));
  database.exec("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('ada','Ada','ada@example.test',1,1); INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('org','Org',1,1); INSERT INTO organization_workspaces(id,organization_id,name,origin,created_at,updated_at) VALUES('w','org','Remy','github.com/release/remy',1,1)");
  database.exec("INSERT INTO review_rules(id,user_id,repository,text,enabled,created_at,updated_at) VALUES('r','ada',NULL,'Rule',1,1,1)");
  database.exec("INSERT INTO review_threads(organization_id,computer_id,thread_id,user_id,workspace_id,repository,pull_number,title,base_ref,head_ref,started_sha,head_sha,created_at,updated_at) VALUES('org','mac','t','ada','w','release/remy',7,'T','main','b','s','s',1,1)");
  database.exec("INSERT INTO review_findings(id,organization_id,computer_id,thread_id,path,start_line,end_line,side,severity,title,body,commit_sha,position,created_at,updated_at) VALUES('f','org','mac','t','a.ts',1,1,'RIGHT','must','T','B','s',1,1,1)");
  database.exec("INSERT INTO review_rule_proposals(id,organization_id,computer_id,thread_id,text,scope,reason,created_at,updated_at) VALUES('p','org','mac','t','Rule','all','r',1,1)");
  assert.throws(() => database.exec("INSERT INTO review_findings(id,organization_id,computer_id,thread_id,path,start_line,end_line,side,severity,title,body,commit_sha,position,created_at,updated_at) VALUES('g','org','mac','t','a.ts',1,1,'UP','must','T','B','s',2,1,1)"));
  database.exec("DELETE FROM review_threads WHERE thread_id='t'");
  assert.equal(database.prepare("SELECT count(*) AS n FROM review_findings").get()?.n, 0);
  assert.equal(database.prepare("SELECT count(*) AS n FROM review_rule_proposals").get()?.n, 0);
  assert.equal(database.prepare("SELECT count(*) AS n FROM review_rules").get()?.n, 1);
  database.exec("DELETE FROM user WHERE id='ada'");
  assert.equal(database.prepare("SELECT count(*) AS n FROM review_rules").get()?.n, 0);
});
