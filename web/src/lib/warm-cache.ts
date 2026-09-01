/// What the window already knew, kept for the next time it opens.
///
/// A restart used to wait out the whole waterfall before it could draw
/// anything: the device list, then every device's threads, then the transcript
/// the URL pointed at. This keeps the settled part of that answer in
/// `localStorage`, so the sidebar and the last few threads paint on the first
/// frame and the read that always follows corrects them.
///
/// Three rules keep it from becoming a second source of truth:
///
/// - Only settled state is written. A streaming turn, a waiting approval and a
///   running clock are moments rather than facts, so they never reach a
///   snapshot — see `settledChat` and `settledDetail`.
/// - Everything is bounded: rows per list, entries per transcript, transcripts
///   per snapshot, characters in total, and how old a snapshot may be.
/// - Nothing here suppresses a request. Hydration seeds the first paint; the
///   refresh underneath it overwrites whatever it finds.

import type { Agent, Chat, ChatDetail, Project, Server, Workspace } from "../state/types";

/// Bump this whenever a persisted shape changes. A snapshot written by another
/// version is discarded rather than migrated: it is a head start, and the read
/// behind it is already on its way.
export const WARM_CACHE_VERSION = 1;

export const WARM_CACHE_KEY = "remy.warm-cache";

/// Every bound this cache lives inside. `characters` is what `localStorage`
/// itself counts, so it is the honest unit for a quota.
export const WARM_CACHE_BOUNDS = {
  servers: 12,
  chats: 60,
  dms: 30,
  workspaces: 60,
  agents: 40,
  projects: 40,
  details: 4,
  entriesPerDetail: 24,
  characters: 256_000,
  ageMs: 7 * 24 * 60 * 60 * 1_000,
} as const;

/// The lists a person sees before they touch anything, plus the transcripts
/// they were last reading.
///
/// The roster is here because Inbox is the agents and `#/inbox/<handle>` cannot
/// find its conversation without it. Tickets and routines are not: they belong
/// to a pane of their own, and a board is the one list here with no natural
/// size. Archived threads are absent for the same reason — they carry whole
/// conversations and nothing opens on them.
export interface WarmSnapshot {
  version: number;
  servers: Server[];
  chats: Chat[];
  dms: Chat[];
  workspaces: Workspace[];
  agents: Agent[];
  projects: Project[];
  details: ChatDetail[];
}

interface StoredSnapshot extends WarmSnapshot {
  at: number;
}

/// Just enough of `Storage` to be handed a fake in a test.
export interface WarmStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): WarmStorage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    // A window opened with storage blocked still works; it just opens cold.
    return undefined;
  }
}

/// The last body written, so an unchanged snapshot costs no write at all. A
/// streaming turn produces the same settled projection frame after frame, which
/// is exactly the case this skips.
let written: string | undefined;

