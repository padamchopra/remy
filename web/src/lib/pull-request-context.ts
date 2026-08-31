import type { PullRequestDiffFile, PullRequestDiffLine } from "../state/types";

export interface ContextGap {
  oldStart: number;
  newStart: number;
  count?: number;
  fromEnd: boolean;
}

export function fileLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
}

/// Reject a raced or stale PR patch instead of mixing two revisions.
export function validateFileContext(file: PullRequestDiffFile, lines: string[]): void {
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      const index = file.deleted ? line.oldLine : line.newLine;
      if (index !== null && lines[index - 1] !== line.text) {
        throw new Error("This file doesn't match the diff. Refresh the pull request and try again.");
      }
    }
  }
}

export function fileContextGaps(file: PullRequestDiffFile): ContextGap[] {
  if (file.deleted) return [];
  let oldEnd = 1;
  let newEnd = 1;
  const gaps: ContextGap[] = [];
  for (const [index, hunk] of file.hunks.entries()) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(hunk.header);
    if (!match) return [];
    const oldCount = Number(match[2] ?? 1);
    const newCount = Number(match[4] ?? 1);
    const oldStart = Number(match[1]) + Number(oldCount === 0);
    const newStart = Number(match[3]) + Number(newCount === 0);
    const count = newStart - newEnd;
    if (count < 0 || oldStart - oldEnd !== count) return [];
    gaps.push({ oldStart: oldEnd, newStart: newEnd, count, fromEnd: index === 0 });
    oldEnd = oldStart + oldCount;
    newEnd = newStart + newCount;
  }
  gaps.push({ oldStart: oldEnd, newStart: newEnd, fromEnd: false });
  return gaps;
}

export function contextGapLines(gap: ContextGap, lines: string[], shown: number): PullRequestDiffLine[] {
  const count = gap.count ?? Math.max(0, lines.length - gap.newStart + 1);
  const length = Math.min(shown, count);
  const offset = gap.fromEnd ? count - length : 0;
  return lines.slice(gap.newStart - 1 + offset, gap.newStart - 1 + offset + length).map((text, index) => ({
    kind: "ctx",
    text,
    oldLine: gap.oldStart + offset + index,
    newLine: gap.newStart + offset + index,
  }));
}
