import { randomUUID } from "node:crypto";
import { getAgent } from "./agents.js";
import { append, applyFields, deviceId, entityIds, eventsFor, type LogEvent } from "./board-log.js";
import { db, runTransaction } from "./db.js";

export type Cadence = "daily" | "weekdays" | "weekly" | "monthly";

export const CADENCES: Cadence[] = ["daily", "weekdays", "weekly", "monthly"];

export interface Routine {
  id: string;
  agentId: string;
  name: string;
  prompt: string;
  cadence: Cadence;
  hour: number;
  minute: number;
  weekday?: number;
  day?: number;
  enabled: boolean;
  /// The machine that owns the clock. It may dispatch the run to another
  /// device according to the preference order at the moment the routine fires.
  schedulerDeviceId: string;
  runs: number;
  lastRunAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RoutineView extends Routine {
  nextRunAt: number;
}

const EDITABLE = [
  "name",
  "prompt",
  "cadence",
  "hour",
  "minute",
  "weekday",
  "day",
  "enabled",
  "schedulerDeviceId",
] as const;

type Schedule = Pick<Routine, "cadence" | "hour" | "minute" | "weekday" | "day">;

function due(schedule: Schedule, candidate: Date): boolean {
  if (schedule.cadence === "daily") return true;
  if (schedule.cadence === "weekdays") {
    const day = candidate.getDay();
    return day >= 1 && day <= 5;
  }
  if (schedule.cadence === "weekly") return candidate.getDay() === (schedule.weekday ?? 1);
  return candidate.getDate() === (schedule.day ?? 1);
}

export function nextRun(schedule: Schedule, after: number): number {
  const from = new Date(after);
  const candidate = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate(),
    schedule.hour,
    schedule.minute,
    0,
    0,
  );
  for (let step = 0; step < 400; step += 1) {
    if (candidate.getTime() > after && due(schedule, candidate)) return candidate.getTime();
    candidate.setDate(candidate.getDate() + 1);
  }
  throw new Error("could not work out when that comes round again");
}

function cadence(value: unknown, fallback: Cadence = "weekly"): Cadence {
  return CADENCES.includes(value as Cadence) ? (value as Cadence) : fallback;
}

function fold(id: string, events: LogEvent[]): Routine | undefined {
  let routine: Routine | undefined;
  for (const event of events) {
    if (event.kind === "tombstone") return undefined;
    if (event.kind === "create") {
      // Recurring-ticket events from older builds have a project id and no
      // routine marker. They remain in the log for convergence but never turn
      // into agent routines by accident.
      if (event.payload.type !== "routine") return undefined;
      routine = {
        id,
        agentId: String(event.payload.agentId ?? ""),
        name: String(event.payload.name ?? "Routine"),
        prompt: String(event.payload.prompt ?? ""),
        cadence: cadence(event.payload.cadence),
        hour: Number(event.payload.hour ?? 9),
        minute: Number(event.payload.minute ?? 0),
        enabled: event.payload.enabled !== false,
        schedulerDeviceId: String(event.payload.schedulerDeviceId ?? event.deviceId),
        runs: 0,
        createdAt: event.at,
        updatedAt: event.at,
      };
      routine = applyFields(routine, event.payload, EDITABLE);
      routine.cadence = cadence(routine.cadence);
      continue;
    }
    if (!routine) continue;
    if (event.kind === "field") {
      routine = { ...applyFields(routine, event.payload, EDITABLE), updatedAt: event.at };
      routine.cadence = cadence(routine.cadence);
      continue;
    }
    if (event.kind === "ran") {
      const failed = typeof event.payload.error === "string" ? event.payload.error : undefined;
      routine = {
        ...routine,
        runs: routine.runs + (failed ? 0 : 1),
        lastRunAt: event.at,
        ...(failed ? { lastError: failed } : {}),
        updatedAt: event.at,
      };
      if (!failed) delete routine.lastError;
    }
  }
  return routine;
}

function nextRunFor(routine: Routine): number {
  return nextRun(routine, routine.lastRunAt ?? routine.createdAt);
}

export function reproject(id: string): RoutineView | undefined {
  const events = eventsFor("recurrence", id);
  const routine = events.length ? fold(id, events) : undefined;
  if (!routine) {
    // A tombstoned routine must disappear on peers too. Older recurring-ticket
    // events are not ours to alter, so only rows carrying the routine marker
    // are retired here.
    if (events.some((event) => event.kind === "create" && event.payload.type === "routine")) {
      db.prepare("update recurrences set deleted = 1 where id = ?").run(id);
    }
    return undefined;
  }
  db.prepare(
    `insert into recurrences (
       id, project_id, title, body, assignee_agent_id, cadence, hour, minute,
       weekday, day, enabled, device_id, runs, last_run_at, last_error,
       created_at, updated_at, deleted
     ) values (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     on conflict(id) do update set
       project_id = '', title = excluded.title, body = excluded.body,
       assignee_agent_id = excluded.assignee_agent_id, cadence = excluded.cadence,
       hour = excluded.hour, minute = excluded.minute, weekday = excluded.weekday,
       day = excluded.day, enabled = excluded.enabled, device_id = excluded.device_id,
       runs = excluded.runs, last_run_at = excluded.last_run_at,
       last_error = excluded.last_error, updated_at = excluded.updated_at, deleted = 0`,
  ).run(
    routine.id,
    routine.name,
    routine.prompt,
    routine.agentId,
    routine.cadence,
    routine.hour,
    routine.minute,
    routine.weekday ?? null,
    routine.day ?? null,
    routine.enabled ? 1 : 0,
    routine.schedulerDeviceId,
    routine.runs,
    routine.lastRunAt ?? null,
    routine.lastError ?? null,
    routine.createdAt,
    routine.updatedAt,
  );
  return { ...routine, nextRunAt: nextRunFor(routine) };
}

