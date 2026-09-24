/// Last successful hosted workspace list, kept on this device.
///
/// Opening Workspaces used to wait for every account's catalogue before it
/// could draw a tile, and leaving the section threw that answer away. This
/// paints the last settled list on the first frame; the read that always
/// follows corrects it. It is a head start, not a second source of truth.

/// The list fields a workspace tile needs. Extra catalogue fields ride along
/// when present and are ignored when they are not.
export type CachedHubWorkspace = {
  id: string;
  organizationId: string;
  name: string;
  origin: string;
  icon?: string;
  tint?: string;
  restricted?: boolean;
};

/// Bump this whenever a persisted shape changes. A snapshot written by another
/// version is discarded rather than migrated: it is a head start, and the read
/// behind it is already on its way.
export const HUB_WORKSPACE_CACHE_VERSION = 1;

export const HUB_WORKSPACE_CACHE_KEY = "remy.hub-workspaces.v1";

export const HUB_WORKSPACE_CACHE_BOUNDS = {
  organizations: 24,
  workspaces: 60,
  characters: 128_000,
  ageMs: 7 * 24 * 60 * 60 * 1_000,
} as const;

/// Just enough of `Storage` to be handed a fake in a test.
export interface HubWorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredCache {
  version: number;
  savedAt: number;
  byOrganization: Record<string, CachedHubWorkspace[]>;
}

function defaultStorage(): HubWorkspaceStorage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    // A window opened with storage blocked still works; it just opens cold.
    return undefined;
  }
}

const memory = new Map<string, CachedHubWorkspace[]>();
let hydrated = false;

function isCachedWorkspace(value: unknown): value is CachedHubWorkspace {
  if (!value || typeof value !== "object") return false;
  const workspace = value as CachedHubWorkspace;
  return typeof workspace.id === "string"
    && typeof workspace.organizationId === "string"
    && typeof workspace.name === "string"
    && typeof workspace.origin === "string";
}

function bounded(workspaces: readonly CachedHubWorkspace[]): CachedHubWorkspace[] {
  return workspaces.filter(isCachedWorkspace).slice(0, HUB_WORKSPACE_CACHE_BOUNDS.workspaces);
}

function readStored(storage: HubWorkspaceStorage | undefined): Map<string, CachedHubWorkspace[]> {
  const next = new Map<string, CachedHubWorkspace[]>();
  if (!storage) return next;
  let raw: string | null = null;
  try {
    raw = storage.getItem(HUB_WORKSPACE_CACHE_KEY);
  } catch {
    return next;
  }
  if (!raw) return next;
  if (raw.length > HUB_WORKSPACE_CACHE_BOUNDS.characters) {
    try { storage.removeItem(HUB_WORKSPACE_CACHE_KEY); } catch { /* quota or revoked */ }
    return next;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCache> | null;
    if (
      !parsed
      || parsed.version !== HUB_WORKSPACE_CACHE_VERSION
      || typeof parsed.savedAt !== "number"
      || Date.now() - parsed.savedAt > HUB_WORKSPACE_CACHE_BOUNDS.ageMs
      || !parsed.byOrganization
      || typeof parsed.byOrganization !== "object"
    ) {
      return next;
    }
    for (const [organizationId, value] of Object.entries(parsed.byOrganization)) {
      if (typeof organizationId !== "string" || !Array.isArray(value)) continue;
      next.set(organizationId, bounded(value));
    }
  } catch {
    try { storage.removeItem(HUB_WORKSPACE_CACHE_KEY); } catch { /* ignore */ }
  }
  return next;
}

function hydrate(storage: HubWorkspaceStorage | undefined = defaultStorage()) {
  if (hydrated) return;
  hydrated = true;
  for (const [organizationId, workspaces] of readStored(storage)) {
    memory.set(organizationId, workspaces);
  }
}

function persist(storage: HubWorkspaceStorage | undefined) {
  if (!storage) return;
  const body = JSON.stringify({
    version: HUB_WORKSPACE_CACHE_VERSION,
    savedAt: Date.now(),
    byOrganization: Object.fromEntries([...memory]
      .slice(-HUB_WORKSPACE_CACHE_BOUNDS.organizations)
      .map(([organizationId, workspaces]) => [organizationId, bounded(workspaces)])),
  } satisfies StoredCache);
  if (body.length > HUB_WORKSPACE_CACHE_BOUNDS.characters) return;
  try {
    storage.setItem(HUB_WORKSPACE_CACHE_KEY, body);
  } catch {
    // The in-memory snapshot still keeps navigation and refreshes stable.
  }
}

/// Forget what this device remembered. Tests call this so one case cannot
/// leak into the next; a person never needs it.
export function clearHubWorkspaceCache(storage: HubWorkspaceStorage | undefined = defaultStorage()) {
  memory.clear();
  hydrated = false;
  try {
    storage?.removeItem(HUB_WORKSPACE_CACHE_KEY);
  } catch {
    // Nothing to do: the cache is an optimisation either way.
  }
}

/// The last successful list for one account, or nothing. An empty array is a
/// real save — that account had no workspaces — and is not the same as never
/// having opened Workspaces on this device.
export function cachedHubWorkspaces(
  organizationId: string,
  storage: HubWorkspaceStorage | undefined = defaultStorage(),
): CachedHubWorkspace[] {
  hydrate(storage);
  return memory.get(organizationId) ?? [];
}

export function hasCachedHubWorkspaces(
  organizationId: string,
  storage: HubWorkspaceStorage | undefined = defaultStorage(),
): boolean {
  hydrate(storage);
  return memory.has(organizationId);
}

export function hasCachedHubWorkspacesFor(
  organizationIds: readonly string[],
  storage: HubWorkspaceStorage | undefined = defaultStorage(),
): boolean {
  return organizationIds.some((organizationId) => hasCachedHubWorkspaces(organizationId, storage));
}

/// Remember a successful read. Re-inserted rather than replaced in place, so
/// the map's own order is which account answered least recently — which is the
/// order the stored copy sheds.
export function cacheHubWorkspaces(
  organizationId: string,
  workspaces: readonly CachedHubWorkspace[],
  storage: HubWorkspaceStorage | undefined = defaultStorage(),
) {
  hydrate(storage);
  memory.delete(organizationId);
  memory.set(organizationId, bounded(workspaces));
  persist(storage);
}