function keptRows(chats: readonly Chat[], limit: number): Chat[] {
  // The same order the sidebar leads with, so what is dropped is what a person
  // would have had to scroll to.
  return [...chats]
    .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

/// A device as it can honestly be redrawn later. Whether a machine answers is
/// this second's question, so a snapshot never claims one does.
function settledServer(server: Server): Server {
  return { ...server, online: false, ...(server.cloud ? { cloudConnected: false } : {}) };
}

/// A row as it can honestly be redrawn later. What a thread was doing is not
/// what it is doing, and an elapsed clock started before the restart would
/// count from the wrong moment, so only a settled row is remembered — anything
/// mid-flight is written down as idle and the read behind it says otherwise
/// within a frame or two.
export function settledChat(chat: Chat): Chat {
  const { workingSince: _workingSince, ...rest } = chat;
  return { ...rest, state: chat.state === "error" ? "error" : "idle" };
}

/// A transcript as it can honestly be redrawn later, or nothing when the thread
/// was mid-turn. A question or an approval is somebody waiting on an answer
/// that a restarted provider will no longer take, so those are never a snapshot
/// either.
export function settledDetail(detail: ChatDetail): ChatDetail | undefined {
  if (detail.state === "working" || detail.state === "needs_input") return undefined;
  if (detail.approval || detail.question) return undefined;

  const {
    action: _action,
    approval: _approval,
    question: _question,
    live: _live,
    workingSince: _workingSince,
    ...rest
  } = detail;
  const kept = detail.entries.slice(-WARM_CACHE_BOUNDS.entriesPerDetail);
  const trimmed = kept.length < detail.entries.length;
  return {
    ...rest,
    entries: kept,
    // Trimming the head is the same shape as a first page, so "Load earlier"
    // asks for the entries that were dropped instead of skipping them.
    history: trimmed
      ? { hasEarlier: true, ...(kept[0] ? { before: kept[0].id } : {}) }
      : detail.history,
  };
}

/// The projection of the store that is worth keeping. `details` arrives most
/// recently used first, which is the order it is trimmed in.
export function warmSnapshot(
  state: {
    servers: readonly Server[];
    chats: readonly Chat[];
    dms: readonly Chat[];
    workspaces: readonly Workspace[];
    agents: readonly Agent[];
    projects: readonly Project[];
  },
  details: readonly ChatDetail[],
): WarmSnapshot {
  return {
    version: WARM_CACHE_VERSION,
    servers: state.servers.slice(0, WARM_CACHE_BOUNDS.servers).map(settledServer),
    chats: keptRows(state.chats, WARM_CACHE_BOUNDS.chats).map(settledChat),
    dms: keptRows(state.dms, WARM_CACHE_BOUNDS.dms).map(settledChat),
    workspaces: state.workspaces.slice(0, WARM_CACHE_BOUNDS.workspaces),
    agents: state.agents.slice(0, WARM_CACHE_BOUNDS.agents),
    projects: state.projects.slice(0, WARM_CACHE_BOUNDS.projects),
    details: details
      .flatMap((detail) => {
        const settled = settledDetail(detail);
        return settled ? [settled] : [];
      })
      .slice(0, WARM_CACHE_BOUNDS.details),
  };
}

/// Whether anything was written. A snapshot over the character bound sheds its
/// least recent transcript until it fits; one that cannot fit even with no
/// transcripts leaves nothing behind, because a snapshot that can never be
/// updated is worse than opening cold.
export function writeWarmCache(
  snapshot: WarmSnapshot,
  storage: WarmStorage | undefined = defaultStorage(),
  now: () => number = Date.now,
): boolean {
  if (!storage) return false;

  let bounded = snapshot;
  let body = JSON.stringify(bounded);
  while (body.length > WARM_CACHE_BOUNDS.characters && bounded.details.length > 0) {
    bounded = { ...bounded, details: bounded.details.slice(0, -1) };
    body = JSON.stringify(bounded);
  }
  if (body.length > WARM_CACHE_BOUNDS.characters) {
    clearWarmCache(storage);
    return false;
  }
  if (body === written) return false;

  try {
    storage.setItem(WARM_CACHE_KEY, JSON.stringify({ ...bounded, at: now() } satisfies StoredSnapshot));
    written = body;
    return true;
  } catch {
    // Out of quota, or storage was revoked mid-session. Drop what is there so
    // the next launch opens cold rather than from something half written.
    clearWarmCache(storage);
    return false;
  }
}

export function clearWarmCache(storage: WarmStorage | undefined = defaultStorage()): void {
  written = undefined;
  try {
    storage?.removeItem(WARM_CACHE_KEY);
  } catch {
    // Nothing to do: the cache is an optimisation either way.
  }
}

/// The rows of one list, as this version of Remy can still use them. Reading
/// applies the same bounds writing does, so a snapshot from anywhere — an older
/// build, another window, a hand-edited value — cannot cost more than one this
/// build wrote.
function rows<T extends { id?: unknown }>(value: unknown, limit: number, hasShape: (row: T) => boolean): T[] {
  if (!Array.isArray(value)) return [];
  return (value as T[])
    .filter((row) => Boolean(row) && typeof row.id === "string" && hasShape(row))
    .slice(0, limit);
}

const isChat = (chat: Chat) =>
  typeof chat.serverId === "string" && typeof chat.title === "string" && typeof chat.cwd === "string";

/// The snapshot to open with, or nothing. A version that does not match, a
/// snapshot older than the age bound, and anything that does not parse are all
/// discarded outright — the read that follows hydration is the source of truth,
/// so there is never a reason to repair one of these.
export function readWarmCache(
  storage: WarmStorage | undefined = defaultStorage(),
  now: () => number = Date.now,
): WarmSnapshot | undefined {
  if (!storage) return undefined;
  let raw: string | null = null;
  try {
    raw = storage.getItem(WARM_CACHE_KEY);
  } catch {
    return undefined;
  }
  if (!raw) return undefined;
  // Checked before parsing, not after: the bounds exist so that opening a window
  // never means reading an unbounded amount of anything.
  if (raw.length > WARM_CACHE_BOUNDS.characters) {
    clearWarmCache(storage);
    return undefined;
  }

  try {
    const stored = JSON.parse(raw) as Partial<StoredSnapshot> | null;
    if (!stored || stored.version !== WARM_CACHE_VERSION) throw new Error("another schema");
    if (typeof stored.at !== "number" || now() - stored.at > WARM_CACHE_BOUNDS.ageMs) {
      throw new Error("too old to be worth painting");
    }
    const snapshot: WarmSnapshot = {
      version: WARM_CACHE_VERSION,
      servers: rows<Server>(stored.servers, WARM_CACHE_BOUNDS.servers, (server) => typeof server.url === "string")
        .map(settledServer),
      chats: rows<Chat>(stored.chats, WARM_CACHE_BOUNDS.chats, isChat).map(settledChat),
      dms: rows<Chat>(stored.dms, WARM_CACHE_BOUNDS.dms, isChat).map(settledChat),
      workspaces: rows<Workspace>(stored.workspaces, WARM_CACHE_BOUNDS.workspaces, (w) => typeof w.path === "string"),
      agents: rows<Agent>(stored.agents, WARM_CACHE_BOUNDS.agents, (agent) => typeof agent.handle === "string"),
      projects: rows<Project>(stored.projects, WARM_CACHE_BOUNDS.projects, (p) => typeof p.keyPrefix === "string"),
      details: rows<ChatDetail>(stored.details, WARM_CACHE_BOUNDS.details, (d) => Array.isArray(d.entries))
        .flatMap((detail) => {
          const settled = settledDetail(detail);
          return settled ? [settled] : [];
        }),
    };
    if (snapshot.servers.length === 0) throw new Error("nothing to attribute rows to");
    return snapshot;
  } catch {
    clearWarmCache(storage);
    return undefined;
  }
}
