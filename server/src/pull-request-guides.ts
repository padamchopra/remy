import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { agentCommand } from "./agent.js";
import { getChat } from "./chat.js";
import { codexAnswer } from "./codex.js";
import { config } from "./config.js";
import { cursorAnswer } from "./cursor.js";
import { db } from "./db.js";
import { callPeer, getPeer, peerViews } from "./peers.js";
import { parsePullRequestPatch, pullRequestDiff, type PullRequestDiffLine } from "./pull-requests.js";
import { providerEffort, providerId, providerModel, type ProviderId } from "./providers.js";
import { run as exec } from "./run.js";
import { listWorkspaces } from "./workspaces.js";

export interface PullRequestGuideCommit {
  sha: string;
  title: string;
  author: string;
  committedAt: string;
}

export interface PullRequestGuideHunk {
  id: string;
  path: string;
  header: string;
  lines: PullRequestDiffLine[];
}

export interface PullRequestGuideStep {
  id: string;
  title: string;
  summary: string;
  hunkIds: string[];
}

export interface PullRequestGuideQuestion {
  id: string;
  stepId: string;
  hunkId: string;
  start: number;
  end: number;
  question: string;
  answer: string;
  createdAt: number;
}

export interface PullRequestGuide {
  repository: string;
  number: number;
  provider: ProviderId;
  model: string;
  effort: string;
  commitShas: string[];
  commits: PullRequestGuideCommit[];
  hunks: PullRequestGuideHunk[];
  steps: PullRequestGuideStep[];
  uncoveredHunkIds: string[];
  questions: PullRequestGuideQuestion[];
  createdAt: number;
}

export interface PullRequestGuideChoice {
  provider: ProviderId;
  model: string;
  effort: string;
}

interface ModelStep {
  title?: unknown;
  summary?: unknown;
  hunks?: unknown;
}

const GUIDE_TIMEOUT_MS = 90_000;
const GUIDE_PROMPT_CHARS = 80_000;
const MAX_PATCH_CHARS = 600_000;
const UNCOVERED_STEP_ID = "uncovered";
const discoveringGuides = new Map<string, Promise<SavedPullRequestGuide>>();
const generatingGuides = new Map<string, Promise<PullRequestGuide>>();

export interface SavedPullRequestGuide {
  guide?: PullRequestGuide;
  peerId?: string;
}

export function discoverPullRequestGuide(repository: string, number: number): Promise<SavedPullRequestGuide> {
  const local = readSavedPullRequestGuide(repository, number);
  if (local) return Promise.resolve({ guide: local });
  const key = JSON.stringify([repository, number]);
  const existing = discoveringGuides.get(key);
  if (existing) return existing;
  const params = new URLSearchParams({ repository, number: String(number) });
  const reads = peerViews().filter((peer) => peer.online).map(async (view): Promise<SavedPullRequestGuide> => {
    const peer = getPeer(view.id);
    if (!peer) throw new Error("that device is no longer paired");
    const result = await callPeer<{ guide?: unknown }>(peer, `/pull-requests/guide/saved?${params}`, { timeoutMs: 2_500 });
    if (!isSavedGuide(result?.guide, repository, number)) throw new Error("that device has no saved guide");
    return { guide: result.guide, peerId: peer.id };
  });
  const pending = Promise.any(reads)
    .catch((): SavedPullRequestGuide => ({}))
    .finally(() => { discoveringGuides.delete(key); });
  discoveringGuides.set(key, pending);
  return pending;
}

export async function pullRequestGuideContext(
  repository: string,
  number: number,
  chatId?: string,
): Promise<{ guide?: PullRequestGuide; commits: PullRequestGuideCommit[]; defaultChoice: PullRequestGuideChoice }> {
  const guide = readSavedPullRequestGuide(repository, number);
  if (guide) return {
    guide,
    commits: guide.commits,
    defaultChoice: { provider: guide.provider, model: guide.model, effort: guide.effort },
  };
  return {
    commits: await pullRequestGuideCommits(repository, number),
    defaultChoice: await guideDefaultChoice(repository, chatId),
  };
}

interface GenerateGuideInput {
  repository: string;
  number: number;
  chatId?: string;
  provider?: unknown;
  model?: unknown;
  effort?: unknown;
  commitShas?: unknown;
}

