/// What the Files tab reads from GitHub beside the diff: which files you
/// marked viewed, the review conversations on the lines, and which of their
/// comments are still in your pending review. Parsing only; the reads and
/// writes live on `GitHubConnection`.

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
  /// Still in your pending review: only you can see it until you submit.
  pending: boolean;
  author: ReviewAuthor;
}

export interface ReviewThread {
  id: string;
  path: string;
  /// Where the conversation sits in the current diff; null once outdated.
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  originalStartLine: number | null;
  side: DiffSide;
  startSide: DiffSide | null;
  isResolved: boolean;
  isOutdated: boolean;
  /// A conversation about the whole file rather than a line.
  file: boolean;
  comments: ReviewComment[];
}

export const REVIEW_FILES_PAGE = 100;
export const REVIEW_FILES_MAX_PAGES = 30;
export const REVIEW_THREADS_PAGE = 50;
export const REVIEW_THREADS_MAX_PAGES = 10;
export const REVIEW_BODY_MAX = 65_000;

const VIEWED = new Set(["VIEWED", "UNVIEWED", "DISMISSED"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nodes(value: unknown): unknown[] {
  const list = record(value).nodes;
  return Array.isArray(list) ? list : [];
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function side(value: unknown): DiffSide | null {
  return value === "LEFT" || value === "RIGHT" ? value : null;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/// A GitHub login as an author carries it. Bots and deleted accounts are not
/// valid user logins, so this keeps anything printable rather than dropping
/// the comment.
function authorLogin(value: unknown) {
  const login = text(record(value).login, 100).replace(/[^\w.[\]-]/g, "");
  return login || "ghost";
}

function https(value: unknown): string | null {
  return typeof value === "string" && /^https:\/\//.test(value) ? value.slice(0, 2_000) : null;
}

export function reviewAuthor(value: unknown): ReviewAuthor {
  const actor = record(value);
  const name = typeof actor.name === "string" && actor.name.trim() ? actor.name.trim().slice(0, 120) : null;
  return { login: authorLogin(actor), name, avatarUrl: https(actor.avatarUrl) };
}

/// GitHub's viewed state by path, as `files` reports it for the viewer.
export function viewedStates(files: unknown[]): Record<string, ViewedState> {
  const out: Record<string, ViewedState> = {};
  for (const node of files) {
    const file = record(node);
    const path = text(file.path, 4_000);
    if (!path || !VIEWED.has(String(file.viewerViewedState))) continue;
    out[path] = file.viewerViewedState as ViewedState;
  }
  return out;
}

export function reviewThreads(threads: unknown[]): ReviewThread[] {
  return threads.flatMap((node) => {
    const thread = record(node);
    const id = text(thread.id, 200);
    const path = text(thread.path, 4_000);
    if (!id || !path) return [];
    const comments = nodes(thread.comments).flatMap((value) => {
      const comment = record(value);
      const commentId = text(comment.id, 200);
      if (!commentId) return [];
      return [{
        id: commentId,
        databaseId: positive(comment.databaseId),
        body: text(comment.body, REVIEW_BODY_MAX),
        createdAt: text(comment.createdAt, 40),
        url: https(comment.url),
        pending: comment.state === "PENDING",
        author: reviewAuthor(comment.author),
      } satisfies ReviewComment];
    });
    if (!comments.length) return [];
    return [{
      id,
      path,
      line: positive(thread.line),
      startLine: positive(thread.startLine),
      originalLine: positive(thread.originalLine),
      originalStartLine: positive(thread.originalStartLine),
      side: side(thread.diffSide) ?? "RIGHT",
      startSide: side(thread.startDiffSide),
      isResolved: thread.isResolved === true,
      isOutdated: thread.isOutdated === true,
      file: thread.subjectType === "FILE",
      comments,
    } satisfies ReviewThread];
  });
}

/// Where a new line comment goes, checked before anything reaches GitHub:
/// a path, a line on one side, and for a range a start line before it on
/// that same side.
export function lineCommentTarget(input: Record<string, unknown>) {
  const path = typeof input.path === "string" ? input.path : "";
  const line = positive(input.line);
  const lineSide = side(input.side);
  const startLine = input.startLine === undefined || input.startLine === null ? null : positive(input.startLine);
  const startSide = input.startSide === undefined || input.startSide === null ? lineSide : side(input.startSide);
  if (!path || path.length > 4_000 || path.startsWith("/") || path.split("/").includes("..") || !line || !lineSide)
    return undefined;
  if (input.startLine !== undefined && input.startLine !== null && (!startLine || startSide !== lineSide || startLine > line))
    return undefined;
  return { path, line, side: lineSide, startLine: startLine && startLine < line ? startLine : null };
}

export function reviewBody(input: Record<string, unknown>, required = true) {
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (body.length > REVIEW_BODY_MAX) return undefined;
  if (required && !body) return undefined;
  return body;
}

export const REVIEW_EVENTS = new Set(["COMMENT", "APPROVE", "REQUEST_CHANGES"]);
