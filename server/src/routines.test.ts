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
      return "sent";
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

test("an interval lands on the grid and ignores the time of day", () => {
  assert.equal(
    routines.nextRun({ cadence: "interval", hour: 9, minute: 41, everyMinutes: 15 }, at(2026, 6, 6, 10, 7)),
    at(2026, 6, 6, 10, 15),
  );
  assert.equal(
    routines.nextRun({ cadence: "interval", hour: 9, minute: 41, everyMinutes: 30 }, at(2026, 6, 6, 10, 7)),
    at(2026, 6, 6, 10, 30),
  );
  assert.equal(
    routines.nextRun({ cadence: "interval", hour: 9, minute: 41, everyMinutes: 60 }, at(2026, 6, 6, 10, 7)),
    at(2026, 6, 6, 11, 0),
  );
});

test("a boundary the routine has already reached is not the next one", () => {
  assert.equal(
    routines.nextRun({ cadence: "interval", hour: 9, minute: 0, everyMinutes: 15 }, at(2026, 6, 6, 10, 15)),
    at(2026, 6, 6, 10, 30),
  );
});

test("an interval shorter than the tick is clamped rather than believed", () => {
  const agent = agents.createAgent({ name: "Eager" });
  const routine = routines.createRoutine({
    agentId: agent.id,
    name: "Poll",
    prompt: "Check.",
    cadence: "interval",
    everyMinutes: 1,
  });
  assert.equal(routine.everyMinutes, routines.MIN_INTERVAL_MINUTES);
  // Nonsense keeps what the routine already had rather than resetting it.
  assert.equal(routines.updateRoutine(routine.id, { everyMinutes: "nonsense" }).everyMinutes, 5);
  assert.equal(routines.updateRoutine(routine.id, { everyMinutes: 9000 }).everyMinutes, 1440);
});

test("an unknown cadence is refused at the door", () => {
  const agent = agents.createAgent({ name: "Picky" });
  assert.throws(
    () => routines.createRoutine({ agentId: agent.id, name: "Nope", prompt: "Do it", cadence: "every7m" }),
    /pick how often/,
  );
});

test("an interval routine catches up once and then waits for the grid", async () => {
  const agent = agents.createAgent({ name: "Interval" });
  const routine = routines.createRoutine({
    agentId: agent.id,
    name: "Poll tickets",
    prompt: "Check my tickets.",
    cadence: "interval",
    everyMinutes: 15,
  });
  const future = Date.now() + 24 * 60 * 60 * 1000;
  assert.equal(routines.dueRoutines(future, deviceId).filter((entry) => entry.id === routine.id).length, 1);

  const ran = await runner.runRoutine(routine.id, { devices: ["local"], send: async () => "sent" });
  assert.equal(ran.runs, 1);
  assert.ok(ran.nextRunAt > Date.now());
  assert.ok(!routines.dueRoutines(Date.now(), deviceId).some((entry) => entry.id === routine.id));
});

test("a busy agent skips the run rather than landing on another device", async () => {
  const agent = agents.createAgent({ name: "Occupied" });
  const routine = routines.createRoutine({ agentId: agent.id, name: "Poll CI", prompt: "Check CI." });
  const attempts: string[] = [];

  await assert.rejects(
    () => runner.runRoutine(routine.id, {
      devices: ["first", "second"],
      send: async (_routine, target) => {
        attempts.push(target);
        return "busy";
      },
    }),
    (error: Error) => error instanceof runner.RoutineBusyError,
  );

  assert.deepEqual(attempts, ["first"]);
  const after = routines.getRoutine(routine.id);
  assert.equal(after?.runs, 0);
  assert.equal(after?.lastRunAt, undefined);
  assert.equal(after?.lastError, undefined);
});

test("a routine moves to another agent and takes its conversation with it", () => {
  const first = agents.createAgent({ name: "Manager" });
  const second = agents.createAgent({ name: "Engineer" });
  const routine = routines.createRoutine({ agentId: first.id, name: "Handover", prompt: "Do it." });

  const moved = routines.updateRoutine(routine.id, { agentId: second.id });
  assert.equal(moved.agentId, second.id);
  assert.ok(routines.listRoutines(second.id).some((entry) => entry.id === routine.id));
  assert.ok(!routines.listRoutines(first.id).some((entry) => entry.id === routine.id));
  assert.throws(() => routines.updateRoutine(routine.id, { agentId: "nobody" }), /pick an agent/);
});

test("an instruction file has to be markdown", () => {
  const agent = agents.createAgent({ name: "Filed" });
  const routine = routines.createRoutine({ agentId: agent.id, name: "From a file", prompt: "Fallback." });
  assert.throws(() => routines.updateRoutine(routine.id, { promptPath: "~/notes.txt" }), /markdown/);
  assert.equal(routines.updateRoutine(routine.id, { promptPath: "~/notes.md" }).promptPath, "~/notes.md");
  assert.equal(routines.updateRoutine(routine.id, { promptPath: "" }).promptPath, undefined);
});

test("a peer's newer cadence fails toward doing less work", async () => {
  const { append } = await import("./board-log.js");
  const agent = agents.createAgent({ name: "Ahead" });
  const routine = routines.createRoutine({ agentId: agent.id, name: "Future", prompt: "Do it." });
  append("recurrence", routine.id, "field", { cadence: "every5s" });
  assert.equal(routines.reproject(routine.id)?.cadence, "weekly");
});

test("a routine handed to an agent this machine has not merged still folds", async () => {
  const { append } = await import("./board-log.js");
  const agent = agents.createAgent({ name: "Known" });
  const routine = routines.createRoutine({ agentId: agent.id, name: "Remote handover", prompt: "Do it." });
  append("recurrence", routine.id, "field", { agentId: "agent-from-another-machine" });
  assert.equal(routines.reproject(routine.id)?.agentId, "agent-from-another-machine");
});

test("an unreadable instruction file fails the run in a sentence a person can read", async () => {
  const agent = agents.createAgent({ name: "Reader" });
  const routine = routines.createRoutine({
    agentId: agent.id,
    name: "From a missing file",
    prompt: "Fallback.",
    promptPath: "~/definitely-not-here.md",
  });

  await assert.rejects(
    () => runner.runRoutine(routine.id, { devices: ["local"], send: async () => "sent" }),
    /could not read ~\/definitely-not-here\.md/,
  );
  const after = routines.getRoutine(routine.id);
  assert.equal(after?.runs, 0);
  assert.match(after?.lastError ?? "", /could not read/);
});

test("a run says it is a routine firing, not something the person typed", () => {
  const framing = runner.routineRunContext({ name: "Check CI" });
  assert.match(framing, /<remy_routine_run>/);
  assert.match(framing, /your routine "Check CI" firing on its cadence/);
  assert.match(framing, /Nobody typed this/);
  assert.match(framing, /<\/remy_routine_run>/);
});
