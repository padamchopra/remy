import { chmodSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { configDir } from "./paths.js";

/// One file for everything Remy persists: config, settings, chats, workspaces,
/// projects, archives, and the session registry.
export const dbFile = join(configDir, "remy.db");

const sqlite = await import("node:sqlite");
export const db: DatabaseSync = new sqlite.DatabaseSync(dbFile);
db.exec("pragma journal_mode = wal");
db.exec("pragma synchronous = normal");
db.exec("pragma foreign_keys = on");
migrate(db);
try {
  chmodSync(dbFile, 0o600);
} catch {
  // A freshly created WAL file can race chmod; the next write retries.
}

function migrate(database: DatabaseSync): void {
  database.exec(`
    create table if not exists kv (
      key text primary key,
      value text not null
    );
    create table if not exists chats (
      id text primary key,
      title text not null,
      cwd text not null,
      model text,
      effort text,
      permission_mode text not null,
      created_at integer not null,
      updated_at integer not null,
      claude_session_id text,
      -- Which provider runs this thread, and the id that resumes it there. Each
      -- provider keeps its own transcript, so each has its own column: a thread
      -- that ran on one is not resumable on the other.
      provider text not null default 'claude',
      codex_thread_id text,
      cursor_session_id text,
      turns integer not null default 0,
      cost_usd real,
      context_json text,
      todos_json text,
      error text,
      pinned integer not null default 0,
      parent_chat_id text references chats(id) on delete cascade
    );
    create table if not exists chat_entries (
      chat_id text not null references chats(id) on delete cascade,
      seq integer not null,
      entry_id text not null,
      json text not null,
      primary key (chat_id, entry_id)
    );
    create index if not exists chat_entries_order on chat_entries(chat_id, seq);
    create table if not exists workspaces (
      id text primary key,
      name text not null,
      path text not null,
      icon text,
      tint text
    );
    create table if not exists archives (
      id text primary key,
      chat_id text,
      session text not null,
      archived_at integer not null,
      agent text not null,
      cwd text,
      conversation_json text not null
    );
    create table if not exists registry (
      name text primary key,
      json text not null
    );
    -- Every change to a project is an event; the projects table is a fold of
    -- it, rebuilt from the log rather than written to directly.
    create table if not exists board_log (
      id text primary key,
      device_id text not null,
      lamport integer not null,
      at integer not null,
      entity text not null,
      entity_id text not null,
      kind text not null,
      json text not null
    );
    create index if not exists board_log_entity on board_log(entity, entity_id, lamport);
    create index if not exists board_log_cursor on board_log(lamport, device_id);
    create table if not exists projects (
      id text primary key,
      name text not null,
      origin text,
      icon text,
      tint text,
      created_at integer not null,
      updated_at integer not null,
      deleted integer not null default 0
    );
    -- Local, not projected: which folder on *this* disk a synced project is.
    create table if not exists project_workspaces (
      project_id text not null,
      workspace_id text not null,
      primary key (project_id, workspace_id)
    );
    -- Shared workspace environments are encrypted independently on each
    -- machine. Values from the hub arrive over the authenticated computer
    -- channel and are re-encrypted with this machine's key.
    create table if not exists workspace_environments (
      id text primary key,
      project_id text not null,
      name text not null,
      updated_at integer not null,
      device_id text not null,
      deleted integer not null default 0
    );
    create index if not exists workspace_environments_project
      on workspace_environments(project_id, deleted, name);
    create table if not exists workspace_environment_values (
      environment_id text not null,
      name text not null,
      ciphertext text,
      iv text,
      tag text,
      updated_at integer not null,
      device_id text not null,
      deleted integer not null default 0,
      primary key (environment_id, name)
    );
    create table if not exists workspace_environment_selection (
      project_id text primary key,
      environment_id text not null,
      updated_at integer not null,
      device_id text not null
    );
    create table if not exists cursor_cloud_chats (
      id text primary key,
      title text not null,
      cwd text not null,
      origin text not null,
      starting_ref text not null,
      model text,
      permission_mode text not null default 'default',
      cursor_agent_id text,
      cursor_run_id text,
      state text not null default 'idle',
      action text,
      working_since integer,
      created_at integer not null,
      updated_at integer not null,
      error text,
      archived_at integer
    );
    create table if not exists cursor_cloud_entries (
      chat_id text not null references cursor_cloud_chats(id) on delete cascade,
      seq integer not null,
      entry_id text not null,
      json text not null,
      primary key (chat_id, entry_id)
    );
    create index if not exists cursor_cloud_entries_order on cursor_cloud_entries(chat_id, seq);
    create table if not exists pull_request_guides (
      repository text not null,
      number integer not null,
      json text not null,
      updated_at integer not null,
      primary key (repository, number)
    );
    create table if not exists pull_request_questions (
      id text primary key,
      repository text not null,
      number integer not null,
      json text not null,
      created_at integer not null
    );
    create index if not exists pull_request_questions_pr on pull_request_questions(repository, number, created_at);
  `);
  // Agents and routines were removed, and their projections with them.
  database.exec("drop table if exists agent_memories");
  database.exec("drop table if exists agents");
  database.exec("drop table if exists recurrences");
  // Pairing computers directly was replaced by the hub. The table held other
  // machines' bearer tokens, so it goes rather than sitting inert.
  database.exec("drop table if exists peers");
  // Apple Push from the daemon served the retired iPhone app; the hub sends
  // its own notifications.
  database.exec("drop table if exists push_devices");
  database.exec("delete from kv where key = 'pairing'");
  // The hub watches pull requests now, from GitHub's webhooks; the poller that
  // read gh here and its per-thread choices are gone.
  database.exec("delete from kv where key in ('pullRequestMonitoringOverrides', 'pullRequestMonitorHandled')");
  // Tasks were removed. Tickets and their thread links go with their events;
  // the log keeps only the projects that workspaces and environments use.
  database.exec("drop table if exists ticket_threads");
  database.exec("drop table if exists tickets");
  database.exec("delete from board_log where entity <> 'project'");
  for (const column of ["key_prefix", "counter"]) {
    try {
      database.exec(`alter table projects drop column ${column}`);
    } catch {
      // Column already gone on databases created after this migration.
    }
  }
  try {
    database.exec("alter table workspaces add column icon text");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table workspaces add column tint text");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table projects add column icon text");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table projects add column tint text");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table chats add column provider text not null default 'claude'");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table chats add column codex_thread_id text");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table chats add column cursor_session_id text");
  } catch {
    // Column already exists on databases created after this migration.
  }
  // A workspace can run on something other than this machine's default. Null in
  // both means it follows the machine, which is what every existing row does.
  try {
    database.exec("alter table workspaces add column provider text");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table workspaces add column model text");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table workspaces add column effort text");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table chats add column effort text");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table chats add column read_at integer");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table chats add column pinned integer not null default 0");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table chats add column parent_chat_id text references chats(id) on delete cascade");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table archives add column chat_id text");
  } catch {
    // Column already exists on databases created after this migration.
  }
  // Loops were scheduled prompts, and a table nothing reads is worth dropping
  // rather than carrying.
  database.exec("drop table if exists loops");
  database.exec("pragma user_version = 9");
}

export function getKv<T>(key: string): T | undefined {
  const row = db.prepare("select value from kv where key = ?").get(key) as { value?: string } | undefined;
  if (typeof row?.value !== "string") return undefined;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return undefined;
  }
}

export function setKv(key: string, value: unknown): void {
  db.prepare("insert or replace into kv (key, value) values (?, ?)").run(key, JSON.stringify(value));
}

export function runTransaction(work: () => void): void {
  db.exec("begin immediate");
  try {
    work();
    db.exec("commit");
  } catch (error) {
    try {
      db.exec("rollback");
    } catch {
      // The connection is already aborted; the original error is the one to throw.
    }
    throw error;
  }
}
