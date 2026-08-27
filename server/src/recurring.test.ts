import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Every module here opens the shared database at import time, so the suite runs
// against a throwaway directory. node:test gives each file its own process, so
// this override cannot leak sideways.
const stateDir = mkdtempSync(join(tmpdir(), "mc-recurring-"));
process.env.MC_CONFIG_DIR = stateDir;

const projects = await import("./projects.js");
const recurring = await import("./recurring.js");
const tickets = await import("./tickets.js");
const agents = await import("./agents.js");

function at(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month, day, hour, minute, 0, 0).getTime();
}

// ── the clock ───────────────────────────────────────────────────────────────

test("a daily ticket is due at the next matching wall-clock time", () => {
  const schedule = { cadence: "daily" as const, hour: 9, minute: 30 };
  assert.equal(recurring.nextRun(schedule, at(2026, 6, 6, 8, 0)), at(2026, 6, 6, 9, 30));
  // Past today's time, so tomorrow.
  assert.equal(recurring.nextRun(schedule, at(2026, 6, 6, 9, 30)), at(2026, 6, 7, 9, 30));
});

test("a weekday ticket skips Saturday and Sunday", () => {
  // 3 July 2026 is a Friday.
  const friday = at(2026, 6, 3, 10, 0);
  assert.equal(
    recurring.nextRun({ cadence: "weekdays", hour: 9, minute: 0 }, friday),
    at(2026, 6, 6, 9, 0),
  );
});

test("a weekly ticket lands on the weekday it was given", () => {
  const wednesday = at(2026, 6, 8, 12, 0);
  const monday = recurring.nextRun({ cadence: "weekly", hour: 7, minute: 45, weekday: 1 }, wednesday);
  assert.equal(monday, at(2026, 6, 13, 7, 45));
  assert.equal(new Date(monday).getDay(), 1);
});

test("a monthly ticket lands on its day, in the next month once the day has gone", () => {
  const schedule = { cadence: "monthly" as const, hour: 8, minute: 0, day: 15 };
  assert.equal(recurring.nextRun(schedule, at(2026, 0, 2, 9, 0)), at(2026, 0, 15, 8, 0));
  assert.equal(recurring.nextRun(schedule, at(2026, 0, 15, 8, 0)), at(2026, 1, 15, 8, 0));
});

// ── recurrences ─────────────────────────────────────────────────────────────

test("a recurrence writes a ticket in Todo, assigned to whoever holds it", () => {
  const project = projects.createProject({ name: "Sweep" });
  const agent = agents.createAgent({ name: "Triager" });
  const recurrence = recurring.createRecurrence({
    projectId: project.id,
    title: "Triage the backlog",
    body: "Merge duplicates.",
    assigneeAgentId: agent.id,
    cadence: "weekly",
    weekday: 1,
    hour: 9,
  });

  const { ticket } = recurring.runRecurrence(recurrence.id);

  assert.equal(ticket.title, "Triage the backlog");
  assert.equal(ticket.body, "Merge duplicates.");
  assert.equal(ticket.status, "todo");
  assert.equal(ticket.assigneeAgentId, agent.id);
  // Remy wrote it, not you — which is what the ticket's own feed says.
  assert.equal(tickets.ticketActivity(ticket.id)[0].actor, "remy");

  const after = recurring.getRecurrence(recurrence.id);
  assert.equal(after?.runs, 1);
  assert.ok(after?.lastRunAt && after.lastRunAt <= Date.now());
  assert.equal(after?.lastError, undefined);
  // The next one is a week on from the run, not from when it was written.
  assert.ok(after && after.nextRunAt > Date.now());
});

test("the workspace agent may hold a recurring ticket, and an unknown agent may not", () => {
  const project = projects.createProject({ name: "Chores" });
  const recurrence = recurring.createRecurrence({
    projectId: project.id,
    title: "Update the dependencies",
    assigneeAgentId: agents.WORKSPACE_AGENT,
    cadence: "monthly",
    day: 1,
  });
  assert.equal(recurrence.assigneeAgentId, agents.WORKSPACE_AGENT);

  const { ticket } = recurring.runRecurrence(recurrence.id);
  assert.equal(ticket.assigneeAgentId, agents.WORKSPACE_AGENT);

  assert.throws(
    () => recurring.createRecurrence({ projectId: project.id, title: "Nope", assigneeAgentId: "nobody" }),
    /no such agent/,
  );
});

