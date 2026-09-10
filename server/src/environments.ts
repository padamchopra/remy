import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { deviceId } from "./board-log.js";
import { db, getKv, runTransaction, setKv } from "./db.js";
import { getProject, projectForWorkspace } from "./projects.js";
import { run } from "./run.js";
import { listWorkspaces } from "./workspaces.js";

const KEYCHAIN_SERVICE = "me.padamchopra.Remy.workspace-environments";
const VALUE_LIMIT = 32_768;
const INPUT_LIMIT = 262_144;
const VARIABLE_LIMIT = 200;
const OUTPUT_LIMIT = 100_000;

export interface EnvironmentVariableView {
  name: string;
  configured: true;
  updatedAt: number;
}

export interface WorkspaceEnvironmentView {
  id: string;
  name: string;
  active: boolean;
  variables: EnvironmentVariableView[];
  updatedAt: number;
}

interface EnvironmentRow {
  id: string;
  project_id: string;
  name: string;
  updated_at: number;
  device_id: string;
  deleted: number;
}

interface ValueRow {
  environment_id: string;
  name: string;
  ciphertext: string | null;
  iv: string | null;
  tag: string | null;
  updated_at: number;
  device_id: string;
  deleted: number;
}

interface SelectionRow {
  project_id: string;
  environment_id: string;
  updated_at: number;
  device_id: string;
}

export interface EnvironmentSyncRecord {
  kind: "environment" | "value" | "selection";
  id?: string;
  projectId: string;
  environmentId: string;
  name?: string;
  value?: string;
  updatedAt: number;
  deviceId: string;
  deleted?: boolean;
}

export interface RuntimeCommandInput {
  program: string;
  args?: string[];
  timeoutSeconds?: number;
}

export interface RuntimeCommandResult {
  command: string;
  output: string;
  exitCode: number;
  environment: string;
}

let cachedKey: Buffer | undefined;
const cleartextCache = new Map<string, string[]>();

function machineKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fallback = getKv<string>("workspaceEnvironmentKey");
  let encoded = "";
  if (process.platform === "darwin" && !process.env.MC_CONFIG_DIR) {
    try {
      encoded = execFileSync("/usr/bin/security", [
        "find-generic-password", "-a", deviceId, "-s", KEYCHAIN_SERVICE, "-w",
      ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch (error) {
      const detail = String((error as { stderr?: unknown; message?: unknown }).stderr ?? (error as Error).message ?? "");
      if (!/could not be found|item.*not found/i.test(detail)) {
        throw new Error("workspace environment encryption is unavailable");
      }
      const encrypted = db.prepare(
        "select 1 as present from workspace_environment_values where ciphertext is not null limit 1",
      ).get() as { present?: number } | undefined;
      if (encrypted?.present) throw new Error("the workspace environment key is missing from Keychain");
      encoded = randomBytes(32).toString("base64");
      execFileSync("/usr/bin/security", [
        "add-generic-password", "-a", deviceId, "-s", KEYCHAIN_SERVICE, "-w", encoded,
      ], { stdio: "ignore" });
    }
  } else {
    encoded = fallback ?? randomBytes(32).toString("base64");
    if (!fallback) setKv("workspaceEnvironmentKey", encoded);
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("workspace environment encryption is unavailable");
  cachedKey = key;
  return key;
}

function encrypt(value: string): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", machineKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decrypt(row: Pick<ValueRow, "ciphertext" | "iv" | "tag">): string {
  if (!row.ciphertext || !row.iv || !row.tag) return "";
  const decipher = createDecipheriv("aes-256-gcm", machineKey(), Buffer.from(row.iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function environmentRows(projectId: string): EnvironmentRow[] {
  return db.prepare(
    "select * from workspace_environments where (project_id = ? or project_id = '*') order by name collate nocase, id",
  ).all(projectId) as unknown as EnvironmentRow[];
}

function valueRows(environmentId: string, includeDeleted = false): ValueRow[] {
  const sql = includeDeleted
    ? "select * from workspace_environment_values where environment_id = ? order by name collate nocase"
    : "select * from workspace_environment_values where environment_id = ? and deleted = 0 order by name collate nocase";
  return db.prepare(sql).all(environmentId) as unknown as ValueRow[];
}

function selection(projectId: string): SelectionRow | undefined {
  return db.prepare("select * from workspace_environment_selection where project_id = ?").get(projectId) as
    | SelectionRow
    | undefined;
}

function assertProject(projectId: string): void {
  if (projectId !== "*" && !getProject(projectId)) throw new Error("no such workspace");
}

function environment(id: string, projectId?: string): EnvironmentRow {
  const row = db.prepare("select * from workspace_environments where id = ? and deleted = 0").get(id) as
    | EnvironmentRow
    | undefined;
  if (!row || (projectId && row.project_id !== projectId && row.project_id !== "*")) throw new Error("no such environment");
  return row;
}

function nextTimestamp(previous = 0): number {
  const stored = getKv<number>("workspaceEnvironmentClock") ?? 0;
  const rows = db.prepare(
    `select max(high) as high from (
       select max(updated_at) as high from workspace_environments
       union all select max(updated_at) as high from workspace_environment_values
       union all select max(updated_at) as high from workspace_environment_selection
     )`,
  ).get() as { high?: number | null } | undefined;
  const next = Math.max(stored, Number(rows?.high ?? 0), previous) + 1;
  setKv("workspaceEnvironmentClock", next);
  return next;
}

function compareVersion(a: { updatedAt: number; deviceId: string }, b: { updatedAt: number; deviceId: string }): number {
  return a.updatedAt === b.updatedAt ? a.deviceId.localeCompare(b.deviceId) : a.updatedAt - b.updatedAt;
}

function refreshCache(environmentId: string): void {
  cleartextCache.set(environmentId, valueRows(environmentId).map(decrypt).filter(Boolean));
}

/// Lists environment metadata without returning any stored value.
export function listEnvironments(projectId: string): WorkspaceEnvironmentView[] {
  assertProject(projectId);
  const active = selection(projectId)?.environment_id;
  return environmentRows(projectId)
    .filter((row) => row.deleted === 0)
    .map((row) => ({
      id: row.id,
      name: row.name,
      active: row.id === active,
      updatedAt: row.updated_at,
      variables: valueRows(row.id).map((value) => ({
        name: value.name,
        configured: true,
        updatedAt: value.updated_at,
      })),
    }));
}

/// Creates a named environment and selects the first one automatically.
export function createEnvironment(projectId: string, askedName: unknown): WorkspaceEnvironmentView {
  assertProject(projectId);
  const name = typeof askedName === "string" ? askedName.trim().slice(0, 60) : "";
  if (!name) throw new Error("an environment needs a name");
  if (environmentRows(projectId).some((row) => row.deleted === 0 && row.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("that environment already exists");
  }
  const id = randomUUID();
  const at = nextTimestamp();
  const picked = selection(projectId);
  const needsSelection = !picked || !environmentRows(projectId).some((row) => row.id === picked.environment_id && row.deleted === 0);
  runTransaction(() => {
    db.prepare(
      "insert into workspace_environments (id, project_id, name, updated_at, device_id, deleted) values (?, ?, ?, ?, ?, 0)",
    ).run(id, projectId, name, at, deviceId);
    if (needsSelection && projectId !== "*") {
      db.prepare(
        `insert into workspace_environment_selection (project_id, environment_id, updated_at, device_id)
         values (?, ?, ?, ?)
         on conflict(project_id) do update set environment_id = excluded.environment_id,
           updated_at = excluded.updated_at, device_id = excluded.device_id`,
      ).run(projectId, id, at, deviceId);
    }
  });
  return listEnvironments(projectId).find((entry) => entry.id === id)!;
}

/// Renames an environment without touching its values or active selection.
export function renameEnvironment(
  projectId: string,
  environmentId: string,
  askedName: unknown,
): WorkspaceEnvironmentView {
  const row = environment(environmentId, projectId);
  const name = typeof askedName === "string" ? askedName.trim().slice(0, 60) : "";
  if (!name) throw new Error("an environment needs a name");
  if (environmentRows(projectId).some((candidate) =>
    candidate.id !== row.id && candidate.deleted === 0 && candidate.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("that environment already exists");
  }
  db.prepare("update workspace_environments set name = ?, updated_at = ?, device_id = ? where id = ?")
    .run(name, nextTimestamp(row.updated_at), deviceId, row.id);
  return listEnvironments(projectId).find((entry) => entry.id === row.id)!;
}

/// Chooses which named environment runtime commands use for a workspace.
export function selectEnvironment(projectId: string, environmentId: string): WorkspaceEnvironmentView {
  const row = environment(environmentId, projectId);
  const previous = selection(projectId);
  const at = nextTimestamp(previous?.updated_at);
  db.prepare(
    `insert into workspace_environment_selection (project_id, environment_id, updated_at, device_id)
     values (?, ?, ?, ?)
     on conflict(project_id) do update set
       environment_id = excluded.environment_id, updated_at = excluded.updated_at, device_id = excluded.device_id`,
  ).run(projectId, row.id, at, deviceId);
  return listEnvironments(projectId).find((entry) => entry.id === row.id)!;
}

/// Leaves every encrypted value in place while making none of the named sets
/// available to runtime commands.
export function disableEnvironment(projectId: string): void {
  assertProject(projectId);
  const previous = selection(projectId);
  const at = nextTimestamp(previous?.updated_at);
  db.prepare(
    `insert into workspace_environment_selection (project_id, environment_id, updated_at, device_id)
     values (?, '', ?, ?)
     on conflict(project_id) do update set environment_id = '', updated_at = excluded.updated_at,
       device_id = excluded.device_id`,
  ).run(projectId, at, deviceId);
}

/// Deletes an environment without making its old encrypted values reappear on
/// a device that was offline during the deletion.
export function deleteEnvironment(projectId: string, environmentId: string): void {
  const row = environment(environmentId, projectId);
  const active = selection(projectId);
  const newestValue = valueRows(row.id, true).reduce((high, value) => Math.max(high, value.updated_at), 0);
  const at = nextTimestamp(Math.max(row.updated_at, active?.updated_at ?? 0, newestValue));
  runTransaction(() => {
    db.prepare(
      "update workspace_environments set deleted = 1, updated_at = ?, device_id = ? where id = ?",
    ).run(at, deviceId, row.id);
    db.prepare(
      `update workspace_environment_values
       set deleted = 1, ciphertext = null, iv = null, tag = null, updated_at = ?, device_id = ?
       where environment_id = ?`,
    ).run(at, deviceId, row.id);
    if (row.project_id === "*") {
      db.prepare("update workspace_environment_selection set environment_id = '', updated_at = ?, device_id = ? where environment_id = ?").run(at, deviceId, row.id);
    }
    if (active?.environment_id === row.id) {
      const next = environmentRows(projectId).find((candidate) => candidate.id !== row.id && candidate.deleted === 0);
      if (next) {
        db.prepare(
          "update workspace_environment_selection set environment_id = ?, updated_at = ?, device_id = ? where project_id = ?",
        ).run(next.id, at, deviceId, projectId);
      } else {
        db.prepare(
          "update workspace_environment_selection set environment_id = '', updated_at = ?, device_id = ? where project_id = ?",
        ).run(at, deviceId, projectId);
      }
    }
  });
  cleartextCache.delete(row.id);
}

function variableName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!validTaskVariable(name)) throw new Error(`${name || "a value"} is not a valid variable name`);
  return name;
}

/// Replaces named values while keeping every value out of API responses.
export function setEnvironmentValues(
  projectId: string,
  environmentId: string,
  values: Record<string, string>,
): WorkspaceEnvironmentView {
  environment(environmentId, projectId);
  const entries = Object.entries(values);
  if (entries.length === 0) throw new Error("add at least one value");
  const names = new Set([...valueRows(environmentId).map((row) => row.name), ...entries.map(([name]) => name)]);
  if (names.size > VARIABLE_LIMIT) throw new Error(`an environment can contain up to ${VARIABLE_LIMIT} values`);
  const at = nextTimestamp();
  runTransaction(() => {
    const statement = db.prepare(
      `insert into workspace_environment_values
         (environment_id, name, ciphertext, iv, tag, updated_at, device_id, deleted)
       values (?, ?, ?, ?, ?, ?, ?, 0)
       on conflict(environment_id, name) do update set
         ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag,
         updated_at = excluded.updated_at, device_id = excluded.device_id, deleted = 0`,
    );
    for (const [askedName, rawValue] of entries) {
      const name = variableName(askedName);
      const value = String(rawValue);
      if (value.length > VALUE_LIMIT) throw new Error(`${name} is too large`);
      const sealed = encrypt(value);
      statement.run(environmentId, name, sealed.ciphertext, sealed.iv, sealed.tag, at, deviceId);
    }
  });
  refreshCache(environmentId);
  return listEnvironments(projectId).find((entry) => entry.id === environmentId)!;
}

/// Removes one value and leaves a tombstone for peer convergence.
export function deleteEnvironmentValue(projectId: string, environmentId: string, askedName: unknown): void {
  environment(environmentId, projectId);
  const name = variableName(askedName);
  const existing = db.prepare(
    "select * from workspace_environment_values where environment_id = ? and name = ? and deleted = 0",
  ).get(environmentId, name) as ValueRow | undefined;
  if (!existing) throw new Error("no such environment value");
  db.prepare(
    `update workspace_environment_values
     set ciphertext = null, iv = null, tag = null, deleted = 1, updated_at = ?, device_id = ?
     where environment_id = ? and name = ?`,
  ).run(nextTimestamp(existing.updated_at), deviceId, environmentId, name);
  refreshCache(environmentId);
}

/// Parses ordinary dotenv lines and comma-separated KEY=value entries.
export function parseEnvironmentValues(input: string): Record<string, string> {
  if (Buffer.byteLength(input) > INPUT_LIMIT) throw new Error("that environment is too large");
  const normalized = input.replace(/\r\n?/g, "\n");
  const pieces: string[] = [];
  let start = 0;
  let quote = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if ((character === '"' || character === "'") && normalized[index - 1] !== "\\") {
      quote = quote === character ? "" : quote || character;
      continue;
    }
    const commaStartsEntry = character === ","
      && /^(?:\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=)/.test(normalized.slice(index + 1));
    if (!quote && (character === "\n" || commaStartsEntry)) {
      pieces.push(normalized.slice(start, index));
      start = index + 1;
    }
  }
  pieces.push(normalized.slice(start));
  const entries = pieces
    .map((piece) => piece.trim())
    .filter((piece) => piece && !piece.startsWith("#"));
  const values: Record<string, string> = {};
  for (const piece of entries) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/.exec(piece);
    if (!match) throw new Error(`Couldn't read "${piece.slice(0, 40)}" as NAME=value.`);
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    values[variableName(match[1])] = value;
  }
  if (Object.keys(values).length === 0) throw new Error("add at least one NAME=value pair");
  return values;
}

/// Finds dotenv files at a workspace root without revealing their contents.
export async function listEnvironmentFiles(projectId: string): Promise<string[]> {
  assertProject(projectId);
  const workspace = await workspaceForProjectId(projectId);
  return readdirSync(workspace.path)
    .filter((name) => /^\.env(?:\.[A-Za-z0-9_.-]+)?$/.test(name))
    .filter((name) => {
      try {
        const path = realpathSync(resolve(workspace.path, name));
        const inside = relative(workspace.path, path);
        return !inside.startsWith("..") && !isAbsolute(inside) && statSync(path).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

/// Imports a dotenv file from the workspace root without sending its contents
/// through the browser.
export async function importEnvironmentFile(
  projectId: string,
  environmentId: string,
  file: unknown,
  remove = false,
): Promise<WorkspaceEnvironmentView> {
  const name = typeof file === "string" ? file : "";
  if (!(await listEnvironmentFiles(projectId)).includes(name)) throw new Error("pick an environment file from this workspace");
  const workspace = await workspaceForProjectId(projectId);
  const path = realpathSync(resolve(workspace.path, name));
  if (relative(workspace.path, path).startsWith("..") || isAbsolute(relative(workspace.path, path))) {
    throw new Error("pick an environment file from this workspace");
  }
  const saved = setEnvironmentValues(projectId, environmentId, parseEnvironmentValues(readFileSync(path, "utf8")));
  if (remove) unlinkSync(path);
  return saved;
}

async function workspaceForProjectId(projectId: string) {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find((entry) => projectForWorkspace(entry.id)?.id === projectId);
  if (!workspace) throw new Error("this workspace is not on this machine");
  return workspace;
}

async function environmentForCwd(cwd: string): Promise<{
  projectId: string;
  environment: EnvironmentRow;
  values: Record<string, string>;
}> {
  let canonical: string;
  try { canonical=realpathSync(cwd); } catch { canonical=resolve(cwd); }
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find((candidate) => {
    const roots = [candidate.path, ...candidate.worktrees.map((worktree) => worktree.path)].map((path) => resolve(path));
    return roots.some((root) => canonical === root || !relative(root, canonical).startsWith("..") && !isAbsolute(relative(root, canonical)));
  });
  const project = workspace ? projectForWorkspace(workspace.id) : undefined;
  if (!project) throw new Error("this thread is not in a registered workspace");
  const picked = selection(project.id);
  if (!picked?.environment_id) throw new Error("this workspace has no active environment");
  const row = environment(picked.environment_id, project.id);
  const values = Object.fromEntries(valueRows(row.id).map((value) => [value.name, decrypt(value)]));
  cleartextCache.set(row.id, Object.values(values).filter(Boolean));
  return { projectId: project.id, environment: row, values };
}

function runtimeBaseEnvironment(): NodeJS.ProcessEnv {
  const names = ["HOME", "USER", "LOGNAME", "PATH", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM", "SSH_AUTH_SOCK"];
  return Object.fromEntries(names.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]])) as NodeJS.ProcessEnv;
}

function displayCommand(program: string, args: string[]): string {
  return [program, ...args].map((part) => /\s/.test(part) ? JSON.stringify(part) : part).join(" ");
}

function assertRuntimeCommand(program: string, args: string[]): void {
  const leaf = basename(program);
  const joined = args.join(" ");
  if ((leaf === "git" && /(?:^|\s)(?:commit|tag|push)(?:\s|$)/.test(joined))
    || (leaf === "gh" && /(?:^|\s)(?:pr|release)(?:\s|$)/.test(joined))
    || ((leaf === "bash" || leaf === "zsh" || leaf === "sh")
      && /\b(?:git\s+(?:[^;|&\n]+\s+)?(?:commit|tag|push)|gh\s+(?:pr|release))\b/.test(joined))) {
    throw new Error("run version-control publishing commands without the workspace environment");
  }
}

function runtimeGitGuard(values: string[]): { env: NodeJS.ProcessEnv; close(): void } {
  const root = mkdtempSync(join(tmpdir(), "remy-environment-hooks-"));
  const guard = `#!${process.execPath}
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
const values = JSON.parse(process.env.REMY_SECRET_GUARD || "[]").filter(Boolean).map((value) => Buffer.from(value));
const input = basename(process.argv[1]) === "commit-msg"
  ? readFileSync(process.argv[2])
  : execFileSync("git", ["diff", "--cached", "--no-ext-diff", "--binary"], { maxBuffer: 50 * 1024 * 1024 });
if (values.some((value) => input.includes(value))) {
  process.stderr.write("Remy blocked a commit containing a workspace environment value.\\n");
  process.exit(1);
}
`;
  for (const name of ["pre-commit", "commit-msg"]) {
    const path = join(root, name);
    writeFileSync(path, guard, { mode: 0o700 });
    chmodSync(path, 0o700);
  }
  return {
    env: {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: root,
      NODE_OPTIONS: "",
      REMY_SECRET_GUARD: JSON.stringify(values),
    },
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

async function redactChangedFiles(cwd: string, startedAt: number, values: string[]): Promise<string[]> {
  let root: string;
  try {
    root = realpathSync((await run("git", ["-C", cwd, "rev-parse", "--show-toplevel"])).stdout.trim());
  } catch {
    return [];
  }
  const redacted: string[] = [];
  const replacements = [...new Set(values)].filter(Boolean).sort((a, b) => b.length - a.length);
  try {
    const [tracked, staged, untracked] = await Promise.all([
      run("git", ["-C", root, "diff", "--name-only", "-z", "--diff-filter=ACMR"]),
      run("git", ["-C", root, "diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"]),
      run("git", ["-C", root, "ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
    const stagedPaths = new Set(staged.stdout.split("\0").filter(Boolean));
    const paths = [...new Set(`${tracked.stdout}\0${staged.stdout}\0${untracked.stdout}`.split("\0").filter(Boolean))];
    for (const relativePath of paths) {
      const path = resolve(root, relativePath);
      const inside = relative(root, path);
      if (inside.startsWith("..") || isAbsolute(inside)) continue;
      try {
        const metadata = statSync(path);
        if (!metadata.isFile() || metadata.mtimeMs < startedAt - 1_000 || metadata.size > 50 * 1024 * 1024) continue;
        const bytes = readFileSync(path);
        const original = bytes.toString("utf8");
        if (!Buffer.from(original, "utf8").equals(bytes)) continue;
        const safe = redactExact(original, replacements);
        if (safe === original) continue;
        writeFileSync(path, safe);
        if (stagedPaths.has(relativePath)) await run("git", ["-C", root, "add", "--", relativePath]);
        redacted.push(relativePath);
      } catch {
        // A file can disappear between git listing it and the scan.
      }
    }
  } catch {
    return [];
  }
  return redacted;
}

/// Replaces exact configured values before output crosses into a provider or a
/// persisted transcript. Longer values go first so one cannot partially mask
/// another.
export function redactExact(text: string, values: Iterable<string>): string {
  let redacted = text;
  const unique = [...new Set(values)].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const value of unique) redacted = redacted.split(value).join("[REDACTED]");
  return redacted;
}

/// Scrubs text against values already activated in this daemon. It is sync so
/// transcript persistence can apply it at the final write boundary.
export function redactKnownSecrets(text: string): string {
  return redactExact(text, [...cleartextCache.values()].flat());
}

/// Loads the active values for this workspace, then scrubs a user-supplied
/// string before it can be sent to the provider.
export async function redactForCwd(cwd: string, text: string): Promise<string> {
  try {
    const active = await environmentForCwd(cwd);
    return redactExact(text, Object.values(active.values));
  } catch {
    return redactKnownSecrets(text);
  }
}

/// Runs one executable with the active workspace environment. The provider
/// process never inherits these values; it receives only this redacted result.
export async function runWithEnvironment(cwd: string, input: RuntimeCommandInput): Promise<RuntimeCommandResult> {
  const program = typeof input.program === "string" ? input.program.trim() : "";
  if (!program || program.length > 500) throw new Error("a runtime command needs a program");
  const args = Array.isArray(input.args) ? input.args.map(String) : [];
  if (args.length > 200 || args.some((arg) => arg.length > 20_000)) throw new Error("that runtime command is too large");
  assertRuntimeCommand(program, args);
  const active = await environmentForCwd(cwd);
  const timeout = Math.min(Math.max(Number(input.timeoutSeconds) || 30, 1), 300) * 1000;
  const values = Object.values(active.values);
  const guard = runtimeGitGuard(values);
  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    try {
      const result = await run(program, args, {
        cwd,
        env: { ...runtimeBaseEnvironment(), ...active.values, ...guard.env },
        timeout,
        maxBuffer: OUTPUT_LIMIT,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      const detail = error as { stdout?: unknown; stderr?: unknown; code?: unknown; message?: unknown };
      stdout = Buffer.isBuffer(detail.stdout) ? detail.stdout.toString("utf8") : typeof detail.stdout === "string" ? detail.stdout : "";
      stderr = Buffer.isBuffer(detail.stderr)
        ? detail.stderr.toString("utf8")
        : typeof detail.stderr === "string" ? detail.stderr : String(detail.message ?? "the command failed");
      exitCode = typeof detail.code === "number" ? detail.code : 1;
    }
  } finally {
    guard.close();
  }
  const changed = await redactChangedFiles(cwd, startedAt, values);
  const notice = changed.length
    ? `Remy removed configured values from ${changed.length === 1 ? changed[0] : `${changed.length} changed files`}.`
    : "";
  const output = redactExact([stdout, stderr, notice].filter(Boolean).join("\n"), values);
  return {
    command: displayCommand(program, args),
    output: output.slice(0, OUTPUT_LIMIT),
    exitCode,
    environment: active.environment.name,
  };
}

/// Decrypts sync records only for an authenticated peer-to-peer exchange.
export function exportEnvironmentSync(): EnvironmentSyncRecord[] {
  const environments = db.prepare("select * from workspace_environments").all() as unknown as EnvironmentRow[];
  const records: EnvironmentSyncRecord[] = environments.map((row) => ({
    kind: "environment",
    id: row.id,
    projectId: row.project_id,
    environmentId: row.id,
    name: row.name,
    updatedAt: row.updated_at,
    deviceId: row.device_id,
    ...(row.deleted ? { deleted: true } : {}),
  }));
  for (const row of db.prepare("select * from workspace_environment_values").all() as unknown as ValueRow[]) {
    const parent = environments.find((candidate) => candidate.id === row.environment_id);
    if (!parent) continue;
    records.push({
      kind: "value",
      projectId: parent.project_id,
      environmentId: row.environment_id,
      name: row.name,
      ...(row.deleted ? {} : { value: decrypt(row) }),
      updatedAt: row.updated_at,
      deviceId: row.device_id,
      ...(row.deleted ? { deleted: true } : {}),
    });
  }
  for (const row of db.prepare("select * from workspace_environment_selection").all() as unknown as SelectionRow[]) {
    records.push({
      kind: "selection",
      projectId: row.project_id,
      environmentId: row.environment_id,
      updatedAt: row.updated_at,
      deviceId: row.device_id,
    });
  }
  return records;
}

function syncRecord(value: unknown): EnvironmentSyncRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (!new Set(["environment", "value", "selection"]).has(String(row.kind))) return undefined;
  const updatedAt = Number(row.updatedAt);
  const projectId = typeof row.projectId === "string" ? row.projectId : "";
  const environmentId = typeof row.environmentId === "string" ? row.environmentId : "";
  const from = typeof row.deviceId === "string" ? row.deviceId : "";
  const kind = row.kind as EnvironmentSyncRecord["kind"];
  if (!projectId || (!environmentId && kind !== "selection") || !from || !Number.isSafeInteger(updatedAt) || updatedAt <= 0) return undefined;
  if (kind !== "selection" && (typeof row.name !== "string" || !row.name)) return undefined;
  if (kind === "value" && row.deleted !== true && typeof row.value !== "string") return undefined;
  return {
    kind,
    projectId,
    environmentId,
    updatedAt,
    deviceId: from,
    ...(typeof row.id === "string" ? { id: row.id } : {}),
    ...(typeof row.name === "string" ? { name: row.name } : {}),
    ...(typeof row.value === "string" ? { value: row.value.slice(0, VALUE_LIMIT) } : {}),
    ...(row.deleted === true ? { deleted: true } : {}),
  };
}

/// Merges peer records by timestamp and device id, encrypting every incoming
/// value with this machine's own key before it reaches SQLite.
export function mergeEnvironmentSync(input: unknown): number {
  const records = (Array.isArray(input) ? input : []).map(syncRecord).filter((row): row is EnvironmentSyncRecord => !!row);
  const remoteHigh = records.reduce((high, row) => Math.max(high, row.updatedAt), 0);
  if (remoteHigh > (getKv<number>("workspaceEnvironmentClock") ?? 0)) {
    setKv("workspaceEnvironmentClock", remoteHigh);
  }
  let changed = 0;
  runTransaction(() => {
    for (const row of records) {
      if (row.kind === "environment") {
        const existing = db.prepare("select * from workspace_environments where id = ?").get(row.environmentId) as EnvironmentRow | undefined;
        if (existing && compareVersion({ updatedAt: row.updatedAt, deviceId: row.deviceId }, { updatedAt: existing.updated_at, deviceId: existing.device_id }) <= 0) continue;
        db.prepare(
          `insert into workspace_environments (id, project_id, name, updated_at, device_id, deleted)
           values (?, ?, ?, ?, ?, ?)
           on conflict(id) do update set project_id = excluded.project_id, name = excluded.name,
             updated_at = excluded.updated_at, device_id = excluded.device_id, deleted = excluded.deleted`,
        ).run(row.environmentId, row.projectId, row.name!, row.updatedAt, row.deviceId, row.deleted ? 1 : 0);
        changed += 1;
        continue;
      }
      if (row.kind === "selection") {
        const existing = selection(row.projectId);
        if (existing && compareVersion({ updatedAt: row.updatedAt, deviceId: row.deviceId }, { updatedAt: existing.updated_at, deviceId: existing.device_id }) <= 0) continue;
        db.prepare(
          `insert into workspace_environment_selection (project_id, environment_id, updated_at, device_id)
           values (?, ?, ?, ?)
           on conflict(project_id) do update set environment_id = excluded.environment_id,
             updated_at = excluded.updated_at, device_id = excluded.device_id`,
        ).run(row.projectId, row.environmentId, row.updatedAt, row.deviceId);
        changed += 1;
        continue;
      }
      const existing = db.prepare(
        "select * from workspace_environment_values where environment_id = ? and name = ?",
      ).get(row.environmentId, row.name!) as ValueRow | undefined;
      if (existing && compareVersion({ updatedAt: row.updatedAt, deviceId: row.deviceId }, { updatedAt: existing.updated_at, deviceId: existing.device_id }) <= 0) continue;
      const sealed = row.deleted ? { ciphertext: null, iv: null, tag: null } : encrypt(row.value ?? "");
      db.prepare(
        `insert into workspace_environment_values
           (environment_id, name, ciphertext, iv, tag, updated_at, device_id, deleted)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(environment_id, name) do update set ciphertext = excluded.ciphertext,
           iv = excluded.iv, tag = excluded.tag, updated_at = excluded.updated_at,
           device_id = excluded.device_id, deleted = excluded.deleted`,
      ).run(row.environmentId, row.name!, sealed.ciphertext, sealed.iv, sealed.tag, row.updatedAt, row.deviceId, row.deleted ? 1 : 0);
      cleartextCache.delete(row.environmentId);
      changed += 1;
    }
  });
  return changed;
}

/// Supplies the assigned workspace values to a task on its execution computer.
export async function taskEnvironment(cwd: string, chatId?: string): Promise<Record<string,string>> {
  if (chatId) {
    const stored=getKv<ReturnType<typeof encrypt>>(`taskEnvironment:${chatId}`);
    if(stored) {
      const values=JSON.parse(decrypt(stored)) as Record<string,string>;
      cleartextCache.set(`task:${chatId}`,Object.values(values).filter(Boolean));
      return values;
    }
  }
  try { return (await environmentForCwd(cwd)).values; }
  catch (error) {
    if (error instanceof Error && ["this workspace has no active environment", "this thread is not in a registered workspace"].includes(error.message)) return {};
    throw error;
  }
}

export function sharedEnvironmentAssignments() {
  return db.prepare("select project_id as projectId, environment_id as environmentId from workspace_environment_selection where project_id != '*'").all();
}

/// Accepts only the environment delivered by an authenticated hub for this thread.
export function setTaskEnvironment(chatId:string,input:unknown) {
  const profile=input as {values?:unknown} | null;
  const values=profile?.values ?? {};
  if(!values || typeof values!=="object" || Array.isArray(values))throw Error("Your environment is invalid.");
  const entries=Object.entries(values);
  if(entries.length>200 || JSON.stringify(values).length>64000 || entries.some(([name,value])=>!validTaskVariable(name) || typeof value!=="string"))throw Error("Your environment is invalid.");
  setKv(`taskEnvironment:${chatId}`,encrypt(JSON.stringify(values)));
  cleartextCache.set(`task:${chatId}`,[...new Set([...(cleartextCache.get(`task:${chatId}`)??[]),...entries.map(([,value])=>String(value)).filter(Boolean))]);
}
function validTaskVariable(name:string) {
  return /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) && !/^(?:__proto__$|constructor$|prototype$|MC_|REMY_|NODE_OPTIONS$|CODEX_HOME$|CLAUDE_CONFIG_DIR$)/.test(name);
}

export async function applyHubEnvironments(org:string,input:unknown) {
  const rows=(input as {workspaces?:{localId:string;profile:{id:string;name:string;values:Record<string,string>;updatedAt:number}|null}[]})?.workspaces;
  if(!Array.isArray(rows))throw Error("Your workspace environments could not sync.");
  const {syncProjectBindings}=await import("./projects.js");await syncProjectBindings();
  const previous=getKv<string[]>(`hubEnvironmentProjects:${org}`)??[];
  const current:string[]=[];
  const records:EnvironmentSyncRecord[]=[];
  for(const entry of rows) {
    const project=projectForWorkspace(entry.localId);if(!project)continue;
    current.push(project.id);
    const id=entry.profile?`hub:${org}:${entry.profile.id}`:"";
    const at=nextTimestamp();
    if(entry.profile) {
      records.push({kind:"environment",projectId:"*",environmentId:id,name:entry.profile.name,updatedAt:at,deviceId:`hub:${org}`});
      const oldNames=valueRows(id).map(v=>v.name);
      for(const [name,value] of Object.entries(entry.profile.values)) {
        if(!validTaskVariable(name)||typeof value!=="string")throw Error("Your environment contains an invalid value.");
        records.push({kind:"value",projectId:"*",environmentId:id,name,value,updatedAt:at,deviceId:`hub:${org}`});
      }
      for(const name of oldNames)if(!(name in entry.profile.values))records.push({kind:"value",projectId:"*",environmentId:id,name,deleted:true,updatedAt:at,deviceId:`hub:${org}`});
    }
    const selected=selection(project.id)?.environment_id;
    if(id || selected?.startsWith(`hub:${org}:`))records.push({kind:"selection",projectId:project.id,environmentId:id,updatedAt:at,deviceId:`hub:${org}`});
  }
  for(const projectId of previous)if(!current.includes(projectId)&&selection(projectId)?.environment_id.startsWith(`hub:${org}:`))records.push({kind:"selection",projectId,environmentId:"",updatedAt:nextTimestamp(),deviceId:`hub:${org}`});
  const retained=new Set(rows.flatMap(entry=>entry.profile?[`hub:${org}:${entry.profile.id}`]:[]));
  for(const row of environmentRows("*"))if(row.id.startsWith(`hub:${org}:`)&&!retained.has(row.id))records.push({kind:"environment",projectId:"*",environmentId:row.id,name:row.name,deleted:true,updatedAt:nextTimestamp(),deviceId:`hub:${org}`});
  mergeEnvironmentSync(records);
  setKv(`hubEnvironmentProjects:${org}`,current);
  const {broadcast}=await import("./notify.js");broadcast({type:"environments"});
}
