import type { ThreadMember, ThreadSnapshot } from "@remy/contract";
import { ConnectionError } from "./connections.js";
import { allowedRequestOrigin } from "./request-origin.js";
import type { GitHubConnection } from "./github-connection.js";
import { ReviewAgent, reviewNewChangesMessage, type ReviewThreadRow } from "./review-agent.js";
import type { Env } from "./worker.js";

const noStore = { "cache-control": "no-store" };
const failure = (error: unknown) =>
  Response.json(
    { error: error instanceof ConnectionError ? error.message : "Your review is unavailable; try again." },
    { status: error instanceof ConnectionError ? error.status : 500 },
  );

/// Your review rules. They belong to you, not to an organization, so they
/// live beside your profile: every organization and computer you review from
/// reads the same ones, and nobody else reads them at all.
export async function reviewRulesRoute(request: Request, env: Env, user: string, clientKind?: string, reviews = new ReviewAgent(env.DB)): Promise<Response | undefined> {
  const url = new URL(request.url);
  const match = /^\/api\/review-rules(?:\/([^/]+))?$/.exec(url.pathname);
  if (!match) return;
  // A computer holds a member identity too, but rules are the person's words.
  if (clientKind === "computer") return Response.json({ error: "Change your rules in Remy." }, { status: 403 });
  if (request.method !== "GET" && !allowedRequestOrigin(request, env.PREVIEW_ORIGINS)) return Response.json({ error: "Change your rules in Remy." }, { status: 403 });
  const id = match[1] ? decodeURIComponent(match[1]) : undefined;
  try {
    if (!id && request.method === "GET") {
      const repository = url.searchParams.get("repository") || undefined;
      return Response.json({ rules: await reviews.rules(user, repository) }, { headers: noStore });
    }
    let response: Response | undefined;
    if (!id && request.method === "POST") response = Response.json({ rule: await reviews.createRule(user, await request.json().catch(() => ({}))) }, { status: 201, headers: noStore });
    else if (id && request.method === "PATCH") response = Response.json({ rule: await reviews.updateRule(user, id, await request.json().catch(() => ({}))) }, { headers: noStore });
    else if (id && request.method === "DELETE") { await reviews.deleteRule(user, id); response = new Response(null, { status: 204 }); }
    if (!response) return Response.json({ error: "This rule action is not available." }, { status: 405 });
    await rulesChanged(env, user);
    return response;
  } catch (error) {
    return failure(error);
  }
}

