/// The review agent's hub state: your personal rules, the pull request each
/// review thread is attached to, the findings it reported and the rules it
/// proposed. `docs/review-agent.md` describes who reads and writes each part.
import {
  REVIEW_FINDINGS_PER_REVIEW,
  REVIEW_PROPOSALS_PENDING_MAX,
  REVIEW_RULES_ENABLED_MAX,
  reviewFindingsReportSchema,
  reviewFindingStatusSchema,
  reviewRuleInputSchema,
  reviewRulePatchSchema,
  reviewRuleProposalInputSchema,
  reviewRuleScopeSchema,
  type HubReview,
  type ReviewFinding,
  type ReviewRule,
  type ReviewRuleProposal,
  type ReviewState,
} from "@remy/contract";
import { z } from "zod";
import { ConnectionError } from "./connections.js";

export type ReviewThreadRow = {
  organization_id: string;
  computer_id: string;
  thread_id: string;
  user_id: string;
  workspace_id: string;
  repository: string;
  pull_number: number;
  title: string;
  base_ref: string;
  head_ref: string;
  started_sha: string;
  head_sha: string;
  reviewed_sha: string | null;
  provider: string | null;
  model: string | null;
  rules_applied: number;
  summary: string | null;
  created_at: number;
  updated_at: number;
};
type RuleRow = {
  id: string;
  user_id: string;
  repository: string | null;
  text: string;
  enabled: number;
  source_repository: string | null;
  source_number: number | null;
  source_finding_id: string | null;
  created_at: number;
  updated_at: number;
};
type FindingRow = {
  id: string;
  organization_id: string;
  computer_id: string;
  thread_id: string;
  path: string;
  start_line: number;
  end_line: number;
  side: "RIGHT" | "LEFT";
  severity: "must" | "should" | "note";
  title: string;
  body: string;
  suggestion: string | null;
  rule_ids: string;
  depends_on: number | null;
  commit_sha: string;
  status: ReviewFinding["status"];
  github_comment_id: string | null;
  position: number;
  created_at: number;
  updated_at: number;
};
type ProposalRow = {
  id: string;
  organization_id: string;
  computer_id: string;
  thread_id: string;
  text: string;
  scope: "repository" | "all";
  reason: string;
  finding_id: string | null;
  status: ReviewRuleProposal["status"];
  rule_id: string | null;
  created_at: number;
  updated_at: number;
};

/// The lines of one file's diff a comment may sit on, per side: each hunk's
/// range, context lines included, as GitHub accepts them for a review comment.
export type DiffAnchors = { RIGHT: [number, number][]; LEFT: [number, number][] };

/// Hunk ranges from a unified diff patch as GitHub's files API returns it.
export function diffAnchors(patch: string): DiffAnchors {
  const anchors: DiffAnchors = { RIGHT: [], LEFT: [] };
  for (const match of patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const [, oldStart, oldCount, newStart, newCount] = match;
    const left = Number(oldCount ?? 1), right = Number(newCount ?? 1);
    if (left > 0) anchors.LEFT.push([Number(oldStart), Number(oldStart) + left - 1]);
    if (right > 0) anchors.RIGHT.push([Number(newStart), Number(newStart) + right - 1]);
  }
  return anchors;
}

/// A changed file as the anchor check sees it: without a patch (binary, or
/// too large for GitHub to send) any line of it is accepted.
export type DiffFile = { path: string; patch?: string };

function anchored(files: Map<string, DiffAnchors | null>, finding: { path: string; startLine: number; endLine: number; side: "RIGHT" | "LEFT" }) {
  if (!files.has(finding.path)) return false;
  const anchors = files.get(finding.path);
  if (!anchors) return true;
  return anchors[finding.side].some(([start, end]) => finding.startLine >= start && finding.endLine <= end);
}

