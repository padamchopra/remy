import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const stateDir = mkdtempSync(join(tmpdir(), "remy-environments-test-"));
process.env.MC_CONFIG_DIR = stateDir;

const { db } = await import("./db.js");
const env = await import("./environments.js");

const workspacePath = join(stateDir, "repo");
mkdirSync(workspacePath);

test("a thread keeps the values the hub delivered for it, sealed, and nothing else", async () => {
  assert.deepEqual(await env.taskEnvironment("thread-one"), {});
  env.setTaskEnvironment("thread-one", { values: { SERVICE_TOKEN: "task-test-secret", LOG_LEVEL: "debug" }, secrets: ["SERVICE_TOKEN"] });
  assert.equal((await env.taskEnvironment("thread-one")).SERVICE_TOKEN, "task-test-secret");
  assert.deepEqual(await env.taskEnvironment("thread-two"), {});
  assert.ok(!JSON.stringify(db.prepare("select value from kv where key=?").get("taskEnvironment:thread-one")).includes("task-test-secret"));
  assert.equal(env.redactForThread("thread-one", "token task-test-secret"), "token [REDACTED]");
  // A variable is ordinary text; only secrets are scrubbed.
  assert.equal(env.redactForThread("thread-one", "level debug"), "level debug");
  assert.equal(env.redactKnownSecrets("level debug, token task-test-secret"), "level debug, token [REDACTED]");
  // A later turn replaces the whole environment, so a removed value is gone.
  env.setTaskEnvironment("thread-one", { values: { LOG_LEVEL: "info" } });
  assert.deepEqual(await env.taskEnvironment("thread-one"), { LOG_LEVEL: "info" });
  assert.throws(() => env.setTaskEnvironment("thread-one", { values: { REMY_HOSTED_TASK: "1" } }), /invalid/);
  assert.throws(() => env.setTaskEnvironment("thread-one", { values: { OK: 1 } }), /invalid/);
  // A hub that names no secrets has every value treated as one.
  env.setTaskEnvironment("thread-legacy", { values: { OLD_VALUE: "legacy-test-value" } });
  assert.equal(env.redactForThread("thread-legacy", "legacy-test-value"), "[REDACTED]");
});

test("the local named environments are gone", () => {
  const tables = (db.prepare("select name from sqlite_master where type='table'").all() as { name: string }[]).map((row) => row.name);
  assert.ok(!tables.some((name) => name.startsWith("workspace_environment")));
});

test("a runtime command sees the thread's values, and they are scrubbed from what it returns", async () => {
  await assert.rejects(env.runWithEnvironment(workspacePath, "thread-empty", { program: process.execPath, args: ["-e", ""] }), /no environment values/);
  env.setTaskEnvironment("thread-run", { values: { FROM_HUB: "exact-secret-value" } });
  const result = await env.runWithEnvironment(workspacePath, "thread-run", {
    program: process.execPath,
    args: ["-e", "console.log(process.env.FROM_HUB)"],
  });
  assert.equal(result.output.trim(), "[REDACTED]");
  assert.equal(result.exitCode, 0);
});

test("runtime environments cannot publish version-control history", async () => {
  env.setTaskEnvironment("thread-git", { values: { FROM_HUB: "exact-secret-value" } });
  execFileSync("git", ["init"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Remy Test"], { cwd: workspacePath });
  execFileSync("git", ["config", "user.email", "remy@example.com"], { cwd: workspacePath });
  writeFileSync(join(workspacePath, "README.md"), "baseline\n");
  execFileSync("git", ["add", "README.md"], { cwd: workspacePath });
  execFileSync("git", ["commit", "-m", "Baseline"], { cwd: workspacePath, stdio: "ignore" });
  await assert.rejects(
    env.runWithEnvironment(workspacePath, "thread-git", { program: "git", args: ["commit", "-m", "unsafe"] }),
    /without the workspace environment/,
  );

  const wrote = await env.runWithEnvironment(workspacePath, "thread-git", {
    program: process.execPath,
    args: ["-e", "require('fs').writeFileSync('leak.txt', process.env.FROM_HUB)"],
  });
  assert.match(wrote.output, /removed configured values/);
  assert.equal(readFileSync(join(workspacePath, "leak.txt"), "utf8"), "[REDACTED]");

  const before = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspacePath, encoding: "utf8" }).trim();
  const committed = await env.runWithEnvironment(workspacePath, "thread-git", {
    program: process.execPath,
    args: [
      "-e",
      "const {execFileSync}=require('child_process');require('fs').writeFileSync('commit.txt',process.env.FROM_HUB);execFileSync('git',['add','commit.txt']);execFileSync('git',['commit','-m','Indirect']);",
    ],
  });
  assert.equal(committed.exitCode, 1);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspacePath, encoding: "utf8" }).trim(), before);
  assert.equal(execFileSync("git", ["show", ":commit.txt"], { cwd: workspacePath, encoding: "utf8" }), "[REDACTED]");
});
