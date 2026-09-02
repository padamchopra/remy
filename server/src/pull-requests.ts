import { run as exec } from "./run.js";
import { pullRequestStacks, type PullRequestStack } from "./pull-request-stacks.js";
import { listWorkspaces, type Workspace } from "./workspaces.js";

export interface PullRequestCheck {
  name: string;
  state: "pass" | "fail" | "pending" | "skipping";
}

export interface PullRequestComment {
  author: string;
  body: string;
  createdAt: string | null;
  path?: string | null;
  line?: number | null;
}

export type PullRequestTimelineKind = "commit" | "comment" | "review" | "review_comment";

export interface PullRequestTimelineItem {
  id: string;
  kind: PullRequestTimelineKind;
  author: string;
  body: string;
  createdAt: string;
  url: string;
  sha?: string | null;
  state?: string | null;
  path?: string | null;
  line?: number | null;
}

export interface AuthoredPullRequest {
  stack?: PullRequestStack | null;
  url: string;
  number: number;
  title: string;
  body: string;
  repository: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  reviewDecision: string;
  authorLogin: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  checks: PullRequestCheck[];
  comments: PullRequestComment[];
  unreadComments: PullRequestComment[];
  unreadSince: string | null;
  latestCommentAt: string | null;
  hasUnreadActivity: boolean;
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
  worktreePath: string | null;
}

export interface PullRequestDiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface PullRequestDiffHunk {
  header: string;
  lines: PullRequestDiffLine[];
}

export interface PullRequestDiffFile {
  path: string;
  previousPath?: string;
  deleted?: boolean;
  hunks: PullRequestDiffHunk[];
  viewed?: boolean;
}

export interface PullRequestDiff {
  nodeId?: string;
  headRefOid?: string;
  baseRefOid?: string;
  url: string;
  repository: string;
  number: number;
  title: string;
  body: string;
  baseRefName: string;
  headRefName: string;
  state: string;
  isDraft: boolean;
  mergeable: string;
  mergeStateStatus: string;
  reviewDecision: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  checks: PullRequestCheck[];
  files: PullRequestDiffFile[];
}

const CACHE_TTL_MS = 60_000;
let cache: { at: number; pullRequests: AuthoredPullRequest[] } | null = null;

