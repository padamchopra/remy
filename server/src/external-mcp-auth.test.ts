import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "remy-external-mcp-auth-"));
const {
  disableExternalMcp,
  enableExternalMcp,
  externalMcpEnabled,
  externalMcpProvider,
  externalMcpToken,
} = await import("./external-mcp-auth.js");

test("external MCP capabilities are provider-scoped and revocable", () => {
  enableExternalMcp("codex");
  const token = externalMcpToken("codex");

  assert.ok(token);
  assert.equal(externalMcpEnabled("codex"), true);
  assert.equal(externalMcpEnabled("claude"), false);
  assert.equal(externalMcpProvider(`Bearer ${token}`), "codex");
  assert.equal(externalMcpProvider(`Bearer ${token}changed`), undefined);

  disableExternalMcp("codex");
  assert.equal(externalMcpProvider(`Bearer ${token}`), undefined);
  assert.equal(externalMcpToken("codex"), undefined);
});

test("reinstalling replaces the previous capability", () => {
  enableExternalMcp("claude");
  const before = externalMcpToken("claude");
  enableExternalMcp("claude");
  const after = externalMcpToken("claude");

  assert.notEqual(before, after);
  assert.equal(externalMcpProvider(`Bearer ${before}`), undefined);
  assert.equal(externalMcpProvider(`Bearer ${after}`), "claude");
});
