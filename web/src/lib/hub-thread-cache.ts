import type { HubThread } from "@remy/contract";

/// Last hosted threads this device had open.
///
/// A refresh of one thread used to wait until every account's catalogue came
/// back, and that catalogue is the slow read. This paints the thread the
/// window already had; the read that always follows replaces it. It is a head
/// start, not a second source of truth.

/// Bump this whenever a persisted shape changes. A snapshot written by another
/// version is discarded rather than migrated: it is a head start, and the read
/// behind it is already on its way.
export const HUB_THREAD_CACHE_VERSION = 1;

export const HUB_THREAD_CACHE_KEY = "remy.hub-threads.v1";

export const HUB_THREAD_CACHE_BOUNDS = {
  threads: 4,
  characters: 480_000,
  ageMs: 7 * 24 * 60 * 60 * 1_000,
} as const;

/// Just enough of `Storage` to be handed a fake in a test.
export interface HubThreadStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CachedHubThread {
  organizationId: string;
  savedAt: number;
  /// The computer's name when this device last knew it, so the composer does
  /// not flash "unavailable" while the computer list is still arriving.
  computerName?: string;
  /// The signed-in person, so a refresh can tell their thread from one they
  /// only read before the catalogue returns.
  memberId?: string;
  thread: HubThread;
}

interface StoredCache {
  version: number;
  savedAt: number;
  threads: CachedHubThread[];
}

function defaultStorage(): HubThreadStorage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

const memory = new Map<string, CachedHubThread>();
let hydrated = false;

function isHubThread(value: unknown): value is HubThread {
  if (!value || typeof value !== "object") return false;
  const thread = value as HubThread;
  return typeof thread.id === "string" && thread.id.length > 0
    && typeof thread.computerId === "string"
    && thread.computerId.length > 0
    && thread.computerId !== "pending"
    && typeof thread.revision === "number"
    && typeof thread.stale === "boolean"
    && typeof thread.observedAt === "number"
    && !!thread.access
    && typeof thread.access.organizationId === "string"
    && thread.access.organizationId.length > 0
    && !!thread.detail
    && typeof thread.detail.title === "string"
    && Array.isArray(thread.detail.entries);
}

function isCached(value: unknown): value is CachedHubThread {
  if (!value || typeof value !== "object") return false;
  const row = value as CachedHubThread;
  return typeof row.organizationId === "string"
    && row.organizationId.length > 0
    && typeof row.savedAt === "number"
    && (row.computerName === undefined || typeof row.computerName === "string")
    && (row.memberId === undefined || typeof row.memberId === "string")
    && isHubThread(row.thread)
    && row.thread.access.organizationId === row.organizationId;
}

/// Drop the oldest entries until one thread fits the character bound. The tail
/// is what the open thread shows.
function fitting(row: CachedHubThread): CachedHubThread | undefined {
  const limit = HUB_THREAD_CACHE_BOUNDS.characters - 256;
  let next = row;
  let body = JSON.stringify(next);
  const entries = row.thread.detail.entries;
  let keep = entries.length;
  while (body.length > limit && keep > 0) {
    keep = Math.max(0, keep - Math.ceil(keep / 2));
    next = {
      ...row,
      thread: { ...row.thread, detail: { ...row.thread.detail, entries: entries.slice(entries.length - keep) } },
    };
    body = JSON.stringify(next);
  }
  return body.length <= limit ? next : undefined;
}

function readStored(storage: HubThreadStorage | undefined): CachedHubThread[] {
  if (!storage) return [];
  let raw: string | null = null;
  try {
    raw = storage.getItem(HUB_THREAD_CACHE_KEY);
  } catch {
    return [];
  }
  if (!raw || raw.length > HUB_THREAD_CACHE_BOUNDS.characters) {
    if (raw) try { storage.removeItem(HUB_THREAD_CACHE_KEY); } catch { /* quota or revoked */ }
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCache> | null;
    if (
      !parsed
      || parsed.version !== HUB_THREAD_CACHE_VERSION
      || typeof parsed.savedAt !== "number"
      || Date.now() - parsed.savedAt > HUB_THREAD_CACHE_BOUNDS.ageMs
      || !Array.isArray(parsed.threads)
    ) return [];
    return parsed.threads.filter(isCached);
  } catch {
    try { storage.removeItem(HUB_THREAD_CACHE_KEY); } catch { /* ignore */ }
    return [];
  }
}

