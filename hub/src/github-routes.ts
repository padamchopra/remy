import { ConnectionError } from "./connections.js";
import { GitHubConnection } from "./github-connection.js";
import { connectionsFor } from "./connection-routes.js";
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
  );
}
export async function githubRoute(
  request: Request,
  env: Env,
  user: string,
): Promise<Response | undefined> {
  const url = new URL(request.url),
    match =
      /^\/api\/organizations\/([^/]+)\/github(?:\/(installations|repositories|selection|monitoring|actions))?$/.exec(
        url.pathname,
      );
  if (!match) return;
  const org = decodeURIComponent(match[1]),
    action = match[2],
    service = githubFor(env);
  try {
    if (request.method === "GET") {
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
      if (action === "monitoring") {
        await service.access(org, user, ["owner", "admin"]);
        return env.COORDINATOR.get(
          env.COORDINATOR.idFromName(`organization:${org}`),
        ).fetch(
          new Request("https://internal/github/monitoring", {
            method: "POST",
            headers: {
              "x-organization-id": org,
              "x-user-id": user,
              "content-type": "application/json",
            },
            body: JSON.stringify(input),
          }),
        );
      }
    }
    return Response.json({ error: "Choose a GitHub action." }, { status: 400 });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof ConnectionError ? e.message : "GitHub is unavailable.",
      },
      { status: 400 },
    );
  }
}
