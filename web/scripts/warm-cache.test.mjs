import assert from "node:assert/strict";
import test from "node:test";
import {
  WARM_CACHE_BOUNDS,
  WARM_CACHE_KEY,
  WARM_CACHE_VERSION,
  clearWarmCache,
  readWarmCache,
  settledDetail,
  warmSnapshot,
  writeWarmCache,
} from "../src/lib/warm-cache.ts";

function storage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

const server = { id: "local", name: "This machine", url: "http://127.0.0.1:8420", code: "L", online: true, icon: "laptop" };

function chat(id, patch = {}) {
  return { id, serverId: "local", title: `Thread ${id}`, cwd: "/tmp", state: "idle", updatedAt: 1, ...patch };
}

function detail(id, patch = {}) {
  return { id, serverId: "local", title: `Thread ${id}`, cwd: "/tmp", state: "idle", entries: [], todos: [], ...patch };
}

const store = (patch = {}) => ({ servers: [server], chats: [], dms: [], workspaces: [], agents: [], projects: [], ...patch });

test.beforeEach(() => clearWarmCache(storage()));

test("writes a settled snapshot and opens from it", () => {
  const kept = storage();
  const state = store({
    chats: [chat("a")],
    agents: [{ id: "scout", serverId: "local", name: "Scout", handle: "scout" }],
    projects: [{ id: "remy", serverId: "local", name: "Remy", keyPrefix: "REMY" }],
  });
  assert.equal(writeWarmCache(warmSnapshot(state, [detail("a")]), kept), true);

  const snapshot = readWarmCache(kept);
  assert.equal(snapshot.version, WARM_CACHE_VERSION);
  assert.deepEqual(snapshot.chats.map((row) => row.id), ["a"]);
  // Inbox is the agents, and `#/inbox/<handle>` cannot find its conversation
  // without the roster.
  assert.deepEqual(snapshot.agents.map((row) => row.handle), ["scout"]);
  assert.deepEqual(snapshot.projects.map((row) => row.keyPrefix), ["REMY"]);
  assert.deepEqual(snapshot.details.map((row) => row.id), ["a"]);
  // Whether a machine answers is this second's question, never a cached one.
  assert.equal(snapshot.servers[0].online, false);
});

test("never records a turn in flight as settled truth", () => {
  const working = detail("a", {
    state: "working",
    action: "Reading files",
    workingSince: 5,
    live: true,
    entries: [{ id: "partial", kind: "assistant", text: "Half a sen" }],
  });
  assert.equal(settledDetail(working), undefined);
  assert.equal(settledDetail(detail("a", { approval: { requestId: "r", tool: "Bash" } })), undefined);
  assert.equal(settledDetail(detail("a", { question: { requestId: "r", questions: [] } })), undefined);
  assert.equal(settledDetail(detail("a", { state: "needs_input" })), undefined);

  // A settled transcript keeps its content and drops every momentary field.
  const settled = settledDetail(detail("a", { live: true, action: "Reading files", workingSince: 5 }));
  assert.equal(settled.live, undefined);
  assert.equal(settled.action, undefined);
  assert.equal(settled.workingSince, undefined);

  const snapshot = warmSnapshot(
    store({ chats: [chat("a", { state: "working", workingSince: 5 }), chat("b", { state: "needs_input" })] }),
    [working, detail("b")],
  );
  assert.deepEqual(snapshot.details.map((row) => row.id), ["b"]);
  assert.deepEqual(snapshot.chats.map((row) => [row.state, row.workingSince]), [["idle", undefined], ["idle", undefined]]);
});

test("keeps an errored row as the settled fact it is", () => {
  const snapshot = warmSnapshot(store({ chats: [chat("a", { state: "error" })] }), [detail("a", { state: "error" })]);
  assert.equal(snapshot.chats[0].state, "error");
  assert.deepEqual(snapshot.details.map((row) => row.id), ["a"]);
});

