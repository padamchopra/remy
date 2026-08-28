import { randomUUID } from "node:crypto";
import { db, getKv, runTransaction, setKv } from "./db.js";

/// The board's append-only log, and the only way anything on the board changes.
///
/// Tickets, agents and projects are not rows anyone writes to — they are folds
/// of the events recorded here, replayed in a total order every machine agrees
/// on. That is a lot of ceremony for one daemon, and none of it is for one
/// daemon: it is what lets a second machine replay the same events and land on
/// the same board without a coordinator deciding who won.
///
/// The order is `(lamport, deviceId, id)`. Lamport counts events rather than
/// milliseconds, so two machines whose clocks disagree still converge, and the
/// device id breaks the tie the counter cannot. `at` is wall clock, and is only
/// ever shown to a person.

export type LogEntity = "project" | "agent" | "memory" | "ticket" | "recurrence";

export type LogKind =
  | "create"
  | "field"
  | "status"
  | "comment"
  | "comment_edit"
  | "comment_delete"
  | "handoff"
  | "link"
  | "unlink"
  /// A routine completing one trigger. On the log rather than in a row so two
  /// machines cannot each believe they still owe the same run.
  | "ran"
  | "tombstone";

export interface LogEvent {
  id: string;
  deviceId: string;
  lamport: number;
  at: number;
  entity: LogEntity;
  entityId: string;
  kind: LogKind;
  payload: Record<string, unknown>;
}

const localAppendListeners = new Set<(event: LogEvent) => void>();
const remoteMergeListeners = new Set<(event: LogEvent) => void>();

/// Runs after this machine writes a board event. Callbacks are deferred until
/// the writer has rebuilt its projection, so a window reacting to the signal
/// cannot read the old row between the append and the fold.
export function onLocalAppend(listener: (event: LogEvent) => void): () => void {
  localAppendListeners.add(listener);
  return () => localAppendListeners.delete(listener);
}

/// Runs after peer events have landed. Deferred so the caller can rebuild the
/// board projections before subscribers read the changed ticket or agent.
export function onRemoteMerge(listener: (event: LogEvent) => void): () => void {
  remoteMergeListeners.add(listener);
  return () => remoteMergeListeners.delete(listener);
}

/// This machine's name in the log. Minted once and kept, because every event
/// ever written carries it — regenerating one would fork the history.
export const deviceId: string = (() => {
  const existing = getKv<string>("deviceId");
  if (typeof existing === "string" && existing.length > 0) return existing;
  const minted = randomUUID();
  setKv("deviceId", minted);
  return minted;
})();

function nextLamport(): number {
  const row = db.prepare("select max(lamport) as high from board_log").get() as { high?: number | null };
  return Number(row?.high ?? 0) + 1;
}

function toEvent(row: Record<string, unknown>): LogEvent {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(String(row.json)) as Record<string, unknown>;
  } catch {
    // A payload we cannot read is an event we cannot apply; folding skips it
    // rather than losing every other event for the entity.
  }
  return {
    id: String(row.id),
    deviceId: String(row.device_id),
    lamport: Number(row.lamport),
    at: Number(row.at),
    entity: String(row.entity) as LogEntity,
    entityId: String(row.entity_id),
    kind: String(row.kind) as LogKind,
    payload,
  };
}

