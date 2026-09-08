import {
  boardAppendInputSchema,
  foldBoardEvents,
  boardLogEventSchema,
  type BoardActor,
  type BoardAppendInput,
  type BoardAppendResult,
  type BoardLiveFrame,
  type BoardLogEntity,
  type BoardLogEvent,
  type BoardProjection,
  type BoardProjectionEntity,
  type BoardVersionVector,
} from "@remy/contract";

function compareEvents(left: BoardLogEvent, right: BoardLogEvent): number { return left.lamport - right.lamport || left.deviceId.localeCompare(right.deviceId) || left.id.localeCompare(right.id); }

const FRAME_HISTORY = 512;
const EVENT_PREFIX = "board:event:";
const ENTITY_EVENT_PREFIX = "board:entity-event:";
const PROJECTION_PREFIX = "board:projection:";
const DEVICE_KEY = "board:device";
const VECTOR_KEY = "board:vector";
const CURSOR_KEY = "board:cursor";
const FRAME_PREFIX = "board:frame:";

export interface BoardStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  transaction<T>(closure: (storage: BoardStorage) => Promise<T>): Promise<T>;
}

type BoardDependencies = {
  id: () => string;
  now: () => number;
  publish: (frames: BoardLiveFrame[]) => void;
};

const projectionEntities: Record<BoardProjectionEntity, BoardLogEntity> = {
  tickets: "ticket",
  agents: "agent",
  memories: "memory",
  routines: "recurrence",
};
const entityFor = (entity: BoardProjectionEntity): BoardLogEntity => projectionEntities[entity];
const projectionKey = (entity: BoardLogEntity, id: string) => `${PROJECTION_PREFIX}${entity}:${id}`;
const frameKey = (cursor: number) => `${FRAME_PREFIX}${String(cursor).padStart(16, "0")}`;
const entityEventPrefix = (entity: BoardLogEntity, id: string) => `${ENTITY_EVENT_PREFIX}${entity}:${encodeURIComponent(id)}:`;
const entityEventKey = (event: BoardLogEvent) => `${entityEventPrefix(event.entity, event.entityId)}${String(event.lamport).padStart(16, "0")}:${encodeURIComponent(event.deviceId)}:${encodeURIComponent(event.id)}`;

async function eventsIn(storage: BoardStorage): Promise<BoardLogEvent[]> {
  return [...(await storage.list<BoardLogEvent>({ prefix: EVENT_PREFIX })).values()].sort(compareEvents);
}

async function reproject(storage: BoardStorage, entity: BoardLogEntity, id: string): Promise<BoardProjection | undefined> {
  const projection = foldBoardEvents(entity, id, [...(await storage.list<BoardLogEvent>({ prefix: entityEventPrefix(entity, id) })).values()]);
  const key = projectionKey(entity, id);
  if (projection) await storage.put(key, projection);
  else await storage.delete(key);
  return projection;
}

async function recordFrame(storage: BoardStorage, event: BoardLogEvent): Promise<BoardLiveFrame> {
  const cursor = (await storage.get<number>(CURSOR_KEY) ?? 0) + 1;
  const frame = { kind: "event" as const, cursor, event };
  await storage.put(CURSOR_KEY, cursor);
  await storage.put(frameKey(cursor), frame);
  if (cursor > FRAME_HISTORY) await storage.delete(frameKey(cursor - FRAME_HISTORY));
  return frame;
}

export class OrganizationBoard {
  private readonly dependencies: BoardDependencies;

  constructor(private readonly storage: BoardStorage, dependencies: Partial<BoardDependencies> = {}) {
    this.dependencies = {
      id: () => crypto.randomUUID(),
      now: Date.now,
      publish: () => undefined,
      ...dependencies,
    };
  }

  async append(inputValue: unknown, actor: BoardActor): Promise<BoardAppendResult> {
    const input = boardAppendInputSchema.parse(inputValue);
    const result = await this.storage.transaction(async (storage) => {
      const deviceId = await this.deviceId(storage);
      const version = await this.versionVector(storage);
      if (input.entity === "ticket" && input.kind === "create" && input.payload.number === undefined) {
        const tickets = await storage.list<BoardProjection>({ prefix: `${PROJECTION_PREFIX}ticket:` });
        input.payload.number = Math.max(0, ...[...tickets.values()].map((p) => Number(p.fields.number) || 0)) + 1;
      }
      const event = boardLogEventSchema.parse({
        ...input,
        id: this.dependencies.id(),
        deviceId,
        lamport: Math.max(0, ...Object.values(version)) + 1,
        at: this.dependencies.now(),
        actor,
      });
      await storage.put(`${EVENT_PREFIX}${event.id}`, event);
      await storage.put(entityEventKey(event), event);
      await storage.put(VECTOR_KEY, { ...version, [deviceId]: event.lamport });
      const projection = await reproject(storage, event.entity, event.entityId);
      const frame = await recordFrame(storage, event);
      return { event, projection: projection ?? null, cursor: frame.cursor, version: { ...version, [deviceId]: event.lamport }, frame };
    });
    this.dependencies.publish([result.frame]);
    const { frame: _, ...response } = result;
    return response;
  }

