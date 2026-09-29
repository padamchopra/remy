import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { deviceId } from "./board-log.js";
import { db, getKv, setKv } from "./db.js";
import { run } from "./run.js";

// A thread's environment arrives from the hub with each turn: the starter's
// Personal values under the workspace's own. It is sealed with this machine's
// key under the thread's id, and nothing else on the computer holds values.
const KEYCHAIN_SERVICE = "me.padamchopra.Remy.workspace-environments";
const OUTPUT_LIMIT = 100_000;
const THREAD_VALUE_LIMIT = 400;
const THREAD_SIZE_LIMIT = 262_144;

export interface RuntimeCommandInput {
  program: string;
  args?: string[];
  timeoutSeconds?: number;
}

export interface RuntimeCommandResult {
  command: string;
  output: string;
  exitCode: number;
}

let cachedKey: Buffer | undefined;
const cleartextCache = new Map<string, string[]>();

function keychainText(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr ?? "";
  const message = error instanceof Error ? error.message : "";
  return `${stderr}\n${message}`;
}

/// `security` writes "The specified item could not be found in the keychain."
/// on stderr. The command's own message never says that, so a caller that
/// drops stderr cannot tell a first save from a keychain that refused the read.
export function isMissingKeychainItem(error: unknown): boolean {
  return /could not be found|item.*not found/i.test(keychainText(error));
}

/// `-A` lets `security` read the item later without a prompt. A background
/// Remy cannot approve one, which is what stopped a new computer. `-U`
/// replaces an unreadable item only when nothing has been sealed with it yet.
export function keychainSaveArgs(account: string, encoded: string): string[] {
  return ["add-generic-password", "-U", "-A", "-a", account, "-s", KEYCHAIN_SERVICE, "-w", encoded];
}

function encodedKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return Buffer.from(value, "base64").length === 32 ? value : undefined;
}

export type EnvironmentKeyPlan =
  | { action: "use"; encoded: string }
  | { action: "create"; encoded: string }
  | { action: "refuse"; reason: "missing" | "locked" };

/// A new computer has nothing sealed, so any failed keychain read is the first
/// save. Refusing that read is what stopped every thread. A computer that
/// already sealed values keeps its key: a new one could not open them.
export function planEnvironmentKey(input: {
  encoded?: string;
  error?: unknown;
  sealed: boolean;
  stored?: string;
}): EnvironmentKeyPlan {
  const read = input.error ? undefined : encodedKey(input.encoded);
  if (read) return { action: "use", encoded: read };
  if (input.sealed) {
    return { action: "refuse", reason: input.error && isMissingKeychainItem(input.error) ? "missing" : "locked" };
  }
  return { action: "create", encoded: encodedKey(input.stored) ?? randomBytes(32).toString("base64") };
}

export function environmentKeyRefusal(reason: "missing" | "locked"): string {
  return reason === "missing"
    ? "The environment key is missing from this computer's keychain."
    : "This computer can't open its keychain. Unlock it and try again.";
}

function sealedEnvironmentValues(): boolean {
  const kv = db.prepare(
    "select 1 as present from kv where (key like 'taskEnvironment:%' or key = 'hubModelKeys' or key like 'hubLinear:%') and value like '%\"ciphertext\"%' limit 1",
  ).get() as { present?: number } | undefined;
  if (kv?.present) return true;
  try {
    const linear = db.prepare("select 1 as present from linear_accounts limit 1").get() as { present?: number } | undefined;
    return Boolean(linear?.present);
  } catch {
    return false;
  }
}