export function generatePullRequestGuide(input: GenerateGuideInput): Promise<PullRequestGuide> {
  const saved = readSavedPullRequestGuide(input.repository, input.number);
  if (saved) return Promise.resolve(saved);
  const key = JSON.stringify([input.repository, input.number]);
  const existing = generatingGuides.get(key);
  if (existing) return existing;
  const pending = buildPullRequestGuide(input).finally(() => { generatingGuides.delete(key); });
  generatingGuides.set(key, pending);
  return pending;
}

async function buildPullRequestGuide(input: GenerateGuideInput): Promise<PullRequestGuide> {
  const commits = await pullRequestGuideCommits(input.repository, input.number);
  if (commits.length === 0) throw new Error("this pull request has no commits to review");
  const selected = selectedCommits(commits, input.commitShas);
  const inherited = await guideDefaultChoice(input.repository, input.chatId);
  const choice = validateChoice(input, inherited);
  const patch = await patchForSelection(input.repository, input.number, commits, selected);
  if (!patch.trim()) throw new Error("the selected commits have no text changes to guide");
  if (patch.length > MAX_PATCH_CHARS) throw new Error("the selected changes are too large for one guide");
  const hunks = flattenGuideHunks(parsePullRequestPatch(patch));
  if (hunks.length === 0) throw new Error("the selected commits have no changes to guide");

  const answer = await modelAnswer(choice, guidePrompt(input.repository, input.number, selected, hunks));
  const hunkIds = hunks.map((hunk) => hunk.id);
  const steps = parseGuideSteps(answer, hunkIds);
  const guide: PullRequestGuide = {
    repository: input.repository,
    number: input.number,
    ...choice,
    commitShas: selected.map((commit) => commit.sha),
    commits: selected,
    hunks,
    steps,
    uncoveredHunkIds: uncoveredGuideHunkIds(steps, hunkIds),
    questions: [],
    createdAt: Date.now(),
  };
  saveGuide(guide);
  return guide;
}

export async function askPullRequestGuideQuestion(input: {
  repository: string;
  number: number;
  stepId?: unknown;
  hunkId?: unknown;
  start?: unknown;
  end?: unknown;
  question?: unknown;
}): Promise<PullRequestGuide> {
  const guide = readSavedPullRequestGuide(input.repository, input.number);
  if (!guide) throw new Error("start the guide before asking a question");
  const stepId = String(input.stepId ?? "");
  const hunkId = String(input.hunkId ?? "");
  const step = guide.steps.find((entry) => entry.id === stepId);
  const hunk = guide.hunks.find((entry) => entry.id === hunkId);
  const uncovered = uncoveredGuideHunkIds(guide.steps, guide.hunks.map((entry) => entry.id));
  const uncoveredStep = stepId === UNCOVERED_STEP_ID && uncovered.includes(hunkId)
    ? {
        id: UNCOVERED_STEP_ID,
        title: "Changes the guide missed",
        summary: "These changes are in the selected diff but not in a generated step.",
        hunkIds: uncovered,
      }
    : undefined;
  const question = String(input.question ?? "").trim().slice(0, 4_000);
  const askedStart = Number(input.start);
  const askedEnd = Number(input.end);
  if ((!step && !uncoveredStep) || !hunk || !(step ?? uncoveredStep)?.hunkIds.includes(hunk.id) || !question) {
    throw new Error("choose lines in this guide and ask a question");
  }
  if (!Number.isInteger(askedStart) || !Number.isInteger(askedEnd)) throw new Error("choose lines in this guide and ask a question");
  const start = Math.max(0, Math.min(askedStart, askedEnd));
  const end = Math.min(hunk.lines.length - 1, Math.max(askedStart, askedEnd));
  if (start > end) throw new Error("choose lines in this guide and ask a question");

  const answer = await modelAnswer(guide, questionPrompt(guide, step ?? uncoveredStep!, hunk, start, end, question));
  const latest = readSavedPullRequestGuide(input.repository, input.number);
  if (!latest || latest.createdAt !== guide.createdAt) {
    throw new Error("the guide changed while this answer was being written");
  }
  latest.questions.push({
    id: randomUUID(),
    stepId,
    hunkId,
    start,
    end,
    question,
    answer: answer.trim(),
    createdAt: Date.now(),
  });
  saveGuide(latest);
  return latest;
}

