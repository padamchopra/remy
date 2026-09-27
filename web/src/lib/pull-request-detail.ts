/// What one pull request's summary needs beyond the list: read from
/// `github/pull-request` when it opens. Everything is optional, because an
/// older hub answers without that route and the summary still draws.
export interface PullRequestDetailCheck {
  name: string;
  state: "pass" | "fail" | "pending" | "skipping";
  startedAt?: string | null;
  completedAt?: string | null;
  url?: string | null;
  summary?: string | null;
}

export interface PullRequestDetailReviewer {
  login: string;
  name?: string | null;
  state: "REQUESTED" | "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";
}

export interface PullRequestDetail {
  viewer?: string;
  state?: string;
  isDraft?: boolean;
  createdAt?: string;
  mergeable?: string;
  mergeStateStatus?: string;
  headRefOid?: string | null;
  squashMergeAllowed?: boolean;
  authorName?: string | null;
  reviewers?: PullRequestDetailReviewer[];
  checks?: PullRequestDetailCheck[];
  stack?: { number: number; state: string; mergeable: string }[];
}

/// How long a check ran, the way CI says it: "48s", "1m 04s", "1h 02m".
/// Nothing while it has not finished or GitHub gave no times.
export function checkDuration(startedAt?: string | null, completedAt?: string | null): string {
  if (!startedAt || !completedAt) return "";
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/// "4 hours ago", "a minute ago", "3 days ago", for a sentence rather than a
/// list column.
export function timeAgo(value: string | undefined, now = Date.now()): string {
  if (!value) return "";
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  const unit = (count: number, word: string) => count === 1 ? `a${word === "hour" ? "n" : ""} ${word} ago` : `${count} ${word}s ago`;
  if (minutes < 1) return "just now";
  if (minutes < 60) return unit(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 30) return unit(days, "day");
  const months = Math.floor(days / 30);
  if (months < 12) return unit(months, "month");
  return unit(Math.floor(days / 365), "year");
}

/// The clause after the workspace and number: who opened it and when.
export function openedLine(
  pullRequest: { authorLogin?: string; createdAt?: string; updatedAt: string; worktreePath?: string | null },
  detail: PullRequestDetail | undefined,
  now = Date.now(),
): string {
  const mine = detail?.viewer && pullRequest.authorLogin
    ? detail.viewer.toLowerCase() === pullRequest.authorLogin.toLowerCase()
    : Boolean(pullRequest.worktreePath);
  const created = detail?.createdAt || pullRequest.createdAt;
  if (!created) return `Updated ${timeAgo(pullRequest.updatedAt, now)}`;
  const who = mine ? "You" : pullRequest.authorLogin || "Someone";
  return `${who} opened this ${timeAgo(created, now)}`;
}

/// What a stack row ends with. The pull request in front is "You are here";
/// a conflict is the one thing worth colour; merged, closed and draft say so.
export function stackEntryStatus(
  entry: { number: number; state: string; isDraft: boolean },
  current: boolean,
  mergeable?: string,
): { label: string; tone: "muted" | "destructive" } | undefined {
  if (current) return { label: "You are here", tone: "muted" };
  if (entry.state === "MERGED") return { label: "Merged", tone: "muted" };
  if (entry.state === "CLOSED") return { label: "Closed", tone: "muted" };
  if (mergeable === "CONFLICTING") return { label: "Conflicts", tone: "destructive" };
  if (entry.isDraft) return { label: "Draft", tone: "muted" };
  return undefined;
}

/// Why Squash and merge is off, or nothing when it can go.
export function mergeBlocker(
  pullRequest: { isDraft: boolean; state?: string },
  detail: PullRequestDetail | undefined,
): string {
  if (!detail?.mergeable) return "Open this on GitHub to merge it.";
  if ((detail.state ?? pullRequest.state) && (detail.state ?? pullRequest.state) !== "OPEN") return "This pull request is no longer open.";
  if (detail.isDraft ?? pullRequest.isDraft) return "Mark this ready for review before merging.";
  if (detail.squashMergeAllowed === false) return "This repository doesn't allow squash merging.";
  if (detail.mergeable === "CONFLICTING") return "Resolve the conflicts before merging.";
  if (detail.mergeable !== "MERGEABLE") return "GitHub is still checking whether this can merge.";
  if (detail.mergeStateStatus === "BLOCKED") return "Branch protection blocks this merge.";
  if (detail.mergeStateStatus === "BEHIND") return "Update the branch before merging.";
  if (detail.mergeStateStatus === "DIRTY") return "Resolve the conflicts before merging.";
  if (detail.mergeStateStatus === "UNSTABLE" || detail.checks?.some((check) => check.state === "fail")) return "Fix the failing checks before merging.";
  if (detail.checks?.some((check) => check.state === "pending")) return "Wait for the checks to finish.";
  return "";
}

/// What "Ask the thread to fix them" sends: the pull request, then each
/// failing check with the line it failed with and where to read the rest.
export function failingChecksMessage(
  pullRequest: { repository: string; number: number; title: string; url: string },
  checks: readonly PullRequestDetailCheck[],
): string {
  const failing = checks.filter((check) => check.state === "fail");
  return [
    `These checks are failing on ${pullRequest.repository}#${pullRequest.number} (${pullRequest.title}):`,
    pullRequest.url,
    "",
    ...failing.map((check) => {
      const summary = check.summary?.split("\n").find((line) => line.trim())?.trim();
      return `- ${check.name}${summary ? `: ${summary}` : ""}${check.url ? ` (${check.url})` : ""}`;
    }),
    "",
    "Fix them on this branch and push. Do not open another pull request.",
  ].join("\n");
}

/// Initials for a reviewer's avatar: two words give two letters, a login one.
export function initials(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}
