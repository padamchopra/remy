import assert from "node:assert/strict";
import test from "node:test";
import {
  HUB_THREAD_CACHE_BOUNDS,
  HUB_THREAD_CACHE_KEY,
  HUB_THREAD_CACHE_VERSION,
  cacheHubThread,
  cachedHubThread,
  clearHubThreadCache,
  forgetHubThread,
} from "../src/lib/hub-thread-cache.ts";

function storage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

function thread(id, patch = {}) {
  return {
    id,
    computerId: "computer",
    revision: 1,
    stale: false,
    observedAt: 10,
    access: {
      organizationId: "org",
      owner: { id: "person", label: "You" },
      visibility: "private",
      participants: [],
    },
    detail: { id, title: `Thread ${id}`, entries: [{ id: "m", kind: "user", text: "Hello" }] },
    ...patch,
  };
}

test.beforeEach(() => {
  clearHubThreadCache(storage());
});

test("paints a confirmed thread from the stored copy", () => {
  const kept = storage();
  clearHubThreadCache(kept);
  assert.equal(cachedHubThread("thread-1", kept), undefined);

  cacheHubThread("org", thread("thread-1"), { computerName: "Macbook Pro", memberId: "person" }, kept);
  const row = cachedHubThread("thread-1", kept);
  assert.equal(row.organizationId, "org");
  assert.equal(row.computerName, "Macbook Pro");
  assert.equal(row.memberId, "person");
  cacheHubThread("org", thread("thread-1", { revision: 2 }), { computerName: "Macbook Pro" }, kept);
  assert.equal(cachedHubThread("thread-1", kept).memberId, "person");
  assert.equal(cachedHubThread("thread-1", kept).thread.revision, 2);
  assert.equal(row.thread.detail.entries[0].text, "Hello");
  assert.equal(JSON.parse(kept.items.get(HUB_THREAD_CACHE_KEY)).version, HUB_THREAD_CACHE_VERSION);

  clearHubThreadCache(storage());
  const reopened = cachedHubThread("thread-1", kept);
  assert.equal(reopened.thread.detail.title, "Thread thread-1");
  assert.equal(reopened.computerName, "Macbook Pro");
});

test("drops a pending thread, the wrong account, another schema, and an old copy", () => {
  const kept = storage();
  clearHubThreadCache(kept);
  cacheHubThread("org", thread("pending-thread", { computerId: "pending" }), undefined, kept);
  cacheHubThread("other", thread("thread-1"), undefined, kept);
  assert.equal(cachedHubThread("pending-thread", kept), undefined);
  assert.equal(cachedHubThread("thread-1", kept), undefined);

  const stale = storage({
    [HUB_THREAD_CACHE_KEY]: JSON.stringify({
      version: 0,
      savedAt: Date.now(),
      threads: [{ organizationId: "org", savedAt: Date.now(), thread: thread("thread-1") }],
    }),
  });
  clearHubThreadCache(storage());
  assert.equal(cachedHubThread("thread-1", stale), undefined);

  const expired = storage({
    [HUB_THREAD_CACHE_KEY]: JSON.stringify({
      version: HUB_THREAD_CACHE_VERSION,
      savedAt: Date.now() - HUB_THREAD_CACHE_BOUNDS.ageMs - 1,
      threads: [{ organizationId: "org", savedAt: Date.now(), thread: thread("thread-1") }],
    }),
  });
  clearHubThreadCache(storage());
  assert.equal(cachedHubThread("thread-1", expired), undefined);
});

test("keeps the newest threads and the tail of a transcript that does not fit", () => {
  const kept = storage();
  clearHubThreadCache(kept);
  for (let index = 0; index < HUB_THREAD_CACHE_BOUNDS.threads + 2; index += 1) {
    cacheHubThread("org", thread(`thread-${index}`), undefined, kept);
  }
  clearHubThreadCache(storage());
  assert.equal(cachedHubThread("thread-0", kept), undefined);
  assert.equal(cachedHubThread("thread-1", kept), undefined);
  assert.ok(cachedHubThread(`thread-${HUB_THREAD_CACHE_BOUNDS.threads + 1}`, kept));

  const entries = Array.from({ length: 8 }, (_, index) => ({
    id: `e-${index}`,
    kind: "assistant",
    text: "x".repeat(80_000),
  }));
  const huge = storage();
  clearHubThreadCache(huge);
  cacheHubThread("org", thread("huge", { detail: { id: "huge", title: "Huge", entries } }), undefined, huge);
  clearHubThreadCache(storage());
  const saved = cachedHubThread("huge", huge);
  assert.ok(saved.thread.detail.entries.length < entries.length);
  assert.equal(saved.thread.detail.entries.at(-1).text, entries.at(-1).text);
  assert.ok(huge.items.get(HUB_THREAD_CACHE_KEY).length <= HUB_THREAD_CACHE_BOUNDS.characters);
});

test("forgets one thread and keeps an in-memory copy when storage fails", () => {
  const kept = storage();
  clearHubThreadCache(kept);
  cacheHubThread("org", thread("thread-1"), undefined, kept);
  cacheHubThread("org", thread("thread-2"), undefined, kept);
  forgetHubThread("thread-1", kept);
  assert.equal(cachedHubThread("thread-1", kept), undefined);
  assert.equal(cachedHubThread("thread-2", kept).thread.id, "thread-2");

  const failing = {
    getItem: () => null,
    setItem: () => { throw new Error("quota"); },
    removeItem: () => {},
  };
  clearHubThreadCache(storage());
  cacheHubThread("org", thread("thread-3"), { computerName: "Studio" }, failing);
  assert.equal(cachedHubThread("thread-3", failing).computerName, "Studio");
});
