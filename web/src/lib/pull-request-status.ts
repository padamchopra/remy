import type { PullRequestCheckState } from "./pull-request-checks";

export type PullRequestStatusKind =
  | "draft"
  | "checks-failing"
  | "changes-requested"
  | "checks-running"
  | "your-review"
  | "waiting-for-review"
  | "ready";

export interface PullRequestStatus {
  kind: PullRequestStatusKind;
  label: string;
  tone: "muted" | "error" | "warning" | "info" | "success";
}

const STATUSES: Record<PullRequestStatusKind, Omit<PullRequestStatus, "kind">> = {
  draft: { label: "Draft", tone: "muted" },
  "checks-failing": { label: "Checks failing", tone: "error" },
  "changes-requested": { label: "Changes requested", tone: "error" },
  "checks-running": { label: "Checks running", tone: "warning" },
  "your-review": { label: "Your review", tone: "info" },
  "waiting-for-review": { label: "Waiting for review", tone: "info" },
  ready: { label: "Ready to merge", tone: "success" },
};

/// The one thing an open pull request is waiting on, first match wins: a draft
/// is not asking for anything, a red check or requested changes block it
/// before anyone reviews, and it is ready only once nothing else is left.
/// `yours` is the same test the list's Yours filter uses.
export function pullRequestStatus(pullRequest: {
  isDraft: boolean;
  reviewDecision?: string;
  checks: readonly { state: PullRequestCheckState }[];
}, yours: boolean): PullRequestStatus {
  const kind: PullRequestStatusKind = pullRequest.isDraft
    ? "draft"
    : pullRequest.checks.some((check) => check.state === "fail")
      ? "checks-failing"
      : pullRequest.reviewDecision === "CHANGES_REQUESTED"
        ? "changes-requested"
        : pullRequest.checks.some((check) => check.state === "pending")
          ? "checks-running"
          : pullRequest.reviewDecision === "REVIEW_REQUIRED"
            ? yours ? "waiting-for-review" : "your-review"
            : "ready";
  return { kind, ...STATUSES[kind] };
}
