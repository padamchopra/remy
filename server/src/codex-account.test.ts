import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CodexAccount } from "./codex-account.js";

const until = async (condition: () => boolean) => {
  for (let n = 0; n < 100; n++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw Error("Account did not update");
};
test("device login pushes completion, hides credentials, survives restart and supports logout", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "remy-codex-account-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  let connected = false,
    changes = 0;
  const options = {
    command: process.execPath,
    args: [resolve("test/fixtures/codex-account.mjs")],
    cwd: home,
    env: {
      ...process.env,
      CODEX_HOME: home,
      REMY_CODEX_TEST: "1",
      OPENAI_API_KEY: "api-test-value",
    },
    changed: () => {
      changes++;
    },
    connected: (value: boolean) => {
      connected = value;
    },
  };
  const account = new CodexAccount(options);
  t.after(() => account.close());
  assert.equal((await account.status()).phase, "signedOut");
  const [first, duplicate] = await Promise.all([
    account.change("start"),
    account.change("start"),
  ]);
  assert.deepEqual(first, duplicate);
  assert.equal(first.userCode, "DEMO-0000");
  const before = changes;
  writeFileSync(join(home, "test-approve"), "success");
  await until(() => connected && changes > before);
  const status = await account.status();
  assert.equal(status.phase, "connected");
  assert.equal(status.email, "reviewer@example.test");
  assert.equal(status.userCode, undefined);
  assert.ok(!JSON.stringify(status).includes("test-value"));
  const stableChanges = changes;
  await account.status();
  assert.equal(changes, stableChanges);
  account.close();
  const restarted = new CodexAccount(options);
  t.after(() => restarted.close());
  assert.equal((await restarted.status()).phase, "connected");
  assert.equal((await restarted.change("logout")).phase, "signedOut");
  assert.equal(connected, false);
  assert.equal((await restarted.status()).apiKeyConfigured, true);
});
test("cancellation and login failure discard the code and raw provider errors", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "remy-codex-cancel-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  let changes = 0;
  const account = new CodexAccount({
    command: process.execPath,
    args: [resolve("test/fixtures/codex-account.mjs")],
    cwd: home,
    env: { ...process.env, CODEX_HOME: home, REMY_CODEX_TEST: "1" },
    changed: () => {
      changes++;
    },
    connected: () => {},
  });
  t.after(() => account.close());
  await account.change("start");
  assert.equal((await account.change("cancel")).userCode, undefined);
  await account.change("start");
  const before = changes;
  writeFileSync(join(home, "test-approve"), "failure");
  await until(() => changes > before);
  const status = await account.status();
  assert.equal(status.phase, "error");
  assert.equal(status.userCode, undefined);
  assert.ok(!JSON.stringify(status).includes("never-return"));
  assert.equal((await account.change("start")).phase, "pending");
});
test("expired device-code attempts can be restarted", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "remy-codex-expiry-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  let changes = 0;
  const account = new CodexAccount({
    command: process.execPath,
    args: [resolve("test/fixtures/codex-account.mjs")],
    cwd: home,
    env: { ...process.env, CODEX_HOME: home, REMY_CODEX_TEST: "1" },
    loginTimeoutMs: 40,
    changed: () => {
      changes++;
    },
    connected: () => {},
  });
  t.after(() => account.close());
  await account.change("start");
  const before = changes;
  await until(() => changes > before);
  assert.equal((await account.status()).phase, "error");
  assert.equal((await account.change("start")).phase, "pending");
});


test("a failed initialization closes its process and can retry", async t => {
  const home = mkdtempSync(join(tmpdir(), "remy-codex-retry-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  writeFileSync(join(home, "test-init-fail"), "1");
  const account = new CodexAccount({ command: process.execPath, args: [resolve("test/fixtures/codex-account.mjs")], cwd: home,
    env: { ...process.env, CODEX_HOME: home, REMY_CODEX_TEST: "1" }, changed: () => {}, connected: () => {} });
  t.after(() => account.close());
  await assert.rejects(account.status(), error => error instanceof Error && !error.message.includes("never-return"));
  assert.equal((await account.status()).phase, "signedOut");
});
