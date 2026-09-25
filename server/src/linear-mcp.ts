/// Linear's hosted read-write MCP. Remy attaches the person's sign-in; it does
/// not reimplement Linear's tools, and it does not accept another host.
export const LINEAR_MCP_URL = "https://mcp.linear.app/mcp";
export const LINEAR_MCP_NAME = "linear";
export const LINEAR_MCP_TOKEN_ENV = "LINEAR_MCP_TOKEN";

export type LinearHttpMcp = { name: string; url: string; token: string };

export function linearHttpMcp(servers: LinearHttpMcp[] | undefined): LinearHttpMcp | undefined {
  return servers?.find((server) => server.name === LINEAR_MCP_NAME && server.url === LINEAR_MCP_URL && !!server.token);
}

export function claudeLinearMcp(server: LinearHttpMcp) {
  return { type: "http" as const, url: server.url, headers: { Authorization: `Bearer ${server.token}` } };
}

/// Config keys and the environment variable name only. The token stays in the child env.
export function codexLinearArgs(server: LinearHttpMcp): string[] {
  return [
    "--config",
    `mcp_servers.${server.name}.url=${JSON.stringify(server.url)}`,
    "--config",
    `mcp_servers.${server.name}.bearer_token_env_var=${JSON.stringify(LINEAR_MCP_TOKEN_ENV)}`,
  ];
}

export function cursorLinearMcp(server: LinearHttpMcp) {
  return {
    type: "http",
    name: server.name,
    url: server.url,
    headers: [{ name: "Authorization", value: `Bearer ${server.token}` }],
  };
}
