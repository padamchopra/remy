import { fileURLToPath } from "node:url";

export interface RemyMcpProcess {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/// The one subprocess shape used by Remy-owned and separately installed MCP
/// clients. A packaged daemon runs under Electron's Node mode, so every later
/// Electron invocation needs the same flag or macOS opens another Remy window.
export function remyMcpProcess(input: {
  apiUrl: string;
  token?: string;
  provider?: string;
  chatId?: string;
  deviceId?: string;
  agentId?: string;
  dm?: boolean;
  command?: string;
  script?: string;
  electron?: boolean;
}): RemyMcpProcess {
  const command = input.command ?? process.execPath;
  const script = input.script ?? fileURLToPath(new URL("./ticket-mcp.js", import.meta.url));
  const electron = input.electron ?? Boolean(process.versions.electron);
  return {
    command,
    args: [script],
    env: {
      REMY_API_URL: input.apiUrl,
      ...(input.token ? { REMY_API_TOKEN: input.token } : {}),
      ...(input.provider ? { REMY_MCP_PROVIDER: input.provider } : {}),
      ...(input.chatId ? { REMY_CHAT_ID: input.chatId } : {}),
      ...(input.deviceId ? { REMY_DEVICE_ID: input.deviceId } : {}),
      ...(input.agentId ? { REMY_AGENT_ID: input.agentId } : {}),
      ...(input.dm ? { REMY_CHAT_DM: "1" } : {}),
      ...(electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
  };
}
