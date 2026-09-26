import assert from "node:assert/strict";
import test from "node:test";
import { claudeLinearMcp, codexLinearArgs, cursorLinearMcp, LINEAR_MCP_URL } from "./linear-mcp.js";

const server = { name: "linear", url: LINEAR_MCP_URL, token: "secret-linear-token" };

test("provider MCP config carries the Linear URL and keeps the token out of the command line", () => {
  const args = codexLinearArgs(server);
  assert.match(args.join(" "), new RegExp(LINEAR_MCP_URL.replaceAll(".", "\\.")));
  assert.match(args.join(" "), /bearer_token_env_var/);
  assert.equal(args.join(" ").includes(server.token), false);
  const claude = claudeLinearMcp(server);
  assert.equal(claude.headers.Authorization, "Bearer secret-linear-token");
  assert.equal(JSON.stringify(claude).includes("command"), false);
  const cursor = cursorLinearMcp(server);
  assert.equal(cursor.url, LINEAR_MCP_URL);
  assert.equal(cursor.headers[0]?.value, "Bearer secret-linear-token");
  assert.equal("command" in cursor, false);
});
