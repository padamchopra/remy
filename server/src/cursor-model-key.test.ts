import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import test, { after } from "node:test";
import type { ProviderSessionOptions } from "./provider-adapters/types.js";

// The database opens at import time, so the whole file runs against a throwaway
// directory. node:test gives each file its own process.
const directory = mkdtempSync(join(tmpdir(), "remy-cursor-model-key-"));
process.env.MC_CONFIG_DIR = directory;
delete process.env.CURSOR_API_KEY;
const command = join(directory, "agent");
writeFileSync(command, "#!/bin/sh\nexit 1\n");
chmodSync(command, 0o755);
process.env.PATH = `${directory}:${process.env.PATH}`;
const keys = await import("./hub-model-keys.js");
const { Chat } = await import("./chat.js");
const { setProviderAdapterForTest } = await import("./provider-adapters/index.js");
after(() => rmSync(directory, { recursive: true, force: true }));

test("a Cursor key set from the web reaches agent acp through its environment and restarts it on change", async (t) => {
  const sessions: { options: ProviderSessionOptions; closed: boolean }[] = [];
  const reset = setProviderAdapterForTest({
    id: "cursor",
    createSession(options, handlers) {
      const session = { options, closed: false };
      sessions.push(session);
      return {
        turn() {
          handlers.event({ type: "turn.started" });
          handlers.event({ type: "turn.completed", turns: 1 });
          return { done: Promise.resolve(), interrupt() {} };
        },
        close() { session.closed = true; },
      };
    },
    answer: async () => undefined,
    discoverModels: async () => [],
  });
  const chat = new Chat({ id: randomUUID(), title: "Cursor key", cwd: directory, provider: "cursor",
    permissionMode: "default", entries: [], todos: [], turns: 0, createdAt: Date.now(), updatedAt: Date.now() });
  chat.persist();
  t.after(async () => { chat.stop(); reset(); keys.forgetHubModelKeys(); await tick(); });

  assert.equal(keys.applyHubModelKeys({ values: { CURSOR_API_KEY: "test-cursor-first" } }), true);
  assert.equal(process.env.CURSOR_API_KEY, "test-cursor-first", "Cursor's own model discovery reads it too");
  await chat.send("Read the change.");
  await tick();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].options.env?.CURSOR_API_KEY, "test-cursor-first");
  assert.ok(!sessions[0].options.command.includes("test-cursor"), "the key never rides on the command line");

  await chat.send("Keep going.");
  await tick();
  assert.equal(sessions.length, 1, "an unchanged key keeps the live conversation");

  keys.applyHubModelKeys({ values: { CURSOR_API_KEY: "test-cursor-second" } });
  await chat.send("Now with the new key.");
  await tick();
  assert.equal(sessions.length, 2, "a changed key starts a new Cursor session");
  assert.equal(sessions[0].closed, true);
  assert.equal(sessions[1].options.env?.CURSOR_API_KEY, "test-cursor-second");
});
