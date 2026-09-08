import test from "node:test";
import assert from "node:assert/strict";
import { OrganizationBoard, type BoardStorage } from "./organization-board.js";
import type { OrganizationStore } from "./organization-store.js";
import { seedHubAgents, ORCHESTRATOR_INSTRUCTIONS } from "./remy-agent.js";
import { BoardAccess } from "./board-access.js";
test("built-ins seed once, isolate personal Remy, preserve rename and repair instructions", async () => {
  const data = new Map<string, unknown>();
  const storage: BoardStorage = {
    get: async <T>(k: string) => structuredClone(data.get(k)) as T,
    put: async (k, v) => {
      data.set(k, structuredClone(v));
    },
    delete: async (k) => data.delete(k),
    list: async <T>({ prefix }: { prefix: string }) =>
      new Map([...data].filter(([k]) => k.startsWith(prefix))) as Map<
        string,
        T
      >,
    transaction: async (fn) => fn(storage),
  };
  const store = {
    organization: async () => ({ name: "Studio" }),
    members: async () => [
      { id: "m-ada", userId: "ada" },
      { id: "m-grace", userId: "grace" },
    ],
    membership: async (_o: string, u: string) => ({
      role: u === "ada" ? "owner" : "member",
    }),
  } as unknown as OrganizationStore;
  const board = new OrganizationBoard(storage);
  await seedHubAgents(board, store, "org");
  assert.equal((await board.list("agents")).items.length, 3);
  const before = await board.versionVector();
  await seedHubAgents(board, store, "org");
  assert.deepEqual(await board.versionVector(), before);
  const ada = new BoardAccess(store, board, "org", "ada"),
    grace = new BoardAccess(store, board, "org", "grace");
  assert.equal(
    await ada.canRead((await board.detail("agents", "remy:m-grace"))!),
    false,
  );
  const input = {
    entity: "agent" as const,
    entityId: "orchestrator:org",
    kind: "field" as const,
    payload: { name: "Studio coordinator" },
  };
  assert.ok(await ada.canWrite(input));
  assert.equal(await grace.canWrite(input), false);
  assert.equal(
    await ada.canWrite({ ...input, payload: { instructions: "Override" } }),
    false,
  );
  assert.equal(
    await ada.canWrite({ ...input, kind: "tombstone", payload: {} }),
    false,
  );
  await board.append(
    {
      ...input,
      payload: { name: "Studio coordinator", instructions: "old release" },
    },
    { kind: "agent", id: "remy", label: "Remy" },
  );
  await seedHubAgents(board, store, "org");
  const current = await board.detail("agents", "orchestrator:org");
  assert.equal(current?.fields.name, "Studio coordinator");
  assert.equal(current?.fields.instructions, ORCHESTRATOR_INSTRUCTIONS);
});
