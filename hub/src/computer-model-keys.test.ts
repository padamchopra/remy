import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { ComputerModelKeyStore, computerModelKeyName, computerModelKeyWrite, publicComputerModelKeys } from "./computer-model-keys.js";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(new URL("../migrations", import.meta.url)).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  const prepare = (sql: string, values: unknown[] = []): unknown => ({
    bind: (...args: unknown[]) => prepare(sql, args),
    first: async () => sqlite.prepare(sql).get(...(values as never[])) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...(values as never[])) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...(values as never[])).changes) } }),
  });
  return { sqlite, db: { prepare } as unknown as D1Database };
}

test("a provider key is readable only by the computer it was set on", async () => {
  const { sqlite, db } = database();
  const store = new ComputerModelKeyStore(db, async () => "root-secret", () => 1000);
  await store.set("mac", "ANTHROPIC_API_KEY", "test-anthropic-value");

  assert.deepEqual(await store.names("mac"), ["ANTHROPIC_API_KEY"]);
  assert.deepEqual(await store.values("mac"), { ANTHROPIC_API_KEY: "test-anthropic-value" });
  assert.deepEqual(await store.values("other"), {});

  const row = sqlite.prepare("SELECT ciphertext FROM computer_model_keys WHERE computer_id='mac'").get() as { ciphertext: string };
  assert.doesNotMatch(row.ciphertext, /test-anthropic-value/);
  sqlite.prepare("INSERT INTO computer_model_keys VALUES ('other','ANTHROPIC_API_KEY',?,1000)").run(row.ciphertext);
  await assert.rejects(store.values("other"));
});

test("a key is replaced, removed, and forgotten with its computer", async () => {
  const { db } = database();
  const store = new ComputerModelKeyStore(db, async () => "root-secret");
  await store.set("mac", "OPENAI_API_KEY", "test-first-value");
  await store.set("mac", "OPENAI_API_KEY", "test-second-value");
  assert.deepEqual(await store.values("mac"), { OPENAI_API_KEY: "test-second-value" });

  await store.set("mac", "OPENAI_API_KEY", null);
  assert.deepEqual(await store.names("mac"), []);

  await store.set("mac", "ANTHROPIC_API_KEY", "test-anthropic-value");
  await store.forget("mac");
  assert.deepEqual(await store.names("mac"), []);
});

test("management reads say what is configured and never the value", async () => {
  assert.deepEqual(publicComputerModelKeys(["ANTHROPIC_API_KEY"]), [
    { id: "anthropic", label: "Anthropic", runtime: "Claude", configured: true },
    { id: "openai", label: "OpenAI", runtime: "Codex", configured: false },
  ]);
  assert.equal(computerModelKeyName("openai"), "OPENAI_API_KEY");
});

test("only the provider keys Remy delivers can be written", () => {
  assert.equal(computerModelKeyWrite.safeParse({ id: "anthropic", apiKey: "test-value" }).success, true);
  assert.equal(computerModelKeyWrite.safeParse({ id: "anthropic", apiKey: null }).success, true);
  assert.equal(computerModelKeyWrite.safeParse({ id: "router", apiKey: "test-value" }).success, false);
  assert.equal(computerModelKeyWrite.safeParse({ id: "anthropic", apiKey: "" }).success, false);
  assert.equal(computerModelKeyWrite.safeParse({ id: "anthropic", apiKey: "a".repeat(8193) }).success, false);
  assert.equal(computerModelKeyWrite.safeParse({ id: "anthropic", apiKey: "test-value", name: "ANTHROPIC_API_KEY" }).success, false);
});
