import { isAbsolute, relative } from "node:path";
import { agentByHandle } from "./agents.js";
import { createChat, listChats, sendChatMessage, type ChatSummary } from "./chat.js";
import { getKv, setKv } from "./db.js";
import { listAuthoredPullRequests, type AuthoredPullRequest } from "./pull-requests.js";
import { checkoutPullRequestWorktree } from "./workspaces.js";

const GITHUB_AGENT_HANDLE = "github";
const HANDLED_KEY = "pullRequestMonitorHandled";
const MONITOR_INTERVAL_MS = 60_000;

type HandledPullRequests = Record<string, string>;

function pullRequestKey(pullRequest: AuthoredPullRequest): string {
  return `${pullRequest.repository}#${pullRequest.number}`;
}

export function pullRequestIssue(pullRequest: AuthoredPullRequest): string | undefined {
  const failures = pullRequest.checks.filter((check) => check.state === "fail");
  const lines: string[] = [];
  if (failures.length > 0) {
    lines.push(`Failed checks: ${failures.map((check) => check.name).join(", ")}.`);
  }
  if (pullRequest.reviewDecision === "CHANGES_REQUESTED") {
    lines.push("A reviewer requested changes.");
  }
  if (pullRequest.unreadComments.length > 0) {
    lines.push(`${pullRequest.unreadComments.length} unread review comment${pullRequest.unreadComments.length === 1 ? " needs" : "s need"} attention.`);
  } else if (pullRequest.hasUnreadActivity) {
    lines.push("New review activity needs attention.");
  }
  return lines.length > 0 ? lines.join(" ") : undefined;
}

export function pullRequestFingerprint(pullRequest: AuthoredPullRequest): string {
  return JSON.stringify({
    updatedAt: pullRequest.updatedAt,
    reviewDecision: pullRequest.reviewDecision,
    checks: pullRequest.checks.map((check) => [check.name, check.state]),
    unread: pullRequest.unreadComments.map((comment) => [comment.author, comment.createdAt, comment.path, comment.line]),
    hasUnreadActivity: pullRequest.hasUnreadActivity,
  });
}

function inside(path: string, root: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

export function activePullRequestThread(
  pullRequest: AuthoredPullRequest,
  chats: ChatSummary[],
): ChatSummary | undefined {
  if (!pullRequest.worktreePath) return undefined;
  return chats
    .filter((chat) =>
      (chat.state === "working" || chat.state === "needs_input")
      && inside(chat.cwd, pullRequest.worktreePath!),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

function workPrompt(pullRequest: AuthoredPullRequest, issue: string): string {
  return [
    `Keep ${pullRequest.repository}#${pullRequest.number} moving: ${pullRequest.title}`,
    pullRequest.url,
    "",
    issue,
    "Inspect the current pull request and handle what is actionable. Reuse this branch and do not open another pull request.",
  ].join("\n");
}

let running = false;

export async function monitorPullRequests(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const github = agentByHandle(GITHUB_AGENT_HANDLE);
    if (!github?.autoStart) return;

    const handled = getKv<HandledPullRequests>(HANDLED_KEY) ?? {};
    const next: HandledPullRequests = {};
    const pullRequests = await listAuthoredPullRequests(true);
    for (const pullRequest of pullRequests) {
      const issue = pullRequestIssue(pullRequest);
      if (!issue) continue;
      const key = pullRequestKey(pullRequest);
      const fingerprint = pullRequestFingerprint(pullRequest);
      if (handled[key] === fingerprint) {
        next[key] = fingerprint;
        continue;
      }

      try {
        const prompt = workPrompt(pullRequest, issue);
        const active = activePullRequestThread(pullRequest, listChats());
        if (active) {
          await sendChatMessage(active.id, prompt);
        } else {
          const { workspace, path } = await checkoutPullRequestWorktree(
            pullRequest.workspaceId,
            pullRequest.headRefName,
            pullRequest.number,
          );
          const thread = createChat({
            cwd: path,
            title: `PR #${pullRequest.number}: ${pullRequest.title}`,
            agentId: github.id,
            workspaceDefault: {
              provider: workspace.provider,
              model: workspace.model,
              effort: workspace.effort,
            },
          });
          await sendChatMessage(thread.id, prompt);
        }
        next[key] = fingerprint;
      } catch (error) {
        console.error(`could not handle ${key}:`, error);
      }
    }
    setKv(HANDLED_KEY, next);
  } catch (error) {
    console.error("pull request monitor failed:", error);
  } finally {
    running = false;
  }
}

export function startPullRequestMonitor(): void {
  setTimeout(() => void monitorPullRequests(), 10_000).unref();
  setInterval(() => void monitorPullRequests(), MONITOR_INTERVAL_MS).unref();
}
