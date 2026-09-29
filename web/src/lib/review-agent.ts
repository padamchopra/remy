import type { ReviewFinding, ReviewFindingStatus, ReviewRule, ReviewRuleProposal, ReviewRuleScope, ReviewSeverity, ReviewState } from "@remy/contract";
import type { PullRequestDiffHunk } from "@/state/types";
import { hubRequest, hubThreadBase } from "./hub-threads";
import { diffRowIndex } from "./pull-request-review-state";
import { timeAgo } from "./pull-request-detail";

/// The review agent's reads and writes, and the words Remy sends its thread.
/// A review is an ordinary hub thread started with `startHubThread({ review })`;
/// `hub/docs/review-agent.md` describes each route.

export type { ReviewFinding, ReviewFindingStatus, ReviewRule, ReviewRuleProposal, ReviewRuleScope, ReviewSeverity, ReviewState };

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

/// What a severity is called where a person reads it.
export const SEVERITY_LABEL: Record<ReviewSeverity, string> = { must: "Must fix", should: "Should fix", note: "Note" };

/// The pane header's chip, from the review thread's own state.
export function reviewStatus(state: unknown): "Working" | "Needs you" | "Done" {
  return state === "working" ? "Working" : state === "needs_input" ? "Needs you" : "Done";
}

/// The repository's short name, as the workspace chip and the rules scope say it.
export function repositoryName(repository: string) {
  return repository.split("/").pop() || repository;
}

/// Rules that apply to a review of this repository: its own and the ones for
/// all your workspaces, only those turned on.
export function applyingRules(rules: readonly Pick<ReviewRule, "repository" | "enabled">[], repository: string) {
  const own = rules.filter((rule) => rule.enabled && rule.repository?.toLowerCase() === repository.toLowerCase()).length;
  const all = rules.filter((rule) => rule.enabled && rule.repository === null).length;
  return { own, all, total: own + all };
}

/// "8 rules apply: 5 for remy, 3 for all workspaces", for the Start popover.
export function rulesApplyLine(rules: readonly Pick<ReviewRule, "repository" | "enabled">[], repository: string, name = repositoryName(repository)) {
  const { own, all, total } = applyingRules(rules, repository);
  if (!total) return "No rules yet. The agent suggests them when you correct it.";
  const count = `${total} ${total === 1 ? "rule applies" : "rules apply"}`;
  if (!all) return `${count} for ${name}`;
  if (!own) return `${count} for all workspaces`;
  return `${count}: ${own} for ${name}, ${all} for all workspaces`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/// When something happened, as a rule's source line says it: "just now",
/// "5 minutes ago" today, "3 Sep" this year, "3 Sep 2025" before.
export function ruleDate(at: number, now = Date.now()) {
  if (now - at < 86_400_000) return timeAgo(new Date(at).toISOString(), now);
  const date = new Date(at);
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === new Date(now).getFullYear() ? day : `${day} ${date.getFullYear()}`;
}

/// Where a rule came from and whether it is on: "Learned on #162 · just now",
/// "Added by you · 19 Aug · Off".
export function ruleSourceLine(rule: Pick<ReviewRule, "source" | "createdAt" | "enabled">, now = Date.now()) {
  return [
    rule.source ? `Learned on #${rule.source.number}` : "Added by you",
    ruleDate(rule.createdAt, now),
    ...(rule.enabled ? [] : ["Off"]),
  ].join(" · ");
}

/// Findings placed on a file's diff, under the row their range ends on. One
/// on a line this diff does not show, or on a commit the diff moved past so
/// its line is gone, goes to `elsewhere` with the file's outdated
/// conversations. Dismissed and fixed ones stay in the pane only.
export function placeFindings(findings: readonly ReviewFinding[], path: string, hunks: readonly PullRequestDiffHunk[]) {
  const byKey = diffRowIndex(hunks);
  const atRow = new Map<string, ReviewFinding[]>();
  const elsewhere: ReviewFinding[] = [];
  for (const finding of findings) {
    if (finding.path !== path || finding.status === "dismissed" || finding.status === "resolved") continue;
    const row = byKey.get(`${finding.side}:${finding.endLine}`);
    if (!row) { elsewhere.push(finding); continue; }
    atRow.set(row, [...(atRow.get(row) ?? []), finding]);
  }
  return { atRow, elsewhere };
}

/// The line label on a finding's card: L175 or L41-44, "Old" for removed lines.
export function findingLines(finding: Pick<ReviewFinding, "startLine" | "endLine" | "side">) {
  return `${finding.side === "LEFT" ? "Old " : ""}L${finding.startLine}${finding.endLine !== finding.startLine ? `-${finding.endLine}` : ""}`;
}

/// A reference chip on your message: "github.test.ts L12" or "a.ts L3-5".
export function referenceChip(reference: { path: string; startLine: number; endLine: number }) {
  const file = reference.path.split("/").pop() || reference.path;
  return `${file} L${reference.startLine}${reference.endLine !== reference.startLine ? `-${reference.endLine}` : ""}`;
}

/// The words you wrote when you flagged a finding, read back off the message
/// `flagFindingMessage` sent, so the pane shows what you said, not Remy's
/// wrapping. Anything else is not a flag.
export function parseFlagMessage(text: string): { findingId: string; words: string } | undefined {
  const match = /^I flagged your finding ".*" at \S+ \(finding ([^)]+)\)\.(?: ([\s\S]*?))? If this is how I want reviews done, propose a rule\.$/.exec(text);
  return match ? { findingId: match[1]!, words: match[2]?.trim() ?? "" } : undefined;
}

