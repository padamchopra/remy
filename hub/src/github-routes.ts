import { ConnectionError } from "./connections.js";
import { GitHubConnection } from "./github-connection.js";
import { connectionsFor } from "./connection-routes.js";
import { linearAccountsFor } from "./linear-routes.js";
import type { Env } from "./worker.js";

export async function githubChanged(env: Env, org: string) {
  await env.COORDINATOR.get(
    env.COORDINATOR.idFromName(`organization:${org}`),
  ).fetch(
    new Request("https://internal/connections/changed", {
      method: "POST",
      headers: { "x-organization-id": org },
    }),
  );
}
export function githubFor(env: Env) {
  return new GitHubConnection(
    env.DB,
    connectionsFor(env),
    env.GITHUB_APP_ID ?? "",
    (org) => githubChanged(env, org),
    undefined,
    { secret: () => env.AUTH_SECRET.get(), ...(env.DEVELOPMENT_CONNECTIONS ? { development: async (organizationId: string, userId: string, path: string, method: string, input?: unknown) => {
      const response = await env.DEVELOPMENT_CONNECTIONS!.fetch(new Request("https://internal/github", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId, userId, path, method, ...(input === undefined ? {} : { input }) }) }));
      if (!response.ok) throw new ConnectionError("Your GitHub connection is unavailable. Try again.", response.status);
      return response.json();
    } } : {}) },
  );
}
export async function githubRoute(
  request: Request,
  env: Env,
  user: string,
  clientKind?: string,
): Promise<Response | undefined> {
  const url = new URL(request.url),
    match =
      /^\/api\/organizations\/([^/]+)\/github(?:\/(installations|repositories|selection|actions|token|accessible-repositories|import|workspace-images|workspace-branches|pull-requests|pull-request|pull-request-reviewers|pull-request-images|pull-request-commits|pull-request-files|pull-request-review|pull-request-activity|pull-request-seen|pull-request-ticket))?$/.exec(
        url.pathname,
      );
  if (!match) return;
  const org = decodeURIComponent(match[1]),
    action = match[2],
    service = githubFor(env);
  try {
    if (request.method === "GET") {
      if (action === "pull-requests") return Response.json(await service.openPullRequests(org, user, url.searchParams.get("refresh") === "1"), { headers: { "cache-control": "no-store" } });
      if (action === "pull-request") return Response.json(await service.pullRequestDetail(org, user, url.searchParams.get("repository") ?? "", Number(url.searchParams.get("number"))), { headers: { "cache-control": "no-store" } });
      if (action === "pull-request-reviewers") return Response.json(await service.pullRequestReviewerCandidates(org, user, url.searchParams.get("repository") ?? "", Number(url.searchParams.get("number")), url.searchParams.get("q") ?? ""), { headers: { "cache-control": "no-store" } });
      if (action === "pull-request-commits") return Response.json(await service.pullRequestCommits(org, user, url.searchParams.get("repository") ?? "", Number(url.searchParams.get("number"))), { headers: { "cache-control": "no-store" } });
      if (action === "pull-request-files") return Response.json(await service.pullRequestFiles(org, user, url.searchParams.get("repository") ?? "", Number(url.searchParams.get("number")), Number(url.searchParams.get("changedFiles") ?? 0), url.searchParams.getAll("commit")), { headers: { "cache-control": "no-store" } });
      if (action === "pull-request-review") return Response.json(await service.pullRequestReview(org, user, url.searchParams.get("repository") ?? "", Number(url.searchParams.get("number"))), { headers: { "cache-control": "no-store" } });
      if (action === "pull-request-activity") return Response.json(await service.pullRequestActivity(org, user, url.searchParams.get("repository") ?? "", Number(url.searchParams.get("number"))), { headers: { "cache-control": "no-store" } });
      if (action === "pull-request-ticket") return Response.json(await pullRequestTicket(env, service, org, user, url.searchParams.get("repository") ?? "", Number(url.searchParams.get("number"))), { headers: { "cache-control": "no-store" } });
      if (action === "pull-request-images") return Response.json(await service.pullRequestImages(org, user, url.searchParams.get("repository") ?? "", Number(url.searchParams.get("number"))), { headers: { "cache-control": "no-store" } });
      if (action === "workspace-branches") return Response.json(await service.workspaceBranches(org, user, url.searchParams.get("workspace") ?? ""), { headers: { "cache-control": "no-store" } });
      if (action === "workspace-images") return Response.json(await service.workspaceImage(org, user, url.searchParams.get("workspace") ?? "", url.searchParams.get("path") ?? undefined, url.searchParams.get("q") ?? ""), { headers: { "cache-control": "no-store" } });
      if (action === "accessible-repositories") return Response.json(await service.accessibleRepositories(org, user, Number(url.searchParams.get("page") ?? 1)), {headers: {"cache-control":"no-store"}});
      if (!action) return Response.json(await service.list(org, user));
      if (action === "installations")
        return Response.json({
          installations: await service.installations(org, user),
        });
      if (action === "repositories")
        return Response.json({
          repositories: await service.repositories(
            org,
            user,
            Number(url.searchParams.get("installation")),
          ),
        });
    }
    if (request.method === "POST") {
      const input = (await request.json()) as Record<string, unknown>;
      if (action === "token") {
        if (typeof input.token !== "string") throw new ConnectionError("Enter your GitHub personal access token.");
        await service.access(org, user, ["owner", "admin"]);
        await service.connections.personalToken(org, user, input.token.trim());
        return Response.json({connected:true}, {headers:{"cache-control":"no-store"}});
      }
      if (action === "import") return Response.json(await service.importRepository(org, user, String(input.fullName ?? "")));
      if (
        action === "selection" &&
        Array.isArray(input.repositoryIds) &&
        input.repositoryIds.every(Number.isSafeInteger)
      )
        return Response.json(
          await service.select(
            org,
            user,
            Number(input.installation),
            input.repositoryIds as number[],
          ),
        );
      // A pull request write is the member acting in Remy. A computer holds a
      // member identity too, but it never merges or asks for reviews for them.
      if (action === "actions" && clientKind === "computer")
        throw new ConnectionError("Change pull requests in Remy.", 403);
      if (action === "actions")
        return Response.json(
          await service.action(
            org,
            user,
            String(input.workspaceId),
            String(input.action),
            input,
          ),
        );
    }
    // A read mark is the member acting in Remy, never a computer.
    if (request.method === "PUT" && action === "pull-request-seen") {
      if (clientKind === "computer") throw new ConnectionError("Change pull requests in Remy.", 403);
      const input = (await request.json()) as Record<string, unknown>;
      return Response.json({ seenAt: await service.markActivitySeen(org, user, String(input.repository ?? ""), Number(input.number)) }, { headers: { "cache-control": "no-store" } });
    }
    return Response.json({ error: "Choose a GitHub action." }, { status: 400 });
  } catch (e) {
    // A ConnectionError already carries the status it means. Flattening every
    // one to 400 hid the difference between a bad request and an account that
    // is simply not connected, which a caller has to tell apart.
    return Response.json(
      {
        error:
          e instanceof ConnectionError ? e.message : "GitHub is unavailable.",
      },
      { status: e instanceof ConnectionError ? e.status : 400 },
    );
  }
}

/// The Linear issue a pull request belongs to, or null when your Linear
/// account is not connected here or nothing matches. A Linear failure is not
/// the pull request's failure, so it answers null rather than an error.
async function pullRequestTicket(env: Env, service: GitHubConnection, org: string, user: string, repository: string, number: number) {
  const pull = await service.pullRequestReference(org, user, repository, number);
  try {
    return { ticket: await linearAccountsFor(env).pullRequestTicket(org, user, pull) };
  } catch {
    return { ticket: null };
  }
}