  async mergeRemote(values: unknown): Promise<{ landed: number; version: BoardVersionVector }> {
    const parsed = (Array.isArray(values) ? values : [])
      .map((value) => boardLogEventSchema.safeParse(value))
      .flatMap((result) => result.success ? [result.data] : [])
      .sort(compareEvents);
    if (parsed.length === 0) return { landed: 0, version: await this.versionVector() };

    const result = await this.storage.transaction(async (storage) => {
      let version = await this.versionVector(storage);
      const frames: BoardLiveFrame[] = [];
      const touched = new Set<string>();
      for (const event of parsed) {
        const key = `${EVENT_PREFIX}${event.id}`;
        if (await storage.get(key)) continue;
        await storage.put(key, event);
        await storage.put(entityEventKey(event), event);
        version = { ...version, [event.deviceId]: Math.max(version[event.deviceId] ?? 0, event.lamport) };
        touched.add(`${event.entity}\0${event.entityId}`);
        frames.push(await recordFrame(storage, event));
      }
      await storage.put(VECTOR_KEY, version);
      for (const value of touched) {
        const [entity, id] = value.split("\0") as [BoardLogEntity, string];
        await reproject(storage, entity, id);
      }
      return { frames, version };
    });
    this.dependencies.publish(result.frames);
    return { landed: result.frames.length, version: result.version };
  }

  async versionVector(storage: BoardStorage = this.storage): Promise<BoardVersionVector> {
    return await storage.get<BoardVersionVector>(VECTOR_KEY) ?? {};
  }

  async eventsSince(vector: BoardVersionVector, limit = 500): Promise<BoardLogEvent[]> {
    const bounded = Math.min(Math.max(Math.trunc(limit), 1), 500);
    return (await eventsIn(this.storage)).filter((event) => event.lamport > (vector[event.deviceId] ?? 0)).slice(0, bounded);
  }

  async list(entity: BoardProjectionEntity): Promise<{ items: BoardProjection[]; version: BoardVersionVector }> {
    const logEntity = entityFor(entity);
    const items = [...(await this.storage.list<BoardProjection>({ prefix: `${PROJECTION_PREFIX}${logEntity}:` })).values()]
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
    return { items, version: await this.versionVector() };
  }

  async project(id: string) { return this.storage.get<BoardProjection>(projectionKey("project", id)); }

  async detail(entity: BoardProjectionEntity, id: string): Promise<BoardProjection | undefined> {
    return this.storage.get<BoardProjection>(projectionKey(entityFor(entity), id));
  }

  async liveFramesAfter(cursor?: number): Promise<{ cursor: number; frames: BoardLiveFrame[] }> {
    const current = await this.storage.get<number>(CURSOR_KEY) ?? 0;
    if (cursor === undefined) return { cursor: current, frames: [] };
    const earliest = Math.max(1, current - FRAME_HISTORY + 1);
    if (cursor > current || cursor < earliest - 1) return { cursor: current, frames: [{ kind: "reset", cursor: current, reason: "cursor_unavailable" }] };
    const frames = [...(await this.storage.list<BoardLiveFrame>({ prefix: FRAME_PREFIX })).values()]
      .filter((frame) => frame.cursor > cursor)
      .sort((left, right) => left.cursor - right.cursor);
    return { cursor: current, frames };
  }

  private async deviceId(storage: BoardStorage): Promise<string> {
    const existing = await storage.get<string>(DEVICE_KEY);
    if (existing) return existing;
    const minted = `hub:${this.dependencies.id()}`;
    await storage.put(DEVICE_KEY, minted);
    return minted;
  }
}

export class DurableBoardStorage implements BoardStorage {
  constructor(private readonly storage: DurableObjectStorage | DurableObjectTransaction) {}
  get<T>(key: string) { return this.storage.get<T>(key); }
  put<T>(key: string, value: T) { return this.storage.put(key, value); }
  delete(key: string) { return this.storage.delete(key); }
  list<T>(options: { prefix: string }) { return this.storage.list<T>(options); }
  transaction<T>(closure: (storage: BoardStorage) => Promise<T>): Promise<T> {
    if (!("transaction" in this.storage)) return closure(this);
    return this.storage.transaction((transaction) => closure(new DurableBoardStorage(transaction)));
  }
}
