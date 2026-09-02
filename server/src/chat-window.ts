import type { ConvEntry } from "./transcript.js";

export interface ChatHistory {
  hasEarlier: boolean;
  before?: string;
}

export interface ChatWindow {
  entries: ConvEntry[];
  history: ChatHistory;
}

/// Keeps complete user turns together: a tool-heavy turn is one reading unit,
/// even when it contains far more rows than the turns around it.
export function chatWindow(
  entries: readonly ConvEntry[],
  turnLimit: number,
  before?: string,
  byteLimit = Number.POSITIVE_INFINITY,
): ChatWindow {
  const end = before === undefined
    ? entries.length
    : entries.findIndex((entry) => entry.id === before);
  if (end < 0) throw new Error("that history cursor is no longer available");

  let start = end;
  let turns = 0;
  while (start > 0) {
    const entry = entries[start - 1];
    start -= 1;
    if (entry.kind === "user") {
      turns += 1;
      if (turns >= turnLimit) break;
    }
  }
  if (turns === 0) start = Math.max(start, end - turnLimit * 4);

  let page = entries.slice(start, end);
  while (page.length > 1 && Buffer.byteLength(JSON.stringify(page)) > byteLimit) {
    const nextTurn = page.findIndex((entry, index) => index > 0 && entry.kind === "user");
    if (nextTurn < 0) break;
    start += nextTurn;
    page = page.slice(nextTurn);
  }
  return {
    entries: page,
    history: {
      hasEarlier: start > 0,
      ...(start > 0 && page[0] ? { before: page[0].id } : {}),
    },
  };
}