test("bounds every list it keeps", () => {
  const many = (count, prefix) => Array.from({ length: count }, (_, index) => chat(`${prefix}${index}`, { updatedAt: index }));
  const snapshot = warmSnapshot(
    {
      servers: Array.from({ length: 40 }, (_, index) => ({ ...server, id: `s${index}` })),
      chats: many(200, "c"),
      dms: many(200, "d"),
      workspaces: Array.from({ length: 200 }, (_, index) => ({ id: `w${index}`, serverId: "local", name: "W", path: "/tmp" })),
      agents: Array.from({ length: 90 }, (_, index) => ({ id: `a${index}`, serverId: "local", handle: `a${index}` })),
      projects: Array.from({ length: 90 }, (_, index) => ({ id: `p${index}`, serverId: "local", keyPrefix: `P${index}` })),
    },
    Array.from({ length: 12 }, (_, index) => detail(`t${index}`)),
  );
  assert.equal(snapshot.servers.length, WARM_CACHE_BOUNDS.servers);
  assert.equal(snapshot.chats.length, WARM_CACHE_BOUNDS.chats);
  assert.equal(snapshot.dms.length, WARM_CACHE_BOUNDS.dms);
  assert.equal(snapshot.workspaces.length, WARM_CACHE_BOUNDS.workspaces);
  assert.equal(snapshot.agents.length, WARM_CACHE_BOUNDS.agents);
  assert.equal(snapshot.projects.length, WARM_CACHE_BOUNDS.projects);
  assert.equal(snapshot.details.length, WARM_CACHE_BOUNDS.details);
  // The rows a person sees first are the rows that survive.
  assert.equal(snapshot.chats[0].id, "c199");
  assert.deepEqual(snapshot.details.map((row) => row.id), ["t0", "t1", "t2", "t3"]);
});

test("keeps a pinned thread over a busier unpinned one", () => {
  const rows = [chat("pinned", { updatedAt: 1, pinned: true })];
  for (let index = 0; index < WARM_CACHE_BOUNDS.chats; index += 1) {
    rows.push(chat(`c${index}`, { updatedAt: 100 + index }));
  }
  assert.ok(warmSnapshot(store({ chats: rows }), []).chats.some((row) => row.id === "pinned"));
});

test("trims a long transcript into a first page that can still load earlier", () => {
  const entries = Array.from({ length: 90 }, (_, index) => ({ id: `e${index}`, kind: "assistant", text: `Entry ${index}` }));
  const settled = settledDetail(detail("a", { entries, history: { hasEarlier: false } }));
  assert.equal(settled.entries.length, WARM_CACHE_BOUNDS.entriesPerDetail);
  assert.equal(settled.entries.at(-1).id, "e89");
  assert.deepEqual(settled.history, { hasEarlier: true, before: settled.entries[0].id });
});

test("sheds transcripts rather than exceeding its character bound", () => {
  const kept = storage();
  const fat = (id) => detail(id, {
    entries: [{ id: `${id}-out`, kind: "tool", tool: "Bash", output: "x".repeat(90_000) }],
  });
  writeWarmCache(warmSnapshot(store({ chats: [chat("a")] }), [fat("a"), fat("b"), fat("c"), fat("d")]), kept);

  const stored = kept.getItem(WARM_CACHE_KEY);
  assert.ok(stored.length <= WARM_CACHE_BOUNDS.characters);
  const snapshot = readWarmCache(kept);
  assert.deepEqual(snapshot.details.map((row) => row.id), ["a", "b"]);
  assert.deepEqual(snapshot.chats.map((row) => row.id), ["a"]);
});

test("keeps the lists when a transcript on its own cannot fit", () => {
  const kept = storage();
  const huge = detail("a", {
    entries: [{ id: "out", kind: "tool", tool: "Bash", output: "x".repeat(WARM_CACHE_BOUNDS.characters * 2) }],
  });
  writeWarmCache(warmSnapshot(store({ chats: [chat("a")] }), [huge]), kept);

  const snapshot = readWarmCache(kept);
  assert.deepEqual(snapshot.chats.map((row) => row.id), ["a"]);
  assert.deepEqual(snapshot.details, []);
});

test("leaves nothing behind when a snapshot cannot fit with no transcripts at all", () => {
  const kept = storage();
  writeWarmCache(warmSnapshot(store({ chats: [chat("a")] }), []), kept);
  assert.ok(readWarmCache(kept));

  // A snapshot that can never be written is worse than opening cold, because
  // every launch after it would paint the same state nothing can update.
  const unwritable = warmSnapshot(
    store({ chats: [chat("a", { title: "T".repeat(WARM_CACHE_BOUNDS.characters * 2) })] }),
    [],
  );
  assert.equal(writeWarmCache(unwritable, kept), false);
  assert.equal(kept.getItem(WARM_CACHE_KEY), null);
});

test("skips a write that would store what is already stored", () => {
  const kept = storage();
  const snapshot = () => warmSnapshot(store({ chats: [chat("a")] }), [detail("a")]);
  assert.equal(writeWarmCache(snapshot(), kept), true);
  assert.equal(writeWarmCache(snapshot(), kept), false);
  assert.equal(writeWarmCache(warmSnapshot(store({ chats: [chat("a"), chat("b")] }), [detail("a")]), kept), true);
});