/// What Remy sent on your behalf rather than something you typed: the first
/// message of a review and each Review new changes.
export function reviewControlMessage(text: string): { kind: "start" } | { kind: "new-changes"; to: string } | undefined {
  if (/^Review pull request #\d+ /.test(text)) return { kind: "start" };
  const moved = /^Review the commits after ([0-9a-f]{7,40}) up to ([0-9a-f]{7,40})\./i.exec(text);
  return moved ? { kind: "new-changes", to: moved[2]! } : undefined;
}

/// The commits after the reviewed one, oldest first, from the pull request's
/// latest commits. When the reviewed commit is no longer among them (a force
/// push, or more than were read), every one read counts as new.
export function commitsSince<T extends { sha: string }>(commits: readonly T[], reviewed: string | null | undefined): T[] {
  if (!reviewed) return [];
  const at = commits.findIndex((commit) => commit.sha.toLowerCase().startsWith(reviewed.toLowerCase()));
  return at < 0 ? [...commits] : commits.slice(at + 1);
}

/// The pull requests lower in the stack that findings depend on, each with
/// the first finding's place, for the pane's stack note.
export function stackDependencies(findings: readonly ReviewFinding[]) {
  const by = new Map<number, ReviewFinding>();
  for (const finding of findings) {
    if (finding.dependsOn && finding.status !== "dismissed" && finding.status !== "resolved" && !by.has(finding.dependsOn)) by.set(finding.dependsOn, finding);
  }
  return [...by.entries()].map(([number, finding]) => ({ number, finding }));
}

const PANE_KEY = "remy:review-agent-pane";

/// Whether the findings pane is open on this pull request, on this device.
export function reviewPaneOpen(repository: string, number: number): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(PANE_KEY) ?? "{}") as Record<string, boolean>;
    return saved[`${repository.toLowerCase()}#${number}`] === true;
  } catch {
    return false;
  }
}

export function rememberReviewPane(repository: string, number: number, open: boolean) {
  try {
    const saved = JSON.parse(localStorage.getItem(PANE_KEY) ?? "{}") as Record<string, boolean>;
    const key = `${repository.toLowerCase()}#${number}`;
    if (open) saved[key] = true; else delete saved[key];
    const keys = Object.keys(saved);
    // Only open panes are written down; the oldest go first past a few hundred.
    for (const old of keys.slice(0, Math.max(0, keys.length - 300))) delete saved[old];
    localStorage.setItem(PANE_KEY, JSON.stringify(saved));
  } catch {
    // A browser without storage opens the pane every time.
  }
}
