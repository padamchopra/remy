import assert from "node:assert/strict";
import test from "node:test";

import type { BoardActor, BoardLogEvent } from "@remy/contract";

import { OrganizationBoard, type BoardStorage } from "./organization-board.js";

class MemoryBoardStorage implements BoardStorage {
  constructor(private values = new Map<string, unknown>()) {}
  async get<T>(key: string) { return this.values.get(key) as T | undefined; }
  async put<T>(key: string, value: T) { this.values.set(key, structuredClone(value)); }
  async delete(key: string) { return this.values.delete(key); }
  async list<T>({ prefix }: { prefix: string }) {
    return new Map([...this.values.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value) as T]));
  }
  async transaction<T>(closure: (storage: BoardStorage) => Promise<T>) {
    const copy = new MemoryBoardStorage(new Map(structuredClone([...this.values.entries()])));
    const result = await closure(copy);
    this.values = copy.values;
    return result;
  }
}

const member = (id: string): BoardActor => ({ kind: "member", id, label: id === "ada" ? "Ada" : "Grace" });

function board(device: string, storage = new MemoryBoardStorage(), now = () => 1) {
  let next = 0;
  return new OrganizationBoard(storage, { id: () => next++ === 0 ? device : `${device}-event-${next}`, now });
}

test("two writers converge on the same ticket in total log order", async () => {
  const first = board("device-a");
  const second = board("device-b");
  const created = await first.append({ entity: "ticket", entityId: "ticket-1", kind: "create", payload: { title: "Original", status: "todo" } }, member("ada"));
  await second.mergeRemote([created.event]);

  const fromFirst = await first.append({ entity: "ticket", entityId: "ticket-1", kind: "field", payload: { title: "From Ada" } }, member("ada"));
  const fromSecond = await second.append({ entity: "ticket", entityId: "ticket-1", kind: "field", payload: { title: "From Grace" } }, member("grace"));
  await first.mergeRemote([fromSecond.event]);
  await second.mergeRemote([fromFirst.event]);

  assert.deepEqual(await first.detail("tickets", "ticket-1"), await second.detail("tickets", "ticket-1"));
  assert.equal((await first.detail("tickets", "ticket-1"))?.fields.title, "From Grace");
  assert.deepEqual(await first.versionVector(), await second.versionVector());
});

test("a reconnect replays retained frames without duplicates", async () => {
  let now = 1;
  const current = board("device-a", new MemoryBoardStorage(), () => now);
  const created = await current.append({ entity: "ticket", entityId: "ticket-1", kind: "create", payload: { title: "Original" } }, member("ada"));
  now += 60_000;
  const changed = await current.append({ entity: "ticket", entityId: "ticket-1", kind: "field", payload: { title: "After reconnect" } }, member("grace"));

  const replay = await current.liveFramesAfter(created.cursor);
  assert.deepEqual(replay.frames, [{ kind: "event", cursor: changed.cursor, event: changed.event }]);
  assert.deepEqual((await current.liveFramesAfter(changed.cursor)).frames, []);
});

test("a cursor outside retained live history receives a reset", async () => {
  const current = board("device-a");
  for (let index = 0; index < 513; index += 1) {
    await current.append({ entity: "ticket", entityId: `ticket-${index}`, kind: "create", payload: { title: String(index) } }, member("ada"));
  }

  assert.deepEqual((await current.liveFramesAfter(0)).frames, [{ kind: "reset", cursor: 513, reason: "cursor_unavailable" }]);
});

test("a late third writer remains visible through the version vector", async () => {
  const first = board("device-a");
  const third = board("device-c");
  const created = await first.append({ entity: "ticket", entityId: "ticket-1", kind: "create", payload: { title: "Original" } }, member("ada"));
  await third.mergeRemote([created.event]);
  const fromThird = await third.append({ entity: "ticket", entityId: "ticket-1", kind: "field", payload: { priority: 1 } }, member("grace"));
  await first.append({ entity: "ticket", entityId: "ticket-1", kind: "field", payload: { status: "in_progress" } }, member("ada"));

  const beforeMerge = await first.versionVector();
  await first.mergeRemote([fromThird.event]);
  assert.deepEqual((await first.eventsSince(beforeMerge)).map((event) => event.id), [fromThird.event.id]);
  assert.equal((await first.detail("tickets", "ticket-1"))?.fields.priority, 1);
});

test("reprojects every hub board entity and keeps actor attribution", async () => {
  const current = board("hub");
  const inputs: Array<["ticket" | "agent" | "memory" | "recurrence", string, Record<string, unknown>]> = [
    ["ticket", "ticket-1", { title: "Ticket" }],
    ["agent", "agent-1", { name: "Builder" }],
    ["memory", "memory-1", { agentId: "agent-1", content: "Remember" }],
    ["recurrence", "routine-1", { type: "routine", name: "Digest" }],
  ];
  const events: BoardLogEvent[] = [];
  for (const [entity, entityId, payload] of inputs) {
    events.push((await current.append({ entity, entityId, kind: "create", payload }, member("ada"))).event);
  }

  assert.equal((await current.list("tickets")).items.length, 1);
  assert.equal((await current.list("agents")).items.length, 1);
  assert.equal((await current.list("memories")).items.length, 1);
  assert.equal((await current.list("routines")).items.length, 1);
  assert.equal((await current.detail("tickets", "ticket-1"))?.lastActor.label, "Ada");
  assert.equal((await current.detail("tickets", "ticket-1"))?.activity[0]?.eventId, events[0]?.id);
});

test("merge ignores malformed and duplicate events", async () => {
  const source = board("device-a");
  const target = board("device-b");
  const event = (await source.append({ entity: "ticket", entityId: "ticket-1", kind: "create", payload: { title: "Original" } }, member("ada"))).event;

  assert.equal((await target.mergeRemote([event, { ...event, actor: undefined }, event])).landed, 1);
  assert.equal((await target.eventsSince({})).length, 1);
});

test("keeps project events mergeable and legacy recurrences out of routine projections", async () => {
  const source = board("device-a");
  const target = board("device-b");
  const project = await source.append({ entity: "project", entityId: "project-1", kind: "create", payload: { name: "Remy" } }, member("ada"));
  const legacy = await source.append({ entity: "recurrence", entityId: "legacy-1", kind: "create", payload: { projectId: "project-1", title: "Old schedule" } }, member("ada"));

  assert.equal((await target.mergeRemote([project.event, legacy.event])).landed, 2);
  assert.deepEqual((await target.eventsSince({})).map((event) => event.entity), ["project", "recurrence"]);
  assert.deepEqual((await target.list("routines")).items, []);
});