test("discards state written by another schema", () => {
  const kept = storage({
    [WARM_CACHE_KEY]: JSON.stringify({ version: WARM_CACHE_VERSION + 1, at: Date.now(), servers: [server], chats: [chat("a")] }),
  });
  assert.equal(readWarmCache(kept), undefined);
  assert.equal(kept.getItem(WARM_CACHE_KEY), null);
});

test("discards a snapshot that is unreadable, ageless, or too old", () => {
  const broken = storage({ [WARM_CACHE_KEY]: "{not json" });
  assert.equal(readWarmCache(broken), undefined);
  assert.equal(broken.getItem(WARM_CACHE_KEY), null);

  const kept = storage();
  writeWarmCache(warmSnapshot(store({ chats: [chat("a")] }), []), kept, () => 1_000);
  assert.ok(readWarmCache(kept, () => 1_000 + WARM_CACHE_BOUNDS.ageMs));
  assert.equal(readWarmCache(kept, () => 1_001 + WARM_CACHE_BOUNDS.ageMs), undefined);
  assert.equal(kept.getItem(WARM_CACHE_KEY), null);
});

test("drops rows that no longer have the shape they were written with", () => {
  const kept = storage({
    [WARM_CACHE_KEY]: JSON.stringify({
      version: WARM_CACHE_VERSION,
      at: Date.now(),
      servers: [server, { name: "no id" }],
      chats: [chat("a"), { id: "b" }, null],
      dms: "not a list",
      workspaces: [{ id: "w", serverId: "local", name: "W", path: "/tmp" }, { id: "gone" }],
      agents: [{ id: "a", serverId: "local", handle: "scout" }, { id: "no handle" }],
      projects: [{ id: "p", serverId: "local", keyPrefix: "REMY" }, { id: "no prefix" }],
      details: [detail("a"), { id: "b", serverId: "local" }],
    }),
  });
  const snapshot = readWarmCache(kept);
  assert.deepEqual(snapshot.servers.map((row) => row.id), ["local"]);
  assert.deepEqual(snapshot.chats.map((row) => row.id), ["a"]);
  assert.deepEqual(snapshot.dms, []);
  assert.deepEqual(snapshot.workspaces.map((row) => row.id), ["w"]);
  assert.deepEqual(snapshot.agents.map((row) => row.id), ["a"]);
  assert.deepEqual(snapshot.projects.map((row) => row.id), ["p"]);
  assert.deepEqual(snapshot.details.map((row) => row.id), ["a"]);
});

test("applies the same bounds reading as writing", () => {
  const many = (count, prefix) => Array.from({ length: count }, (_, index) => chat(`${prefix}${index}`, { updatedAt: index }));
  const kept = storage({
    [WARM_CACHE_KEY]: JSON.stringify({
      version: WARM_CACHE_VERSION,
      at: Date.now(),
      servers: [server],
      chats: many(400, "c"),
      dms: many(400, "d"),
      workspaces: [],
      agents: [],
      projects: [],
      details: Array.from({ length: 12 }, (_, index) => detail(`t${index}`)),
    }),
  });
  const snapshot = readWarmCache(kept);
  assert.equal(snapshot.chats.length, WARM_CACHE_BOUNDS.chats);
  assert.equal(snapshot.dms.length, WARM_CACHE_BOUNDS.dms);
  assert.equal(snapshot.details.length, WARM_CACHE_BOUNDS.details);
});

test("discards a stored value larger than the character bound without parsing it", () => {
  const kept = storage({ [WARM_CACHE_KEY]: "x".repeat(WARM_CACHE_BOUNDS.characters + 1) });
  assert.equal(readWarmCache(kept), undefined);
  assert.equal(kept.getItem(WARM_CACHE_KEY), null);
});

test("opens cold rather than showing rows no device can be attributed to", () => {
  const kept = storage({
    [WARM_CACHE_KEY]: JSON.stringify({ version: WARM_CACHE_VERSION, at: Date.now(), servers: [], chats: [chat("a")] }),
  });
  assert.equal(readWarmCache(kept), undefined);
});

test("works through storage that is missing or refuses to answer", () => {
  assert.equal(readWarmCache(undefined), undefined);
  assert.equal(writeWarmCache(warmSnapshot(store(), []), undefined), false);

  const refuses = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("over quota"); },
    removeItem() {},
  };
  assert.equal(readWarmCache(refuses), undefined);
  assert.equal(writeWarmCache(warmSnapshot(store({ chats: [chat("a")] }), []), refuses), false);
});
