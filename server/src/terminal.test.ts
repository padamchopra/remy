import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const configDir = mkdtempSync(join(tmpdir(), "remy-terminal-test-"));
process.env.MC_CONFIG_DIR = configDir;

const {
  closeTerminal,
  openTerminal,
  resolveTerminalCwd,
  terminalView,
  writeTerminal,
} = await import("./terminal.js");

test("resolves home and rejects a missing terminal directory", () => {
  assert.equal(resolveTerminalCwd(configDir), configDir);
  assert.throws(() => resolveTerminalCwd(join(configDir, "missing")));
});

test("keeps a terminal alive while clients read its buffered output", async () => {
  const terminalId = "test-terminal";
  const opened = openTerminal(terminalId, { cwd: configDir, cols: 80, rows: 24 });
  assert.equal(opened.active, true);
  assert.equal(opened.cwd, configDir);

  writeTerminal(terminalId, "printf '__REMY_TERMINAL_READY__\\n'\n");
  await assertEventually(() => terminalView(terminalId)?.output.includes("__REMY_TERMINAL_READY__") === true);
  assert.equal(terminalView(terminalId)?.active, true);

  closeTerminal(terminalId);
  assert.equal(terminalView(terminalId), undefined);
});

async function assertEventually(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("terminal output did not arrive");
}
