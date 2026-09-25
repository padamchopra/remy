import { LinearConnection } from "./linear-connection.js";
import { ConnectionError } from "./connections.js";
import { connectionsFor } from "./connection-routes.js";
import { LinearAccounts, assertLinearPerson } from "./linear-accounts.js";
import { githubChanged } from "./github-routes.js";
import { D1OrganizationStore } from "./organization-store.js";
import { OrganizationService } from "./organizations.js";
import type { Env } from "./worker.js";
export function linearAccountsFor(env: Env) {
  return new LinearAccounts(
    env.DB,
    connectionsFor(env).vault,
    new OrganizationService(new D1OrganizationStore(env.DB)),
    (org) => githubChanged(env, org),
    Date.now,
    {
      clientId: env.LINEAR_CLIENT_ID,
      clientSecret: env.LINEAR_CLIENT_SECRET
        ? () => env.LINEAR_CLIENT_SECRET!.get()
        : undefined,
    },
  );
}
export function linearFor(env: Env) {
  const accounts = linearAccountsFor(env);
  return new LinearConnection(
    env.DB,
    connectionsFor(env),
    (org) => githubChanged(env, org),
    fetch,
    (org, user) => accounts.accessToken(org, user),
  );
}
export async function linearAccountRoute(
  request: Request,
  env: Env,
  user: string,
  clientKind?: string,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const workspace = /^\/api\/organizations\/([^/]+)\/linear-workspace$/.exec(url.pathname);
  const access = /^\/api\/organizations\/([^/]+)\/linear-access$/.exec(url.pathname);
  if (!workspace && !access) return;
  const org = decodeURIComponent((workspace ?? access)![1]);
  const accounts = linearAccountsFor(env);
  try {
    if (access && request.method === "GET")
      return Response.json(
        { notice: await accounts.accessNotice(org, user) },
        { headers: { "cache-control": "no-store" } },
      );
    if (workspace && request.method === "GET")
      return Response.json(await accounts.view(org, user), {
        headers: { "cache-control": "no-store" },
      });
    if (workspace && request.method === "PUT") {
      assertLinearPerson(clientKind);
      const input = (await request.json()) as { accountId?: unknown };
      const accountId = input.accountId === null ? null : input.accountId;
      if (accountId !== null && typeof accountId !== "string")
        throw new ConnectionError("Choose one of your Linear accounts.");
      return Response.json(await accounts.setLink(org, user, accountId));
    }
    return Response.json(
      { error: "Choose a Linear connection action." },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ConnectionError
            ? error.message
            : "Your Linear account could not be saved.",
      },
      { status: error instanceof ConnectionError ? error.status : 400 },
    );
  }
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
