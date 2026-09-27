/// The review agent's two Remy tools, defined once for both ways a provider
/// reaches Remy: in process for Claude (`ticket-tools.ts`) and over STDIO for
/// Codex and Cursor (`ticket-mcp.ts`). The hub validates the same shapes
/// again with the contract's schemas; these tell the model what to send.
import { z } from "zod";

export const REVIEW_TOOLS = ["report_review_findings", "propose_review_rule"] as const;
export type ReviewTool = (typeof REVIEW_TOOLS)[number];
export const isReviewTool = (action: string): action is ReviewTool => (REVIEW_TOOLS as readonly string[]).includes(action);

export const REPORT_REVIEW_FINDINGS = "Save this review's findings for the person. Each finding sits on one file and a line range inside a hunk of the pull request's diff (side RIGHT for new lines, LEFT for removed ones). Pass the commit you reviewed. Send an earlier finding's id to update it, and list findings the new commits fixed in resolvedIds. Nothing is posted to GitHub.";
export const reportReviewFindingsInput = {
  commit: z.string().regex(/^[0-9a-fA-F]{7,40}$/).describe("The commit you reviewed, usually `git rev-parse HEAD`."),
  summary: z.string().max(4000).optional().describe("One short paragraph for the person: what you read, what you ran, what is worth a look."),
  findings: z.array(z.object({
    id: z.string().max(64).optional().describe("An earlier finding's id, to update it in place. Leave it out for a new finding."),
    path: z.string().min(1).max(1000).describe("The file's path in the repository, as the diff names it."),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    side: z.enum(["RIGHT", "LEFT"]).default("RIGHT"),
    severity: z.enum(["must", "should", "note"]).describe("must: a bug, a regression or a broken rule. should: worth fixing before merge. note: worth knowing."),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(8000).describe("Why it matters, in plain words."),
    suggestion: z.string().max(8000).optional().describe("Replacement text for exactly these lines, when you have one."),
    ruleIds: z.array(z.string().max(64)).max(10).optional().describe("Ids of the person's rules this finding follows."),
    dependsOn: z.number().int().positive().optional().describe("A lower pull request in the stack this finding depends on."),
  })).max(50),
  resolvedIds: z.array(z.string().max(64)).max(200).optional(),
};

export const PROPOSE_REVIEW_RULE = "Suggest a rule after the person corrects you, flags a finding or says how they want reviews done. It is only a proposal: the person saves it, edits it or discards it, and it applies from the turn after they save it.";
export const proposeReviewRuleInput = {
  text: z.string().min(1).max(500).describe("One plain sentence they would want on every review."),
  scope: z.enum(["repository", "all"]).describe("repository for this repository only; all for all their workspaces."),
  reason: z.string().min(1).max(1000).describe("What they said or did that this rule comes from."),
  findingId: z.string().max(64).optional().describe("The finding it came from, if any."),
};

/// What the model reads back after a review tool ran.
export function reviewToolText(action: ReviewTool, result: Record<string, unknown>): string {
  if (action === "propose_review_rule") {
    const proposal = (result.proposal ?? {}) as { id?: unknown };
    return `Proposed rule ${String(proposal.id ?? "")}. It is not a rule yet: the person saves, edits or discards it.`;
  }
  const ids = Array.isArray(result.findings) ? result.findings.map(String) : [];
  const resolved = Array.isArray(result.resolved) ? result.resolved.map(String) : [];
  return [
    `Saved ${ids.length} finding${ids.length === 1 ? "" : "s"} for ${String(result.commit ?? "")}: ${ids.join(", ") || "none"}.`,
    resolved.length ? `Marked fixed: ${resolved.join(", ")}.` : "",
    `${String(result.open ?? ids.length)} open in this review. The person sees them beside the diff.`,
  ].filter(Boolean).join(" ");
}
