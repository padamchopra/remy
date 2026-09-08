import {
  hubRoutineSchema,
  type HubRoutine,
  type BoardProjection,
} from "@remy/contract";
import type { OrganizationBoard, BoardStorage } from "./organization-board.js";
export function nextRoutineAt(schedule: HubRoutine, after: number): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = (at: number) =>
    Object.fromEntries(
      formatter
        .formatToParts(new Date(at))
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, Number(p.value)]),
    );
  const local = parts(after),
    start = Date.UTC(local.year!, local.month! - 1, local.day!);
  for (let offset = 0; offset < 64; offset++) {
    const day = new Date(start + offset * 86400000),
      weekday = day.getUTCDay();
    if (
      (schedule.cadence === "weekdays" && (weekday === 0 || weekday === 6)) ||
      (schedule.cadence === "weekly" && weekday !== schedule.weekday) ||
      (schedule.cadence === "monthly" && day.getUTCDate() !== schedule.day)
    )
      continue;
    const desired =
      start +
      offset * 86400000 +
      schedule.hour * 3600000 +
      schedule.minute * 60000;
    let candidate = desired;
    for (let n = 0; n < 3; n++) {
      const p = parts(candidate),
        actual = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!);
      candidate += desired - actual;
    }
    const p = parts(candidate);
    if (
      candidate > after &&
      p.hour === schedule.hour &&
      p.minute === schedule.minute &&
      p.day === day.getUTCDate()
    )
      return candidate;
  }
  throw Error("This routine has no upcoming time.");
}
type Clock = {
  schedule: string;
  nextAt: number;
  warmedAt?: number;
  launching?: number;
};
export class HubRoutines {
  constructor(
    private readonly board: OrganizationBoard,
    private readonly storage: BoardStorage,
    private readonly run: (
      routine: HubRoutine,
      slot: string,
    ) => Promise<unknown>,
    private readonly failed: (
      agentId: string,
      id: string,
      text: string,
    ) => Promise<void>,
    private readonly prewarm: (routine: HubRoutine) => Promise<void>,
    private readonly now = Date.now,
  ) {}
  private async clock(row: BoardProjection, routine: HubRoutine) {
    const signature = JSON.stringify(routine),
      key = `routine-clock:${row.id}`;
    let clock = await this.storage.get<Clock>(key);
    if (!clock || clock.schedule !== signature) {
      clock = {
        schedule: signature,
        nextAt: nextRoutineAt(routine, this.now()),
      };
      await this.storage.put(key, clock);
    }
    return { clock, key };
  }
  private pending?: Promise<number | undefined>;
  tick(): Promise<number | undefined> {
    if (this.pending) return this.pending;
    const task = this.advance();
    this.pending = task;
    return task.finally(() => {
      if (this.pending === task) delete this.pending;
    });
  }
  private async advance(): Promise<number | undefined> {
    let next: number | undefined;
    for (const row of (await this.board.list("routines")).items) {
      const parsed = hubRoutineSchema.safeParse(row.fields);
      if (!parsed.success || !parsed.data.enabled) {
        await this.storage.delete(`routine-clock:${row.id}`);
        continue;
      }
      const routine = parsed.data,
        { clock, key } = await this.clock(row, routine),
        now = this.now();
      if (clock.launching !== undefined) {
        await this.failed(
          routine.agentId,
          `routine-interrupted:${row.id}:${clock.launching}`,
          `${routine.name} was interrupted while starting; check its thread before trying again.`,
        );
        delete clock.launching;
        clock.nextAt = nextRoutineAt(routine, now);
        await this.storage.put(key, clock);
      }
      if (now >= clock.nextAt) {
        const at = clock.nextAt,
          slot = `${row.id}:${at}`;
        clock.launching = at;
        await this.storage.put(key, clock);
        try {
          await this.run(routine, slot);
          await this.board.append(
            {
              entity: "recurrence",
              entityId: row.id,
              kind: "ran",
              payload: {},
            },
            {
              kind: "agent",
              id: routine.agentId,
              label: row.fields.name as string,
            },
          );
        } catch {
          const error = `${routine.name} could not run because no eligible computer could start it.`;
          await this.failed(routine.agentId, `routine-failed:${slot}`, error);
          await this.board.append(
            {
              entity: "recurrence",
              entityId: row.id,
              kind: "ran",
              payload: { error },
            },
            {
              kind: "agent",
              id: routine.agentId,
              label: row.fields.name as string,
            },
          );
        }
        delete clock.launching;
        clock.nextAt = nextRoutineAt(routine, Math.max(at, this.now()));
        delete clock.warmedAt;
        await this.storage.put(key, clock);
      }
      if (
        this.now() >= clock.nextAt - 120000 &&
        clock.warmedAt !== clock.nextAt
      ) {
        clock.warmedAt = clock.nextAt;
        await this.storage.put(key, clock);
        try {
          await this.prewarm(routine);
        } catch {}
      }
      const due =
        clock.warmedAt === clock.nextAt
          ? clock.nextAt
          : Math.max(this.now() + 1, clock.nextAt - 120000);
      next = Math.min(next ?? Infinity, due);
    }
    return next;
  }
}
