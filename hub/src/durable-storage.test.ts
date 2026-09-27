import assert from "node:assert/strict";
import test from "node:test";
import { clearRetiredTasks, RETIRED_TASKS_CLEARED, type KeyValueStorage } from "./durable-storage.js";

class PagedStorage implements KeyValueStorage {
  lists = 0;
  constructor(readonly values = new Map<string, unknown>()) {}
  async get<T>(key: string) { return this.values.get(key) as T | undefined; }
  async put<T>(key: string, value: T) { this.values.set(key, value); }
  async delete(key: string) { return this.values.delete(key); }
  async list<T>({ prefix, limit }: { prefix: string; limit?: number }) {
    this.lists++;
    const keys = [...this.values.keys()].filter((key) => key.startsWith(prefix)).sort().slice(0, limit);
    return new Map(keys.map((key) => [key, this.values.get(key) as T]));
  }
  async transaction<T>(closure: (storage: KeyValueStorage) => Promise<T>): Promise<T> { return closure(this); }
}

test("clearing retired Tasks removes only board and Linear sync keys, once", async () => {
  const storage = new PagedStorage();
  for (let i = 0; i < 600; i++) storage.values.set(`board:event:${String(i).padStart(4, "0")}`, { id: i });
  const kept: Record<string, unknown> = {
    organizationId: "org",
    "threads:snapshot:computer:thread": { id: "thread" },
    "threads:cursor": 9,
    "threads:frame:0000000000000009": { kind: "snapshot" },
    "threads:retired:computer:thread": true,
    "thread-run:thread": { computerId: "computer", userId: "ada" },
    "hosted:workspace": { computerId: "hosted" },
    "hosted-key:hosted": { publicKey: "public" },
    "cursor-cloud:thread:one": { id: "one" },
    "uptime.latest": { ok: true },
  };
  for (const [key, value] of Object.entries(kept)) storage.values.set(key, value);
  for (const key of ["board:vector", "board:cursor", "board:projection:ticket:one", "linear:ticket:one", "linear:run:thread", "linear:vector"]) storage.values.set(key, true);

  assert.equal(await clearRetiredTasks(storage), 606);
  assert.deepEqual(Object.fromEntries([...storage.values].filter(([key]) => key !== RETIRED_TASKS_CLEARED)), kept);
  assert.equal(storage.values.get(RETIRED_TASKS_CLEARED), true);

  storage.values.set("linear:ticket:late", true);
  const lists = storage.lists;
  assert.equal(await clearRetiredTasks(storage), 0);
  assert.equal(storage.lists, lists);
  assert.equal(storage.values.get("linear:ticket:late"), true);
});

test("an organization object clears retired Tasks before it serves a request", async () => {
  const { HubCoordinator } = await import("./worker.js");
  const storage = new PagedStorage(new Map<string, unknown>([
    ["board:event:one", { entity: "ticket" }],
    ["linear:ticket:one", { issueId: "ENG-1" }],
    ["threads:snapshot:computer:thread", { id: "thread" }],
  ]));
  let blocked: Promise<unknown> | undefined;
  new HubCoordinator({
    storage,
    blockConcurrencyWhile: <T>(work: () => Promise<T>) => (blocked = work()),
    getWebSockets: () => [],
  } as unknown as DurableObjectState, { DB: {} } as never);
  await blocked;
  assert.deepEqual([...storage.values.keys()].sort(), [RETIRED_TASKS_CLEARED, "threads:snapshot:computer:thread"]);
});
