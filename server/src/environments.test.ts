import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const stateDir = mkdtempSync(join(tmpdir(), "remy-environments-test-"));
process.env.MC_CONFIG_DIR = stateDir;

const { db } = await import("./db.js");
const { bindWorkspace, createProject } = await import("./projects.js");
const {
  createEnvironment,
  deleteEnvironmentValue,
  exportEnvironmentSync,
  importEnvironmentFile,
  listEnvironmentFiles,
  listEnvironments,
  mergeEnvironmentSync,
  parseEnvironmentValues,
  redactForCwd,
  runWithEnvironment,
  setEnvironmentValues,
} = await import("./environments.js");

const workspacePath = join(stateDir, "repo");
mkdirSync(workspacePath);
const project = createProject({ name: "Secrets" });
db.prepare(
  "insert into workspaces (id, name, path, icon, tint, provider, model) values (?, ?, ?, null, null, null, null)",
).run("workspace-one", "Secrets", workspacePath);
bindWorkspace(project.id, "workspace-one");

test("environment views and SQLite never expose cleartext values", () => {
  const environment = createEnvironment(project.id, "Development");
  const saved = setEnvironmentValues(project.id, environment.id, {
    API_KEY: "exact-secret-value",
    PORT: "4040",
  });

  assert.deepEqual(saved.variables.map((entry) => entry.name), ["API_KEY", "PORT"]);
  assert.equal(JSON.stringify(listEnvironments(project.id)).includes("exact-secret-value"), false);
  const row = db.prepare(
    "select ciphertext, iv, tag from workspace_environment_values where environment_id = ? and name = 'API_KEY'",
  ).get(environment.id) as { ciphertext: string; iv: string; tag: string };
  assert.ok(row.ciphertext);
  assert.ok(row.iv);
  assert.ok(row.tag);
  assert.equal(JSON.stringify(row).includes("exact-secret-value"), false);
});

test("dotenv and comma-separated values import without returning values", async () => {
  assert.deepEqual(parseEnvironmentValues("ONE=first, TWO='second, THREE=inside'\nexport THREE=third # note"), {
    ONE: "first",
    TWO: "second, THREE=inside",
    THREE: "third",
  });
  writeFileSync(join(workspacePath, ".env.local"), "FROM_FILE=inside-file\n");
  assert.deepEqual(await listEnvironmentFiles(project.id), [".env.local"]);
  const environment = listEnvironments(project.id)[0];
  await importEnvironmentFile(project.id, environment.id, ".env.local");
  assert.ok(listEnvironments(project.id)[0].variables.some((entry) => entry.name === "FROM_FILE"));
  writeFileSync(join(workspacePath, ".env.remove"), "REMOVED_FILE=gone\n");
  await importEnvironmentFile(project.id, environment.id, ".env.remove", true);
  assert.equal(existsSync(join(workspacePath, ".env.remove")), false);
});

test("runtime commands receive values but their output and prompts are redacted", async () => {
  const result = await runWithEnvironment(workspacePath, {
    program: process.execPath,
    args: ["-e", "process.stdout.write(`${process.env.API_KEY} safe`)"],
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.output, "[REDACTED] safe");
  assert.equal(await redactForCwd(workspacePath, "token exact-secret-value"), "token [REDACTED]");
  const { redactEntry } = await import("./chat.js");
  const entry = redactEntry({
    id: "activity:tool", kind: "tool",
    activity: { id: "tool", kind: "shell", provider: "claude", title: "exact-secret-value", command: "echo exact-secret-value", progress: "exact-secret-value", output: "exact-secret-value", model: "exact-secret-value", status: "running", startedAt: 1, updatedAt: 2 },
  });
  assert.ok(!JSON.stringify(entry).includes("exact-secret-value"));
  assert.equal(entry.activity?.output, "[REDACTED]");
});

test("sync records converge while the receiving database remains encrypted", () => {
  const environment = listEnvironments(project.id)[0];
  const outgoing = exportEnvironmentSync();
  const value = outgoing.find((row) => row.kind === "value" && row.name === "API_KEY");
  assert.equal(value?.value, "exact-secret-value");
  assert.equal(mergeEnvironmentSync(outgoing), 0);

  deleteEnvironmentValue(project.id, environment.id, "API_KEY");
  assert.equal(listEnvironments(project.id)[0].variables.some((entry) => entry.name === "API_KEY"), false);
});

test("runtime environments cannot publish version-control history", async () => {
  execFileSync("git", ["init"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Remy Test"], { cwd: workspacePath });
  execFileSync("git", ["config", "user.email", "remy@example.com"], { cwd: workspacePath });
  writeFileSync(join(workspacePath, "README.md"), "baseline\n");
  execFileSync("git", ["add", "README.md"], { cwd: workspacePath });
  execFileSync("git", ["commit", "-m", "Baseline"], { cwd: workspacePath, stdio: "ignore" });
  await assert.rejects(
    runWithEnvironment(workspacePath, { program: "git", args: ["commit", "-m", "unsafe"] }),
    /without the workspace environment/,
  );

  const wrote = await runWithEnvironment(workspacePath, {
    program: process.execPath,
    args: ["-e", "require('fs').writeFileSync('leak.txt', process.env.FROM_FILE)"],
  });
  assert.match(wrote.output, /removed configured values/);
  assert.equal(readFileSync(join(workspacePath, "leak.txt"), "utf8"), "[REDACTED]");

  const before = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspacePath, encoding: "utf8" }).trim();
  const committed = await runWithEnvironment(workspacePath, {
    program: process.execPath,
    args: [
      "-e",
      "const {execFileSync}=require('child_process');require('fs').writeFileSync('commit.txt',process.env.FROM_FILE);execFileSync('git',['add','commit.txt']);execFileSync('git',['commit','-m','Indirect']);",
    ],
  });
  assert.equal(committed.exitCode, 1);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspacePath, encoding: "utf8" }).trim(), before);
  assert.equal(execFileSync("git", ["show", ":commit.txt"], { cwd: workspacePath, encoding: "utf8" }), "[REDACTED]");
});
