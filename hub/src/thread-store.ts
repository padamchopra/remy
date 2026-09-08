import {
  canReadThread,
  threadSnapshotSchema,
  type HubThread,
  type ThreadLiveFrame,
  type ThreadSnapshot,
} from "@remy/contract";
import type { BoardStorage } from "./organization-board.js";

const PREFIX = "threads:snapshot:";
const HISTORY = 128;
const keyFor = (computer: string, id: string) =>
  `${PREFIX}${encodeURIComponent(computer)}:${id}`;
const frameKey = (cursor: number) =>
  `threads:frame:${String(cursor).padStart(16, "0")}`;
type StoredFrame = Exclude<
  ThreadLiveFrame,
  { kind: "ready" } | { kind: "reset" }
>;

export class ThreadStore {
  constructor(
    private readonly storage: BoardStorage,
    private readonly publish: (frame: StoredFrame) => void = () => undefined,
  ) {}

  async snapshot(computerId: string, value: ThreadSnapshot): Promise<void> {
    const snapshot = threadSnapshotSchema.parse(value);
    const thread: HubThread = {
      ...snapshot,
      computerId,
      stale: false,
      observedAt: Date.now(),
    };
    await this.write({ kind: "snapshot", cursor: 0, thread });
  }

  async get(computerId: string, id: string): Promise<HubThread | undefined> {
    return this.storage.get<HubThread>(keyFor(computerId, id));
  }

  async list(userId?: string): Promise<HubThread[]> {
    return [
      ...(await this.storage.list<HubThread>({ prefix: PREFIX })).values(),
    ]
      .filter((thread) => !userId || canReadThread(thread.access, userId))
      .sort(
        (a, b) =>
          Number(b.detail.updatedAt ?? b.observedAt) -
          Number(a.detail.updatedAt ?? a.observedAt),
      );
  }

  async offline(computerId: string): Promise<void> {
    for (const thread of await this.list())
      if (thread.computerId === computerId && !thread.stale)
        await this.write({
          kind: "snapshot",
          cursor: 0,
          thread: { ...thread, stale: true },
        });
  }

  async manifest(computerId: string, ids: string[]): Promise<void> {
    const known = new Set(ids);
    for (const thread of await this.list())
      if (thread.computerId === computerId && !known.has(thread.id))
        await this.write({
          kind: "remove",
          cursor: 0,
          computerId,
          threadId: thread.id,
        });
  }

  async replay(
    after?: number,
  ): Promise<{ cursor: number; frames: ThreadLiveFrame[] }> {
    const cursor = (await this.storage.get<number>("threads:cursor")) ?? 0;
    if (
      after === undefined ||
      after > cursor ||
      after < Math.max(0, cursor - HISTORY)
    )
      return { cursor, frames: [{ kind: "reset", cursor }] };
    const frames = [
      ...(
        await this.storage.list<StoredFrame>({ prefix: "threads:frame:" })
      ).values(),
    ]
      .filter((frame) => frame.cursor > after)
      .sort((a, b) => a.cursor - b.cursor);
    return { cursor, frames };
  }

  private async write(value: StoredFrame): Promise<void> {
    const frame = await this.storage.transaction(async (storage) => {
      if (value.kind === "snapshot") {
        const old = await storage.get<HubThread>(
          keyFor(value.thread.computerId, value.thread.id),
        );
        if (
          old &&
          (old.revision > value.thread.revision ||
            (old.revision === value.thread.revision && !value.thread.stale))
        )
          return undefined;
      }
      const cursor = ((await storage.get<number>("threads:cursor")) ?? 0) + 1;
      const next = { ...value, cursor };
      if (next.kind === "snapshot")
        await storage.put(
          keyFor(next.thread.computerId, next.thread.id),
          next.thread,
        );
      else await storage.delete(keyFor(next.computerId, next.threadId));
      await storage.put("threads:cursor", cursor);
      await storage.put(frameKey(cursor), next);
      if (cursor > HISTORY) await storage.delete(frameKey(cursor - HISTORY));
      return next;
    });
    if (frame) this.publish(frame);
  }
}