export async function pullRequestGuideCommits(repository: string, number: number): Promise<PullRequestGuideCommit[]> {
  const { stdout } = await exec(
    "gh",
    ["api", "--paginate", "--slurp", `repos/${repository}/pulls/${number}/commits?per_page=100`],
    { timeout: 30_000 },
  );
  const pages = JSON.parse(stdout || "[]") as unknown;
  const rows = Array.isArray(pages) ? pages.flatMap((page) => Array.isArray(page) ? page : []) : [];
  return rows.flatMap((value) => {
    const row = record(value);
    const commit = record(row.commit);
    const author = record(row.author);
    const commitAuthor = record(commit.author);
    const sha = text(row.sha);
    if (!/^[a-f0-9]{40}$/i.test(sha)) return [];
    return [{
      sha,
      title: text(commit.message).split("\n")[0] || sha.slice(0, 7),
      author: text(author.login) || text(commitAuthor.name) || "Unknown author",
      committedAt: text(commitAuthor.date),
    }];
  });
}

export function parseGuideSteps(raw: string, hunkIds: string[]): PullRequestGuideStep[] {
  const parsed = parseJsonObject(raw);
  const candidates = Array.isArray(parsed.steps) ? parsed.steps : [];
  const available = new Set(hunkIds);
  const used = new Set<string>();
  const steps: PullRequestGuideStep[] = [];
  for (const value of candidates) {
    const row = record(value) as ModelStep;
    const title = text(row.title).trim().slice(0, 120);
    const summary = text(row.summary).trim().slice(0, 1_500);
    const hunks = Array.isArray(row.hunks)
      ? [...new Set(row.hunks.map(String))].filter((id) => available.has(id) && !used.has(id))
      : [];
    if (!title || !summary || hunks.length === 0) continue;
    hunks.forEach((id) => used.add(id));
    steps.push({ id: randomUUID(), title, summary, hunkIds: hunks });
  }
  return steps;
}

export function uncoveredGuideHunkIds(steps: PullRequestGuideStep[], hunkIds: string[]): string[] {
  const surfaced = new Set(steps.flatMap((step) => step.hunkIds));
  return hunkIds.filter((id) => !surfaced.has(id));
}

function selectedCommits(commits: PullRequestGuideCommit[], value: unknown): PullRequestGuideCommit[] {
  const asked = Array.isArray(value) ? new Set(value.map(String)) : new Set(commits.map((commit) => commit.sha));
  const selected = commits.filter((commit) => asked.has(commit.sha));
  if (selected.length === 0) throw new Error("choose at least one commit");
  if (selected.length !== asked.size) throw new Error("one of those commits is not in this pull request");
  return selected;
}

async function patchForSelection(
  repository: string,
  number: number,
  commits: PullRequestGuideCommit[],
  selected: PullRequestGuideCommit[],
): Promise<string> {
  if (selected.length === commits.length && selected.every((commit, index) => commit.sha === commits[index]?.sha)) {
    const diff = await pullRequestDiff(repository, number);
    return serializeFiles(diff.files);
  }
  const patches: string[] = [];
  for (const commit of selected) {
    const { stdout } = await exec(
      "gh",
      ["api", `repos/${repository}/commits/${commit.sha}`, "-H", "Accept: application/vnd.github.diff"],
      { timeout: 30_000 },
    );
    patches.push(stdout);
  }
  return patches.join("\n");
}

function serializeFiles(files: Awaited<ReturnType<typeof pullRequestDiff>>["files"]): string {
  return files.flatMap((file) => [
    `diff --git a/${file.previousPath ?? file.path} b/${file.path}`,
    ...file.hunks.flatMap((hunk) => [
      hunk.header,
      ...hunk.lines.map((line) => `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`),
    ]),
  ]).join("\n");
}

export function flattenGuideHunks(files: ReturnType<typeof parsePullRequestPatch>): PullRequestGuideHunk[] {
  let next = 1;
  return files.flatMap((file) => file.hunks.length > 0
    ? file.hunks.map((hunk) => ({
        id: `H${next++}`,
        path: file.path,
        header: hunk.header,
        lines: hunk.lines,
      }))
    : [{
        id: `H${next++}`,
        path: file.path,
        header: file.previousPath ? `Renamed from ${file.previousPath}` : "No text preview",
        lines: [],
      }]);
}

async function guideDefaultChoice(repository: string, chatId?: string): Promise<PullRequestGuideChoice> {
  const chat = chatId ? getChat(chatId) : undefined;
  if (chat) return fastDefault(validateChoice(chat, machineChoice()));
  const origin = `github.com/${repository}`.toLowerCase();
  const workspace = (await listWorkspaces()).find((entry) => entry.origin?.toLowerCase() === origin);
  if (workspace?.provider) return fastDefault(validateChoice(workspace, machineChoice()));
  return fastDefault(machineChoice());
}

