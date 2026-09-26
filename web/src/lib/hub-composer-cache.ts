import type { ModelChoice, Provider } from "./providers";

/// What the new-thread composer last settled on for one workspace, kept on this
/// device.
///
/// The computer, model, sharing and branch each wait on a different hosted
/// read, and the slowest takes seconds. Drawing the last settled labels in
/// place, as controls that cannot be used yet, keeps the toolbar from arriving
/// late and from moving when it does. The fresh reads always decide: nothing
/// here is sent, and a control becomes usable only once its own read answers.
export type ComposerSnapshot = {
  computerId: string;
  computerName: string;
  cloud: boolean;
  /// That computer's own copy of the workspace, where its branches are read.
  localWorkspaceId?: string;
  visibility?: "private" | "open";
  branch?: string;
  model?: { choice: ModelChoice; provider: Provider };
};

export const HUB_COMPOSER_CACHE_KEY = "remy.hub-composer.v1";
const BOUNDS = { entries: 40, characters: 64_000, ageMs: 30 * 24 * 60 * 60 * 1_000 } as const;

type Stored = { version: 1; entries: Record<string, ComposerSnapshot & { savedAt: number }> };

function storage(): Storage | undefined {
  try { return globalThis.localStorage ?? undefined; }
  catch { return undefined; }
}

function read(): Stored["entries"] {
  try {
    const raw = storage()?.getItem(HUB_COMPOSER_CACHE_KEY);
    if (!raw || raw.length > BOUNDS.characters) return {};
    const parsed = JSON.parse(raw) as Partial<Stored> | null;
    if (parsed?.version !== 1 || !parsed.entries || typeof parsed.entries !== "object") return {};
    return parsed.entries;
  } catch {
    return {};
  }
}

const key = (organizationId: string, workspaceId: string) => `${organizationId}:${workspaceId}`;

export function composerSnapshot(organizationId: string, workspaceId: string): ComposerSnapshot | undefined {
  if (!organizationId || !workspaceId) return undefined;
  const entry = read()[key(organizationId, workspaceId)];
  if (!entry || typeof entry.computerId !== "string" || typeof entry.computerName !== "string") return undefined;
  if (typeof entry.savedAt !== "number" || Date.now() - entry.savedAt > BOUNDS.ageMs) return undefined;
  return entry;
}

export function saveComposerSnapshot(organizationId: string, workspaceId: string, snapshot: ComposerSnapshot) {
  const target = storage();
  if (!target || !organizationId || !workspaceId) return;
  const entries = read();
  delete entries[key(organizationId, workspaceId)];
  entries[key(organizationId, workspaceId)] = { ...snapshot, savedAt: Date.now() };
  const kept = Object.entries(entries).slice(-BOUNDS.entries);
  const body = JSON.stringify({ version: 1, entries: Object.fromEntries(kept) } satisfies Stored);
  if (body.length > BOUNDS.characters) return;
  try { target.setItem(HUB_COMPOSER_CACHE_KEY, body); }
  catch { /* A full or blocked store only means the next open starts cold. */ }
}