function readKeychain(): string {
  return execFileSync("/usr/bin/security", [
    "find-generic-password", "-a", deviceId, "-s", KEYCHAIN_SERVICE, "-w",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function rememberKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error(environmentKeyRefusal("locked"));
  cachedKey = key;
  return key;
}

function machineKey(): Buffer {
  if (cachedKey) return cachedKey;
  const stored = encodedKey(getKv<string>("workspaceEnvironmentKey"));
  if (process.platform !== "darwin" || process.env.MC_CONFIG_DIR) {
    const encoded = stored ?? randomBytes(32).toString("base64");
    if (!stored) setKv("workspaceEnvironmentKey", encoded);
    return rememberKey(encoded);
  }
  let plan: EnvironmentKeyPlan;
  try {
    const encoded = readKeychain();
    plan = encodedKey(encoded)
      ? { action: "use", encoded }
      : planEnvironmentKey({ encoded, sealed: sealedEnvironmentValues(), stored });
  } catch (error) {
    plan = planEnvironmentKey({ error, sealed: sealedEnvironmentValues(), stored });
  }
  if (plan.action === "refuse") throw new Error(environmentKeyRefusal(plan.reason));
  if (plan.action === "create") {
    try {
      execFileSync("/usr/bin/security", keychainSaveArgs(deviceId, plan.encoded), { stdio: ["ignore", "pipe", "pipe"] });
      if (stored) setKv("workspaceEnvironmentKey", null);
    } catch {
      // The keychain would not take a write without a prompt. Keep the same
      // key in the database so this computer can still seal values, and try
      // the keychain again on the next start.
      setKv("workspaceEnvironmentKey", plan.encoded);
    }
  } else if (stored) setKv("workspaceEnvironmentKey", null);
  return rememberKey(plan.encoded);
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

/// Seals a value with this machine's environment key, so a credential Remy is
/// handed rests the same way a workspace value does.
export function sealSecret(value: string): { ciphertext: string; iv: string; tag: string } {
  return encrypt(value);
}

export function openSecret(sealed: { ciphertext: string; iv: string; tag: string }): string {
  return decrypt(sealed);
}

/// Keeps values out of anything Remy writes down, alongside a thread's values.
export function rememberSecrets(scope: string, values: Iterable<string>): void {
  cleartextCache.set(scope, [...new Set([...values].filter(Boolean))]);
}

function decrypt(row: { ciphertext: string | null; iv: string | null; tag: string | null }): string {
  if (!row.ciphertext || !row.iv || !row.tag) return "";
  const decipher = createDecipheriv("aes-256-gcm", machineKey(), Buffer.from(row.iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
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

type ThreadEnvironment = { values: Record<string, string>; secrets: string[] };
const ephemeralTaskAccess = process.env.MC_EPHEMERAL_TASK_ACCESS === "1";
const taskAccess = new Map<string,ThreadEnvironment>();

/// The values the hub last delivered for this thread, and which of them are
/// secrets; none when it has none.
function threadEnvironment(chatId: string): ThreadEnvironment {
  if (ephemeralTaskAccess) return taskAccess.get(chatId) ?? {values:{},secrets:[]};
  const stored = getKv<ReturnType<typeof encrypt>>(`taskEnvironment:${chatId}`);
  if (!stored) return { values: {}, secrets: [] };
  const parsed = JSON.parse(decrypt(stored)) as ThreadEnvironment | Record<string, string>;
  // An older daemon kept the values alone; they were all scrubbed then too.
  const opened = Array.isArray(parsed.secrets) ? parsed as ThreadEnvironment : { values: parsed as Record<string, string>, secrets: Object.keys(parsed) };
  remember(chatId, opened);
  return opened;
}

/// Only secrets are scrubbed: a variable is ordinary text, and hiding it would
/// blank out every "debug" or "true" a thread writes.
function secretValues(environment: ThreadEnvironment): string[] {
  return environment.secrets.flatMap((key) => environment.values[key] ? [environment.values[key]] : []);
}
function remember(chatId: string, environment: ThreadEnvironment) {
  cleartextCache.set(`task:${chatId}`, [...new Set([...(cleartextCache.get(`task:${chatId}`) ?? []), ...secretValues(environment)])]);
}

/// Scrubs a user-supplied string against this thread's secrets before it can
/// be sent to the provider.
export function redactForThread(chatId: string, text: string): string {
  return redactExact(text, [...secretValues(threadEnvironment(chatId)), ...[...cleartextCache.values()].flat()]);
}

/// Runs one executable with the thread's environment. The provider receives
/// only this redacted result.
export async function runWithEnvironment(cwd: string, chatId: string, input: RuntimeCommandInput): Promise<RuntimeCommandResult> {
  const program = typeof input.program === "string" ? input.program.trim() : "";
  if (!program || program.length > 500) throw new Error("a runtime command needs a program");
  const args = Array.isArray(input.args) ? input.args.map(String) : [];
  if (args.length > 200 || args.some((arg) => arg.length > 20_000)) throw new Error("that runtime command is too large");
  assertRuntimeCommand(program, args);
  const environment = threadEnvironment(chatId);
  const active = environment.values;
  if (!Object.keys(active).length) throw new Error("this thread has no environment values");
  const timeout = Math.min(Math.max(Number(input.timeoutSeconds) || 30, 1), 300) * 1000;
  const values = secretValues(environment);
  const guard = runtimeGitGuard(values);
  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    try {
      const result = await run(program, args, {
        cwd,
        env: { ...runtimeBaseEnvironment(), ...active, ...guard.env },
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
  };
}

/// What a thread's provider process inherits: this computer's provider keys,
/// then the values the hub delivered for the thread.
export async function taskEnvironment(chatId?: string): Promise<Record<string,string>> {
  const { hubModelKeys } = await import("./hub-model-keys.js");
  return { ...hubModelKeys(), ...(chatId ? threadEnvironment(chatId).values : {}) };
}

/// Accepts only the environment delivered by an authenticated hub for this thread.
/// A hub that names no secrets predates the distinction, so every value it
/// sends is treated as one.
export function setTaskEnvironment(chatId:string,input:unknown) {
  const profile=input as {values?:unknown;secrets?:unknown} | null;
  const values=profile?.values ?? {};
  if(!values || typeof values!=="object" || Array.isArray(values))throw Error("Your environment is invalid.");
  const entries=Object.entries(values);
  if(entries.length>THREAD_VALUE_LIMIT || JSON.stringify(values).length>THREAD_SIZE_LIMIT || entries.some(([name,value])=>!validTaskVariable(name) || typeof value!=="string"))throw Error("Your environment is invalid.");
  const secrets=Array.isArray(profile?.secrets) ? profile.secrets.filter((key):key is string=>typeof key==="string" && key in values) : Object.keys(values);
  const environment={values:values as Record<string,string>,secrets};
  if (ephemeralTaskAccess) taskAccess.set(chatId,environment);
  else setKv(`taskEnvironment:${chatId}`,encrypt(JSON.stringify(environment)));
  remember(chatId,environment);
}
function validTaskVariable(name:string) {
  return /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) && !/^(?:__proto__$|constructor$|prototype$|MC_|REMY_|NODE_OPTIONS$|CODEX_HOME$|CLAUDE_CONFIG_DIR$)/.test(name);
}
