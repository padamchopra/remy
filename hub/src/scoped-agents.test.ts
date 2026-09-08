import test from "node:test";
import assert from "node:assert/strict";
import { OrganizationBoard, type BoardStorage } from "./organization-board.js";
import type { OrganizationStore } from "./organization-store.js";
import { BoardAccess } from "./board-access.js";
import { ScopedAgents } from "./scoped-agents.js";
function fixture() {
  const values = new Map<string, unknown>();
  const storage: BoardStorage = {
    get: async <T>(k: string) => structuredClone(values.get(k)) as T,
    put: async (k, v) => {
      values.set(k, structuredClone(v));
    },
    delete: async (k) => values.delete(k),
    list: async <T>({ prefix }: { prefix: string }) =>
      new Map([...values].filter(([k]) => k.startsWith(prefix))) as Map<
        string,
        T
      >,
    transaction: async (fn) => fn(storage),
  };
  const members = new Set(["ada", "grace"]);
  const store = {
    membership: async (_o: string, u: string) =>
      members.has(u) ? { role: u === "ada" ? "owner" : "member" } : undefined,
    teamMembers: async () => ["ada"],
    team: async () => ({ id: "mobile" }),
    workspace: async () => undefined,
  } as unknown as OrganizationStore;
  const board = new OrganizationBoard(storage);
  const agents = new ScopedAgents(board, storage, store, "org");
  const actor = { kind: "member" as const, id: "ada", label: "Ada" };
  return { board, agents, storage, store, members, actor };
}
test("outsiders cannot list, read, message, remember or assign another team's agent", async () => {
  const { board, agents, store, actor } = fixture();
  await board.append(
    {
      entity: "agent",
      entityId: "private",
      kind: "create",
      payload: { name: "Release", scope: "team", ownerId: "mobile" },
    },
    actor,
  );
  assert.equal((await agents.visible("grace")).length, 0);
  await assert.rejects(agents.message("private", "grace", "hello", "one"));
  const access = new BoardAccess(store, board, "org", "grace");
  assert.equal(
    await access.canWrite({
      entity: "memory",
      entityId: "m",
      kind: "create",
      payload: { agentId: "private", content: "secret" },
    }),
    false,
  );
  assert.equal(
    await access.canWrite({
      entity: "ticket",
      entityId: "t",
      kind: "create",
      payload: { assigneeAgentId: "private" },
    }),
    false,
  );
});
test("promotion carries conversation and memory IDs, and deletion removes them for everyone", async () => {
  const { board, agents, store, actor } = fixture();
  await board.append(
    {
      entity: "agent",
      entityId: "a",
      kind: "create",
      payload: { name: "Release", scope: "personal", ownerId: "ada" },
    },
    actor,
  );
  await agents.message("a", "ada", "Remember the release", "message");
  await board.append(
    {
      entity: "memory",
      entityId: "m",
      kind: "create",
      payload: { agentId: "a", content: "Friday release" },
    },
    actor,
  );
  const access = new BoardAccess(store, board, "org", "ada");
  assert.ok(
    await access.canWrite({
      entity: "agent",
      entityId: "a",
      kind: "field",
      payload: { scope: "team", ownerId: "mobile" },
    }),
  );
  await board.append(
    {
      entity: "agent",
      entityId: "a",
      kind: "field",
      payload: { scope: "team", ownerId: "mobile" },
    },
    actor,
  );
  await board.append(
    {
      entity: "agent",
      entityId: "a",
      kind: "field",
      payload: { scope: "org", ownerId: "org" },
    },
    actor,
  );
  assert.equal((await agents.conversation("a", "grace"))[0]?.id, "message");
  assert.equal((await board.detail("memories", "m"))?.fields.agentId, "a");
  assert.equal((await board.detail("agents", "a"))?.activity.length, 3);
  await agents.remove("a", actor);
  assert.equal(await board.detail("memories", "m"), undefined);
  await assert.rejects(agents.conversation("a", "grace"));
});
test("departure deletes personal agents while retaining team conversations and export excludes agents", async () => {
  const { board, agents, members, actor } = fixture();
  for (const [id, scope, ownerId] of [
    ["personal", "personal", "ada"],
    ["team", "team", "mobile"],
  ]) {
    await board.append(
      {
        entity: "agent",
        entityId: id!,
        kind: "create",
        payload: { scope, ownerId },
      },
      actor,
    );
    await agents.message(id!, "ada", "Keep this context", id!);
  }
  members.delete("ada");
  await agents.departures();
  assert.equal(await board.detail("agents", "personal"), undefined);
  assert.ok(await board.detail("agents", "team"));
  assert.deepEqual(await board.eventsSince({}, 500, true), []);
});