export async function listAuthoredPullRequests(refresh = false): Promise<AuthoredPullRequest[]> {
  if (!refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.pullRequests;
  const workspaces = await listWorkspaces();
  const unread = await unreadPullRequestAttention();
  const batches = await Promise.all(workspaces.map((workspace) => pullRequestsForWorkspace(workspace, unread)));
  const byURL = new Map<string, AuthoredPullRequest>();
  for (const pullRequest of batches.flat()) {
    const existing = byURL.get(pullRequest.url);
    // Prefer the workspace copy that can resolve the PR branch to a worktree.
    if (!existing || (!existing.worktreePath && pullRequest.worktreePath)) byURL.set(pullRequest.url, pullRequest);
  }
  const pullRequests = [...byURL.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  cache = { at: Date.now(), pullRequests };
  return pullRequests;
}

export interface MergedPullRequest {
  url: string;
  number: number;
  title: string;
  repository: string;
  headRefName: string;
  mergedAt: string | null;
  workspaceId: string;
}

const MERGED_CACHE_TTL_MS = 60_000;
const mergedCache = new Map<string, { at: number; pullRequests: MergedPullRequest[] }>();

/// The pull requests you have merged lately in one workspace.
///
/// `listAuthoredPullRequests` asks only for open ones, and a merged pull request
/// is a whole signal of its own — a ticket that landed — so this is a second,
/// smaller question rather than a wider version of that one. `@me` is the same
/// author: a pull request Remy opened for a ticket was opened from here.
export async function listMergedPullRequests(workspace: Workspace, limit = 50): Promise<MergedPullRequest[]> {
  const cached = mergedCache.get(workspace.id);
  if (cached && Date.now() - cached.at < MERGED_CACHE_TTL_MS) return cached.pullRequests;
  try {
    const { stdout } = await exec(
      "gh",
      [
        "pr", "list", "--author", "@me", "--state", "merged", "--limit", String(limit),
        "--json", "url,number,title,headRefName,mergedAt",
      ],
      { cwd: workspace.path, timeout: 30_000 },
    );
    const pullRequests = parseMergedPullRequests(stdout, workspace);
    mergedCache.set(workspace.id, { at: Date.now(), pullRequests });
    return pullRequests;
  } catch (error) {
    const detail = String((error as { stderr?: unknown })?.stderr ?? error ?? "").trim();
    if (detail && !/not logged into|not a git repository|no remotes found/i.test(detail)) {
      console.error(`merged pull request list failed in ${workspace.path}:`, detail);
    }
    return [];
  }
}

export function parseMergedPullRequests(raw: string, workspace: Workspace): MergedPullRequest[] {
  const parsed = JSON.parse(raw || "[]");
  if (!Array.isArray(parsed)) return [];
  const repository = repositoryName(workspace);
  return parsed.flatMap((value: unknown) => {
    const pr = asRecord(value);
    const url = stringValue(pr.url);
    if (!url) return [];
    return [{
      url,
      number: numberValue(pr.number),
      title: stringValue(pr.title) || "Untitled pull request",
      repository,
      headRefName: stringValue(pr.headRefName),
      mergedAt: stringValue(pr.mergedAt) || null,
      workspaceId: workspace.id,
    }];
  });
}

async function pullRequestsForWorkspace(
  workspace: Workspace,
  unread: Map<string, PullRequestAttention>,
): Promise<AuthoredPullRequest[]> {
  try {
    const fields = [
      "url", "number", "title", "body", "headRefName", "baseRefName", "isDraft", "reviewDecision", "author",
      "updatedAt", "additions", "deletions", "changedFiles", "comments", "latestReviews", "statusCheckRollup",
    ].join(",");
    const { stdout } = await exec(
      "gh",
      ["pr", "list", "--author", "@me", "--state", "open", "--limit", "100", "--json", fields],
      { cwd: workspace.path, timeout: 30_000 },
    );
    const pullRequests = parseAuthoredPullRequests(stdout, workspace, new Set(unread.keys()));
    const stacks = await pullRequestStacks(repositoryName(workspace), pullRequests.map((pr) => pr.number))
      .catch(() => new Map<number, PullRequestStack | null>());
    for (const pr of pullRequests) {
      if (stacks.has(pr.number)) pr.stack = stacks.get(pr.number);
    }
    return Promise.all(pullRequests.map(async (pullRequest) => {
      const attention = unread.get(pullRequestKey(pullRequest.repository, pullRequest.number));
      if (!attention) return pullRequest;
      const unreadComments = await fetchUnreadReviewComments(workspace, pullRequest, attention);
      const latestUnreadAt = unreadComments
        .map((comment) => comment.createdAt)
        .filter((date): date is string => Boolean(date))
        .sort()
        .pop() ?? null;
      return {
        ...pullRequest,
        unreadComments,
        unreadSince: attention.lastReadAt,
        latestCommentAt: [pullRequest.latestCommentAt, latestUnreadAt]
          .filter((date): date is string => Boolean(date))
          .sort()
          .pop() ?? null,
      };
    }));
  } catch (error) {
    const detail = String((error as { stderr?: unknown })?.stderr ?? error ?? "").trim();
    if (detail && !/not logged into|not a git repository|no remotes found/i.test(detail)) {
      console.error(`pull request list failed in ${workspace.path}:`, detail);
    }
    return [];
  }
}

export function parseAuthoredPullRequests(
  raw: string,
  workspace: Workspace,
  unread: Set<string> = new Set(),
): AuthoredPullRequest[] {
  const parsed = JSON.parse(raw || "[]");
  if (!Array.isArray(parsed)) return [];
  const repository = repositoryName(workspace);
  return parsed.flatMap((value: unknown) => {
    const pr = asRecord(value);
    const url = stringValue(pr.url);
    if (!url) return [];
    const headRefName = stringValue(pr.headRefName);
    const comments = parseComments(pr.comments, pr.latestReviews);
    const latestCommentAt = comments
      .map((comment) => comment.createdAt)
      .filter((date): date is string => Boolean(date))
      .sort()
      .pop() ?? null;
    return [{
      url,
      number: numberValue(pr.number),
      title: stringValue(pr.title) || "Untitled pull request",
      body: stringValue(pr.body),
      repository,
      headRefName,
      baseRefName: stringValue(pr.baseRefName),
      isDraft: Boolean(pr.isDraft),
      reviewDecision: stringValue(pr.reviewDecision).toUpperCase(),
      authorLogin: stringValue(asRecord(pr.author).login),
      updatedAt: stringValue(pr.updatedAt) || new Date(0).toISOString(),
      additions: numberValue(pr.additions),
      deletions: numberValue(pr.deletions),
      changedFiles: numberValue(pr.changedFiles),
      checks: parseChecks(pr.statusCheckRollup),
      comments,
      unreadComments: [],
      unreadSince: null,
      latestCommentAt,
      hasUnreadActivity: unread.has(pullRequestKey(repository, numberValue(pr.number))),
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspacePath: workspace.path,
      worktreePath: workspace.worktrees.find((worktree) => worktree.branch === headRefName)?.path ?? null,
    }];
  });
}

function parseChecks(value: unknown): PullRequestCheck[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const check = asRecord(entry);
    const name = stringValue(check.name) || stringValue(check.context) || stringValue(check.workflowName);
    if (!name) return [];
    const conclusion = (stringValue(check.conclusion) || stringValue(check.state)).toUpperCase();
    const status = stringValue(check.status).toUpperCase();
    let state: PullRequestCheck["state"] = "pending";
    if (["SUCCESS", "NEUTRAL"].includes(conclusion)) state = "pass";
    else if (["SKIPPED", "EXPECTED"].includes(conclusion)) state = "skipping";
    else if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(conclusion)) state = "fail";
    else if (status === "COMPLETED" && !conclusion) state = "pass";
    return [{ name, state }];
  });
}

