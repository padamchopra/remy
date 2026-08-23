import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { config } from "./config.js";
import {
  disableExternalMcp,
  enableExternalMcp,
  externalMcpEnabled,
} from "./external-mcp-auth.js";
import { remyMcpProcess, type RemyMcpProcess } from "./mcp-process.js";
import { provider, type ProviderId } from "./providers.js";
import { run } from "./run.js";

const MCP_NAME = "remy";

export interface ProviderMcpStatus {
  provider: ProviderId;
  installed: boolean;
  configured: boolean;
}

export function mcpInstallCommand(id: ProviderId, child: RemyMcpProcess): { file: string; args: string[] } | undefined {
  const environment = Object.entries(child.env).map(([name, value]) => `${name}=${value}`);
  if (id === "claude") {
    return {
      file: "claude",
      args: [
        "mcp", "add", "--scope", "user", "--transport", "stdio", MCP_NAME,
        ...environment.flatMap((pair) => ["-e", pair]),
        "--", child.command, ...child.args,
      ],
    };
  }
  if (id === "codex") {
    return {
      file: "codex",
      args: [
        "mcp", "add", MCP_NAME,
        ...environment.flatMap((pair) => ["--env", pair]),
        "--", child.command, ...child.args,
      ],
    };
  }
  return undefined;
}

export function cursorMcpConfig(value: unknown, child: RemyMcpProcess): Record<string, unknown> {
  const current = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const servers = current.mcpServers && typeof current.mcpServers === "object" && !Array.isArray(current.mcpServers)
    ? current.mcpServers as Record<string, unknown>
    : {};
  return {
    ...current,
    mcpServers: {
      ...servers,
      [MCP_NAME]: { command: child.command, args: child.args, env: child.env },
    },
  };
}

export function withoutCursorMcp(value: unknown): Record<string, unknown> {
  const current = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const servers = current.mcpServers && typeof current.mcpServers === "object" && !Array.isArray(current.mcpServers)
    ? { ...current.mcpServers as Record<string, unknown> }
    : {};
  delete servers[MCP_NAME];
  return { ...current, mcpServers: servers };
}

function childFor(id: ProviderId): RemyMcpProcess {
  return remyMcpProcess({
    apiUrl: `http://127.0.0.1:${config.port}`,
    provider: id,
  });
}

function cursorConfigPath(): string {
  return join(homedir(), ".cursor", "mcp.json");
}

async function readCursorConfig(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(cursorConfigPath(), "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return {};
    if (error instanceof SyntaxError) throw new Error("Cursor's MCP settings are not valid JSON");
    throw error;
  }
}

async function writeCursorConfig(value: Record<string, unknown>): Promise<void> {
  const path = cursorConfigPath();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.remy-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function configured(id: ProviderId): Promise<boolean> {
  if (id === "cursor") {
    const saved = await readCursorConfig();
    const servers = saved.mcpServers && typeof saved.mcpServers === "object"
      ? saved.mcpServers as Record<string, unknown>
      : {};
    return Boolean(servers[MCP_NAME]);
  }
  try {
    await run(id === "claude" ? "claude" : "codex", ["mcp", "get", MCP_NAME], {
      cwd: homedir(),
      timeout: 8_000,
    });
    return true;
  } catch {
    return false;
  }
}

export async function providerMcpStatuses(): Promise<ProviderMcpStatus[]> {
  return Promise.all((["claude", "codex", "cursor"] as const).map(async (id) => {
    const hasConfig = await configured(id).catch(() => false);
    return {
      provider: id,
      configured: hasConfig,
      installed: hasConfig && externalMcpEnabled(id),
    };
  }));
}

async function removeProviderConfig(id: ProviderId): Promise<void> {
  if (id === "cursor") {
    await writeCursorConfig(withoutCursorMcp(await readCursorConfig()));
    return;
  }
  if (!(await configured(id))) return;
  await run(id === "claude" ? "claude" : "codex", ["mcp", "remove", ...(id === "claude" ? ["--scope", "user"] : []), MCP_NAME], {
    cwd: homedir(),
    timeout: 15_000,
  });
}

export async function installProviderMcp(value: unknown): Promise<ProviderMcpStatus> {
  const selected = provider(value);
  if (!selected) throw new Error("no such provider");
  try {
    if (await configured(selected.id)) await removeProviderConfig(selected.id);
    enableExternalMcp(selected.id);
    const child = childFor(selected.id);
    const command = mcpInstallCommand(selected.id, child);
    if (command) {
      await run(command.file, command.args, { cwd: homedir(), timeout: 15_000 });
    } else {
      await writeCursorConfig(cursorMcpConfig(await readCursorConfig(), child));
    }
  } catch (error) {
    disableExternalMcp(selected.id);
    throw providerMcpError(selected.id, error);
  }
  return { provider: selected.id, configured: true, installed: true };
}

export async function removeProviderMcp(value: unknown): Promise<ProviderMcpStatus> {
  const selected = provider(value);
  if (!selected) throw new Error("no such provider");
  disableExternalMcp(selected.id);
  try {
    await removeProviderConfig(selected.id);
  } catch (error) {
    throw providerMcpError(selected.id, error);
  }
  return { provider: selected.id, configured: false, installed: false };
}

function providerMcpError(id: ProviderId, error: unknown): Error {
  const code = (error as { code?: string }).code;
  if (code === "ENOENT") {
    const name = id === "claude" ? "Claude Code" : id === "codex" ? "Codex" : "Cursor Agent";
    return new Error(`Install ${name} on this machine, then try again.`);
  }
  if ((error as Error)?.message === "Cursor's MCP settings are not valid JSON") {
    return new Error("Fix Cursor's MCP settings, then try again.");
  }
  const command = id === "claude" ? "claude mcp list" : id === "codex" ? "codex mcp list" : "agent mcp list";
  return new Error(`Run ${command} in Terminal, then try again.`);
}
