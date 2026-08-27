import { homedir } from "node:os";
import { run as exec } from "./run.js";

/// What the command-line tools Remy leans on report about themselves, so
/// Settings can say "gh is not signed in" instead of leaving someone to work it
/// out from a failed pull request.

export interface ToolStatus {
  available: boolean;
  version?: string;
  /// The newest published CLI version, when its package registry answered.
  latestVersion?: string;
  updateAvailable?: boolean;
  /// Installed is not the same as signed in.
  authenticated?: boolean;
  account?: string;
  /// The billing or subscription source the provider itself reports.
  plan?: string;
  organization?: string;
  /// Why the tool could not be used, when it could not.
  error?: string;
}

export interface Tooling {
  git: ToolStatus;
  gh: ToolStatus;
  claude: ToolStatus;
  codex: ToolStatus;
  cursor: ToolStatus;
}

const PROVIDER_PACKAGES = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
} as const;
const LATEST_VERSION_TTL_MS = 60 * 60_000;
const LATEST_VERSION_TIMEOUT_MS = 4_000;
const latestVersions = new Map<string, { expiresAt: number; version?: string }>();
const latestVersionRequests = new Map<string, Promise<string | undefined>>();

/// Version output is one line of prose (`git version 2.39.5`, `gh version 2.62.0
/// (2024-11-14)`), so keep the first version-looking number and drop the rest.
function versionFrom(output: string): string | undefined {
  const line = output.split("\n").find((entry) => entry.trim()) ?? "";
  return /\d+\.\d+[^\s]*/.exec(line)?.[0] ?? (line.trim() || undefined);
}

function versionParts(version: string): number[] | undefined {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version.trim());
  if (!match) return undefined;
  return match.slice(1).map((part) => Number.parseInt(part ?? "0", 10));
}

export function isNewerToolVersion(latest: string, current: string): boolean {
  const left = versionParts(latest);
  const right = versionParts(current);
  if (!left || !right) return false;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta > 0;
  }
  return false;
}