function parseComments(commentsValue: unknown, reviewsValue: unknown): PullRequestComment[] {
  const combined = [
    ...(Array.isArray(commentsValue) ? commentsValue : []),
    ...(Array.isArray(reviewsValue) ? reviewsValue : []),
  ];
  return combined.flatMap((entry: unknown) => {
    const comment = asRecord(entry);
    const body = stringValue(comment.body).trim();
    if (!body) return [];
    const author = asRecord(comment.author);
    return [{
      author: stringValue(author.login) || "GitHub user",
      body: body.length > 500 ? `${body.slice(0, 500)}…` : body,
      createdAt: stringValue(comment.createdAt) || stringValue(comment.submittedAt) || null,
    }];
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

interface PullRequestAttention {
  threadId: string;
  lastReadAt: string | null;
  updatedAt: string | null;
}

async function unreadPullRequestAttention(): Promise<Map<string, PullRequestAttention>> {
  try {
    const { stdout } = await exec("gh", ["api", "notifications", "--paginate", "--slurp"], { timeout: 30_000 });
    const pages = JSON.parse(stdout || "[]");
    if (!Array.isArray(pages)) return new Map();
    const notifications = pages.flatMap((page: unknown) => Array.isArray(page) ? page : [page]);
    const result = new Map<string, PullRequestAttention>();
    for (const value of notifications) {
      const notification = asRecord(value);
      const subject = asRecord(notification.subject);
      if (stringValue(subject.type) !== "PullRequest") continue;
      const apiURL = stringValue(subject.url);
      const match = apiURL.match(/\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)/);
      if (!match) continue;
      result.set(pullRequestKey(match[1], Number(match[2])), {
        threadId: stringValue(notification.id),
        lastReadAt: stringValue(notification.last_read_at) || null,
        updatedAt: stringValue(notification.updated_at) || null,
      });
    }
    return result;
  } catch {
    return new Map();
  }
}

async function fetchUnreadReviewComments(
  workspace: Workspace,
  pullRequest: AuthoredPullRequest,
  attention: PullRequestAttention,
): Promise<PullRequestComment[]> {
  try {
    const { stdout } = await exec(
      "gh",
      ["api", `repos/${pullRequest.repository}/pulls/${pullRequest.number}/comments`, "--paginate", "--slurp"],
      { cwd: workspace.path, timeout: 30_000 },
    );
    return parseUnreadReviewComments(stdout, attention.lastReadAt, attention.updatedAt, pullRequest.authorLogin);
  } catch {
    return [];
  }
}

export function parseUnreadReviewComments(
  raw: string,
  lastReadAt: string | null,
  notificationUpdatedAt: string | null,
  authorLogin = "",
): PullRequestComment[] {
  const parsed = JSON.parse(raw || "[]");
  if (!Array.isArray(parsed)) return [];
  const entries = parsed.flatMap((page: unknown) => Array.isArray(page) ? page : [page]);
  const readAt = Date.parse(lastReadAt ?? "");
  const notificationAt = Date.parse(notificationUpdatedAt ?? "");
  // A notification with no prior read marker is normally the first activity on
  // a PR. Bound that initial window around GitHub's notification timestamp so
  // Remy never labels months of historical discussion as unread.
  const cutoff = Number.isFinite(readAt)
    ? readAt
    : Number.isFinite(notificationAt) ? notificationAt - 15 * 60 * 1000 : Date.now() - 24 * 60 * 60 * 1000;

  return entries.flatMap((value: unknown) => {
    const comment = asRecord(value);
    const user = asRecord(comment.user);
    const author = stringValue(user.login);
    const createdAt = stringValue(comment.created_at);
    if (!author || !createdAt || Date.parse(createdAt) <= cutoff) return [];
    if (authorLogin && author.toLowerCase() === authorLogin.toLowerCase()) return [];
    if (stringValue(user.type).toLowerCase() === "bot" || /\[bot\]$/i.test(author)) return [];
    const body = reviewCommentExcerpt(stringValue(comment.body));
    if (!body) return [];
    return [{
      author,
      body,
      createdAt,
      path: stringValue(comment.path) || null,
      line: numberValue(comment.line) || numberValue(comment.original_line) || null,
    }];
  })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 12);
}

export async function markPullRequestRead(repository: string, number: number): Promise<boolean> {
  const attention = (await unreadPullRequestAttention()).get(pullRequestKey(repository, number));
  if (!attention?.threadId) return false;
  await exec("gh", ["api", "--method", "PATCH", `notifications/threads/${attention.threadId}`], { timeout: 30_000 });
  cache = null;
  return true;
}

export function markPullRequestReadyArgs(repository: string, number: number): string[] {
  return ["pr", "ready", String(number), "--repo", repository];
}

export async function markPullRequestReady(repository: string, number: number): Promise<void> {
  await exec("gh", markPullRequestReadyArgs(repository, number), { timeout: 30_000 });
  cache = null;
}

interface PullRequestMergeState {
  state: string;
  isDraft: boolean;
  mergeable: string;
  mergeStateStatus: string;
  headRefOid: string;
}

export function parsePullRequestMergeState(raw: string): PullRequestMergeState {
  const value = asRecord(JSON.parse(raw || "{}"));
  return {
    state: stringValue(value.state).toUpperCase(),
    isDraft: value.isDraft === true,
    mergeable: stringValue(value.mergeable).toUpperCase(),
    mergeStateStatus: stringValue(value.mergeStateStatus).toUpperCase(),
    headRefOid: stringValue(value.headRefOid),
  };
}

export function squashMergePullRequestArgs(input: {
  repository: string;
  number: number;
  headRefOid: string;
  title: string;
  message: string;
}): string[] {
  return [
    "pr", "merge", String(input.number),
    "--repo", input.repository,
    "--squash",
    "--subject", input.title,
    "--body", input.message,
    "--match-head-commit", input.headRefOid,
  ];
}

export function pullRequestMergeBlocker(current: PullRequestMergeState, expectedHeadRefOid: string): string {
  if (current.state !== "OPEN") return "Only an open pull request can be merged.";
  if (current.isDraft) return "Mark this pull request ready before merging.";
  if (current.headRefOid !== expectedHeadRefOid) return "This pull request changed. Refresh it before merging.";
  if (current.mergeable !== "MERGEABLE" || current.mergeStateStatus !== "CLEAN") {
    return "This pull request isn't ready to merge. Refresh it and try again.";
  }
  return "";
}

export async function squashMergePullRequest(input: {
  repository: string;
  number: number;
  headRefOid: string;
  title: string;
  message: string;
}): Promise<void> {
  const fields = "state,isDraft,mergeable,mergeStateStatus,headRefOid";
  const { stdout } = await exec(
    "gh",
    ["pr", "view", String(input.number), "--repo", input.repository, "--json", fields],
    { timeout: 30_000 },
  );
  const current = parsePullRequestMergeState(stdout);
  const blocker = pullRequestMergeBlocker(current, input.headRefOid);
  if (blocker) throw new Error(blocker);
  await exec("gh", squashMergePullRequestArgs(input), { timeout: 60_000 });
  cache = null;
  mergedCache.clear();
}

const PULL_REQUEST_FILES_QUERY = `query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$number){id files(first:100,after:$after){nodes{path viewerViewedState}pageInfo{hasNextPage endCursor}}}}}`;
const MARK_FILE_VIEWED_MUTATION = `mutation($pullRequestId:ID!,$path:String!){markFileAsViewed(input:{pullRequestId:$pullRequestId,path:$path}){pullRequest{id}}}`;
const UNMARK_FILE_VIEWED_MUTATION = `mutation($pullRequestId:ID!,$path:String!){unmarkFileAsViewed(input:{pullRequestId:$pullRequestId,path:$path}){pullRequest{id}}}`;

interface PullRequestFileViewPage {
  pullRequestId: string;
  files: Array<{ path: string; viewed: boolean }>;
  nextCursor?: string;
}

export function parsePullRequestFileViewPage(raw: string): PullRequestFileViewPage {
  const data = asRecord(asRecord(JSON.parse(raw || "{}")).data);
  const pullRequest = asRecord(asRecord(data.repository).pullRequest);
  const files = asRecord(pullRequest.files);
  const pageInfo = asRecord(files.pageInfo);
  const nodes = Array.isArray(files.nodes) ? files.nodes : [];
  return {
    pullRequestId: stringValue(pullRequest.id),
    files: nodes.flatMap((value): Array<{ path: string; viewed: boolean }> => {
      const file = asRecord(value);
      const path = stringValue(file.path);
      return path ? [{ path, viewed: stringValue(file.viewerViewedState).toUpperCase() === "VIEWED" }] : [];
    }),
    ...(pageInfo.hasNextPage && stringValue(pageInfo.endCursor)
      ? { nextCursor: stringValue(pageInfo.endCursor) }
      : {}),
  };
}

async function pullRequestFileViews(repository: string, number: number): Promise<{ pullRequestId: string; viewed: Map<string, boolean> }> {
  const [owner, name] = repository.split("/");
  if (!owner || !name) throw new Error("repository is required");
  const viewed = new Map<string, boolean>();
  let pullRequestId = "";
  let after: string | undefined;
  do {
    const args = [
      "api", "graphql",
      "-f", `query=${PULL_REQUEST_FILES_QUERY}`,
      "-F", `owner=${owner}`,
      "-F", `name=${name}`,
      "-F", `number=${number}`,
      ...(after ? ["-F", `after=${after}`] : []),
    ];
    const page = parsePullRequestFileViewPage((await exec("gh", args, { timeout: 30_000 })).stdout);
    pullRequestId ||= page.pullRequestId;
    for (const file of page.files) viewed.set(file.path, file.viewed);
    after = page.nextCursor;
  } while (after);
  if (!pullRequestId) throw new Error("pull request was not found");
  return { pullRequestId, viewed };
}

export async function pullRequestFileReviewState(repository: string, number: number): Promise<{
  nodeId: string;
  files: Array<{ path: string; viewed: boolean }>;
}> {
  const result = await pullRequestFileViews(repository, number);
  return {
    nodeId: result.pullRequestId,
    files: Array.from(result.viewed, ([path, viewed]) => ({ path, viewed })),
  };
}

export function markPullRequestFileViewedArgs(pullRequestId: string, path: string, viewed: boolean): string[] {
  return [
    "api", "graphql",
    "-f", `query=${viewed ? MARK_FILE_VIEWED_MUTATION : UNMARK_FILE_VIEWED_MUTATION}`,
    "-F", `pullRequestId=${pullRequestId}`,
    "-F", `path=${path}`,
  ];
}

export async function markPullRequestFileViewed(pullRequestId: string, path: string, viewed: boolean): Promise<void> {
  await exec("gh", markPullRequestFileViewedArgs(pullRequestId, path, viewed), { timeout: 30_000 });
}

export async function pullRequestTimeline(repository: string, number: number): Promise<PullRequestTimelineItem[]> {
  const base = `repos/${repository}`;
  const [commits, comments, reviews, reviewComments] = await Promise.all([
    timelineRequest(`${base}/pulls/${number}/commits`),
    timelineRequest(`${base}/issues/${number}/comments`),
    timelineRequest(`${base}/pulls/${number}/reviews`),
    timelineRequest(`${base}/pulls/${number}/comments`),
  ]);
  return parsePullRequestTimeline(commits, comments, reviews, reviewComments);
}

export async function pullRequestDiff(repository: string, number: number, cwd?: string): Promise<PullRequestDiff> {
  const fields = [
    "number", "title", "url", "body", "baseRefName", "headRefName", "baseRefOid", "headRefOid", "state", "isDraft",
    "mergeable", "mergeStateStatus", "reviewDecision", "additions", "deletions", "changedFiles", "statusCheckRollup",
  ].join(",");
  const options = { ...(cwd ? { cwd } : {}), timeout: 30_000 };
  const [view, fileViews] = await Promise.all([
    exec("gh", ["pr", "view", String(number), "--repo", repository, "--json", fields], options),
    pullRequestFileViews(repository, number).catch(() => undefined),
  ]);
  const metadata = asRecord(JSON.parse(view.stdout));
  const base = stringValue(metadata.baseRefOid);
  const head = stringValue(metadata.headRefOid);
  if (!/^[a-f0-9]{40}$/i.test(base) || !/^[a-f0-9]{40}$/i.test(head)) throw new Error("Couldn't resolve this pull request's commits. Try again.");
  // Pin both the aggregate diff and later context reads before the branch can move.
  const patch = await exec("gh", ["api", `repos/${repository}/compare/${base}...${head}`, "-H", "Accept: application/vnd.github.diff"], { ...options, maxBuffer: 20 * 1024 * 1024 });
  const result = parsePullRequestView(view.stdout, patch.stdout, repository, number);
  if (!fileViews) return result;
  return {
    ...result,
    nodeId: fileViews.pullRequestId,
    files: result.files.map((file) => ({ ...file, viewed: fileViews.viewed.get(file.path) ?? false })),
  };
}

export function parsePullRequestView(
  raw: string,
  patch: string,
  repository: string,
  number: number,
): PullRequestDiff {
  const metadata = asRecord(JSON.parse(raw || "{}"));
  return {
    url: stringValue(metadata.url) || `https://github.com/${repository}/pull/${number}`,
    ...(metadata.headRefOid ? { headRefOid: stringValue(metadata.headRefOid) } : {}),
    ...(metadata.baseRefOid ? { baseRefOid: stringValue(metadata.baseRefOid) } : {}),
    repository,
    number,
    title: stringValue(metadata.title) || `Pull request #${number}`,
    body: stringValue(metadata.body),
    baseRefName: stringValue(metadata.baseRefName),
    headRefName: stringValue(metadata.headRefName),
    state: stringValue(metadata.state).toUpperCase() || "OPEN",
    isDraft: Boolean(metadata.isDraft),
    mergeable: stringValue(metadata.mergeable).toUpperCase() || "UNKNOWN",
    mergeStateStatus: stringValue(metadata.mergeStateStatus).toUpperCase() || "UNKNOWN",
    reviewDecision: stringValue(metadata.reviewDecision).toUpperCase(),
    additions: numberValue(metadata.additions),
    deletions: numberValue(metadata.deletions),
    changedFiles: numberValue(metadata.changedFiles),
    checks: parseChecks(metadata.statusCheckRollup),
    files: parsePullRequestPatch(patch),
  };
}

export async function pullRequestDiffForCwd(cwd: string): Promise<PullRequestDiff> {
  const fields = "number,title,url,baseRefName,headRefName";
  const { stdout } = await exec("gh", ["pr", "view", "--json", fields], { cwd, timeout: 30_000 });
  const metadata = asRecord(JSON.parse(stdout || "{}"));
  const url = stringValue(metadata.url);
  const match = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!match) throw new Error("this branch does not have a pull request");
  return pullRequestDiff(match[1], Number(match[2]), cwd);
}

