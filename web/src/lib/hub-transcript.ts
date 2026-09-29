/// A mark beside the transcript for one message you sent, and the latest reply
/// that followed it.
export interface ThreadCheckpoint {
  id: string;
  userText: string;
  assistantText?: string;
}

export function compactCheckpointPreview(text: string | null | undefined): string {
  return text?.replace(/\s+/g, " ").trim() ?? "";
}

export function threadCheckpoints(entries: readonly { id?: string; kind?: string; text?: string | null }[]): ThreadCheckpoint[] {
  const marks: ThreadCheckpoint[] = [];
  let current: ThreadCheckpoint | undefined;
  for (const entry of entries) {
    if (entry.kind === "user" && entry.id) {
      current = { id: entry.id, userText: compactCheckpointPreview(entry.text) || "Your message" };
      marks.push(current);
      continue;
    }
    if (current && entry.kind === "assistant" && entry.text?.trim()) {
      current.assistantText = compactCheckpointPreview(entry.text);
    }
  }
  return marks;
}

/// The live tail replaces the suffix it overlaps. Messages already read above
/// that suffix stay where they are.
export function applyThreadTail<T extends { id?: string }>(current: T[], tail: T[]): T[] {
  if (!tail.length) return current;
  if (!current.length) return tail;
  const first = tail[0]?.id;
  const index = first ? current.findIndex((entry) => entry.id === first) : -1;
  if (index >= 0) return [...current.slice(0, index), ...tail];
  const known = new Set(current.map((entry) => entry.id));
  return [...current, ...tail.filter((entry) => !known.has(entry.id))];
}

export function prependThreadEntries<T extends { id?: string }>(page: T[], current: T[]): T[] {
  const known = new Set(current.map((entry) => entry.id));
  return [...page.filter((entry) => entry.id && !known.has(entry.id)), ...current];
}

export interface TranscriptAssembly<T> {
  id?: string;
  entries: T[];
  before?: string;
  complete: boolean;
  /// The open transcript was replaced, so a page already in flight is stale.
  replaced: boolean;
}

function transcriptOverlaps<T extends { id?: string }>(current: readonly T[], tail: readonly T[]): boolean {
  const first = tail[0]?.id;
  return Boolean(first && current.some((entry) => entry.id === first));
}

/// Fold one live tail into the transcript already on screen. A tail with nothing
/// before it is the whole thread. A tail the screen does not contain replaces
/// what was read, so a shifted mirror cannot leave a hole.
export function mergeThreadTranscript<T extends { id?: string }>(
  state: TranscriptAssembly<T>,
  incoming: {
    id: string;
    entries: T[];
    stale?: boolean;
    history?: { hasEarlier?: boolean; before?: string };
  },
): TranscriptAssembly<T> {
  const cursor = incoming.history?.hasEarlier && incoming.history.before ? incoming.history.before : undefined;
  const tail = incoming.entries;
  if (state.id !== incoming.id) {
    return { id: incoming.id, entries: tail, before: incoming.stale ? undefined : cursor, complete: !cursor, replaced: false };
  }
  if (!cursor) return { id: incoming.id, entries: tail, before: undefined, complete: true, replaced: false };
  if (incoming.stale) {
    const overlapped = transcriptOverlaps(state.entries, tail);
    return {
      id: incoming.id,
      entries: overlapped ? applyThreadTail(state.entries, tail) : (state.entries.length ? state.entries : tail),
      before: undefined,
      complete: false,
      replaced: false,
    };
  }
  if (!transcriptOverlaps(state.entries, tail)) {
    // The same cursor is already being read. Replacing the transcript makes
    // that page stale, so the read has to start again.
    return { id: incoming.id, entries: tail, before: cursor, complete: false, replaced: state.before === cursor };
  }
  return {
    id: incoming.id,
    entries: applyThreadTail(state.entries, tail),
    before: state.complete ? undefined : (state.before ?? cursor),
    complete: state.complete,
    replaced: false,
  };
}
