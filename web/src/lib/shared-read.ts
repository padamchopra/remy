export type SharedResource = "providers" | "settings" | "board" | "pairing" | "identity";

interface PendingRead {
  revision: number;
  promise: Promise<unknown>;
}

interface QueuedRead extends PendingRead {
  read: () => Promise<unknown>;
  now: () => number;
}

interface SharedEntry {
  revision: number;
  value?: unknown;
  valueAt?: number;
  pending?: PendingRead;
  queued?: QueuedRead;
}

interface ReadOptions {
  now?: () => number;
}

/// Every resource is fresh for one mount wave. Provider, settings and identity
/// writes seed or invalidate their entry; board and pairing pushes invalidate
/// theirs. Once the bound expires, the next consumer performs a fresh read, so
/// this never becomes an unbounded session cache.
export const SHARED_RESOURCE_FRESHNESS_MS: Record<SharedResource, number> = {
  providers: 1_000,
  settings: 1_000,
  board: 1_000,
  pairing: 1_000,
  identity: 1_000,
};

const entries = new Map<string, SharedEntry>();

function resourceKey(resource: SharedResource, serverId: string): string {
  return `${resource}:${serverId}`;
}

export function readSharedResource<T>(
  resource: SharedResource,
  serverId: string,
  read: () => Promise<T>,
  options: ReadOptions = {},
): Promise<T> {
  const key = resourceKey(resource, serverId);
  const entry = entries.get(key) ?? { revision: 0 };
  entries.set(key, entry);
  const now = options.now ?? Date.now;
  const readAt = now();

  if (entry.valueAt !== undefined && readAt - entry.valueAt < SHARED_RESOURCE_FRESHNESS_MS[resource]) {
    return Promise.resolve(entry.value as T);
  }
  if (entry.pending?.revision === entry.revision) return entry.pending.promise as Promise<T>;
  if (entry.pending) {
    if (entry.queued) {
      if (entry.queued.revision !== entry.revision) {
        entry.queued.revision = entry.revision;
        entry.queued.read = read;
        entry.queued.now = now;
      }
      return entry.queued.promise as Promise<T>;
    }
    const queued = {
      revision: entry.revision,
      read,
      now,
      promise: Promise.resolve() as Promise<unknown>,
    };
    queued.promise = entry.pending.promise
      .catch(() => undefined)
      .then(() => {
        if (entry.queued === queued) entry.queued = undefined;
        return startRead(entry, queued.revision, queued.read, queued.now);
      });
    entry.queued = queued;
    return queued.promise as Promise<T>;
  }

  return startRead(entry, entry.revision, read, now);
}

function startRead<T>(
  entry: SharedEntry,
  revision: number,
  read: () => Promise<T>,
  now: () => number,
): Promise<T> {
  const promise = Promise.resolve()
    .then(read)
    .then((value) => {
      if (entry.revision === revision) {
        entry.value = value;
        entry.valueAt = now();
      }
      return value;
    })
    .finally(() => {
      if (entry.pending?.promise === promise) entry.pending = undefined;
    });
  entry.pending = { revision, promise };
  return promise;
}

/// A push or mutation makes the last value stale without removing it. If that
/// happens during a read, the next consumer starts a new revision rather than
/// joining a request that began before the change.
export function invalidateSharedResource(resource: SharedResource, serverId: string): void {
  const key = resourceKey(resource, serverId);
  const entry = entries.get(key) ?? { revision: 0 };
  entry.revision += 1;
  entry.valueAt = undefined;
  entries.set(key, entry);
}

/// A mutation response is the freshest server value and can satisfy controls
/// mounting in the same wave without a read-back request.
export function seedSharedResource<T>(resource: SharedResource, serverId: string, value: T): void {
  const key = resourceKey(resource, serverId);
  const entry = entries.get(key) ?? { revision: 0 };
  entry.revision += 1;
  entry.value = value;
  entry.valueAt = Date.now();
  if (entry.queued) {
    entry.queued.revision = entry.revision;
    entry.queued.read = () => Promise.resolve(value);
  }
  entries.set(key, entry);
}

export function resetSharedResources(): void {
  entries.clear();
}