function hydrate(storage: HubThreadStorage | undefined = defaultStorage()) {
  if (hydrated) return;
  hydrated = true;
  for (const row of readStored(storage)) memory.set(row.thread.id, row);
}

function persist(storage: HubThreadStorage | undefined) {
  if (!storage) return;
  while (memory.size > HUB_THREAD_CACHE_BOUNDS.threads) {
    const oldest = memory.keys().next().value;
    if (!oldest) break;
    memory.delete(oldest);
  }
  let body = JSON.stringify({
    version: HUB_THREAD_CACHE_VERSION,
    savedAt: Date.now(),
    threads: [...memory.values()],
  } satisfies StoredCache);
  while (body.length > HUB_THREAD_CACHE_BOUNDS.characters && memory.size > 1) {
    const oldest = memory.keys().next().value;
    if (!oldest) break;
    memory.delete(oldest);
    body = JSON.stringify({
      version: HUB_THREAD_CACHE_VERSION,
      savedAt: Date.now(),
      threads: [...memory.values()],
    } satisfies StoredCache);
  }
  if (body.length > HUB_THREAD_CACHE_BOUNDS.characters) return;
  try {
    storage.setItem(HUB_THREAD_CACHE_KEY, body);
  } catch {
    // The in-memory copy still paints this session.
  }
}

/// Forget what this device remembered. Sign-out calls this so the next person
/// on this browser does not see the previous transcript. Tests call it so one
/// case cannot leak into the next.
export function clearHubThreadCache(storage: HubThreadStorage | undefined = defaultStorage()) {
  memory.clear();
  hydrated = false;
  try {
    storage?.removeItem(HUB_THREAD_CACHE_KEY);
  } catch {
    // Nothing to do: the cache is a head start either way.
  }
}

export function cachedHubThread(
  id: string,
  storage: HubThreadStorage | undefined = defaultStorage(),
): CachedHubThread | undefined {
  hydrate(storage);
  const row = memory.get(id);
  if (!row) return undefined;
  if (Date.now() - row.savedAt > HUB_THREAD_CACHE_BOUNDS.ageMs) {
    memory.delete(id);
    persist(storage);
    return undefined;
  }
  return row;
}

export function forgetHubThread(id: string, storage: HubThreadStorage | undefined = defaultStorage()) {
  hydrate(storage);
  if (!memory.delete(id)) return;
  persist(storage);
}

/// Remember a thread the hub just confirmed. A copy is stored, so a later edit
/// of the live object cannot change what a refresh will paint.
export function cacheHubThread(
  organizationId: string,
  thread: HubThread,
  extras?: { computerName?: string; memberId?: string },
  storage: HubThreadStorage | undefined = defaultStorage(),
) {
  if (!isHubThread(thread) || thread.access.organizationId !== organizationId) return;
  hydrate(storage);
  const previous = memory.get(thread.id);
  const computerName = extras?.computerName ?? previous?.computerName;
  const memberId = extras?.memberId ?? previous?.memberId;
  const row = fitting({
    organizationId,
    savedAt: Date.now(),
    ...(computerName ? { computerName } : {}),
    ...(memberId ? { memberId } : {}),
    thread: JSON.parse(JSON.stringify(thread)) as HubThread,
  });
  if (!row) return;
  memory.delete(thread.id);
  memory.set(thread.id, row);
  while (memory.size > HUB_THREAD_CACHE_BOUNDS.threads) {
    const oldest = memory.keys().next().value;
    if (!oldest) break;
    memory.delete(oldest);
  }
  persist(storage);
}
