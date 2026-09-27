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
