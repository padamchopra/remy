import { chmodSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { configDir } from "./paths.js";

/// One file for everything Remy persists: config, settings, chats, workspaces,
/// the board, archives, and the session registry.
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
      -- Which agent runs this thread, and the id that resumes it there. Each
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
      tint text,
      pr_monitoring_override integer not null default 0,
      pr_monitoring_enabled integer not null default 0,
      pr_monitoring_agent_id text
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
    -- The board. Every mutation is an event; the tables below are folds of it,
    -- rebuilt from the log rather than written to directly. That is what lets a
    -- second machine replay the same events and land on the same board.
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
      key_prefix text not null,
      origin text,
      icon text,
      tint text,
      counter integer not null default 0,
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
    create table if not exists agents (
      id text primary key,
      name text not null,
      handle text not null,
      role text,
      instructions text not null default '',
      provider text not null default 'claude',
      model text,
      effort text,
      permission_mode text not null default 'default',
      avatar text,
      tint text,
      auto_start integer not null default 1,
      handoff_to text,
      git_identity text not null default 'author',
      git_name text,
      git_email text,
      preset text,
      created_at integer not null,
      updated_at integer not null,
      deleted integer not null default 0
    );
    create table if not exists agent_memories (
      id text primary key,
      agent_id text not null,
      scope text not null default 'global',
      project_id text,
      content text not null,
      created_at integer not null,
      updated_at integer not null,
      deleted integer not null default 0
    );
    create index if not exists agent_memories_agent
      on agent_memories(agent_id, scope, project_id, deleted, updated_at);
    create table if not exists tickets (
      id text primary key,
      -- The number is what a ticket owns; the key is that number behind its
      -- project's slug, recomputed whenever either changes.
      number integer not null default 0,
      key text not null,
      project_id text not null,
      title text not null,
      body text not null default '',
      status text not null default 'backlog',
      priority integer not null default 0,
      assignee_agent_id text,
      parent_id text,
      rank text not null default 'n',
      device_id text,
      branch text,
      handoffs integer not null default 0,
      created_at integer not null,
      updated_at integer not null,
      started_at integer,
      closed_at integer,
      deleted integer not null default 0
    );
    create index if not exists tickets_project on tickets(project_id, status);
    create table if not exists ticket_threads (
      ticket_id text not null,
      device_id text not null,
      chat_id text not null,
      agent_id text,
      stage text,
      linked_by text not null default 'you',
      created_at integer not null,
      primary key (ticket_id, device_id, chat_id)
    );
    create index if not exists ticket_threads_chat on ticket_threads(chat_id);
    -- Agent routines reuse the former recurrence projection so existing
    -- databases need no destructive migration. project_id is empty for them.
    create table if not exists recurrences (
      id text primary key,
      project_id text not null,
      title text not null,
      body text not null default '',
      assignee_agent_id text,
      cadence text not null default 'weekly',
      hour integer not null default 9,
      minute integer not null default 0,
      weekday integer,
      day integer,
      enabled integer not null default 1,
      device_id text,
      runs integer not null default 0,
      last_run_at integer,
      last_error text,
      created_at integer not null,
      updated_at integer not null,
      deleted integer not null default 0
    );
    create index if not exists recurrences_project on recurrences(project_id);
    -- The other machines this one is paired with. The token is theirs, not
    -- ours: it is what this daemon presents when it calls them, which is why
    -- pairing lives here rather than in any one client.
    create table if not exists peers (
      id text primary key,
      name text not null,
      url text not null,
      token text not null,
      icon text,
      tint text,
      -- Whether notifications raised here are routed to that machine.
      notify integer not null default 0,
      paired_at integer not null,
      last_seen integer
    );
    -- iPhones that receive Apple Push from this daemon. A token is the phone's
    -- identity; the name is whatever it called itself when it registered.
    create table if not exists push_devices (
      token text primary key,
      name text not null,
      registered_at integer not null,
      last_seen integer not null
    );
    -- Shared workspace environments are encrypted independently on each
    -- machine. Sync decrypts only in daemon memory, over the authenticated peer
    -- channel, then re-encrypts with the receiving machine's key.
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
    database.exec("alter table peers add column tint text");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table chats add column agent_id text");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table tickets add column number integer not null default 0");
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
    database.exec("alter table agents add column effort text");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table workspaces add column pr_monitoring_override integer not null default 0");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table workspaces add column pr_monitoring_enabled integer not null default 0");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table workspaces add column pr_monitoring_agent_id text");
  } catch {
    // Column already exists on databases created after this migration.
  }
  // A thread that is an agent's inbox conversation rather than work in a
  // repository. Zero in every existing row, which is what they all are.
  try {
    database.exec("alter table chats add column dm integer not null default 0");
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
  // Loops were scheduled prompts with no ticket behind them. Recurring tickets
  // replaced them, and a table nothing reads is worth dropping rather than
  // carrying.
  database.exec("drop table if exists loops");
  try {
    database.exec("alter table recurrences add column every_minutes integer");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table recurrences add column body_path text");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table agents add column directives text");
  } catch {
    // Column already exists on databases created after this migration.
  }
  try {
    database.exec("alter table agents add column directives_path text");
  } catch {
    // Column already exists on databases created after this migration.
  }
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
