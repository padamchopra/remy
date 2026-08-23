import { homedir } from "node:os";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { agentCommand } from "./agent.js";
import { codexAnswer } from "./codex.js";
import { cursorAnswer } from "./cursor.js";
import { providerId, type ProviderId } from "./providers.js";

/// Names a thread, and the branch its work belongs on, from the message that
/// started it.
///
/// The first line of a request makes a poor title — it is a sentence, often a
/// long one, and it reads as an instruction rather than a subject. One cheap
/// call gets both names, so they always describe the same thing.
///
/// Everything here is best-effort: a thread that cannot be named keeps the
/// title it had and the worktree stays detached, so nothing waits on this and
/// nothing fails because of it.

const SYSTEM = [
  "You name coding sessions.",
  "Given the request that starts one, reply with exactly two lines and nothing else:",
  "Title: a title of at most six words",
  "Branch: two to four lowercase words joined by hyphens",
  "Name the subject, not the instruction: 'Flaky login test' rather than 'Fix the flaky login test'.",
  "No quotes, no trailing punctuation, no preamble, no explanation.",
].join(" ");

/// How long a name is worth waiting for. Past this the thread keeps the one it
/// was created with.
const TIMEOUT_MS = 25_000;
const MAX_TITLE = 60;
/// A branch name lives in a path, a PR title, and everyone else's `git branch`
/// output, so it is held far shorter than the title.
const MAX_BRANCH = 32;
const MAX_BRANCH_WORDS = 4;

export interface ThreadName {
  title: string;
  /// The branch part only — the prefix is a setting, and joined on later.
  branch?: string;
}

/// Trims a model's answer down to something that belongs in a sidebar. Models
/// like to wrap a title in quotes or add a full stop, and a stray paragraph
/// means the answer was not a title at all.
export function cleanTitle(raw: string): string | undefined {
  const line = raw.trim().split("\n").map((entry) => entry.trim()).find(Boolean);
  if (!line) return undefined;
  const stripped = line
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
    .replace(/[.!]+$/, "")
    .trim();
  if (!stripped) return undefined;
  // A model that explains itself has not answered; keep the existing title
  // rather than putting a paragraph in the sidebar.
  if (stripped.length > MAX_TITLE * 2) return undefined;
  return stripped.slice(0, MAX_TITLE);
}

/// The branch part of a name, held to something short enough to live in a path
/// and read in someone else's `git branch`. The model is asked for a short one;
/// this is what makes it so.
export function cleanBranch(raw: string): string | undefined {
  const words = raw
    .toLowerCase()
    .normalize("NFKD")
    // Decomposing leaves the accents behind as their own characters. Dropping
    // them keeps "déjà" one word rather than splitting it where they sat.
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_BRANCH_WORDS);
  if (words.length === 0) return undefined;

  let slug = words.join("-");
  if (slug.length > MAX_BRANCH) {
    // Cut on a word rather than mid-word, unless the first word is the one that
    // is too long.
    slug = slug.slice(0, MAX_BRANCH);
    const lastDash = slug.lastIndexOf("-");
    if (lastDash > 8) slug = slug.slice(0, lastDash);
  }
  slug = slug.replace(/^-+|-+$/g, "");
  return slug || undefined;
}

function parse(answer: string): ThreadName | undefined {
  const titleLine = /^\s*title\s*:\s*(.+)$/im.exec(answer)?.[1];
  const branchLine = /^\s*branch\s*:\s*(.+)$/im.exec(answer)?.[1];
  // A model that ignored the format still usually answered with a title.
  const title = cleanTitle(titleLine ?? answer);
  if (!title) return undefined;
  return { title, branch: cleanBranch(branchLine ?? title) };
}

export async function suggestName(
  request: string,
  provider: ProviderId,
  model: string,
  effort = "",
): Promise<ThreadName | undefined> {
  // `off` is how someone declines this entirely.
  if (model === "off") return undefined;
  const resolved = providerId(provider);
  const answer = resolved === "codex"
    ? await nameWithCodex(request, model, effort)
    : resolved === "cursor"
      ? await nameWithCursor(request, model, effort)
      : await nameWithClaude(request, model, effort);
  return answer ? parse(answer) : undefined;
}

/// Read-only in the home directory, like the Claude side: this is a naming call
/// and it has no business reading the repository.
async function nameWithCodex(request: string, model: string, effort: string): Promise<string | undefined> {
  try {
    return await codexAnswer({
      command: agentCommand("codex")!,
      prompt: `${SYSTEM}\n\nName the session that starts with this request:\n\n${request}`,
      cwd: homedir(),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      timeoutMs: TIMEOUT_MS,
    });
  } catch {
    return undefined;
  }
}

async function nameWithCursor(request: string, model: string, effort: string): Promise<string | undefined> {
  try {
    return await cursorAnswer({
      command: agentCommand("cursor")!,
      prompt: `${SYSTEM}\n\nName the session that starts with this request:\n\n${request}`,
      cwd: homedir(),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      timeoutMs: TIMEOUT_MS,
    });
  } catch {
    return undefined;
  }
}

async function nameWithClaude(request: string, model: string, effort: string): Promise<string | undefined> {
  const options: Options = {
    // Home, not the project: this is a one-shot naming call, and it has no
    // business reading the repository or its CLAUDE.md.
    cwd: homedir(),
    pathToClaudeCodeExecutable: agentCommand("claude"),
    systemPrompt: SYSTEM,
    settingSources: [],
    maxTurns: 1,
    allowedTools: [],
    ...(model ? { model } : {}),
    ...(effort ? { effort: effort as NonNullable<Options["effort"]> } : {}),
  };

  const handle = query({ prompt: `Name the session that starts with this request:\n\n${request}`, options });
  const timeout = setTimeout(() => void handle.interrupt().catch(() => {}), TIMEOUT_MS);
  try {
    let answer = "";
    for await (const message of handle) {
      if (message.type !== "assistant") continue;
      for (const block of message.message.content) {
        if (block.type === "text") answer += block.text;
      }
    }
    return answer;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
