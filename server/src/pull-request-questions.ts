import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { callPeer, getPeer, peerViews } from "./peers.js";
import { answerPullRequestQuestion } from "./pull-request-guides.js";
import type { PullRequestDiffLine } from "./pull-requests.js";

export interface PullRequestQuestionSource {
  path: string;
  head?: string;
  header: string;
  lines: PullRequestDiffLine[];
}

export interface PullRequestQuestion {
  id: string;
  repository: string;
  number: number;
  source: PullRequestQuestionSource;
  start: number;
  end: number;
  question: string;
  answer: string;
  provider: string;
  model: string;
  createdAt: number;
}

export function validQuestionSource(value: unknown): value is PullRequestQuestionSource {
  if (!value || typeof value !== "object") return false;
  const source = value as PullRequestQuestionSource;
  return typeof source.path === "string" && source.path.length > 0 && source.path.length <= 4096
    && !source.path.split("/").some((part) => !part || part === "." || part === "..")
    && (source.head === undefined || typeof source.head === "string" && /^[a-f0-9]{40}$/i.test(source.head))
    && typeof source.header === "string" && source.header.length <= 4096
    && Array.isArray(source.lines) && source.lines.length > 0 && source.lines.length <= 4000
    && source.lines.every((line) => line && ["add", "del", "ctx"].includes(line.kind)
      && typeof line.text === "string" && [line.oldLine, line.newLine].every((number) => number === null || Number.isInteger(number) && number > 0))
    && JSON.stringify(source).length <= 400_000;
}

function validQuestion(value: unknown, repository: string, number: number): value is PullRequestQuestion {
  if (!value || typeof value !== "object") return false;
  const question = value as PullRequestQuestion;
  return question.repository === repository && question.number === number && validQuestionSource(question.source)
    && [question.id, question.question, question.answer, question.provider, question.model].every((field) => typeof field === "string")
    && Number.isInteger(question.start) && Number.isInteger(question.end) && question.start >= 0
    && question.end >= question.start && question.end < question.source.lines.length && Number.isFinite(question.createdAt);
}

export function readPullRequestQuestions(repository: string, number: number): PullRequestQuestion[] {
  const rows = db.prepare("select json from pull_request_questions where repository = ? and number = ? order by created_at, id").all(repository, number) as { json: string }[];
  return rows.flatMap((row) => {
    try { const value: unknown = JSON.parse(row.json); return validQuestion(value, repository, number) ? [value] : []; }
    catch { return []; }
  });
}

const discovering = new Map<string, Promise<{ questions: PullRequestQuestion[]; unavailable: boolean }>>();

/// Questions are immutable and remain on the device that answered them.
export function discoverPullRequestQuestions(repository: string, number: number) {
  const key = JSON.stringify([repository, number]);
  const existing = discovering.get(key);
  if (existing) return existing;
  const params = new URLSearchParams({ repository, number: String(number) });
  let unavailable = false;
  const peers = peerViews();
  const pending = Promise.all(peers.filter((peer) => peer.online).map(async (view) => {
    try {
      const peer = getPeer(view.id);
      if (!peer) return [];
      const result = await callPeer<{ questions?: unknown }>(peer, `/pull-requests/questions?${params}`, { timeoutMs: 2500 });
      if (!Array.isArray(result.questions)) throw new Error("Invalid question response");
      return result.questions.filter((value) => validQuestion(value, repository, number));
    } catch { unavailable = true; return []; }
  })).then((batches) => ({
    questions: [...new Map([...readPullRequestQuestions(repository, number), ...batches.flat()].map((question) => [question.id, question])).values()]
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    unavailable: unavailable || peers.some((peer) => !peer.online),
  })).finally(() => discovering.delete(key));
  discovering.set(key, pending);
  return pending;
}

export async function askPullRequestQuestion(input: {
  repository: string; number: number; source?: unknown; start?: unknown; end?: unknown; question?: unknown;
  chatId?: string; choice?: { provider?: unknown; model?: unknown; effort?: unknown };
}, answer = answerPullRequestQuestion): Promise<PullRequestQuestion> {
  const { source } = input;
  if (!validQuestionSource(source)) throw new Error("Choose lines in this diff and try again.");
  const start = Number(input.start), end = Number(input.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= source.lines.length || end - start >= 200) {
    throw new Error("Choose lines in this diff and try again.");
  }
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!question || question.length > 4000) throw new Error("Write a question under 4,000 characters.");
  const result = await answer({ ...input, hunk: { ...source, id: "selected" }, start, end, question });
  const saved: PullRequestQuestion = {
    id: randomUUID(), repository: input.repository, number: input.number, source, start, end, question,
    answer: result.answer, provider: result.choice.provider, model: result.choice.model, createdAt: Date.now(),
  };
  db.prepare("insert into pull_request_questions(id, repository, number, json, created_at) values (?, ?, ?, ?, ?)")
    .run(saved.id, saved.repository, saved.number, JSON.stringify(saved), saved.createdAt);
  return saved;
}
