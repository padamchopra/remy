import type { ChatCodeReference, PullRequestQuestionSource } from "../state/types";

export function sameReviewSource(left: PullRequestQuestionSource, right: PullRequestQuestionSource): boolean {
  return left.path === right.path && left.head === right.head && left.header === right.header
    && (left.lines === right.lines || JSON.stringify(left.lines) === JSON.stringify(right.lines));
}

export function reviewReference(source: PullRequestQuestionSource, start: number, end: number, comment: string): ChatCodeReference | undefined {
  const lines = source.lines.slice(start, end + 1);
  if (lines.length > 200 || comment.length > 4000) throw new Error("Choose up to 200 lines and keep your comment under 4,000 characters.");
  const numbers = lines.map((line) => line.newLine ?? line.oldLine).filter((line): line is number => line !== null);
  if (!numbers.length || !comment.trim()) return undefined;
  return { id: crypto.randomUUID(), path: source.path, startLine: Math.min(...numbers), endLine: Math.max(...numbers), lines, comment: comment.trim() };
}

/// How a pinned range of a file reads wherever it is attached — the composer,
/// a sent message, or the review it came from.
export function referenceLabel(reference: Pick<ChatCodeReference, "path" | "startLine" | "endLine">): string {
  const file = reference.path.split("/").at(-1) || reference.path;
  const range = reference.startLine === reference.endLine
    ? `L${reference.startLine}`
    : `L${reference.startLine}-${reference.endLine}`;
  return `${file} (${range})`;
}
