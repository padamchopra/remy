/// Which words changed inside a diff, the way GitHub marks them: a run of
/// deleted lines followed straight away by added ones is one change, its
/// lines pair up in order, and each pair is compared word by word. Only the
/// words that differ are marked; a pair too different to compare usefully,
/// or a line too long to be worth it, keeps its plain line colour.

/// A character range of a line, end exclusive.
export type WordRange = readonly [start: number, end: number];

interface DiffLineLike {
  kind: "add" | "del" | "ctx";
  text: string;
}

/// Below this share of characters in common, a marked pair reads as noise.
export const WORD_SIMILARITY = 0.4;
/// Past this many characters a line is data, not something to read by word.
export const WORD_LINE_LIMIT = 1_000;
/// Tokens compared per pair at most, so one pair cannot stall the diff.
const TOKEN_LIMIT = 400;

const TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

/// Words, runs of whitespace, and each punctuation mark on its own.
export function diffTokens(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/// For each token of `left` and `right`, whether it is outside their longest
/// common subsequence.
function changedTokens(left: string[], right: string[]): [boolean[], boolean[]] {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const table = new Uint16Array(rows * columns);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      table[i * columns + j] = left[i] === right[j]
        ? table[(i + 1) * columns + j + 1]! + 1
        : Math.max(table[(i + 1) * columns + j]!, table[i * columns + j + 1]!);
    }
  }
  const leftChanged = left.map(() => true);
  const rightChanged = right.map(() => true);
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      leftChanged[i++] = false;
      rightChanged[j++] = false;
    } else if (table[(i + 1) * columns + j]! >= table[i * columns + j + 1]!) i++;
    else j++;
  }
  return [leftChanged, rightChanged];
}

/// Changed tokens as character ranges. Two marks with only whitespace
/// between them join, so a changed phrase is one mark rather than a row of
/// separate ones.
function ranges(text: string, tokens: string[], changed: boolean[]): WordRange[] {
  const out: [number, number][] = [];
  let offset = 0;
  tokens.forEach((token, index) => {
    const start = offset;
    offset += token.length;
    if (!changed[index]) return;
    const last = out.at(-1);
    if (last && !text.slice(last[1], start).trim()) last[1] = offset;
    else out.push([start, offset]);
  });
  // Whitespace at a mark's edge is where the comparison lined up spaces
  // differently, not a change anyone reads.
  return out.flatMap(([start, end]) => {
    const slice = text.slice(start, end);
    const from = start + (slice.length - slice.trimStart().length);
    const to = end - (slice.length - slice.trimEnd().length);
    return to > from ? [[from, to] as const] : [];
  });
}

/// The changed words of one deleted line and the added line paired with it,
/// or nothing when the pair should keep plain line colours.
export function wordDiff(before: string, after: string): { before: WordRange[]; after: WordRange[] } | undefined {
  if (before === after || !before.trim() || !after.trim()) return undefined;
  if (before.length > WORD_LINE_LIMIT || after.length > WORD_LINE_LIMIT) return undefined;
  const left = diffTokens(before);
  const right = diffTokens(after);
  if (left.length > TOKEN_LIMIT || right.length > TOKEN_LIMIT) return undefined;
  const [leftChanged, rightChanged] = changedTokens(left, right);
  // Similarity counts what you read, so shared indentation cannot make two
  // unrelated lines look alike.
  const visible = (value: string) => value.replace(/\s+/g, "").length;
  const shared = left.reduce((sum, token, index) => sum + (leftChanged[index] ? 0 : visible(token)), 0);
  if ((2 * shared) / (visible(before) + visible(after)) < WORD_SIMILARITY) return undefined;
  const marked = { before: ranges(before, left, leftChanged), after: ranges(after, right, rightChanged) };
  if (!marked.before.length && !marked.after.length) return undefined;
  return marked;
}

/// Word marks for a hunk's lines, by line index. Each change block's deleted
/// lines pair with its added lines in order; extras on either side stay plain.
export function hunkWordDiff(lines: readonly DiffLineLike[]): Map<number, WordRange[]> {
  const out = new Map<number, WordRange[]>();
  let index = 0;
  while (index < lines.length) {
    if (lines[index]!.kind !== "del") { index++; continue; }
    const deleted: number[] = [];
    while (index < lines.length && lines[index]!.kind === "del") deleted.push(index++);
    const added: number[] = [];
    while (index < lines.length && lines[index]!.kind === "add") added.push(index++);
    for (let pair = 0; pair < Math.min(deleted.length, added.length); pair++) {
      const marked = wordDiff(lines[deleted[pair]!]!.text, lines[added[pair]!]!.text);
      if (!marked) continue;
      if (marked.before.length) out.set(deleted[pair]!, marked.before);
      if (marked.after.length) out.set(added[pair]!, marked.after);
    }
  }
  return out;
}

/// A line cut into plain and marked pieces, for drawing.
export function splitByRanges(text: string, marks: readonly WordRange[] | undefined): { text: string; marked: boolean }[] {
  if (!marks?.length) return [{ text, marked: false }];
  const out: { text: string; marked: boolean }[] = [];
  let at = 0;
  for (const [start, end] of marks) {
    if (start > at) out.push({ text: text.slice(at, start), marked: false });
    out.push({ text: text.slice(start, end), marked: true });
    at = end;
  }
  if (at < text.length) out.push({ text: text.slice(at), marked: false });
  return out;
}
