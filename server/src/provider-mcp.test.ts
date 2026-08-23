import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "remy-provider-mcp-"));
const { cursorMcpConfig, mcpInstallCommand, withoutCursorMcp } = await import("./provider-mcp.js");

const child = {
  command: "/Applications/Remy.app/Contents/MacOS/Remy",
  args: ["/Applications/Remy.app/Contents/Resources/server/dist/ticket-mcp.js"],
  env: {
    REMY_API_URL: "http://127.0.0.1:8420",
    REMY_MCP_PROVIDER: "codex",
    ELECTRON_RUN_AS_NODE: "1",
  },
};

test("Claude and Codex installers configure a user-wide stdio MCP", () => {
  const claude = mcpInstallCommand("claude", child)!;
  assert.equal(claude.file, "claude");
  assert.deepEqual(claude.args.slice(0, 7), ["mcp", "add", "--scope", "user", "--transport", "stdio", "remy"]);
  assert.ok(claude.args.includes("REMY_MCP_PROVIDER=codex"));
  assert.ok(!claude.args.some((arg) => arg.includes("API_TOKEN")));

  const codex = mcpInstallCommand("codex", child)!;
  assert.equal(codex.file, "codex");
  assert.deepEqual(codex.args.slice(0, 3), ["mcp", "add", "remy"]);
  assert.ok(codex.args.includes("ELECTRON_RUN_AS_NODE=1"));
  assert.ok(!codex.args.some((arg) => arg.includes("API_TOKEN")));
});

test("Cursor MCP changes preserve unrelated settings and servers", () => {
  const before = {
    theme: "dark",
    mcpServers: { paper: { url: "https://example.com/mcp" } },
  };
  const installed = cursorMcpConfig(before, child);
  assert.equal(installed.theme, "dark");
  assert.deepEqual((installed.mcpServers as Record<string, unknown>).paper, { url: "https://example.com/mcp" });
  assert.deepEqual((installed.mcpServers as Record<string, unknown>).remy, {
    command: child.command,
    args: child.args,
    env: child.env,
  });

  const removed = withoutCursorMcp(installed);
  assert.deepEqual((removed.mcpServers as Record<string, unknown>).paper, { url: "https://example.com/mcp" });
  assert.equal((removed.mcpServers as Record<string, unknown>).remy, undefined);
});