/// Every open Rules list of yours, in every organization, reads again.
export async function rulesChanged(env: Env, user: string) {
  const memberships = await env.DB.prepare("SELECT organization_id FROM memberships WHERE user_id=?").bind(user).all<{ organization_id: string }>();
  await Promise.all(memberships.results.map((row) =>
    env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${row.organization_id}`))
      .fetch(new Request("https://internal/review-rules/changed", { method: "POST", headers: { "x-organization-id": row.organization_id, "x-user-id": user } }))
      .catch(() => undefined)));
}

/// What the account's coordinator lends the review routes: the thread relay
/// it holds, and a way to message a thread as the member through the same
/// checks their own message passes.
export interface ReviewCoordinator {
  org: string;
  actor: ThreadMember;
  reviews: ReviewAgent;
  github: GitHubConnection;
  /// The thread as the hub last saw it, when the member can still read it.
  thread(computerId: string, threadId: string): Promise<ThreadSnapshot | undefined>;
  send(computerId: string, threadId: string, text: string): Promise<Response>;
  changed(userId: string, computerId: string, threadId: string): void;
}

async function readable(deps: ReviewCoordinator, row: ReviewThreadRow | undefined) {
  if (!row || row.user_id !== deps.actor.id || !await deps.thread(row.computer_id, row.thread_id))
    throw new ConnectionError("This review is no longer available.", 404);
  return row;
}

/// The member routes under `/api/organizations/:org/reviews`, as the
/// coordinator receives them. Every one is the review's owner acting in Remy.
export async function reviewRequest(request: Request, deps: ReviewCoordinator): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== "/reviews" && !url.pathname.startsWith("/reviews/")) return;
  const parts = url.pathname.split("/").slice(2).map(decodeURIComponent);
  const { reviews, actor, org } = deps;
  try {
    // The latest review of a pull request you can still open, or null.
    if (request.method === "GET" && parts.length === 0) {
      const repository = url.searchParams.get("repository") ?? "";
      const number = Number(url.searchParams.get("number"));
      if (!repository || !Number.isSafeInteger(number) || number < 1) throw new ConnectionError("Choose a pull request.", 400);
      for (const row of await reviews.reviewsOf(org, actor.id, repository, number))
        if (await deps.thread(row.computer_id, row.thread_id)) return Response.json({ review: await reviews.state(row, actor.id) }, { headers: noStore });
      return Response.json({ review: null }, { headers: noStore });
    }
    // What you last reviewed with in this workspace, for the Start popover.
    if (request.method === "GET" && parts[0] === "last" && parts.length === 1) {
      const workspaceId = url.searchParams.get("workspaceId") ?? "";
      const row = await reviews.db
        .prepare("SELECT computer_id, provider, model FROM review_threads WHERE organization_id=? AND user_id=? AND workspace_id=? ORDER BY created_at DESC LIMIT 1")
        .bind(org, actor.id, workspaceId)
        .first<{ computer_id: string; provider: string | null; model: string | null }>();
      return Response.json({ last: row ? { computerId: row.computer_id, provider: row.provider, model: row.model } : null }, { headers: noStore });
    }
    if (request.method === "PATCH" && parts[0] === "findings" && parts.length === 2) {
      const { review, finding } = await reviews.setFindingStatus(org, actor.id, parts[1]!, await request.json().catch(() => ({})));
      deps.changed(review.user_id, review.computer_id, review.thread_id);
      return Response.json({ finding }, { headers: noStore });
    }
    if (request.method === "POST" && parts[0] === "proposals" && parts.length === 3 && (parts[2] === "accept" || parts[2] === "discard")) {
      const result = parts[2] === "accept"
        ? await reviews.acceptProposal(org, actor.id, parts[1]!, await request.json().catch(() => ({})))
        : await reviews.discardProposal(org, actor.id, parts[1]!);
      deps.changed(result.review.user_id, result.review.computer_id, result.review.thread_id);
      return Response.json({ proposal: result.proposal, ...("rule" in result ? { rule: result.rule } : {}) }, { headers: noStore });
    }
    if (parts.length >= 2 && parts[0] !== "findings" && parts[0] !== "proposals") {
      const [computerId, threadId, action] = parts as [string, string, string?];
      const row = await readable(deps, await reviews.review(org, computerId, threadId));
      if (request.method === "GET" && parts.length === 2) return Response.json({ review: await reviews.state(row, actor.id) }, { headers: noStore });
      // Review new changes: the thread is told exactly which commits are new.
      if (request.method === "POST" && action === "new-changes" && parts.length === 3) {
        const head = await deps.github.pullRequestHead(org, actor.id, row.repository, row.pull_number);
        const from = row.head_sha;
        if (head === row.head_sha)
          throw new ConnectionError("There are no new commits since the review.", 409);
        await reviews.moveHead(row, head);
        const sent = await deps.send(computerId, threadId, reviewNewChangesMessage(from, head));
        if (!sent.ok) return sent;
        deps.changed(row.user_id, computerId, threadId);
        return Response.json({ from, to: head, review: await reviews.state((await reviews.review(org, computerId, threadId))!, actor.id) }, { headers: noStore });
      }
    }
    return Response.json({ error: "This review action is not available." }, { status: 404 });
  } catch (error) {
    return failure(error);
  }
}