export function reprojectAll(): void {
  runTransaction(() => {
    for (const id of entityIds("recurrence")) reproject(id);
  });
}

function toRoutine(row: Record<string, unknown>): RoutineView {
  const routine: Routine = {
    id: String(row.id),
    agentId: String(row.assignee_agent_id),
    name: String(row.title),
    prompt: String(row.body ?? ""),
    cadence: cadence(row.cadence),
    hour: Number(row.hour ?? 9),
    minute: Number(row.minute ?? 0),
    ...(row.weekday === null || row.weekday === undefined ? {} : { weekday: Number(row.weekday) }),
    ...(row.day === null || row.day === undefined ? {} : { day: Number(row.day) }),
    enabled: Number(row.enabled) === 1,
    schedulerDeviceId: String(row.device_id),
    runs: Number(row.runs ?? 0),
    ...(row.last_run_at ? { lastRunAt: Number(row.last_run_at) } : {}),
    ...(row.last_error ? { lastError: String(row.last_error) } : {}),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
  return { ...routine, nextRunAt: nextRunFor(routine) };
}

export function listRoutines(agentId?: string): RoutineView[] {
  const rows = (
    agentId
      ? db.prepare("select * from recurrences where deleted = 0 and project_id = '' and assignee_agent_id = ? order by created_at asc").all(agentId)
      : db.prepare("select * from recurrences where deleted = 0 and project_id = '' order by created_at asc").all()
  ) as Record<string, unknown>[];
  return rows.map(toRoutine).sort((a, b) => a.nextRunAt - b.nextRunAt);
}

export function getRoutine(id: string): RoutineView | undefined {
  const row = db.prepare("select * from recurrences where id = ? and deleted = 0 and project_id = ''").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? toRoutine(row) : undefined;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function bounded(value: unknown, low: number, high: number, fallback: number): number {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, low), high);
}

function validate(input: Record<string, unknown>, existing?: Routine): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = text(input.name, 200);
    if (!name) throw new Error("a routine needs a name");
    patch.name = name;
  }
  if (input.prompt !== undefined) {
    const prompt = text(input.prompt, 20_000);
    if (!prompt) throw new Error("a routine needs something to do");
    patch.prompt = prompt;
  }
  if (input.cadence !== undefined) {
    if (!CADENCES.includes(input.cadence as Cadence)) throw new Error("pick how often this routine runs");
    patch.cadence = input.cadence;
  }
  if (input.hour !== undefined) patch.hour = bounded(input.hour, 0, 23, existing?.hour ?? 9);
  if (input.minute !== undefined) patch.minute = bounded(input.minute, 0, 59, existing?.minute ?? 0);
  if (input.weekday !== undefined) patch.weekday = bounded(input.weekday, 0, 6, existing?.weekday ?? 1);
  if (input.day !== undefined) patch.day = bounded(input.day, 1, 28, existing?.day ?? 1);
  if (input.enabled !== undefined) patch.enabled = input.enabled !== false;
  if (input.schedulerDeviceId !== undefined) patch.schedulerDeviceId = text(input.schedulerDeviceId, 128) ?? "";
  return patch;
}

export function createRoutine(input: Record<string, unknown>): RoutineView {
  const agentId = text(input.agentId, 64);
  if (!agentId || !getAgent(agentId)) throw new Error("pick an agent for this routine");
  const patch = validate(input);
  if (!patch.name) throw new Error("a routine needs a name");
  if (!patch.prompt) throw new Error("a routine needs something to do");
  const id = randomUUID();
  append("recurrence", id, "create", {
    type: "routine",
    agentId,
    cadence: "weekly",
    hour: 9,
    minute: 0,
    weekday: 1,
    day: 1,
    enabled: true,
    schedulerDeviceId: deviceId,
    ...patch,
  });
  return getOrThrow(id);
}

function getOrThrow(id: string): RoutineView {
  reproject(id);
  const routine = getRoutine(id);
  if (!routine) throw new Error("no such routine");
  return routine;
}

export function updateRoutine(id: string, input: Record<string, unknown>): RoutineView {
  const existing = getRoutine(id);
  if (!existing) throw new Error("no such routine");
  const patch = validate(input, existing);
  if (Object.keys(patch).length === 0) return existing;
  append("recurrence", id, "field", patch);
  return getOrThrow(id);
}

export function deleteRoutine(id: string): void {
  if (!getRoutine(id)) throw new Error("no such routine");
  append("recurrence", id, "tombstone", {});
  db.prepare("update recurrences set deleted = 1 where id = ?").run(id);
}

export function recordRoutineRun(id: string, error?: string): RoutineView {
  if (!getRoutine(id)) throw new Error("no such routine");
  append("recurrence", id, "ran", error ? { error, actor: "remy" } : { actor: "remy" });
  return getOrThrow(id);
}

export function dueRoutines(now = Date.now(), localDeviceId = deviceId): RoutineView[] {
  return listRoutines().filter((routine) =>
    routine.enabled
    && routine.schedulerDeviceId === localDeviceId
    && routine.nextRunAt <= now);
}
