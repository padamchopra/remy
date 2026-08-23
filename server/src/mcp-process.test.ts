import assert from "node:assert/strict";
import test from "node:test";
import { remyMcpProcess } from "./mcp-process.js";

test("packaged MCP children keep Electron in Node mode", () => {
  const child = remyMcpProcess({
    apiUrl: "http://127.0.0.1:8420",
    token: "scoped",
    chatId: "chat-1",
    command: "/Applications/Remy.app/Contents/MacOS/Remy",
    script: "/Applications/Remy.app/Contents/Resources/server/dist/ticket-mcp.js",
    electron: true,
  });

  assert.equal(child.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(child.env.REMY_API_TOKEN, "scoped");
  assert.deepEqual(child.args, ["/Applications/Remy.app/Contents/Resources/server/dist/ticket-mcp.js"]);
});

test("ordinary Node MCP children do not receive an Electron flag", () => {
  const child = remyMcpProcess({
    apiUrl: "http://127.0.0.1:8420",
    provider: "codex",
    command: "/usr/local/bin/node",
    script: "/app/ticket-mcp.js",
    electron: false,
  });

  assert.equal(child.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(child.env.REMY_MCP_PROVIDER, "codex");
  assert.equal(child.env.REMY_API_TOKEN, undefined);
});
