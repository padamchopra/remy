/// The review agent's rule proposal, defined once for both ways a provider
/// reaches Remy: in process for Claude (`ticket-tools.ts`) and over STDIO for
/// Codex and Cursor (`ticket-mcp.ts`). The hub validates the same shapes
/// again with the contract's schemas; these tell the model what to send.
import { z } from "zod";

export const REVIEW_TOOLS = ["propose_review_rule"] as const;
export type ReviewTool = (typeof REVIEW_TOOLS)[number];
export const isReviewTool = (action: string): action is ReviewTool => (REVIEW_TOOLS as readonly string[]).includes(action);

export const PROPOSE_REVIEW_RULE = "Suggest a rule after the person corrects you, flags a finding or says how they want reviews done, or a pull request comment expresses a durable review preference. For PR comments, cite the author, comment URL and feedback in the reason, default to repository scope, and avoid duplicates, one-off fixes, bot output and unresolved disagreements. It is only a proposal: the person saves it, edits it or discards it, and it applies from the turn after they save it.";
export const proposeReviewRuleInput = {
  text: z.string().min(1).max(500).describe("One plain sentence they would want on every review."),
  scope: z.enum(["repository", "all"]).describe("repository for this repository only; all for all their workspaces."),
  reason: z.string().min(1).max(1000).describe("The feedback this rule comes from; include the author and comment URL for PR feedback."),
  findingId: z.string().max(64).optional().describe("The finding it came from, if any."),
};

/// What the model reads back after a review tool ran.
export function reviewToolText(action: ReviewTool, result: Record<string, unknown>): string {
  if (action === "propose_review_rule") {
    const proposal = (result.proposal ?? {}) as { id?: unknown };
    return `Proposed rule ${String(proposal.id ?? "")}. It is not a rule yet: the person saves, edits or discards it.`;
  }
  return "";
}