function fastDefault(choice: PullRequestGuideChoice): PullRequestGuideChoice {
  return { ...choice, effort: providerEffort(choice.provider, choice.model, "low") || choice.effort };
}

function machineChoice(): PullRequestGuideChoice {
  return { provider: config.defaultProvider, model: config.defaultModel, effort: config.defaultEffort };
}

function validateChoice(value: { provider?: unknown; model?: unknown; effort?: unknown }, fallback: PullRequestGuideChoice): PullRequestGuideChoice {
  const provider = providerId(value.provider, fallback.provider);
  if (!config.enabledProviders.includes(provider)) throw new Error("that provider is turned off");
  agentCommand(provider);
  const model = providerModel(provider, value.model ?? fallback.model);
  const effort = providerEffort(provider, model, value.effort ?? fallback.effort);
  return { provider, model, effort };
}

function guidePrompt(
  repository: string,
  number: number,
  commits: PullRequestGuideCommit[],
  hunks: PullRequestGuideHunk[],
): string {
  const changeText = compactGuideHunks(hunks);
  return [
    `Organize ${repository} pull request #${number} into a fast guided reading order.`,
    "This is not a code review. Do not search for bugs, reason deeply, or use tools.",
    "Group the supplied diff hunk IDs into at most six coherent steps in the order a reviewer should read them.",
    "Each step needs a concrete title and a concise explanation of about four or five short lines covering intent, behavior, and what to verify.",
    "Prefer behavior and dependency boundaries over file-by-file grouping. Keep tightly related implementation and tests together.",
    "Do not invent code or findings. Use only supplied hunk IDs and do not spend time checking coverage; Remy handles omissions.",
    'Reply as JSON only: {"steps":[{"title":"...","summary":"...","hunks":["H1","H2"]}]}.',
    "Selected commits:",
    ...commits.map((commit) => `- ${commit.sha.slice(0, 7)} ${commit.title}`),
    "Diff hunks:",
    changeText,
  ].join("\n\n");
}

export function compactGuideHunks(hunks: PullRequestGuideHunk[]): string {
  const sections: string[] = [];
  let length = 0;
  for (const hunk of hunks) {
    const additions = hunk.lines.filter((line) => line.kind === "add").length;
    const deletions = hunk.lines.filter((line) => line.kind === "del").length;
    const changedLines = hunk.lines
      .filter((line) => line.kind !== "ctx")
      .map((line) => `${line.kind === "add" ? "+" : "-"}${line.text}`);
    const excerpt: string[] = [];
    let excerptLength = 0;
    for (const line of changedLines) {
      if (excerpt.length >= 24 || excerptLength + line.length > 1_600) break;
      excerpt.push(line);
      excerptLength += line.length;
    }
    const section = [
      `### ${hunk.id} ${hunk.path.slice(0, 240)}`,
      `${hunk.header.slice(0, 240)} (+${additions} -${deletions})`,
      ...excerpt,
      ...(excerpt.length < changedLines.length ? [`… ${changedLines.length - excerpt.length} more changed lines`] : []),
    ].join("\n");
    const separatorLength = sections.length > 0 ? 2 : 0;
    if (length + separatorLength + section.length > GUIDE_PROMPT_CHARS) break;
    sections.push(section);
    length += separatorLength + section.length;
  }
  return sections.join("\n\n");
}

function questionPrompt(
  guide: PullRequestGuide,
  step: PullRequestGuideStep,
  hunk: PullRequestGuideHunk,
  start: number,
  end: number,
  question: string,
): string {
  const selected = hunk.lines.slice(start, end + 1);
  const contextStart = Math.max(0, start - 12);
  const contextEnd = Math.min(hunk.lines.length, end + 13);
  const context = hunk.lines.slice(contextStart, contextEnd).map((line, index) => {
    const actual = contextStart + index;
    const marker = actual >= start && actual <= end ? ">" : " ";
    const prefix = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
    return `${marker}${prefix}${line.text}`;
  }).join("\n");
  return [
    `Answer a reviewer's question about ${guide.repository} pull request #${guide.number}.`,
    `Guide step: ${step.title}\n${step.summary}`,
    `File: ${hunk.path}\nHunk: ${hunk.header}`,
    "Lines marked with > are selected. Answer directly in a few concise paragraphs. Explain the code in this pull request; do not claim to have inspected anything outside the supplied context.",
    `Question: ${question}`,
    `Selected lines: ${selected.length}`,
    `Context:\n${context}`,
  ].join("\n\n");
}

