import { LinearConnection } from "./linear-connection.js";
import { ConnectionError } from "./connections.js";
import { connectionsFor } from "./connection-routes.js";
import { githubChanged } from "./github-routes.js";
import type { Env } from "./worker.js";
export function linearFor(env: Env) {
  return new LinearConnection(env.DB, connectionsFor(env), (org) =>
    githubChanged(env, org),
  );
}
export async function linearRoute(
  request: Request,
  env: Env,
  user: string,
): Promise<Response | undefined> {
  const url = new URL(request.url),
    match =
      /^\/api\/organizations\/([^/]+)\/linear(?:\/(refresh|workspace|member))?$/.exec(
        url.pathname,
      );
  if (!match) return;
  const org = decodeURIComponent(match[1]),
    service = linearFor(env);
  try {
    if (!match[2] && request.method === "GET")
      return Response.json(await service.list(org, user));
    if (request.method === "POST") {
      if (match[2] === "refresh")
        return Response.json(await service.refresh(org, user));
      const input = (await request.json()) as Record<string, unknown>;
      if (match[2] === "workspace") {
        await service.mapWorkspace(
          org,
          user,
          String(input.workspaceId),
          input as Parameters<LinearConnection["mapWorkspace"]>[3],
        );
        return Response.json(await service.list(org, user));
      }
      if (match[2] === "member") {
        await service.mapMember(
          org,
          user,
          String(input.linearUserId),
          typeof input.memberId === "string" ? input.memberId : null,
        );
        return Response.json(await service.list(org, user));
      }
    }
    return Response.json(
      { error: "Choose a Linear connection action." },
      { status: 400 },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof ConnectionError
            ? e.message
            : "Your Linear mapping could not be saved.",
      },
      { status: e instanceof ConnectionError ? e.status : 400 },
    );
  }
}