export function parsePullRequestPatch(raw: string): PullRequestDiffFile[] {
  const files: PullRequestDiffFile[] = [];
  let file: PullRequestDiffFile | undefined;
  let hunk: PullRequestDiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const line of raw.split(/\r?\n/)) {
    const fileMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (fileMatch) {
      file = {
        path: fileMatch[2],
        ...(fileMatch[1] !== fileMatch[2] ? { previousPath: fileMatch[1] } : {}),
        hunks: [],
      };
      files.push(file);
      hunk = undefined;
      continue;
    }
    if (file && line.startsWith("deleted file mode ")) file.deleted = true;
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (file && hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk || line === "\\ No newline at end of file") continue;
    if (line.startsWith("+")) {
      hunk.lines.push({ kind: "add", text: line.slice(1), oldLine: null, newLine });
      newLine += 1;
    } else if (line.startsWith("-")) {
      hunk.lines.push({ kind: "del", text: line.slice(1), oldLine, newLine: null });
      oldLine += 1;
    } else if (line.startsWith(" ")) {
      hunk.lines.push({ kind: "ctx", text: line.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  return files;
}

async function timelineRequest(endpoint: string): Promise<string> {
  try {
    return (await exec("gh", ["api", endpoint, "--paginate", "--slurp"], { timeout: 30_000 })).stdout;
  } catch {
    return "[]";
  }
}

export function parsePullRequestTimeline(
  commitsRaw: string,
  commentsRaw: string,
  reviewsRaw: string,
  reviewCommentsRaw: string,
): PullRequestTimelineItem[] {
  const commits = timelineEntries(commitsRaw).flatMap((value): PullRequestTimelineItem[] => {
    const entry = asRecord(value);
    const sha = stringValue(entry.sha);
    const commit = asRecord(entry.commit);
    const author = asRecord(entry.author);
    const commitAuthor = asRecord(commit.author);
    const createdAt = stringValue(commitAuthor.date);
    const body = stringValue(commit.message);
    if (!sha || !createdAt || !body) return [];
    return [{
      id: `commit:${sha}`,
      kind: "commit",
      author: stringValue(author.login) || stringValue(commitAuthor.name) || "GitHub user",
      body,
      createdAt,
      url: stringValue(entry.html_url),
      sha,
    }];
  });

  const comments = timelineEntries(commentsRaw).flatMap((value): PullRequestTimelineItem[] => {
    const entry = asRecord(value);
    const id = numberValue(entry.id);
    const user = asRecord(entry.user);
    const createdAt = stringValue(entry.created_at);
    const body = reviewCommentBody(stringValue(entry.body));
    if (!id || !createdAt || !body) return [];
    return [{
      id: `comment:${id}`,
      kind: "comment",
      author: stringValue(user.login) || "GitHub user",
      body,
      createdAt,
      url: stringValue(entry.html_url),
    }];
  });

  const reviews = timelineEntries(reviewsRaw).flatMap((value): PullRequestTimelineItem[] => {
    const entry = asRecord(value);
    const id = numberValue(entry.id);
    const user = asRecord(entry.user);
    const createdAt = stringValue(entry.submitted_at);
    const state = stringValue(entry.state).toUpperCase();
    const body = reviewCommentBody(stringValue(entry.body));
    if (!id || !createdAt || (!body && !["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(state))) return [];
    return [{
      id: `review:${id}`,
      kind: "review",
      author: stringValue(user.login) || "GitHub user",
      body,
      createdAt,
      url: stringValue(entry.html_url),
      state,
      sha: stringValue(entry.commit_id) || null,
    }];
  });

  const reviewComments = timelineEntries(reviewCommentsRaw).flatMap((value): PullRequestTimelineItem[] => {
    const entry = asRecord(value);
    const id = numberValue(entry.id);
    const user = asRecord(entry.user);
    const createdAt = stringValue(entry.created_at);
    const body = reviewCommentBody(stringValue(entry.body));
    if (!id || !createdAt || !body) return [];
    return [{
      id: `review-comment:${id}`,
      kind: "review_comment",
      author: stringValue(user.login) || "GitHub user",
      body,
      createdAt,
      url: stringValue(entry.html_url),
      sha: stringValue(entry.commit_id) || null,
      path: stringValue(entry.path) || null,
      line: numberValue(entry.line) || numberValue(entry.original_line) || null,
    }];
  });

  return [...commits, ...comments, ...reviews, ...reviewComments]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function timelineEntries(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((page: unknown) => Array.isArray(page) ? page : [page]);
  } catch {
    return [];
  }
}

function reviewCommentExcerpt(body: string): string {
  const cleaned = body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<details>[\s\S]*?<\/details>/gi, " ")
    .replace(/[`*_>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 240 ? `${cleaned.slice(0, 240).trim()}…` : cleaned;
}

function reviewCommentBody(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, "").trim();
}

function repositoryName(workspace: Workspace): string {
  const origin = workspace.origin ?? "";
  const parts = origin.replace(/\.git$/, "").split("/").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join("/") : workspace.name;
}

function pullRequestKey(repository: string, number: number): string {
  return `${repository.toLowerCase()}#${number}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
