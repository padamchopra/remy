import { randomUUID } from "node:crypto";
import {
  boardAppendInputSchema,
  boardLogEventSchema,
  foldBoardEvents,
  type BoardLogEvent,
  type BoardProjectionEntity,
  type BoardVersionVector,
} from "@remy/contract";
import { db, getKv, runTransaction, setKv } from "./db.js";
import {
  deviceId,
  eventsSince,
  onLocalAppend,
  onRemoteMerge,
  type LogEvent,
} from "./board-log.js";
import { broadcast } from "./notify.js";

db.exec(`CREATE TABLE IF NOT EXISTS hub_board_events (organization_id TEXT NOT NULL,id TEXT NOT NULL,device_id TEXT NOT NULL,lamport INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(organization_id,id));
CREATE TABLE IF NOT EXISTS hub_board_imports (organization_id TEXT NOT NULL,entity TEXT NOT NULL,entity_id TEXT NOT NULL,PRIMARY KEY(organization_id,entity,entity_id));`);

const key = (org: string) => `hubBoard:${org}`;
type State = {
  enabled: boolean;
  imported: boolean;
  lastSyncAt?: number;
  error?: string;
};
export function hubBoardState(org: string): State {
  return getKv<State>(key(org)) ?? { enabled: false, imported: false };
}
export function configureHubBoard(org: string, enabled: boolean) {
  setKv(key(org), { ...hubBoardState(org), enabled });
}
function all(org: string): BoardLogEvent[] {
  return (
    db
      .prepare(
        "SELECT json FROM hub_board_events WHERE organization_id=? ORDER BY lamport,device_id,id",
      )
      .all(org) as { json: string }[]
  ).map((row) => JSON.parse(row.json));
}
export function hubBoardVersion(org: string): BoardVersionVector {
  return Object.fromEntries(
    (
      db
        .prepare(
          "SELECT device_id,max(lamport) AS high FROM hub_board_events WHERE organization_id=? GROUP BY device_id",
        )
        .all(org) as { device_id: string; high: number }[]
    ).map((r) => [r.device_id, r.high]),
  );
}
export function mergeHubBoard(org: string, values: unknown[]): number {
  const events = values.map((value) => boardLogEventSchema.parse(value));
  let landed = 0;
  runTransaction(() => {
    for (const event of events)
      landed += Number(
        db
          .prepare("INSERT OR IGNORE INTO hub_board_events VALUES (?,?,?,?,?)")
          .run(
            org,
            event.id,
            event.deviceId,
            event.lamport,
            JSON.stringify(event),
          ).changes,
      );
  });
  if (landed) broadcast({ type: "hub-board", organizationId: org });
  return landed;
}
export function hubBoardList(org: string, entity: BoardProjectionEntity) {
  const kind = (
    {
      tickets: "ticket",
      agents: "agent",
      memories: "memory",
      routines: "recurrence",
    } as const
  )[entity];
  const events = all(org).filter((event) => event.entity === kind);
  const items = [...new Set(events.map((event) => event.entityId))].flatMap(
    (id) => {
      const projection = foldBoardEvents(
        kind,
        id,
        events.filter((event) => event.entityId === id),
      );
      return projection ? [projection] : [];
    },
  );
  return { items, version: hubBoardVersion(org), ...hubBoardState(org) };
}
function portable(event: LogEvent): BoardLogEvent {
  const payload = { ...event.payload };
  if (event.entity === "project")
    for (const field of ["path", "paths", "environment", "environments"])
      delete payload[field];
  if (["link", "unlink"].includes(event.kind))
    payload.computerId = payload.deviceId ?? event.deviceId;
  return {
    ...event,
    payload,
    actor: {
      kind: "computer",
      id: deviceId,
      label: "Imported from this computer",
    },
  };
}
export function importHubBoard(org: string) {
  const state = hubBoardState(org);
  if (state.imported) return;
  // Capture a fixed set once; future private entities do not become shared.
  const events: BoardLogEvent[] = [];
  let vector: BoardVersionVector = {};
  for (;;) {
    const batch = eventsSince(vector);
    if (!batch.length) break;
    for (const event of batch) {
      events.push(portable(event));
      vector[event.deviceId] = Math.max(
        vector[event.deviceId] ?? 0,
        event.lamport,
      );
    }
  }
  runTransaction(() => {
    for (const event of events)
      db.prepare(
        "INSERT OR IGNORE INTO hub_board_events VALUES (?,?,?,?,?)",
      ).run(
        org,
        event.id,
        event.deviceId,
        event.lamport,
        JSON.stringify(event),
      );
    for (const event of events)
      db.prepare("INSERT OR IGNORE INTO hub_board_imports VALUES (?,?,?)").run(
        org,
        event.entity,
        event.entityId,
      );
    setKv(key(org), { ...state, imported: true, enabled: true });
  });
}
export function appendHubBoard(org: string, input: unknown) {
  if (!hubBoardState(org).enabled)
    throw new Error("Enable Tasks synchronization first.");
  const value = boardAppendInputSchema.parse(input);
  const event: BoardLogEvent = {
    ...value,
    id: randomUUID(),
    deviceId: `computer:${deviceId}:organization:${org}`,
    lamport: Math.max(0, ...Object.values(hubBoardVersion(org))) + 1,
    at: Date.now(),
    actor: { kind: "computer", id: deviceId, label: "This computer" },
  };
  mergeHubBoard(org, [event]);
  return event;
}
export type BoardExchange = (input: {
  version: BoardVersionVector;
  events: BoardLogEvent[];
}) => Promise<{ version: BoardVersionVector; events: BoardLogEvent[] }>;
export class HubBoardSync {
  private running?: Promise<void>;
  private again = false;
  private stopped = false;
  private off?: () => void;
  constructor(
    private readonly org: string,
    private readonly exchange: BoardExchange,
  ) {}
  start() {
    const changed = (event: LogEvent) => {
      if (!hubBoardState(this.org).enabled) return;
      if (
        db
          .prepare(
            "SELECT 1 FROM hub_board_imports WHERE organization_id=? AND entity=? AND entity_id=?",
          )
          .get(this.org, event.entity, event.entityId)
      )
        mergeHubBoard(this.org, [portable(event)]);
      void this.sync();
    };
    const local = onLocalAppend(changed);
    const remote = onRemoteMerge(changed);
    this.off = () => {
      local();
      remote();
    };
    void this.sync();
  }
  stop() {
    this.stopped = true;
    this.off?.();
  }
  retry(): void {
    if (hubBoardState(this.org).error) void this.sync();
  }
  sync(): Promise<void> {
    if (this.stopped || !hubBoardState(this.org).enabled)
      return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.round()
      .catch(() => {
        if (!this.stopped)
          setKv(key(this.org), {
            ...hubBoardState(this.org),
            error: "Tasks could not synchronize; reconnect to try again.",
          });
      })
      .finally(() => {
        this.running = undefined;
        if (this.again) {
          this.again = false;
          void this.sync();
        }
      });
    return this.running;
  }
  private async round() {
    const initial = await this.exchange({
      version: hubBoardVersion(this.org),
      events: [],
    });
    if (this.stopped) return;
    mergeHubBoard(this.org, initial.events);
    let theirs = initial.version;
    for (;;) {
      const outgoing = all(this.org)
        .filter((e) => e.lamport > (theirs[e.deviceId] ?? 0))
        .slice(0, 500);
      const answer = await this.exchange({
        version: hubBoardVersion(this.org),
        events: outgoing,
      });
      if (this.stopped) return;
      mergeHubBoard(this.org, answer.events);
      theirs = answer.version;
      if (
        answer.events.length < 500 &&
        !all(this.org).some((e) => e.lamport > (theirs[e.deviceId] ?? 0))
      )
        break;
    }
    setKv(key(this.org), {
      ...hubBoardState(this.org),
      lastSyncAt: Date.now(),
      error: undefined,
    });
    broadcast({ type: "hub-board", organizationId: this.org });
  }
}
