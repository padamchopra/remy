import { run } from "./run.js";

export interface PullRequestStack {
  number: number;
  position: number;
  size: number;
  baseRefName: string;
  entries?: {
    position: number;
    number: number;
    title: string;
    state: string;
    isDraft: boolean;
  }[];
}

/// Stack membership comes only from GitHub, never from matching branch names.
export function pullRequestStackQuery(repository: string, numbers: number[], entries = false): string {
  const [owner, name, extra] = repository.split("/");
  if (!owner || !name || extra || numbers.some((number) => !Number.isSafeInteger(number) || number <= 0)) {
    throw new Error("choose a repository and pull request number");
  }
  const members = entries ? "entries(first: 100) { nodes { position pullRequest { number title state isDraft } } }" : "";
  const fields = [...new Set(numbers)].map((number) => `pr${number}: pullRequest(number: ${number}) {
    stackEntry { position }
    stack { number size baseRefName ${members} }
  }`).join("\n");
  return `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${fields} } }`;
}

export async function pullRequestStacks(repository: string, numbers: number[], entries = false): Promise<Map<number, PullRequestStack | null>> {
  const result = new Map<number, PullRequestStack | null>();
  const unique = [...new Set(numbers)];
  for (let offset = 0; offset < unique.length; offset += 100) {
    const batch = unique.slice(offset, offset + 100);
    const { stdout } = await run("gh", ["api", "graphql", "-f", `query=${pullRequestStackQuery(repository, batch, entries)}`], { timeout: 8_000 });
    for (const [number, stack] of parsePullRequestStacks(stdout, batch)) result.set(number, stack);
  }
  return result;
}

export function parsePullRequestStacks(raw: string, numbers: number[]): Map<number, PullRequestStack | null> {
  const response = record(JSON.parse(raw));
  if (Array.isArray(response.errors) && response.errors.length) throw new Error("couldn't read stack information from GitHub");
  const repository = record(record(response.data).repository);
  const result = new Map<number, PullRequestStack | null>();
  for (const number of numbers) {
    const pr = record(repository[`pr${number}`]);
    if (pr.stack === null) { result.set(number, null); continue; }
    const stack = record(pr.stack);
    const position = record(pr.stackEntry).position;
    if (!positive(stack.number) || !positive(stack.size) || !positive(position) || position > stack.size || typeof stack.baseRefName !== "string") continue;
    const nodes = record(stack.entries).nodes;
    const entries = Array.isArray(nodes) ? nodes.flatMap((node) => {
      const entry = record(node);
      const member = record(entry.pullRequest);
      if (!positive(entry.position) || !positive(member.number) || typeof member.title !== "string") return [];
      return [{ position: entry.position, number: member.number, title: member.title,
        state: typeof member.state === "string" ? member.state : "", isDraft: member.isDraft === true }];
    }).sort((a, b) => a.position - b.position) : undefined;
    result.set(number, { number: stack.number, size: stack.size, position, baseRefName: stack.baseRefName, ...(entries ? { entries } : {}) });
  }
  return result;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