test("only the machine that owns a recurrence writes its tickets", () => {
  const project = projects.createProject({ name: "Elsewhere" });
  const mine = recurring.createRecurrence({
    projectId: project.id,
    title: "Mine",
    cadence: "daily",
    hour: 9,
  });
  const theirs = recurring.createRecurrence({
    projectId: project.id,
    title: "Theirs",
    cadence: "daily",
    hour: 9,
  });
  recurring.updateRecurrence(theirs.id, { deviceId: "another-machine" });

  // Far enough ahead that both are overdue. Other tests in this file left
  // recurrences of their own behind, so only these two are read back.
  const written = recurring
    .writeDueTickets(Date.now() + 40 * 24 * 60 * 60 * 1000)
    .filter((ticket) => ticket.projectId === project.id);

  assert.deepEqual(written.map((ticket) => ticket.title), ["Mine"]);
  assert.equal(recurring.getRecurrence(mine.id)?.runs, 1);
  assert.equal(recurring.getRecurrence(theirs.id)?.runs, 0);
});

test("a paused recurrence writes nothing, and one that is due writes exactly one ticket", () => {
  const project = projects.createProject({ name: "Paused" });
  const recurrence = recurring.createRecurrence({
    projectId: project.id,
    title: "Every day",
    cadence: "daily",
    hour: 9,
  });
  const week = 7 * 24 * 60 * 60 * 1000;
  const mine = (ticket: { projectId: string }) => ticket.projectId === project.id;

  recurring.updateRecurrence(recurrence.id, { enabled: false });
  assert.equal(recurring.writeDueTickets(Date.now() + week).filter(mine).length, 0);

  recurring.updateRecurrence(recurrence.id, { enabled: true });
  // A week overdue is still one ticket: the cadence runs on from the run, so a
  // machine that was asleep does not wake up and write seven.
  const written = recurring.writeDueTickets(Date.now() + week).filter(mine);
  assert.equal(written.length, 1);
  assert.equal(recurring.getRecurrence(recurrence.id)?.runs, 1);
});

test("changing the cadence moves when the next ticket is due", () => {
  const project = projects.createProject({ name: "Cadence" });
  const now = new Date();
  // Two calendar days ahead when the monthly day can hold it, otherwise the
  // second of next month. Either stays later than the same daily wall clock.
  const monthlyDay = now.getDate() <= 26 ? now.getDate() + 2 : 2;
  const recurrence = recurring.createRecurrence({
    projectId: project.id,
    title: "Read the diff",
    cadence: "monthly",
    day: monthlyDay,
    hour: now.getHours(),
    minute: now.getMinutes(),
  });
  const monthly = recurrence.nextRunAt;
  const daily = recurring.updateRecurrence(recurrence.id, { cadence: "daily" }).nextRunAt;

  assert.ok(daily < monthly, `${daily} should be sooner than ${monthly}`);
});

test("a deleted recurrence is gone and writes nothing more", () => {
  const project = projects.createProject({ name: "Gone" });
  const recurrence = recurring.createRecurrence({
    projectId: project.id,
    title: "Not for long",
    cadence: "daily",
  });
  recurring.deleteRecurrence(recurrence.id);

  assert.equal(recurring.getRecurrence(recurrence.id), undefined);
  assert.ok(!recurring.listRecurrences().some((entry) => entry.id === recurrence.id));
  assert.throws(() => recurring.runRecurrence(recurrence.id), /no such recurring ticket/);
});

test("a recurrence needs a title and a workspace that exists", () => {
  const project = projects.createProject({ name: "Guards" });
  assert.throws(() => recurring.createRecurrence({ projectId: project.id, title: "  " }), /needs a title/);
  assert.throws(() => recurring.createRecurrence({ projectId: "nope", title: "Anything" }), /pick a workspace/);
  assert.throws(
    () => recurring.createRecurrence({ projectId: project.id, title: "Anything", cadence: "fortnightly" }),
    /how often/,
  );
});

test("a time out of range is held to one that exists", () => {
  const project = projects.createProject({ name: "Bounds" });
  const recurrence = recurring.createRecurrence({
    projectId: project.id,
    title: "Bounded",
    cadence: "monthly",
    hour: 99,
    minute: -4,
    day: 31,
  });
  assert.equal(recurrence.hour, 23);
  assert.equal(recurrence.minute, 0);
  // February has to have the day too, so the month stops at 28.
  assert.equal(recurrence.day, 28);
});
