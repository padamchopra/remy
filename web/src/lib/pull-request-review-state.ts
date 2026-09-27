import type { ChatCodeReference, PullRequestDiffHunk, PullRequestDiffLine } from "@/state/types";

/// What the hub reads beside the diff (`github/pull-request-review`): GitHub's
/// viewed state, the review conversations and your pending comments.
export type ViewedState = "VIEWED" | "UNVIEWED" | "DISMISSED";
export type DiffSide = "LEFT" | "RIGHT";

export interface ReviewAuthor {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface ReviewComment {
  id: string;
  databaseId: number | null;
  body: string;
  createdAt: string;
  url: string | null;
  pending: boolean;
  author: ReviewAuthor;
}

export interface ReviewThread {
  id: string;
  path: string;
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  originalStartLine: number | null;
  side: DiffSide;
  startSide: DiffSide | null;
  isResolved: boolean;
  isOutdated: boolean;
  file: boolean;
  comments: ReviewComment[];
}

export interface HostedReview {
  viewer: ReviewAuthor;
  author: string;
  headRefOid: string | null;
  viewed: Record<string, ViewedState>;
  threads: ReviewThread[];
}

/// A file counts as read only while GitHub says VIEWED. DISMISSED means it
/// changed since you read it, so it opens again, unchecked.
export function isViewed(review: Pick<HostedReview, "viewed"> | undefined, path: string): boolean {
  return review?.viewed[path] === "VIEWED";
}

/// Comments waiting in your pending review, which Send review carries.
export function queuedComments(review: Pick<HostedReview, "threads"> | undefined): number {
  return review?.threads.reduce((sum, thread) => sum + thread.comments.filter((comment) => comment.pending).length, 0) ?? 0;
}

/// Your own pull request: GitHub refuses your approval or change request on it.
export function isOwnPullRequest(review: Pick<HostedReview, "viewer" | "author"> | undefined): boolean {
  return Boolean(review?.author && review.viewer.login.toLowerCase() === review.author.toLowerCase());
}

/// The side a row is commented on: a deletion is the old file, everything
/// else the new one, as GitHub places it.
export function lineSide(line: PullRequestDiffLine): DiffSide {
  return line.kind === "del" ? "LEFT" : "RIGHT";
}

export function lineNumberOn(line: PullRequestDiffLine, side: DiffSide): number | null {
  return side === "LEFT" ? line.oldLine : line.newLine;
}

/// Lines chosen in one hunk: where the click started and where shift-click
/// took it.
export interface LineSelection {
  path: string;
  hunk: number;
  anchor: number;
  focus: number;
}

/// Where a selection goes on GitHub: one side, a last line, and a first line
/// when it is a range. A shift-click onto a row that has no number on the
/// anchor's side keeps the range on that side by stopping short of it.
export function selectionTarget(lines: readonly PullRequestDiffLine[], selection: Pick<LineSelection, "anchor" | "focus">) {
  const anchor = lines[selection.anchor];
  if (!anchor) return undefined;
  const side = lineSide(anchor);
  const from = Math.min(selection.anchor, selection.focus);
  const to = Math.max(selection.anchor, selection.focus);
  const numbered = lines.slice(from, to + 1).map((line) => lineNumberOn(line, side)).filter((value): value is number => value !== null);
  if (!numbered.length) return undefined;
  const startLine = Math.min(...numbered);
  const line = Math.max(...numbered);
  return { side, line, startLine: startLine < line ? startLine : null, from, to, lines: lines.slice(from, to + 1) };
}

/// Where shift-click lands: the row itself when it has a number on the
/// anchor's side, otherwise the nearest row back toward the anchor that does.
export function extendSelection(lines: readonly PullRequestDiffLine[], anchor: number, target: number): number {
  const origin = lines[anchor];
  if (!origin) return target;
  const side = lineSide(origin);
  const step = target > anchor ? -1 : 1;
  for (let index = target; index !== anchor; index += step) {
    if (lines[index] && lineNumberOn(lines[index]!, side) !== null) return index;
  }
  return anchor;
}

/// "L170" or "L170–L172", the way the diff header names a range.
export function lineRangeLabel(start: number | null, end: number): string {
  return start && start !== end ? `L${start}–L${end}` : `L${end}`;
}

/// The file, range and lines "Send to thread" carries with the comment.
export function lineCommentReference(path: string, target: NonNullable<ReturnType<typeof selectionTarget>>, comment: string): ChatCodeReference {
  return {
    id: crypto.randomUUID(),
    path,
    startLine: target.startLine ?? target.line,
    endLine: target.line,
    comment: comment.trim(),
    lines: target.lines.slice(0, 200).map((line) => ({ ...line, text: line.text.slice(0, 10_000) })),
  };
}

function rowKeys(line: PullRequestDiffLine): string[] {
  return [
    ...(line.newLine !== null && line.kind !== "del" ? [`RIGHT:${line.newLine}`] : []),
    ...(line.oldLine !== null && line.kind !== "add" ? [`LEFT:${line.oldLine}`] : []),
  ];
}

/// Where each `SIDE:line` sits in a file's diff, as `hunk:row`: the first row
/// that shows that line on that side.
export function diffRowIndex(hunks: readonly PullRequestDiffHunk[]): Map<string, string> {
  const byKey = new Map<string, string>();
  hunks.forEach((hunk, hunkIndex) => hunk.lines.forEach((line, lineIndex) => {
    for (const key of rowKeys(line)) if (!byKey.has(key)) byKey.set(key, `${hunkIndex}:${lineIndex}`);
  }));
  return byKey;
}

/// Conversations placed on a file's diff. A current conversation sits under
/// the row it ends on. One that is outdated, about the whole file, or on a
/// line this diff does not show goes to `elsewhere`, which the file shows
/// folded above its hunks, as GitHub folds outdated conversations.
export function placeThreads(threads: readonly ReviewThread[], path: string, hunks: readonly PullRequestDiffHunk[]) {
  const byKey = diffRowIndex(hunks);
  const atRow = new Map<string, ReviewThread[]>();
  const elsewhere: ReviewThread[] = [];
  for (const thread of threads) {
    if (thread.path !== path) continue;
    const row = !thread.isOutdated && !thread.file && thread.line ? byKey.get(`${thread.side}:${thread.line}`) : undefined;
    if (!row) { elsewhere.push(thread); continue; }
    atRow.set(row, [...(atRow.get(row) ?? []), thread]);
  }
  return { atRow, elsewhere };
}

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/// What Finish review says goes out: "Three comments go out with it."
export function finishReviewSummary(queued: number): string {
  if (queued === 0) return "Only your note and verdict go out.";
  const count = NUMBER_WORDS[queued] ?? queued.toLocaleString();
  return queued === 1 ? "One comment goes out with it." : `${count} comments go out with it.`;
}
