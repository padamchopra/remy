import type { ReviewFinding, ReviewFindingStatus, ReviewRule, ReviewRuleProposal, ReviewRuleScope, ReviewState } from "@remy/contract";
import { hubRequest, hubThreadBase } from "./hub-threads";

/// The review agent's reads and writes, and the words Remy sends its thread.
/// A review is an ordinary hub thread started with `startHubThread({ review })`;
/// `hub/docs/review-agent.md` describes each route.

export type { ReviewFinding, ReviewFindingStatus, ReviewRule, ReviewRuleProposal, ReviewRuleScope, ReviewState };

/// The first message of a review. The hub names the thread; this is what the
/// agent reads first, with what you asked it to look at.
export function reviewStartMessage(pull: { number: number; title: string; headRef: string; baseRef: string }, focus?: string) {
  const ask = `Review pull request #${pull.number} ${pull.title} (${pull.headRef} → ${pull.baseRef})`;
  const extra = focus?.trim();
  return extra ? `${ask}\n\n${extra}` : ask;
}

/// Whether the pull request moved past what the review looked at: its head
/// against the last reported commit, or the commit the review is about.
export function hasNewCommits(review: Pick<ReviewState, "reviewedSha" | "headSha">, pullHeadSha: string | undefined) {
  if (!pullHeadSha) return false;
  const head = pullHeadSha.toLowerCase();
  const seen = (review.reviewedSha ?? review.headSha).toLowerCase();
  return !head.startsWith(seen) && head !== review.headSha.toLowerCase();
}

/// Where a finding sits, as the pane and a chip show it: `file.tsx:41` or `file.tsx:41-44`.
export function findingLocation(finding: Pick<ReviewFinding, "path" | "startLine" | "endLine">) {
  const file = finding.path.split("/").pop() || finding.path;
  return `${file}:${finding.startLine}${finding.endLine !== finding.startLine ? `-${finding.endLine}` : ""}`;
}

/// Flag: you tell the review agent a finding is wrong, which should make it
/// propose a rule. It is a message to its thread like any other.
export function flagFindingMessage(finding: Pick<ReviewFinding, "id" | "title" | "path" | "startLine" | "endLine">, words?: string) {
  const why = words?.trim();
  return `I flagged your finding "${finding.title}" at ${finding.path}:${finding.startLine}${finding.endLine !== finding.startLine ? `-${finding.endLine}` : ""} (finding ${finding.id}).${why ? ` ${why}` : ""} If this is how I want reviews done, propose a rule.`;
}

const query = (values: Record<string, string>) => new URLSearchParams(values).toString();
const base = (organizationId: string) => `${hubThreadBase(organizationId)}/reviews`;

/// The latest review of a pull request that you can still open, or null.
export const readPullRequestReview = (organizationId: string, repository: string, number: number) =>
  hubRequest<{ review: ReviewState | null }>(`${base(organizationId)}?${query({ repository, number: String(number) })}`).then((value) => value.review);
export const readThreadReview = (organizationId: string, computerId: string, threadId: string) =>
  hubRequest<{ review: ReviewState }>(`${base(organizationId)}/${encodeURIComponent(computerId)}/${encodeURIComponent(threadId)}`).then((value) => value.review);
/// What you last reviewed with in a workspace: the Start popover's default.
export const readLastReviewChoice = (organizationId: string, workspaceId: string) =>
  hubRequest<{ last: { computerId: string; provider: string | null; model: string | null } | null }>(`${base(organizationId)}/last?${query({ workspaceId })}`).then((value) => value.last);
export const setFindingStatus = (organizationId: string, findingId: string, status: Exclude<ReviewFindingStatus, "resolved">, githubCommentId?: string) =>
  hubRequest<{ finding: ReviewFinding }>(`${base(organizationId)}/findings/${encodeURIComponent(findingId)}`, "PATCH", { status, ...(githubCommentId ? { githubCommentId } : {}) }).then((value) => value.finding);
export const acceptRuleProposal = (organizationId: string, proposalId: string, edits: { text?: string; scope?: ReviewRuleScope } = {}) =>
  hubRequest<{ proposal: ReviewRuleProposal; rule: ReviewRule }>(`${base(organizationId)}/proposals/${encodeURIComponent(proposalId)}/accept`, "POST", edits);
export const discardRuleProposal = (organizationId: string, proposalId: string) =>
  hubRequest<{ proposal: ReviewRuleProposal }>(`${base(organizationId)}/proposals/${encodeURIComponent(proposalId)}/discard`, "POST", {}).then((value) => value.proposal);
/// Review new changes: the hub sends the thread the commits after the reviewed one.
export const reviewNewChanges = (organizationId: string, computerId: string, threadId: string) =>
  hubRequest<{ from: string; to: string; review: ReviewState }>(`${base(organizationId)}/${encodeURIComponent(computerId)}/${encodeURIComponent(threadId)}/new-changes`, "POST", {});
/// A socket that says `{ kind: "review", computerId, threadId }` or
/// `{ kind: "rules" }` when yours change, and `{ kind: "reset" }` on connect.
export const reviewLivePath = (organizationId: string) => `${base(organizationId)}/live`;

/// Your rules. With a repository, that repository's and the ones for all
/// your workspaces.
export const listReviewRules = (repository?: string) =>
  hubRequest<{ rules: ReviewRule[] }>(`/api/review-rules${repository ? `?${query({ repository })}` : ""}`).then((value) => value.rules);
export const createReviewRule = (text: string, repository: string | null) =>
  hubRequest<{ rule: ReviewRule }>("/api/review-rules", "POST", { text, repository }).then((value) => value.rule);
export const updateReviewRule = (id: string, patch: { text?: string; repository?: string | null; enabled?: boolean }) =>
  hubRequest<{ rule: ReviewRule }>(`/api/review-rules/${encodeURIComponent(id)}`, "PATCH", patch).then((value) => value.rule);
export const deleteReviewRule = (id: string) => hubRequest<void>(`/api/review-rules/${encodeURIComponent(id)}`, "DELETE");
