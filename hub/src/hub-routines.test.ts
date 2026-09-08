import test from "node:test";
import assert from "node:assert/strict";
import { hubRoutineSchema } from "@remy/contract";
import { OrganizationBoard, type BoardStorage } from "./organization-board.js";
import { HubRoutines, nextRoutineAt } from "./hub-routines.js";
const routine = hubRoutineSchema.parse({
  name: "Release review",
  prompt: "Review the release",
  projectId: "w",
  agentId: "a",
  runAsUserId: "ada",
  cadence: "daily",
  hour: 9,
  minute: 0,
  timeZone: "UTC",
});
function fixture() {
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
  return { storage, board: new OrganizationBoard(storage) };
}
test("09:00 is owned by the hub, prewarms once and fires once across retries and reconstruction", async () => {
  const { storage, board } = fixture();
  let now = Date.parse("2026-09-09T08:58:00Z"),
    starts = 0,
    warms = 0;
  await board.append(
    {
      entity: "recurrence",
      entityId: "r",
      kind: "create",
      payload: { ...routine, type: "routine" },
    },
    { kind: "member", id: "ada", label: "Ada" },
  );
  const build = () =>
    new HubRoutines(
      board,
      storage,
      async (r) => {
        assert.equal(r.runAsUserId, "ada");
        starts++;
      },
      async () => assert.fail("unexpected failure"),
      async () => {
        warms++;
      },
      () => now,
    );
  const service = build();
  assert.equal(await service.tick(), Date.parse("2026-09-09T09:00:00Z"));
  assert.equal(warms, 1);
  assert.equal(starts, 0);
  now += 120000;
  await Promise.all([service.tick(), service.tick()]);
  assert.equal(starts, 1);
  await build().tick();
  assert.equal(starts, 1);
  assert.equal((await board.detail("routines", "r"))?.fields.runs, 1);
});
test("no eligible computer leaves a visible failure and does not replay missed work repeatedly", async () => {
  const { storage, board } = fixture();
  let now = Date.parse("2026-09-09T08:59:00Z");
  const messages: string[] = [];
  await board.append(
    {
      entity: "recurrence",
      entityId: "r",
      kind: "create",
      payload: { ...routine, type: "routine" },
    },
    { kind: "member", id: "ada", label: "Ada" },
  );
  const service = new HubRoutines(
    board,
    storage,
    async () => {
      throw Error("no eligible computer");
    },
    async (_a, _id, text) => {
      messages.push(text);
    },
    async () => {},
    () => now,
  );
  await service.tick();
  now += 120000;
  await service.tick();
  await service.tick();
  assert.equal(messages.length, 1);
  assert.match(messages[0]!, /no eligible computer/);
  assert.ok((await board.detail("routines", "r"))?.fields.lastError);
});
test("time zones, daylight saving and missing month days preserve wall-clock schedules", () => {
  assert.equal(
    new Date(
      nextRoutineAt(
        { ...routine, timeZone: "Asia/Kolkata" },
        Date.parse("2026-09-09T00:00:00Z"),
      ),
    ).toISOString(),
    "2026-09-09T03:30:00.000Z",
  );
  assert.equal(
    new Date(
      nextRoutineAt(
        { ...routine, timeZone: "America/Los_Angeles" },
        Date.parse("2026-03-07T18:00:00Z"),
      ),
    ).toISOString(),
    "2026-03-08T16:00:00.000Z",
  );
  assert.equal(
    new Date(
      nextRoutineAt(
        { ...routine, cadence: "monthly", day: 31 },
        Date.parse("2026-01-31T10:00:00Z"),
      ),
    ).toISOString(),
    "2026-03-31T09:00:00.000Z",
  );
});
