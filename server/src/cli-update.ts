import { spawn, type ExecFileOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

/// The published CLI name. The command people run stays `remy`.
export const CLI_PACKAGE_NAME = "@padamchopra/remy";
const NPM_LATEST = `https://registry.npmjs.org/${CLI_PACKAGE_NAME}/latest`;
const GITHUB_LATEST = "https://api.github.com/repos/padamchopra/remy/releases/latest";
const INSTALL_TIMEOUT_MS = 5 * 60_000;

export type InstallKind = "npm" | "git" | "unknown";

export type UpdateIo = {
  fetch: typeof fetch;
  run: (file: string, args: string[], options?: ExecFileOptions) => Promise<{ stdout: string; stderr: string }>;
  confirm: (question: string) => Promise<boolean>;
  write: (line: string) => void;
  stdinIsTTY: boolean;
  packageRoot: string;
  currentVersion: string;
};

export function parseUpdateArgs(argv: string[]): { yes: boolean } {
  const unknown = argv.filter((entry) => entry !== "--yes" && entry !== "-y" && entry !== "--");
  if (unknown.length) throw new Error(`Remy update does not take ${unknown[0]}.`);
  return { yes: argv.includes("--yes") || argv.includes("-y") };
}

export function compareVersions(a: string, b: string): number {
  const left = a.replace(/^v/, "").split(".").map((part) => Number(part));
  const right = b.replace(/^v/, "").split(".").map((part) => Number(part));
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const da = left[i] || 0;
    const db = right[i] || 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

export function detectInstall(packageRoot: string): InstallKind {
  const normalized = packageRoot.replaceAll("\\", "/");
  if (normalized.includes("/node_modules/@padamchopra/remy")) return "npm";
  if (existsSync(join(packageRoot, "src", "cli.ts")) && existsSync(join(packageRoot, "..", ".git"))) return "git";
  if (existsSync(join(packageRoot, ".git"))) return "git";
  return "unknown";
}

/// Prefix passed to `npm install -g` so a custom or nvm global install updates in place.
export function npmPrefixFromPackageRoot(packageRoot: string): string | undefined {
  const marker = `${sep}node_modules${sep}@padamchopra${sep}remy`;
  const index = packageRoot.lastIndexOf(marker);
  if (index < 0) return undefined;
  let prefix = packageRoot.slice(0, index);
  if (prefix.endsWith(`${sep}lib`)) prefix = prefix.slice(0, -`${sep}lib`.length);
  if (prefix.length === 0) return sep;
  return prefix;
}

export function defaultPackageRoot(): string {
  return dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
}

function defaultRun(file: string, args: string[], options: ExecFileOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { timeout: INSTALL_TIMEOUT_MS, stdio: "inherit", env: options.env, cwd: options.cwd });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve({ stdout: "", stderr: "" });
      else reject(new Error(`${file} ${signal ? `got ${signal}` : `exited ${code}`}`));
    });
  });
}

async function defaultConfirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function defaultIo(overrides: Partial<UpdateIo> = {}): UpdateIo {
  return {
    fetch,
    run: defaultRun,
    confirm: defaultConfirm,
    write: (line) => {
      process.stdout.write(`${line}\n`);
    },
    stdinIsTTY: Boolean(process.stdin.isTTY),
    packageRoot: defaultPackageRoot(),
    currentVersion: "",
    ...overrides,
  };
}

async function readJson(io: Pick<UpdateIo, "fetch">, url: string, headers: Record<string, string>): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await io.fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return undefined;
    const body = await response.json() as Record<string, unknown>;
    return body && typeof body === "object" ? body : undefined;
  } catch {
    return undefined;
  }
}

/// Latest CLI version to install. npm is the distribution channel; GitHub's
/// release tag is the fallback when the registry has not been reached yet.
export async function latestPublishedVersion(io: Pick<UpdateIo, "fetch">): Promise<string | undefined> {
  const npm = await readJson(io, NPM_LATEST, { accept: "application/json", "user-agent": "remy-cli" });
  if (typeof npm?.version === "string" && npm.version) return npm.version.replace(/^v/, "");
  const github = await readJson(io, GITHUB_LATEST, { accept: "application/vnd.github+json", "user-agent": "remy-cli" });
  if (typeof github?.tag_name === "string" && github.tag_name) return github.tag_name.replace(/^v/, "");
  return undefined;
}

async function approved(io: UpdateIo, yes: boolean, ready: string, current: string): Promise<boolean> {
  if (yes) return true;
  io.write(ready);
  if (!io.stdinIsTTY) throw new Error("Run remy update --yes to install it.");
  if (await io.confirm("Install it now? [y/N] ")) return true;
  io.write(`This computer stays on Remy ${current}.`);
  return false;
}

async function installFromNpm(io: UpdateIo, version: string): Promise<void> {
  const spec = `${CLI_PACKAGE_NAME}@${version}`;
  const args = ["install", "-g", spec];
  const prefix = npmPrefixFromPackageRoot(io.packageRoot);
  if (prefix) args.splice(1, 0, "--prefix", prefix);
  try {
    await io.run("npm", args, { timeout: INSTALL_TIMEOUT_MS, env: process.env, cwd: homedir() });
  } catch {
    throw new Error(`Couldn't install Remy ${version}. Check npm's output, then try again.`);
  }
}

async function installFromGit(io: UpdateIo): Promise<void> {
  const repoRoot = existsSync(join(io.packageRoot, "src", "cli.ts")) ? join(io.packageRoot, "..") : io.packageRoot;
  try {
    await io.run("git", ["-C", repoRoot, "pull", "--ff-only"], { timeout: INSTALL_TIMEOUT_MS });
    await io.run("npm", ["ci", "--no-fund", "--no-audit"], { cwd: join(repoRoot, "server"), timeout: INSTALL_TIMEOUT_MS });
    await io.run("npm", ["run", "build"], { cwd: join(repoRoot, "server"), timeout: INSTALL_TIMEOUT_MS });
  } catch {
    throw new Error("Couldn't update this checkout. Commit or stash your local changes, then try again.");
  }
}

/// Upgrade this CLI to the latest published version, or pull a git checkout.
export async function runUpdate(argv: string[], overrides: Partial<UpdateIo> = {}): Promise<void> {
  const io = defaultIo(overrides);
  const { yes } = parseUpdateArgs(argv);
  const kind = detectInstall(io.packageRoot);
  if (kind === "unknown") {
    throw new Error(`Install the latest CLI with npm i -g ${CLI_PACKAGE_NAME}.`);
  }
  if (kind === "git") {
    if (!(await approved(io, yes, "This computer runs Remy from a git checkout.", io.currentVersion || "this checkout"))) return;
    await installFromGit(io);
    io.write("Remy is updated. Start it again to use this version.");
    return;
  }

  const latest = await latestPublishedVersion(io);
  if (!latest) throw new Error(`Couldn't check for a newer Remy. Try again, or install with npm i -g ${CLI_PACKAGE_NAME}.`);
  if (compareVersions(io.currentVersion, latest) >= 0) {
    io.write(`This computer already has Remy ${io.currentVersion}.`);
    return;
  }
  if (!(await approved(io, yes, `Remy ${latest} is ready. This computer has ${io.currentVersion}.`, io.currentVersion))) return;
  await installFromNpm(io, latest);
  io.write(`Remy ${latest} is installed. Start it again to use this version.`);
}
