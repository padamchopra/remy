import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const stateDir = mkdtempSync(join(tmpdir(), "remy-routines-"));
process.env.MC_CONFIG_DIR = stateDir;

const agents = await import("./agents.js");
const { deviceId } = await import("./board-log.js");
const routines = await import("./routines.js");
const runner = await import("./routine-runner.js");

function at(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month, day, hour, minute, 0, 0).getTime();
}

test("routine cadences use the local wall clock", () => {
  assert.equal(
    routines.nextRun({ cadence: "daily", hour: 9, minute: 30 }, at(2026, 6, 6, 8)),
    at(2026, 6, 6, 9, 30),
  );
  assert.equal(
    routines.nextRun({ cadence: "weekdays", hour: 9, minute: 0 }, at(2026, 6, 3, 10)),
    at(2026, 6, 6, 9),
  );
  assert.equal(
    routines.nextRun({ cadence: "monthly", hour: 8, minute: 0, day: 15 }, at(2026, 0, 15, 8)),
    at(2026, 1, 15, 8),
  );
});

test("a routine belongs to an agent and has no workspace or ticket", () => {
  const agent = agents.createAgent({ name: "Scout" });
  const routine = routines.createRoutine({
    agentId: agent.id,
    name: "Read release notes",
    prompt: "Read the latest release notes and tell me what matters.",
    cadence: "weekly",
    weekday: 1,
    hour: 9,
  });

  assert.equal(routine.agentId, agent.id);
  assert.equal(routine.schedulerDeviceId, deviceId);
  assert.equal(routines.listRoutines(agent.id)[0]?.id, routine.id);
  assert.throws(
    () => routines.createRoutine({ agentId: "missing", name: "Nope", prompt: "Do it" }),
    /pick an agent/,
  );
});

test("only the clock owner sees a due routine", () => {
  const agent = agents.createAgent({ name: "Owner" });
  const routine = routines.createRoutine({
    agentId: agent.id,
    name: "Daily check",
    prompt: "Check in.",
    cadence: "daily",
    hour: 0,
  });
  const future = Date.now() + 2 * 24 * 60 * 60 * 1000;
  assert.ok(routines.dueRoutines(future, deviceId).some((entry) => entry.id === routine.id));
  assert.ok(!routines.dueRoutines(future, "another-device").some((entry) => entry.id === routine.id));
});

test("a run follows preference order and falls back to the next device", async () => {
  const agent = agents.createAgent({ name: "Runner" });
  const routine = routines.createRoutine({
    agentId: agent.id,
    name: "Morning brief",
    prompt: "Prepare my brief.",
    cadence: "daily",
    hour: 9,
  });
  const attempts: string[] = [];
  const result = await runner.runRoutine(routine.id, {
    devices: ["preferred", "fallback"],
    send: async (_routine, target) => {
      attempts.push(target);
      if (target === "preferred") throw new Error("offline");
    },
  });

  assert.deepEqual(attempts, ["preferred", "fallback"]);
  assert.equal(result.runs, 1);
  assert.equal(result.lastError, undefined);
});

test("device ordering keeps available preferences first and local as fallback", () => {
  assert.deepEqual(
    runner.orderedRoutineDevices(["peer-2", "offline", "peer-1"], ["local", "peer-1", "peer-2"], "local"),
    ["peer-2", "peer-1", "local"],
  );
});

test("old recurring-ticket events are not routines", async () => {
  const { append } = await import("./board-log.js");
  append("recurrence", "old-recurring-ticket", "create", {
    projectId: "workspace",
    title: "Old ticket",
    cadence: "daily",
    hour: 9,
  });
  assert.equal(routines.reproject("old-recurring-ticket"), undefined);
  assert.ok(!routines.listRoutines().some((entry) => entry.id === "old-recurring-ticket"));
});

test("a deleted routine stays deleted when a peer replays it", async () => {
  const agent = agents.createAgent({ name: "Disposable" });
  const routine = routines.createRoutine({
    agentId: agent.id,
    name: "Temporary",
    prompt: "Do this once more.",
  });
  routines.deleteRoutine(routine.id);
  const { db } = await import("./db.js");
  db.prepare("update recurrences set deleted = 0 where id = ?").run(routine.id);
  assert.equal(routines.reproject(routine.id), undefined);
  assert.equal(routines.getRoutine(routine.id), undefined);
});

test("peer edits and run results converge without counting one trigger twice", async () => {
  const agent = agents.createAgent({ name: "Paired runner" });
  const routine = routines.createRoutine({
    agentId: agent.id,
    name: "Original name",
    prompt: "Check once.",
  });
  const log = await import("./board-log.js");
  const high = Math.max(...Object.values(log.versionVector()));
  const edit = {
    id: "peer-routine-edit",
    deviceId: "paired-device",
    lamport: high + 1,
    at: Date.now() + 1,
    entity: "recurrence",
    entityId: routine.id,
    kind: "field",
    payload: { name: "Shared name", enabled: false },
  } as const;
  const ran = {
    ...edit,
    id: "peer-routine-run",
    lamport: high + 2,
    at: edit.at + 1,
    kind: "ran",
    payload: { actor: "remy" },
  } as const;

  assert.equal(log.mergeRemote([edit, ran]), 2);
  assert.equal(log.mergeRemote([edit, ran]), 0);
  const converged = routines.reproject(routine.id);
  assert.equal(converged?.name, "Shared name");
  assert.equal(converged?.enabled, false);
  assert.equal(converged?.lastRunAt, ran.at);
  assert.equal(converged?.runs, 1);
});
