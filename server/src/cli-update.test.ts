import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CLI_PACKAGE_NAME,
  compareVersions,
  detectInstall,
  latestPublishedVersion,
  npmPrefixFromPackageRoot,
  parseUpdateArgs,
  runUpdate,
  type UpdateIo,
} from "./cli-update.js";

function io(overrides: Partial<UpdateIo> & Pick<UpdateIo, "packageRoot" | "currentVersion">): UpdateIo & { lines: string[]; runs: { file: string; args: string[] }[] } {
  const lines: string[] = [];
  const runs: { file: string; args: string[] }[] = [];
  return {
    fetch: async () => new Response(JSON.stringify({ version: "0.1.12" })),
    run: async (file, args) => {
      runs.push({ file, args });
      return { stdout: "", stderr: "" };
    },
    confirm: async () => false,
    write: (line) => { lines.push(line); },
    stdinIsTTY: false,
    ...overrides,
    lines,
    runs,
  };
}

test("parses remy update --yes and rejects extra arguments", () => {
  assert.deepEqual(parseUpdateArgs(["--yes"]), { yes: true });
  assert.deepEqual(parseUpdateArgs(["-y"]), { yes: true });
  assert.deepEqual(parseUpdateArgs([]), { yes: false });
  assert.throws(() => parseUpdateArgs(["--force"]), /does not take --force/);
});

test("orders stamped versions by run number", () => {
  assert.equal(compareVersions("0.1.5", "0.1.12"), -1);
  assert.equal(compareVersions("0.1.12", "0.1.12"), 0);
  assert.equal(compareVersions("0.2.1", "0.1.99"), 1);
  assert.equal(compareVersions("v0.1.8", "0.1.8"), 0);
});

test("detects an npm global install, a git checkout, and anything else", () => {
  const root = mkdtempSync(join(tmpdir(), "remy-update-kind-"));
  const npmRoot = join(root, "lib", "node_modules", "@padamchopra", "remy");
  mkdirSync(npmRoot, { recursive: true });
  assert.equal(detectInstall(npmRoot), "npm");

  const repo = join(root, "checkout");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, "server", "src"), { recursive: true });
  writeFileSync(join(repo, "server", "src", "cli.ts"), "");
  assert.equal(detectInstall(join(repo, "server")), "git");
  assert.equal(detectInstall(join(root, "somewhere")), "unknown");
});

test("derives the npm prefix from a global install path", () => {
  assert.equal(npmPrefixFromPackageRoot("/usr/local/lib/node_modules/@padamchopra/remy"), "/usr/local");
  assert.equal(
    npmPrefixFromPackageRoot(join("/home/ada/.nvm/versions/node/v22.18.0/lib/node_modules/@padamchopra/remy")),
    join("/home/ada/.nvm/versions/node/v22.18.0"),
  );
  assert.equal(npmPrefixFromPackageRoot("/opt/remy/server"), undefined);
});

test("reads the latest version from npm, then GitHub", async () => {
  const npm = await latestPublishedVersion({
    fetch: async (url) => {
      if (String(url).includes("registry.npmjs.org")) return new Response(JSON.stringify({ version: "0.1.9" }));
      return new Response("missing", { status: 404 });
    },
  });
  assert.equal(npm, "0.1.9");

  const github = await latestPublishedVersion({
    fetch: async (url) => {
      if (String(url).includes("registry.npmjs.org")) return new Response("missing", { status: 404 });
      return new Response(JSON.stringify({ tag_name: "v0.1.10" }));
    },
  });
  assert.equal(github, "0.1.10");
});

test("an npm install already on the latest version stays put", async () => {
  const root = join("/usr/local/lib/node_modules/@padamchopra/remy");
  const fixture = io({ packageRoot: root, currentVersion: "0.1.12" });
  await runUpdate(["--yes"], fixture);
  assert.deepEqual(fixture.lines, ["This computer already has Remy 0.1.12."]);
  assert.deepEqual(fixture.runs, []);
});

test("remy update --yes installs the latest npm package in place", async () => {
  const root = "/usr/local/lib/node_modules/@padamchopra/remy";
  const fixture = io({ packageRoot: root, currentVersion: "0.1.5" });
  await runUpdate(["--yes"], fixture);
  assert.deepEqual(fixture.runs, [{
    file: "npm",
    args: ["install", "--prefix", "/usr/local", "-g", `${CLI_PACKAGE_NAME}@0.1.12`],
  }]);
  assert.equal(fixture.lines.at(-1), "Remy 0.1.12 is installed. Start it again to use this version.");
});

test("without a TTY, remy update asks for --yes instead of installing", async () => {
  const root = "/usr/local/lib/node_modules/@padamchopra/remy";
  const fixture = io({ packageRoot: root, currentVersion: "0.1.5" });
  await assert.rejects(() => runUpdate([], fixture), /remy update --yes/);
  assert.deepEqual(fixture.runs, []);
  assert.equal(fixture.lines[0], "Remy 0.1.12 is ready. This computer has 0.1.5.");
});

test("a TTY that declines leaves the installed version", async () => {
  const root = "/usr/local/lib/node_modules/@padamchopra/remy";
  const fixture = io({
    packageRoot: root,
    currentVersion: "0.1.5",
    stdinIsTTY: true,
    confirm: async () => false,
  });
  await runUpdate([], fixture);
  assert.deepEqual(fixture.runs, []);
  assert.equal(fixture.lines.at(-1), "This computer stays on Remy 0.1.5.");
});

test("a git checkout pulls and rebuilds instead of publishing over itself", async () => {
  const repo = mkdtempSync(join(tmpdir(), "remy-update-git-"));
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, "server", "src"), { recursive: true });
  writeFileSync(join(repo, "server", "src", "cli.ts"), "");
  const fixture = io({ packageRoot: join(repo, "server"), currentVersion: "0.1.0" });
  await runUpdate(["--yes"], fixture);
  assert.deepEqual(fixture.runs.map((entry) => entry.file), ["git", "npm", "npm"]);
  assert.deepEqual(fixture.runs[0]?.args, ["-C", repo, "pull", "--ff-only"]);
  assert.deepEqual(fixture.runs[1]?.args, ["ci", "--no-fund", "--no-audit"]);
  assert.deepEqual(fixture.runs[2]?.args, ["run", "build"]);
  assert.equal(fixture.lines.at(-1), "Remy is updated. Start it again to use this version.");
});

test("an unknown install tells you to use npm", async () => {
  const fixture = io({ packageRoot: "/tmp/not-remy", currentVersion: "0.1.0" });
  await assert.rejects(() => runUpdate(["--yes"], fixture), new RegExp(`npm i -g ${CLI_PACKAGE_NAME}`));
  assert.deepEqual(fixture.runs, []);
});

test("remy --help lists update", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./cli.js", import.meta.url)), "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /remy update/);
  assert.match(result.stdout, /remy update --yes/);
});
