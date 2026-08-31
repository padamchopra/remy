import { run } from "./run.js";

export interface PullRequestFileRequest {
  repository: string;
  head: string;
  base?: string;
  path: string;
}

export interface PullRequestFileContent {
  text: string;
  revision: string;
}

const MAX_BYTES = 1_000_000;
const MAX_LINES = 20_000;
const cache = new Map<string, Promise<PullRequestFileContent>>();

export function validPullRequestFileRequest(value: PullRequestFileRequest): boolean {
  return /^[\w.-]+\/[\w.-]+$/.test(value.repository)
    && /^[a-f0-9]{40}$/i.test(value.head)
    && (value.base === undefined || /^[a-f0-9]{40}$/i.test(value.base))
    && value.path.length > 0 && value.path.length <= 4096
    && !/[\x00-\x1f\x7f\\]/.test(value.path)
    && !value.path.split("/").some((part) => !part || part === "." || part === "..");
}

export function parsePullRequestFileContent(raw: string, revision: string): PullRequestFileContent {
  const response = JSON.parse(raw);
  if (response.errors?.length) throw new Error("Couldn't read this file from GitHub. Try again.");
  const blob = response.data?.repository?.object;
  if (!blob || blob.__typename !== "Blob") throw new Error("This file isn't available at this revision.");
  if (blob.isBinary) throw new Error("This binary file has no text preview.");
  if (blob.isTruncated || blob.byteSize > MAX_BYTES) throw new Error("This file is too large to preview. Open it on GitHub.");
  if (typeof blob.text !== "string") throw new Error("This file has no text preview.");
  if (Buffer.byteLength(blob.text) > MAX_BYTES || blob.text.split("\n").length > MAX_LINES) {
    throw new Error("This file is too large to preview. Open it on GitHub.");
  }
  return { text: blob.text, revision };
}

/// Immutable revisions need no invalidation; rejected reads stay retryable.
export function pullRequestFileContent(request: PullRequestFileRequest): Promise<PullRequestFileContent> {
  if (!validPullRequestFileRequest(request)) return Promise.reject(new Error("A repository, commit, and relative file path are required."));
  const key = JSON.stringify(request);
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = readFile(request).catch((error) => {
    if (cache.get(key) === pending) cache.delete(key);
    if (error && typeof error === "object" && "cmd" in error) {
      throw new Error("Couldn't read this file from GitHub. Check your connection and try again.");
    }
    throw error;
  });
  cache.set(key, pending);
  if (cache.size > 32) cache.delete(cache.keys().next().value!);
  return pending;
}

async function readFile({ repository, head, base, path }: PullRequestFileRequest): Promise<PullRequestFileContent> {
  let revision = head;
  if (base) {
    // Deleted files belong to the PR's merge base, not today's base branch.
    const comparison = await run("gh", ["api", `repos/${repository}/compare/${base}...${head}`, "--jq", ".merge_base_commit.sha"], { timeout: 15_000 });
    revision = comparison.stdout.trim();
    if (!/^[a-f0-9]{40}$/i.test(revision)) throw new Error("Couldn't find this file's base revision. Try again.");
  }
  const [owner, name] = repository.split("/");
  const result = await run("gh", [
    "api", "graphql", "-f", "query=query($owner:String!,$name:String!,$expression:String!){repository(owner:$owner,name:$name){object(expression:$expression){__typename ... on Blob{byteSize isBinary isTruncated text}}}}",
    "-f", `owner=${owner}`, "-f", `name=${name}`, "-f", `expression=${revision}:${path}`,
  ], { timeout: 15_000, maxBuffer: 8 * MAX_BYTES });
  return parsePullRequestFileContent(result.stdout, revision);
}
