export type PullRequestCheckState = "pass" | "fail" | "pending" | "skipping";

export interface PullRequestCheck {
  name: string;
  state: PullRequestCheckState;
}

export const PULL_REQUEST_CHECK_GROUPS = [
  { state: "fail", label: "Failing" },
  { state: "pending", label: "Waiting" },
  { state: "pass", label: "Passing" },
  { state: "skipping", label: "Skipped" },
] as const;

/// Group checks the way a person reads them: failing first, then waiting,
/// passing, and skipped. Empty groups stay off the list.
export function groupPullRequestChecks(checks: readonly PullRequestCheck[]) {
  return PULL_REQUEST_CHECK_GROUPS
    .map((group) => ({
      ...group,
      checks: checks.filter((check) => check.state === group.state),
    }))
    .filter((group) => group.checks.length > 0);
}

/// One line of status for the Checks heading.
export function pullRequestChecksSummary(checks: readonly PullRequestCheck[]): string {
  if (checks.length === 0) return "No checks yet.";
  const failing = checks.filter((check) => check.state === "fail").length;
  const waiting = checks.filter((check) => check.state === "pending").length;
  const passing = checks.filter((check) => check.state === "pass").length;
  const skipped = checks.filter((check) => check.state === "skipping").length;
  if (!failing && !waiting && passing) {
    return skipped ? `${passing} passing · ${skipped} skipped` : "All passing";
  }
  return [
    failing ? `${failing} failing` : "",
    waiting ? `${waiting} waiting` : "",
    passing ? `${passing} passing` : "",
    skipped ? `${skipped} skipped` : "",
  ].filter(Boolean).join(" · ");
}
