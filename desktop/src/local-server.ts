import { spawn, type ChildProcess, execFile as execFileCb } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);
const LAUNCH_AGENT_LABEL = "com.example.remy";

export interface LocalTarget {
  url: string;
  token: string;
}

function configDirs(): string[] {
  return [
    process.env.MC_CONFIG_DIR,
    join(homedir(), ".remy"),
    join(homedir(), ".mission-control"),
  ].filter((dir): dir is string => Boolean(dir));
}

function activeConfigDir(): string {
  return configDirs().find((dir) => existsSync(join(dir, "remy.db"))) ?? join(homedir(), ".remy");
}

export function readHomeConfig(): { port: number; token: string } | undefined {
  for (const dir of configDirs()) {
    const file = join(dir, "remy.db");
    if (!existsSync(file)) continue;
    try {
      const database = new DatabaseSync(file, { readOnly: true });
      const row = database.prepare("select value from kv where key = ?").get("config") as
        | { value?: string }
        | undefined;
      database.close();
      if (typeof row?.value !== "string") continue;
      const parsed = JSON.parse(row.value) as { port?: unknown; token?: unknown };
      if (typeof parsed.token !== "string" || !parsed.token) continue;
      return { port: Number(parsed.port) || 8420, token: parsed.token };
    } catch {
      // A missing or unreadable database is skipped so a later directory can still win.
    }
  }
  return undefined;
}

export function localTargetFromConfig(): LocalTarget {
  const config = readHomeConfig();
  return {
    url: `http://127.0.0.1:${config?.port ?? 8420}`,
    token: process.env.MC_TOKEN ?? config?.token ?? "",
  };
}

export function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

async function reachable(target: LocalTarget): Promise<boolean> {
  const token = target.token || readHomeConfig()?.token || "";
  try {
    const response = await fetch(new URL("/health", target.url), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return response.ok;
  } catch {
    return false;
  }
}

let spawned: ChildProcess | undefined;

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function launchAgentDocument(serverDir: string, entry: string): string {
  const homeDir = homedir();
  const stateDir = activeConfigDir();
  const path = [
    join(homeDir, ".local/bin"),
    join(homeDir, ".npm-global/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].join(":");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(entry)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(serverDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ELECTRON_RUN_AS_NODE</key>
    <string>1</string>
    <key>PATH</key>
    <string>${xml(path)}</string>
    <key>LANG</key>
    <string>${xml(process.env.LANG || process.env.LC_ALL || "en_US.UTF-8")}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(join(stateDir, "server.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(stateDir, "server.log"))}</string>
</dict>
</plist>
`;
}

async function installLaunchAgent(serverDir: string, entry: string): Promise<boolean> {
  const uid = process.getuid?.();
  if (uid === undefined) return false;
  const stateDir = activeConfigDir();
  const agentsDir = join(homedir(), "Library", "LaunchAgents");
  const plistPath = join(agentsDir, `${LAUNCH_AGENT_LABEL}.plist`);
  const service = `gui/${uid}/${LAUNCH_AGENT_LABEL}`;
  const document = launchAgentDocument(serverDir, entry);
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(agentsDir, { recursive: true });
  if (!existsSync(plistPath) || readFileSync(plistPath, "utf8") !== document) {
    writeFileSync(plistPath, document);
  }

  // This path is reached only when the local health check failed. Replacing a
  // loaded but unhealthy job cannot interrupt live work, and refreshes an old
  // plist after the app itself moved or updated.
  await execFile("launchctl", ["bootout", service]).catch(() => undefined);
  try {
    await execFile("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
    await execFile("launchctl", ["kickstart", "-k", service]);
    return true;
  } catch (error) {
    console.warn("remy: could not install the background server", error);
    return false;
  }
}

async function stopLaunchAgent(): Promise<void> {
  const uid = process.getuid?.();
  if (uid === undefined) return;
  await execFile("launchctl", ["bootout", `gui/${uid}/${LAUNCH_AGENT_LABEL}`]).catch(() => undefined);
}

/// GUI apps inherit a tiny PATH. Claude, git, gh, and Homebrew live outside it.
function serverEnv(electronNode: boolean): NodeJS.ProcessEnv {
  const home = homedir();
  const path = [
    join(home, ".local/bin"),
    join(home, ".npm-global/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH ?? "/usr/bin:/bin",
  ].join(":");
  return {
    ...process.env,
    PATH: path,
    LANG: process.env.LANG || process.env.LC_ALL || "en_US.UTF-8",
    ...(electronNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
  };
}

function nodeCommand(electronNode: boolean): string {
  if (electronNode) return process.execPath;
  // Unpackaged Electron cannot load node-pty built for Node. Dev uses PATH node.
  if (process.versions.electron) return "node";
  return process.execPath;
}

/// The desktop window is useless without the daemon on this machine. A packaged
/// app ships the server next to the UI and runs it with Electron's Node, the
/// same way T3 Code does. Claude itself stays the one already on this Mac.
export async function ensureLocalServer(
  serverDir: string,
  target: LocalTarget,
  options: { electronNode?: boolean; persistent?: boolean } = {},
): Promise<LocalTarget> {
  if (!isLoopback(target.url)) return target;
  if (await reachable(target)) return { ...target, token: readHomeConfig()?.token || target.token };

  const entry = join(serverDir, "dist/index.js");
  if (!existsSync(entry)) {
    if (!existsSync(join(serverDir, "package.json"))) return target;
    await execFile("npm", ["run", "build"], { cwd: serverDir });
  }
  if (options.persistent && await installLaunchAgent(serverDir, entry)) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const token = readHomeConfig()?.token || target.token;
      if (await reachable({ url: target.url, token })) return { url: target.url, token };
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    console.warn("remy: background server did not become reachable");
    await stopLaunchAgent();
  }
  const electronNode = Boolean(options.electronNode);
  spawned = spawn(nodeCommand(electronNode), [entry], {
    cwd: serverDir,
    stdio: "inherit",
    env: serverEnv(electronNode),
  });
  spawned.on("error", (error) => {
    console.warn("remy: failed to spawn local server", error);
  });
  spawned.on("exit", () => {
    if (spawned?.exitCode !== null) spawned = undefined;
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const token = readHomeConfig()?.token || target.token;
    if (await reachable({ url: target.url, token })) return { url: target.url, token };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  console.warn("remy: local server did not become reachable");
  return { ...target, token: readHomeConfig()?.token || target.token };
}

export function stopSpawnedServer(): void {
  spawned?.kill();
  spawned = undefined;
}
