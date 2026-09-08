import assert from "node:assert/strict";
import test from "node:test";
import {
  canReadThread,
  canWriteThread,
  type ThreadSnapshot,
} from "@remy/contract";
import type { BoardStorage } from "./organization-board.js";
import { ThreadStore } from "./thread-store.js";

class MemoryStorage implements BoardStorage {
  values = new Map<string, unknown>();
  async get<T>(key: string) {
    return structuredClone(this.values.get(key)) as T | undefined;
  }
  async put<T>(key: string, value: T) {
    this.values.set(key, structuredClone(value));
  }
  async delete(key: string) {
    return this.values.delete(key);
  }
  async list<T>({ prefix }: { prefix: string }) {
    return new Map(
      [...this.values]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key, structuredClone(value) as T]),
    );
  }
  async transaction<T>(fn: (storage: BoardStorage) => Promise<T>): Promise<T> {
    return fn(this);
  }
}
const id = "db837580-3dba-4e6d-8a9a-b3c84b786510";
const owner = { id: "ada", label: "Ada" };
const snapshot = (revision = 1): ThreadSnapshot => ({
  id,
  revision,
  access: {
    organizationId: "org",
    owner,
    visibility: "private",
    participants: [owner],
  },
  detail: {
    id,
    title: "Release notes",
    entries: [
      {
        id: "entry",
        kind: "user",
        text: "Check the release notes.",
        member: owner,
      },
    ],
  },
});

test("private threads are absent for other members; open readers must join to write", async () => {
  const store = new ThreadStore(new MemoryStorage());
  const thread = snapshot();
  await store.snapshot("studio", thread);
  assert.equal((await store.list("grace")).length, 0);
  assert.equal((await store.list("ada")).length, 1);
  thread.access.visibility = "open";
  thread.revision++;
  await store.snapshot("studio", thread);
  assert.equal((await store.list("grace")).length, 1);
  assert.equal(canReadThread(thread.access, "grace"), true);
  assert.equal(canWriteThread(thread.access, "grace"), false);
  thread.access.participants.push({ id: "grace", label: "Grace" });
  assert.equal(canWriteThread(thread.access, "grace"), true);
});

test("out-of-order responses never overwrite newer snapshots; restart preserves cursors and offline content", async () => {
  const storage = new MemoryStorage();
  let store = new ThreadStore(storage);
  await store.snapshot("studio", snapshot(2));
  await store.snapshot("studio", {
    ...snapshot(1),
    detail: { ...snapshot().detail, title: "Old" },
  });
  assert.equal((await store.get("studio", id))?.detail.title, "Release notes");
  assert.equal((await store.replay(0)).frames.length, 1);
  await store.offline("studio");
  store = new ThreadStore(storage);
  assert.equal((await store.get("studio", id))?.stale, true);
  assert.equal((await store.get("studio", id))?.detail.entries.length, 1);
  assert.equal((await store.replay(1)).frames.length, 1);
  await store.snapshot("studio", snapshot(3));
  assert.equal((await store.get("studio", id))?.stale, false);
});

test("bounded history resets an expired cursor, and a manifest removes only that computer's missing threads", async () => {
  const store = new ThreadStore(new MemoryStorage());
  for (let revision = 1; revision <= 130; revision++)
    await store.snapshot("studio", snapshot(revision));
  await store.snapshot("desk", snapshot());
  assert.deepEqual((await store.replay(0)).frames, [
    { kind: "reset", cursor: 131 },
  ]);
  assert.equal((await store.replay(130)).frames.length, 1);
  await store.manifest("studio", []);
  assert.equal(await store.get("studio", id), undefined);
  assert.ok(await store.get("desk", id));
  assert.equal((await store.replay(131)).frames[0]?.kind, "remove");
});