async function latestPackageVersion(packageName: string): Promise<string | undefined> {
  const cached = latestVersions.get(packageName);
  if (cached && cached.expiresAt > Date.now()) return cached.version;

  const pending = latestVersionRequests.get(packageName);
  if (pending) return pending;

  const request = (async () => {
    let version: string | undefined;
    try {
      const response = await fetch(
        `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
        {
          headers: { Accept: "application/json", "User-Agent": "Remy" },
          signal: AbortSignal.timeout(LATEST_VERSION_TIMEOUT_MS),
        },
      );
      if (response.ok) {
        const body = await response.json() as { version?: unknown };
        const candidate = typeof body.version === "string" ? body.version.trim() : "";
        if (candidate && candidate.length <= 80) version = candidate;
      }
    } catch {
      // Provider availability is still useful when the update feed is offline.
    }
    latestVersions.set(packageName, { expiresAt: Date.now() + LATEST_VERSION_TTL_MS, version });
    return version;
  })().finally(() => latestVersionRequests.delete(packageName));

  latestVersionRequests.set(packageName, request);
  return request;
}

async function withLatestVersion(status: ToolStatus, packageName: string): Promise<ToolStatus> {
  if (!status.available || !status.version) return status;
  const latestVersion = await latestPackageVersion(packageName);
  if (!latestVersion) return status;
  return {
    ...status,
    latestVersion,
    updateAvailable: isNewerToolVersion(latestVersion, status.version),
  };
}

async function probe(file: string, args: string[]): Promise<ToolStatus> {
  try {
    const { stdout } = await exec(file, args, { cwd: homedir(), timeout: 5_000 });
    return { available: true, version: versionFrom(stdout) };
  } catch (error) {
    // A missing binary and a binary that failed to run are the same thing to
    // the person reading this: the feature that needs it will not work.
    const detail = (error as { code?: unknown })?.code === "ENOENT"
      ? "Not installed"
      : ((error as Error)?.message ?? "Could not run it").split("\n")[0];
    return { available: false, error: detail };
  }
}

/// `gh auth status` exits non-zero when signed out, and writes its report to
/// stderr on older builds, so both streams are read and the exit code is only a
/// hint.
async function ghStatus(): Promise<ToolStatus> {
  const base = await probe("gh", ["--version"]);
  if (!base.available) return base;
  try {
    const { stdout, stderr } = await exec("gh", ["auth", "status"], { cwd: homedir(), timeout: 8_000 });
    return { ...base, ...readGhAuth(`${stdout}\n${stderr}`) };
  } catch (error) {
    const output = String((error as { stdout?: unknown })?.stdout ?? "")
      + String((error as { stderr?: unknown })?.stderr ?? "");
    return { ...base, ...readGhAuth(output) };
  }
}

/// `gh` has phrased this both ways across versions — "account <name>" and the
/// older "as <name>" — so both connectives are consumed rather than being read
/// as the account itself.
export function readGhAuth(output: string): { authenticated: boolean; account?: string } {
  const account = /Logged in to \S+ (?:account |as )?([A-Za-z0-9-]+)/.exec(output)?.[1];
  if (account) return { authenticated: true, account };
  return { authenticated: /Logged in to/.test(output) };
}

function planLabel(value: unknown): string | undefined {
  const plan = typeof value === "string" ? value.trim() : "";
  if (!plan || plan.length > 80) return undefined;
  return `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan`;
}

function jsonObject(output: string): Record<string, unknown> | undefined {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(output.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/// Claude distinguishes a claude.ai subscription from API billing, which is
/// the difference someone needs to see before an unexpected bill lands.
export function readClaudeAuth(output: string): Partial<ToolStatus> {
  const parsed = jsonObject(output);
  if (!parsed) return {};
  if (parsed.loggedIn !== true) return { authenticated: false };
  const subscription = planLabel(parsed.subscriptionType);
  const authMethod = typeof parsed.authMethod === "string" ? parsed.authMethod : "";
  const apiKeySource = typeof parsed.apiKeySource === "string" && parsed.apiKeySource.trim();
  const organization = typeof parsed.orgName === "string" && parsed.orgName.trim()
    ? parsed.orgName.trim().slice(0, 120)
    : undefined;
  return {
    authenticated: true,
    ...(apiKeySource || (authMethod && authMethod !== "claude.ai")
      ? { plan: "API billing" }
      : subscription ? { plan: subscription } : {}),
    ...(organization ? { organization } : {}),
  };
}

/// Codex currently names the sign-in source but not the person's ChatGPT tier.
export function readCodexAuth(output: string): Partial<ToolStatus> {
  if (/Logged in using ChatGPT/i.test(output)) return { authenticated: true, plan: "ChatGPT sign-in" };
  if (/Logged in using (?:an )?API key|API key authentication/i.test(output)) {
    return { authenticated: true, plan: "API billing" };
  }
  if (/not logged in|logged out/i.test(output)) return { authenticated: false };
  return {};
}

/// Cursor's structured `about` response includes its exact subscription tier.
export function readCursorAbout(output: string): Partial<ToolStatus> {
  const parsed = jsonObject(output);
  if (!parsed) return {};
  const plan = planLabel(parsed.subscriptionTier);
  const authenticated = typeof parsed.userEmail === "string" || Boolean(plan);
  return {
    ...(authenticated ? { authenticated: true } : {}),
    ...(plan ? { plan } : {}),
  };
}

async function providerStatus(
  file: string,
  statusArgs: string[],
  read: (output: string) => Partial<ToolStatus>,
): Promise<ToolStatus> {
  const base = await probe(file, ["--version"]);
  if (!base.available) return base;
  try {
    const { stdout, stderr } = await exec(file, statusArgs, { cwd: homedir(), timeout: 10_000 });
    return { ...base, ...read(`${stdout}\n${stderr}`) };
  } catch (error) {
    const output = String((error as { stdout?: unknown })?.stdout ?? "")
      + String((error as { stderr?: unknown })?.stderr ?? "");
    return { ...base, ...read(output) };
  }
}

/// The GitHub account this machine is signed in as, which is what a branch
/// someone else reads should be prefixed with. Absent when `gh` is missing or
/// signed out, and the caller falls back to Remy's own name.
export async function githubLogin(): Promise<string | undefined> {
  try {
    const { stdout } = await exec("gh", ["api", "user", "--jq", ".login"], { cwd: homedir(), timeout: 8_000 });
    const login = stdout.trim();
    // A branch name has to survive `git check-ref-format`, and a login is the
    // one part of it Remy does not choose.
    return /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(login) ? login : undefined;
  } catch {
    return undefined;
  }
}

/// This account's picture on GitHub, as a `data:` URL.
///
/// Fetched here rather than in the page: the window never calls out, and this
/// way an avatar that came from GitHub is stored the same way as one someone
/// picked off their disk. `s=128` asks GitHub for a small one, so nothing has
/// to be resized afterwards.
export async function githubAvatar(): Promise<string> {
  const { stdout } = await exec("gh", ["api", "user", "--jq", ".avatar_url"], { cwd: homedir(), timeout: 8_000 });
  const url = stdout.trim();
  if (!/^https:\/\/[^\s]+$/.test(url)) throw new Error("GitHub did not give a picture");

  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}s=128`);
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const type = response.headers.get("content-type") ?? "image/png";
  if (!/^image\/(png|jpeg|webp|gif)/.test(type)) throw new Error("that is not an image");
  const body = Buffer.from(await response.arrayBuffer());
  return `data:${type.split(";")[0]};base64,${body.toString("base64")}`;
}

export async function tooling(options: { providerUpdates?: boolean } = {}): Promise<Tooling> {
  const [git, gh, claude, codex, cursor] = await Promise.all([
    probe("git", ["--version"]),
    ghStatus(),
    providerStatus("claude", ["auth", "status", "--json"], readClaudeAuth),
    providerStatus("codex", ["login", "status"], readCodexAuth),
    providerStatus("agent", ["about", "--format", "json"], readCursorAbout),
  ]);
  if (options.providerUpdates === false) return { git, gh, claude, codex, cursor };
  const [claudeWithUpdate, codexWithUpdate] = await Promise.all([
    withLatestVersion(claude, PROVIDER_PACKAGES.claude),
    withLatestVersion(codex, PROVIDER_PACKAGES.codex),
  ]);
  return { git, gh, claude: claudeWithUpdate, codex: codexWithUpdate, cursor };
}
