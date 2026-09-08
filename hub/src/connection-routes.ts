import {
  Connections,
  ConnectionError,
  ingestConnectionWebhook,
  type ConnectionJob,
} from "./connections.js";
import { connectionProviders } from "./connection-providers.js";
import { D1OrganizationStore } from "./organization-store.js";
import { OrganizationService } from "./organizations.js";
import type { Env } from "./worker.js";

export function connectionsFor(env: Env) {
  return new Connections(
    env.DB,
    connectionProviders(env),
    () => env.AUTH_SECRET.get(),
    new OrganizationService(new D1OrganizationStore(env.DB)),
    async (org) => {
      await env.COORDINATOR.get(
        env.COORDINATOR.idFromName(`organization:${org}`),
      ).fetch(
        new Request("https://internal/connections/changed", {
          method: "POST",
          headers: { "x-organization-id": org },
        }),
      );
    },
  );
}

export async function connectionWebhook(
  request: Request,
  env: Env,
): Promise<Response | undefined> {
  const match = /^\/api\/connections\/([a-z]+)\/webhook$/.exec(
    new URL(request.url).pathname,
  );
  if (!match || request.method !== "POST") return;
  try {
    return await ingestConnectionWebhook(
      request,
      connectionsFor(env).provider(match[1]),
      env.DB,
      env.JOBS as Queue<ConnectionJob>,
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ConnectionError
            ? error.message
            : "This update could not be accepted.",
      },
      { status: error instanceof ConnectionError ? error.status : 503 },
    );
  }
}

export async function connectionRoute(
  request: Request,
  env: Env,
  userId: string,
): Promise<Response | undefined> {
  const url = new URL(request.url),
    callback = /^\/api\/connections\/([a-z]+)\/callback$/.exec(url.pathname),
    route = /^\/api\/organizations\/([^/]+)\/connections(?:\/([a-z]+))?$/.exec(
      url.pathname,
    );
  if (!callback && !route) return;
  const service = connectionsFor(env);
  try {
    if (callback && request.method === "GET") {
      const org = await service.finish(
        userId,
        callback[1],
        url.searchParams.get("state") ?? "",
        url.searchParams.get("code") ?? "",
        new URL(env.BETTER_AUTH_URL).origin,
      );
      return new Response(null, {
        status: 303,
        headers: {
          location: `${new URL(env.BETTER_AUTH_URL).origin}/#/settings/connections?organization=${encodeURIComponent(org)}`,
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
      });
    }
    if (!route)
      return Response.json(
        { error: "Reconnect your account." },
        { status: 400 },
      );
    const org = decodeURIComponent(route[1]),
      provider = route[2];
    if (!provider && request.method === "GET")
      return Response.json(await service.list(org, userId), {
        headers: { "cache-control": "no-store" },
      });
    if (provider && ["POST", "DELETE"].includes(request.method)) {
      const body = (await request.json()) as { scope?: string };
      if (body.scope !== "organization" && body.scope !== "member")
        throw new ConnectionError("Choose a connection owner.");
      const subject = body.scope === "member" ? userId : "";
      if (request.method === "DELETE") {
        await service.disconnect(org, userId, provider, subject);
        return Response.json({ ok: true });
      }
      return Response.json(
        await service.begin(
          org,
          userId,
          provider,
          subject,
          new URL(env.BETTER_AUTH_URL).origin,
        ),
      );
    }
    return Response.json(
      { error: "This connection action is unavailable." },
      { status: 405 },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ConnectionError
            ? error.message
            : "Your connection could not be updated; try again.",
      },
      { status: error instanceof ConnectionError ? error.status : 400 },
    );
  }
}