async function modelAnswer(choice: PullRequestGuideChoice, prompt: string): Promise<string> {
  const command = agentCommand(choice.provider)!;
  if (choice.provider === "codex") {
    return codexAnswer({ command, prompt, cwd: homedir(), model: choice.model, effort: choice.effort, timeoutMs: GUIDE_TIMEOUT_MS });
  }
  if (choice.provider === "cursor") {
    return (await cursorAnswer({ command, prompt, cwd: homedir(), model: choice.model, effort: choice.effort, timeoutMs: GUIDE_TIMEOUT_MS })) ?? "";
  }
  const options: Options = {
    cwd: homedir(),
    pathToClaudeCodeExecutable: command,
    systemPrompt: "You create accurate, concise code-review guides from supplied diffs. You never use tools or inspect files outside the prompt.",
    settingSources: [],
    maxTurns: 1,
    tools: [],
    allowedTools: [],
    ...(choice.model ? { model: choice.model } : {}),
    ...(choice.effort ? { effort: choice.effort as NonNullable<Options["effort"]> } : {}),
  };
  const handle = query({ prompt, options });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; handle.close(); }, GUIDE_TIMEOUT_MS);
  timer.unref?.();
  try {
    let answer = "";
    for await (const message of handle) {
      if (message.type !== "assistant") continue;
      for (const block of message.message.content) if (block.type === "text") answer += block.text;
    }
    if (timedOut) throw new Error("the model took too long; choose a faster model and try again");
    return answer;
  } catch (error) {
    if (timedOut) throw new Error("the model took too long; choose a faster model and try again");
    throw error;
  } finally {
    clearTimeout(timer);
    handle.close();
  }
}

export function readSavedPullRequestGuide(repository: string, number: number): PullRequestGuide | undefined {
  const row = db.prepare("select json from pull_request_guides where repository = ? and number = ?").get(repository, number) as
    | { json?: string }
    | undefined;
  if (!row?.json) return undefined;
  try {
    const guide: unknown = JSON.parse(row.json);
    return isSavedGuide(guide, repository, number) ? guide : undefined;
  } catch {
    return undefined;
  }
}

function isSavedGuide(value: unknown, repository: string, number: number): value is PullRequestGuide {
  const guide = record(value);
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string");
  return guide.repository === repository && guide.number === number
    && ["claude", "codex", "cursor"].includes(String(guide.provider))
    && typeof guide.model === "string" && typeof guide.effort === "string"
    && typeof guide.createdAt === "number" && strings(guide.commitShas)
    && Array.isArray(guide.commits) && guide.commits.every((value) => {
      const commit = record(value);
      return [commit.sha, commit.title, commit.author, commit.committedAt].every((field) => typeof field === "string");
    })
    && Array.isArray(guide.hunks) && guide.hunks.every((value) => {
      const hunk = record(value);
      return [hunk.id, hunk.path, hunk.header].every((field) => typeof field === "string")
        && Array.isArray(hunk.lines) && hunk.lines.every((value) => {
          const line = record(value);
          return ["add", "del", "ctx"].includes(String(line.kind)) && typeof line.text === "string"
            && [line.oldLine, line.newLine].every((field) => field === null || Number.isInteger(field));
        });
    })
    && Array.isArray(guide.steps) && guide.steps.every((value) => {
      const step = record(value);
      return [step.id, step.title, step.summary].every((field) => typeof field === "string") && strings(step.hunkIds);
    })
    && Array.isArray(guide.questions) && guide.questions.every((value) => {
      const question = record(value);
      return [question.id, question.stepId, question.hunkId, question.question, question.answer].every((field) => typeof field === "string")
        && [question.start, question.end, question.createdAt].every((field) => typeof field === "number");
    });
}

function saveGuide(guide: PullRequestGuide): void {
  db.prepare(
    `insert into pull_request_guides (repository, number, json, updated_at) values (?, ?, ?, ?)
     on conflict(repository, number) do update set json = excluded.json, updated_at = excluded.updated_at`,
  ).run(guide.repository, guide.number, JSON.stringify(guide), Date.now());
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
  const source = (fenced ?? raw).trim();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    return record(JSON.parse(source.slice(start, end + 1)));
  } catch {
    return {};
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
