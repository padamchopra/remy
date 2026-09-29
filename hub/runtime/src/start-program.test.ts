import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { startProgram } from "./start-program.js";

function layout() {
  const root = mkdtempSync(path.join(tmpdir(), "remy-boot-"));
  const codex = path.join(root, "codex");
  const helper = path.join(codex, "node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin");
  mkdirSync(helper, { recursive: true });
  writeFileSync(path.join(helper, "codex-code-mode-host"), "");
  return { root, codex, entry: path.join(root, "entry.js"), log: path.join(root, "boot.log"), pid: path.join(root, "remy.pid") };
}

function run(env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", startProgram], { env: { ...process.env, ...env } });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stderr }));
  });
}

test("startup fails before advertising a computer without the Codex helper", async () => {
  const paths = layout();
  const empty = path.join(paths.root, "empty");
  mkdirSync(empty);
  const result = await run({
    REMY_BOOT_CODEX_ROOT: empty,
    REMY_BOOT_ENTRY: paths.entry,
    REMY_BOOT_PORT: "29198",
    REMY_BOOT_LOG: paths.log,
    REMY_BOOT_PID: paths.pid,
    REMY_BOOT_HOLD_MS: "1000",
    REMY_BOOT_SETTLE_MS: "50",
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Codex command helper is missing/);
});

test("the boot session stays open until Remy is listening", async () => {
  const paths = layout();
  const port = 29127 + (process.pid % 1000);
  writeFileSync(paths.entry, `const net=require("node:net");setTimeout(()=>net.createServer().listen(${port},"127.0.0.1"),300);\n`);
  const started = Date.now();
  const result = await run({
    REMY_BOOT_CODEX_ROOT: paths.codex,
    REMY_BOOT_ENTRY: paths.entry,
    REMY_BOOT_PORT: String(port),
    REMY_BOOT_LOG: paths.log,
    REMY_BOOT_PID: paths.pid,
    REMY_BOOT_HOLD_MS: "8000",
    REMY_BOOT_SETTLE_MS: "200",
  });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(Date.now() - started >= 400);
});

test("a guest that exits reports its log", async () => {
  const paths = layout();
  writeFileSync(paths.entry, `console.error("clone failed");process.exit(1);\n`);
  const result = await run({
    REMY_BOOT_CODEX_ROOT: paths.codex,
    REMY_BOOT_ENTRY: paths.entry,
    REMY_BOOT_PORT: "29199",
    REMY_BOOT_LOG: paths.log,
    REMY_BOOT_PID: paths.pid,
    REMY_BOOT_HOLD_MS: "8000",
    REMY_BOOT_SETTLE_MS: "50",
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /clone failed/);
  assert.match(result.stderr, /Remy stopped before it could join/);
});