/// Records one change. The caller reprojects afterwards; this only writes.
export function append(
  entity: LogEntity,
  entityId: string,
  kind: LogKind,
  payload: Record<string, unknown> = {},
): LogEvent {
  const event: LogEvent = {
    id: randomUUID(),
    deviceId,
    lamport: nextLamport(),
    at: Date.now(),
    entity,
    entityId,
    kind,
    payload,
  };
  db.prepare(
    `insert into board_log (id, device_id, lamport, at, entity, entity_id, kind, json)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.id,
    event.deviceId,
    event.lamport,
    event.at,
    event.entity,
    event.entityId,
    event.kind,
    JSON.stringify(event.payload),
  );
  queueMicrotask(() => {
    for (const listener of localAppendListeners) listener(event);
  });
  return event;
}

/// Every event for one entity, in the order every machine folds them in.
export function eventsFor(entity: LogEntity, entityId: string): LogEvent[] {
  const rows = db
    .prepare(
      `select * from board_log
        where entity = ? and entity_id = ?
        order by lamport asc, device_id asc, id asc`,
    )
    .all(entity, entityId) as Record<string, unknown>[];
  return rows.map(toEvent);
}

/// Every entity of a kind that the log has ever mentioned, including ones since
/// tombstoned — a fold decides what is still alive, not this.
export function entityIds(entity: LogEntity): string[] {
  const rows = db
    .prepare("select distinct entity_id from board_log where entity = ?")
    .all(entity) as { entity_id: string }[];
  return rows.map((row) => row.entity_id);
}

/// Folds a patch payload onto a record, ignoring keys the payload does not
/// carry. Last write wins per field, which falls out of folding in order.
export function applyFields<T extends object>(
  record: T,
  payload: Record<string, unknown>,
  allowed: readonly (keyof T)[],
): T {
  const next = { ...record } as Record<string, unknown>;
  for (const key of allowed) {
    const value = payload[key as string];
    if (value !== undefined) next[key as string] = value;
  }
  return next as T;
}

/// What this machine has seen, as one high-water mark per device that has ever
/// written to the log.
///
/// A device's own lamports strictly increase — `nextLamport` is the whole log's
/// maximum plus one — so a single number per device is enough to say "everything
/// from you up to here". That is what makes the vector below a complete cursor,
/// where a single lamport is not: a peer can merge a third device's older event
/// long after we last pulled, and a scalar cursor would step straight over it.
export function versionVector(): Record<string, number> {
  const rows = db
    .prepare("select device_id, max(lamport) as high from board_log group by device_id")
    .all() as { device_id: string; high: number }[];
  const vector: Record<string, number> = {};
  for (const row of rows) vector[row.device_id] = Number(row.high);
  return vector;
}

/// Events the holder of `vector` has not seen, oldest first. A device the caller
/// has never heard of contributes its whole history.
export function eventsSince(vector: Record<string, number>, limit = 500): LogEvent[] {
  const known = Object.keys(vector).filter((id) => id.length > 0);
  const params: (string | number)[] = [];
  let where = "1 = 1";
  if (known.length > 0) {
    const seen = known.map(() => "(device_id = ? and lamport > ?)");
    for (const id of known) params.push(id, Number(vector[id]) || 0);
    const unknownDevice = `device_id not in (${known.map(() => "?").join(", ")})`;
    params.push(...known);
    where = `(${seen.join(" or ")} or ${unknownDevice})`;
  }
  const rows = db
    .prepare(
      `select * from board_log
        where ${where}
        order by lamport asc, device_id asc, id asc
        limit ?`,
    )
    .all(...params, limit) as Record<string, unknown>[];
  return rows.map(toEvent);
}

const LOG_ENTITIES: LogEntity[] = ["project", "agent", "memory", "ticket", "recurrence"];
const LOG_KINDS: LogKind[] = [
  "create",
  "field",
  "status",
  "comment",
  "comment_edit",
  "comment_delete",
  "handoff",
  "link",
  "unlink",
  "ran",
  "tombstone",
];

/// An event off the wire, or nothing if it is not one. A peer is trusted with
/// the tailnet, not with the schema: a malformed event that reached the log
/// would break every fold that replays it afterwards.
function parseEvent(value: unknown): LogEvent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : "";
  const from = typeof raw.deviceId === "string" ? raw.deviceId : "";
  const lamport = Number(raw.lamport);
  if (!id || !from || !Number.isSafeInteger(lamport) || lamport <= 0) return undefined;
  if (!LOG_ENTITIES.includes(raw.entity as LogEntity)) return undefined;
  if (!LOG_KINDS.includes(raw.kind as LogKind)) return undefined;
  if (typeof raw.entityId !== "string" || !raw.entityId) return undefined;
  const payload = raw.payload && typeof raw.payload === "object" && !Array.isArray(raw.payload)
    ? (raw.payload as Record<string, unknown>)
    : {};
  return {
    id,
    deviceId: from,
    lamport,
    at: Number(raw.at) || Date.now(),
    entity: raw.entity as LogEntity,
    entityId: raw.entityId,
    kind: raw.kind as LogKind,
    payload,
  };
}

/// Writes a peer's events into this log, skipping any already here and any that
/// do not parse. Answers how many landed, so a caller only replays the folds
/// when something actually changed.
///
/// Nothing is rewritten on the way in: an event keeps the device that wrote it
/// and the lamport it was written at, because those two are its place in the
/// order every machine has to agree on. Our own clock catches up on its own —
/// `nextLamport` reads the maximum, which a merged event may now hold.
export function mergeRemote(events: unknown): number {
  const parsed = (Array.isArray(events) ? events : [])
    .map(parseEvent)
    .filter((event): event is LogEvent => event !== undefined);
  if (parsed.length === 0) return 0;

  let landed = 0;
  const landedEvents: LogEvent[] = [];
  runTransaction(() => {
    const insert = db.prepare(
      `insert or ignore into board_log (id, device_id, lamport, at, entity, entity_id, kind, json)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const event of parsed) {
      const result = insert.run(
        event.id,
        event.deviceId,
        event.lamport,
        event.at,
        event.entity,
        event.entityId,
        event.kind,
        JSON.stringify(event.payload),
      );
      if (Number(result.changes) > 0) {
        landed += 1;
        landedEvents.push(event);
      }
    }
  });
  if (landedEvents.length > 0) {
    queueMicrotask(() => {
      for (const event of landedEvents) {
        for (const listener of remoteMergeListeners) listener(event);
      }
    });
  }
  return landed;
}