function ruleOf(row: RuleRow): ReviewRule {
  return {
    id: row.id,
    repository: row.repository,
    text: row.text,
    enabled: !!row.enabled,
    source: row.source_repository && row.source_number
      ? { repository: row.source_repository, number: row.source_number, findingId: row.source_finding_id }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function proposalOf(row: ProposalRow): ReviewRuleProposal {
  return { id: row.id, text: row.text, scope: row.scope, reason: row.reason, findingId: row.finding_id, status: row.status, ruleId: row.rule_id, createdAt: row.created_at };
}
type Parser<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: readonly { code: string; message: string; path: readonly PropertyKey[] }[] } } };
function parsed<T>(schema: Parser<T>, value: unknown, fallback: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  // A message written for this schema says it plainly; zod's own names the field.
  if (issue && issue.code === "custom") throw new ConnectionError(issue.message, 400);
  throw new ConnectionError(issue ? `${fallback} (${issue.path.map(String).join(".") || "input"}: ${issue.message})` : fallback, 400);
}
function idList(value: string): string[] {
  try {
    const list = JSON.parse(value);
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

const reviewKey = (row: { organization_id: string; computer_id: string; thread_id: string }) => [row.organization_id, row.computer_id, row.thread_id] as const;

export class ReviewAgent {
  constructor(
    readonly db: D1Database,
    readonly now: () => number = Date.now,
    readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  // ---- Rules: yours alone ----------------------------------------------------

  /// Your rules, newest first. With a repository, only that repository's and
  /// the ones for all your workspaces.
  async rules(user: string, repository?: string): Promise<ReviewRule[]> {
    const rows = repository
      ? await this.db.prepare("SELECT * FROM review_rules WHERE user_id=? AND (repository IS NULL OR repository=?) ORDER BY created_at DESC").bind(user, repository.toLowerCase()).all<RuleRow>()
      : await this.db.prepare("SELECT * FROM review_rules WHERE user_id=? ORDER BY created_at DESC").bind(user).all<RuleRow>();
    return rows.results.map(ruleOf);
  }

  /// The rules a review of this repository follows, as the computer receives them.
  async enabledRules(user: string, repository: string): Promise<HubReview["rules"]> {
    const rows = await this.db
      .prepare("SELECT * FROM review_rules WHERE user_id=? AND enabled=1 AND (repository IS NULL OR repository=?) ORDER BY created_at LIMIT ?")
      .bind(user, repository.toLowerCase(), REVIEW_RULES_ENABLED_MAX)
      .all<RuleRow>();
    return rows.results.map((row) => ({ id: row.id, text: row.text, scope: row.repository ? "repository" as const : "all" as const }));
  }

  private async roomForEnabled(user: string, except?: string) {
    const count = await this.db
      .prepare("SELECT count(*) AS n FROM review_rules WHERE user_id=? AND enabled=1 AND id<>?")
      .bind(user, except ?? "")
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= REVIEW_RULES_ENABLED_MAX)
      throw new ConnectionError(`You have ${REVIEW_RULES_ENABLED_MAX} rules on. Turn one off before adding another.`, 409);
  }

  async createRule(user: string, input: unknown, source?: { repository: string; number: number; findingId: string | null }): Promise<ReviewRule> {
    const value = parsed(reviewRuleInputSchema, input, "Write a rule of up to 500 characters.");
    const enabled = value.enabled ?? true;
    if (enabled) await this.roomForEnabled(user);
    const id = this.newId(), at = this.now();
    await this.db
      .prepare("INSERT INTO review_rules(id,user_id,repository,text,enabled,source_repository,source_number,source_finding_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(id, user, value.repository, value.text, enabled ? 1 : 0, source?.repository ?? null, source?.number ?? null, source?.findingId ?? null, at, at)
      .run();
    return (await this.rule(user, id))!;
  }

  async rule(user: string, id: string): Promise<ReviewRule | undefined> {
    const row = await this.db.prepare("SELECT * FROM review_rules WHERE id=? AND user_id=?").bind(id, user).first<RuleRow>();
    return row ? ruleOf(row) : undefined;
  }

  async updateRule(user: string, id: string, input: unknown): Promise<ReviewRule> {
    const current = await this.rule(user, id);
    if (!current) throw new ConnectionError("This rule is no longer available.", 404);
    const value = parsed(reviewRulePatchSchema, input, "Choose what to change.");
    if (value.enabled === true && !current.enabled) await this.roomForEnabled(user, id);
    await this.db
      .prepare("UPDATE review_rules SET text=?, repository=?, enabled=?, updated_at=? WHERE id=? AND user_id=?")
      .bind(
        value.text ?? current.text,
        value.repository !== undefined ? value.repository : current.repository,
        (value.enabled ?? current.enabled) ? 1 : 0,
        this.now(),
        id,
        user,
      )
      .run();
    return (await this.rule(user, id))!;
  }

  async deleteRule(user: string, id: string): Promise<void> {
    const deleted = await this.db.prepare("DELETE FROM review_rules WHERE id=? AND user_id=?").bind(id, user).run();
    if (!deleted.meta.changes) throw new ConnectionError("This rule is no longer available.", 404);
  }

  // ---- Review threads --------------------------------------------------------

  async record(row: Omit<ReviewThreadRow, "reviewed_sha" | "summary" | "created_at" | "updated_at" | "head_sha">): Promise<void> {
    const at = this.now();
    await this.db
      .prepare("INSERT OR REPLACE INTO review_threads(organization_id,computer_id,thread_id,user_id,workspace_id,repository,pull_number,title,base_ref,head_ref,started_sha,head_sha,reviewed_sha,provider,model,rules_applied,summary,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,NULL,?,?)")
      .bind(row.organization_id, row.computer_id, row.thread_id, row.user_id, row.workspace_id, row.repository.toLowerCase(), row.pull_number, row.title, row.base_ref, row.head_ref, row.started_sha, row.started_sha, row.provider, row.model, row.rules_applied, at, at)
      .run();
  }

  async review(org: string, computerId: string, threadId: string): Promise<ReviewThreadRow | undefined> {
    return (await this.db
      .prepare("SELECT * FROM review_threads WHERE organization_id=? AND computer_id=? AND thread_id=?")
      .bind(org, computerId, threadId)
      .first<ReviewThreadRow>()) ?? undefined;
  }

  /// Your reviews of one pull request here, newest first.
  async reviewsOf(org: string, user: string, repository: string, number: number): Promise<ReviewThreadRow[]> {
    const rows = await this.db
      .prepare("SELECT * FROM review_threads WHERE organization_id=? AND user_id=? AND repository=? AND pull_number=? ORDER BY created_at DESC LIMIT 10")
      .bind(org, user, repository.toLowerCase(), number)
      .all<ReviewThreadRow>();
    return rows.results;
  }

  async forget(org: string, computerId: string, threadId: string): Promise<void> {
    await this.db.prepare("DELETE FROM review_threads WHERE organization_id=? AND computer_id=? AND thread_id=?").bind(org, computerId, threadId).run();
  }

  /// A message is on its way with these rules, so they apply from its turn.
  async rulesSent(row: ReviewThreadRow, count: number): Promise<void> {
    if (row.rules_applied === count) return;
    await this.db.prepare("UPDATE review_threads SET rules_applied=?, updated_at=? WHERE organization_id=? AND computer_id=? AND thread_id=?").bind(count, this.now(), ...reviewKey(row)).run();
  }

  /// The next turn reviews up to this commit.
  async moveHead(row: ReviewThreadRow, sha: string): Promise<void> {
    await this.db.prepare("UPDATE review_threads SET head_sha=?, updated_at=? WHERE organization_id=? AND computer_id=? AND thread_id=?").bind(sha, this.now(), ...reviewKey(row)).run();
  }

  /// What a review looks like to its owner. Nobody else reads it.
  async state(row: ReviewThreadRow, user: string): Promise<ReviewState> {
    if (row.user_id !== user) throw new ConnectionError("This review is no longer available.", 404);
    const [findings, proposals, rules] = await Promise.all([
      this.db.prepare("SELECT * FROM review_findings WHERE organization_id=? AND computer_id=? AND thread_id=? ORDER BY position").bind(...reviewKey(row)).all<FindingRow>(),
      this.db.prepare("SELECT * FROM review_rule_proposals WHERE organization_id=? AND computer_id=? AND thread_id=? AND status='pending' ORDER BY created_at").bind(...reviewKey(row)).all<ProposalRow>(),
      this.db.prepare("SELECT id,text FROM review_rules WHERE user_id=?").bind(row.user_id).all<{ id: string; text: string }>(),
    ]);
    const texts = new Map(rules.results.map((rule) => [rule.id, rule.text]));
    return {
      computerId: row.computer_id,
      threadId: row.thread_id,
      workspaceId: row.workspace_id,
      repository: row.repository,
      number: row.pull_number,
      title: row.title,
      baseRef: row.base_ref,
      headRef: row.head_ref,
      startedSha: row.started_sha,
      headSha: row.head_sha,
      reviewedSha: row.reviewed_sha,
      provider: row.provider,
      model: row.model,
      rulesApplied: row.rules_applied,
      summary: row.summary,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      findings: findings.results.map((finding) => ({
        id: finding.id,
        path: finding.path,
        startLine: finding.start_line,
        endLine: finding.end_line,
        side: finding.side,
        severity: finding.severity,
        title: finding.title,
        body: finding.body,
        suggestion: finding.suggestion,
        rules: idList(finding.rule_ids).flatMap((id) => (texts.has(id) ? [{ id, text: texts.get(id)! }] : [])),
        dependsOn: finding.depends_on,
        commit: finding.commit_sha,
        status: finding.status,
        githubCommentId: finding.github_comment_id,
        createdAt: finding.created_at,
        updatedAt: finding.updated_at,
      })),
      proposals: proposals.results.map(proposalOf),
    };
  }

  // ---- What the agent reports ------------------------------------------------

  /// Stores findings for a review. A finding with an earlier id replaces that
  /// finding in place and keeps your decision on it; one without is appended.
  /// Every finding must sit on lines in the pull request's diff, or nothing is
  /// stored and the agent is told which ones missed.
  async report(row: ReviewThreadRow, input: unknown, files: DiffFile[]) {
    const value = parsed(reviewFindingsReportSchema, input, "Report findings with path, startLine, endLine, side, severity, title and body, and the commit you reviewed.");
    const diff = new Map(files.map((file) => [file.path, file.patch === undefined ? null : diffAnchors(file.patch)]));
    const missed = value.findings.filter((finding) => !anchored(diff, finding));
    if (missed.length)
      throw new ConnectionError(
        `These findings are not on lines in the pull request's diff: ${missed.map((finding) => `${finding.path}:${finding.startLine}${finding.endLine !== finding.startLine ? `-${finding.endLine}` : ""} (${finding.side})`).join(", ")}. Anchor each finding to lines inside a hunk of the diff on the side it names, or leave it out.`,
        400,
      );
    const existing = await this.db.prepare("SELECT * FROM review_findings WHERE organization_id=? AND computer_id=? AND thread_id=?").bind(...reviewKey(row)).all<FindingRow>();
    const byId = new Map(existing.results.map((finding) => [finding.id, finding]));
    const unknown = value.findings.filter((finding) => finding.id && !byId.has(finding.id));
    if (unknown.length) throw new ConnectionError(`No earlier finding has id ${unknown.map((finding) => finding.id).join(", ")}. Leave id out for a new finding.`, 400);
    const added = value.findings.filter((finding) => !finding.id).length;
    if (existing.results.length + added > REVIEW_FINDINGS_PER_REVIEW)
      throw new ConnectionError(`A review keeps up to ${REVIEW_FINDINGS_PER_REVIEW} findings. Update earlier ones by id instead of adding more.`, 409);
    const rules = new Set((await this.enabledRules(row.user_id, row.repository)).map((rule) => rule.id));
    const at = this.now();
    let position = existing.results.reduce((max, finding) => Math.max(max, finding.position), 0);
    const statements: D1PreparedStatement[] = [];
    const ids: string[] = [];
    for (const finding of value.findings) {
      const ruleIds = JSON.stringify((finding.ruleIds ?? []).filter((id) => rules.has(id)));
      const fields = [finding.path, finding.startLine, finding.endLine, finding.side, finding.severity, finding.title, finding.body, finding.suggestion?.trim() ? finding.suggestion : null, ruleIds, finding.dependsOn ?? null, value.commit] as const;
      if (finding.id) {
        ids.push(finding.id);
        statements.push(this.db
          .prepare("UPDATE review_findings SET path=?, start_line=?, end_line=?, side=?, severity=?, title=?, body=?, suggestion=?, rule_ids=?, depends_on=?, commit_sha=?, status=CASE WHEN status='resolved' THEN 'open' ELSE status END, updated_at=? WHERE id=?")
          .bind(...fields, at, finding.id));
      } else {
        const id = this.newId();
        ids.push(id);
        statements.push(this.db
          .prepare("INSERT INTO review_findings(id,organization_id,computer_id,thread_id,path,start_line,end_line,side,severity,title,body,suggestion,rule_ids,depends_on,commit_sha,status,github_comment_id,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',NULL,?,?,?)")
          .bind(id, ...reviewKey(row), ...fields, ++position, at, at));
      }
    }
    const resolved = (value.resolvedIds ?? []).filter((id) => byId.get(id)?.status === "open" && !ids.includes(id));
    for (const id of resolved)
      statements.push(this.db.prepare("UPDATE review_findings SET status='resolved', updated_at=? WHERE id=? AND status='open'").bind(at, id));
    statements.push(this.db
      .prepare("UPDATE review_threads SET reviewed_sha=?, summary=COALESCE(?, summary), updated_at=? WHERE organization_id=? AND computer_id=? AND thread_id=?")
      .bind(value.commit, value.summary ?? null, at, ...reviewKey(row)));
    await this.db.batch(statements);
    return { ids, resolved, commit: value.commit };
  }

  /// A rule the agent suggests. It is only a proposal: its owner saves it or not.
  async propose(row: ReviewThreadRow, input: unknown): Promise<ReviewRuleProposal> {
    const value = parsed(reviewRuleProposalInputSchema, input, "Propose a rule with text, scope (repository or all) and reason.");
    if (value.findingId && !await this.db.prepare("SELECT 1 AS ok FROM review_findings WHERE id=? AND organization_id=? AND computer_id=? AND thread_id=?").bind(value.findingId, ...reviewKey(row)).first())
      throw new ConnectionError(`No finding in this review has id ${value.findingId}.`, 400);
    const pending = await this.db.prepare("SELECT count(*) AS n FROM review_rule_proposals WHERE organization_id=? AND computer_id=? AND thread_id=? AND status='pending'").bind(...reviewKey(row)).first<{ n: number }>();
    if ((pending?.n ?? 0) >= REVIEW_PROPOSALS_PENDING_MAX)
      throw new ConnectionError("The person has not answered your earlier proposals yet. Wait for them before proposing more.", 409);
    const id = this.newId(), at = this.now();
    await this.db
      .prepare("INSERT INTO review_rule_proposals(id,organization_id,computer_id,thread_id,text,scope,reason,finding_id,status,rule_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'pending',NULL,?,?)")
      .bind(id, ...reviewKey(row), value.text, value.scope, value.reason, value.findingId ?? null, at, at)
      .run();
    return { id, text: value.text, scope: value.scope, reason: value.reason, findingId: value.findingId ?? null, status: "pending", ruleId: null, createdAt: at };
  }

  // ---- What its owner decides ------------------------------------------------

  private async owned<T extends { organization_id: string; computer_id: string; thread_id: string }>(org: string, user: string, table: "review_findings" | "review_rule_proposals", id: string) {
    const row = await this.db.prepare(`SELECT * FROM ${table} WHERE id=? AND organization_id=?`).bind(id, org).first<T>();
    const review = row ? await this.review(row.organization_id, row.computer_id, row.thread_id) : undefined;
    if (!row || !review || review.user_id !== user)
      throw new ConnectionError(table === "review_findings" ? "This finding is no longer available." : "This suggestion is no longer available.", 404);
    return { row, review };
  }

  /// Dismiss a finding, bring it back, or record the pending GitHub comment it
  /// became. Adding it to GitHub is your own review action, not the agent's.
  async setFindingStatus(org: string, user: string, id: string, input: unknown) {
    const value = parsed(z.object({
      status: reviewFindingStatusSchema.exclude(["resolved"]),
      githubCommentId: z.string().min(1).max(100).optional(),
    }).refine((input) => input.status !== "added-to-github" || !!input.githubCommentId, "Say which pending comment this finding became."), input, "Choose open, dismissed or added-to-github.");
    const { review } = await this.owned<FindingRow>(org, user, "review_findings", id);
    await this.db
      .prepare("UPDATE review_findings SET status=?, github_comment_id=?, updated_at=? WHERE id=?")
      .bind(value.status, value.status === "added-to-github" ? value.githubCommentId! : null, this.now(), id)
      .run();
    return { review, finding: (await this.state(review, user)).findings.find((finding) => finding.id === id)! };
  }

  /// Save a proposal as your rule, with your wording and scope if you changed them.
  async acceptProposal(org: string, user: string, id: string, input: unknown) {
    const value = parsed(z.object({
      text: z.string().trim().min(1).max(500).optional(),
      scope: reviewRuleScopeSchema.optional(),
    }), input ?? {}, "Write a rule of up to 500 characters.");
    const { row, review } = await this.owned<ProposalRow>(org, user, "review_rule_proposals", id);
    if (row.status !== "pending") throw new ConnectionError("This suggestion was already answered.", 409);
    const scope = value.scope ?? row.scope;
    const rule = await this.createRule(
      user,
      { text: value.text ?? row.text, repository: scope === "repository" ? review.repository : null },
      { repository: review.repository, number: review.pull_number, findingId: row.finding_id },
    );
    await this.db.prepare("UPDATE review_rule_proposals SET status='accepted', rule_id=?, updated_at=? WHERE id=?").bind(rule.id, this.now(), id).run();
    return { review, rule, proposal: { ...proposalOf(row), status: "accepted" as const, ruleId: rule.id } };
  }

  async discardProposal(org: string, user: string, id: string) {
    const { row, review } = await this.owned<ProposalRow>(org, user, "review_rule_proposals", id);
    if (row.status !== "pending") throw new ConnectionError("This suggestion was already answered.", 409);
    await this.db.prepare("UPDATE review_rule_proposals SET status='discarded', updated_at=? WHERE id=?").bind(this.now(), id).run();
    return { review, proposal: { ...proposalOf(row), status: "discarded" as const } };
  }
}

/// The first message of a review, and the follow-up for new commits. The
/// hub writes the follow-up because it knows which commit was reviewed.
export function reviewNewChangesMessage(from: string, to: string) {
  return `Review the commits after ${from.slice(0, 12)} up to ${to.slice(0, 12)}. Cover only what those commits changed, recheck your earlier findings against them, and write your findings directly in the thread, explaining which earlier findings the new commits fixed.`;
}
