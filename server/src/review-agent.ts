/// A review thread on this computer: the pull request the hub attached to it,
/// the rules its owner has on, and the instructions its provider reviews by.
/// The findings and proposals themselves live on the hub.
import { hubReviewSchema, type HubReview } from "@remy/contract";
import { db, getKv, setKv } from "./db.js";

export type StoredReview = HubReview & {
  /// The review's own detached checkout of the pull request's head.
  worktree: string;
};

const key = (chatId: string) => `hubReview:${chatId}`;

export function threadReview(chatId: string): StoredReview | undefined {
  return getKv<StoredReview>(key(chatId));
}
export function setThreadReview(chatId: string, review: StoredReview): void {
  setKv(key(chatId), review);
}
export function forgetThreadReview(chatId: string): void {
  db.prepare("delete from kv where key = ?").run(key(chatId));
}

/// The attachment as the hub sent it, or an error the hub can show.
export function parseHubReview(value: unknown): HubReview {
  const parsed = hubReviewSchema.safeParse(value);
  if (!parsed.success) throw new Error("This review's pull request is unreadable; start it again.");
  return parsed.data;
}

function ruleLines(rules: HubReview["rules"]): string {
  if (!rules.length) return "The person has no rules yet.";
  return rules.map((rule) => `- [${rule.id}] ${rule.scope === "repository" ? "(this repository) " : ""}${rule.text.replace(/\s+/g, " ").trim()}`).join("\n");
}

/// The stack members below this pull request, nearest last.
function below(review: HubReview) {
  const at = review.stack.findIndex((member) => member.number === review.number);
  return at > 0 ? review.stack.slice(0, at) : [];
}

/// What the provider reviews by, after Remy's own instructions. The person's
/// rules are their words; each carries its id so a finding can cite it.
export function reviewInstructions(review: HubReview): string {
  const lower = below(review);
  const parent = lower.at(-1);
  const stacked = parent
    ? `This pull request is stacked: it merges into ${review.baseRef}, the branch of #${parent.number} "${parent.title}" below it, not the default branch. Say so in your first message, and review only what this pull request adds on top of it. Below it, in merge order: ${lower.map((member) => `#${member.number} (${member.headRef})`).join(", ")}.`
    : `It merges into ${review.baseRef}.`;
  return `## You are reviewing a pull request

This thread is Remy's review agent for pull request #${review.number} "${review.title}" in ${review.repository}. The person started it to have the pull request reviewed, not changed.

- Your working directory is a detached checkout of the pull request's head (${review.headSha.slice(0, 12)}, branch ${review.headRef}). Read the whole repository and run its tests when that helps. Do not edit, commit or push.
- ${stacked} Compare against the base with \`git diff origin/${review.baseRef}...HEAD\`.
- Report what you find with the report_review_findings tool. Anchor each finding to one file and a line range inside a hunk of the pull request's diff: side RIGHT for lines in the new version, LEFT for removed lines. Give it a severity (must: a bug, a regression or a broken rule; should: worth fixing before merge; note: worth knowing), a short title, an explanation, and a suggested replacement for those lines when you have one. Pass the commit you reviewed. Put a rule's id in ruleIds when the finding follows that rule. When a finding depends on a lower pull request in the stack, set dependsOn to its number and say so in the explanation.
- After reporting, write the person a short summary: what you read, what you ran, and how many findings are worth a look. The findings are drawn beside the diff, so do not repeat each one in prose.
- On a follow-up about new commits, review only those commits, then report again: update an earlier finding by its id, and list the ones the new commits fixed in resolvedIds.
- Never post to GitHub. Do not comment, review, approve, push or merge with gh, git or any other tool. The person decides what goes into their GitHub review.
- When the person corrects you, flags a finding, or tells you how they want something reviewed, propose a rule with propose_review_rule: one plain sentence they would want applied to every review, scope repository for this repository or all for all their workspaces, the reason, and the finding's id if it came from one. Only propose it; nothing is a rule until the person saves it. Do not propose one for a one-off.
- A message may carry lines of the diff as code references with a path and a line range. Those are the person pointing at those lines.

## The person's rules

Follow these on every review.

${ruleLines(review.rules)}`;
}

/// The rules as a comparable value, so a message can tell whether they moved.
export function rulesSignature(rules: HubReview["rules"]): string {
  return JSON.stringify(rules.map((rule) => [rule.id, rule.scope, rule.text]));
}

/// What the next turn is told when the person's rules changed since the
/// provider last saw them: a live session cannot change its instructions, so
/// the new list rides on the message.
export function updatedRulesContext(before: HubReview["rules"], after: HubReview["rules"]): string | undefined {
  if (rulesSignature(before) === rulesSignature(after)) return undefined;
  return `Your review rules changed. From this turn on, follow this list instead of the one in your instructions:\n\n${ruleLines(after)}`;
}

/// What the next turn is told when Review new changes moved the checkout.
export function movedHeadContext(from: string, to: string): string {
  return `Your checkout moved from ${from.slice(0, 12)} to ${to.slice(0, 12)}, the pull request's head now.`;
}
