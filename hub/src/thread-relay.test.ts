import assert from "node:assert/strict";
import test from "node:test";
import { createRouteHandler, type Env } from "./worker.js";

function setup(userId = "ada") {
  const forwarded: Request[] = [];
  const route = createRouteHandler({
    accountStore: () => ({ profile: async () => ({ name: "Ada" }) }) as never,
    accountService: () =>
      ({
        authenticate: async (token: string) =>
          token === "session"
            ? { userId, sessionId: "session", clientKind: "web" }
            : undefined,
      }) as never,
    organizationStore: () => ({}) as never,
    organizationService: () =>
      ({
        member: async (org: string) => {
          if (org !== "team") {
            const { OrganizationError } = await import("./organizations.js");
            throw new OrganizationError(404, "Organization not found.");
          }
          return { role: "member" };
        },
      }) as never,
    computerStore: () =>
      ({
        computer: async (org: string, id: string) =>
          org === "team" && id === "studio" ? { computerId: id } : undefined,
      }) as never,
  });
  const env = {
    COORDINATOR: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (request: Request) => {
          forwarded.push(request);
          return Response.json({ ok: true });
        },
      }),
    },
  } as unknown as Env;
  const call = (path: string, options: RequestInit = {}) =>
    route(
      new Request(`https://hub.example/api/organizations/${path}`, {
        ...options,
        headers: { authorization: "Bearer session", ...options.headers },
      }),
      env,
    );
  return { call, forwarded };
}

test("thread routes bind the actor to the authenticated session and refuse neighboring privileged routes", async () => {
  const { call, forwarded } = setup();
  assert.equal(
    (
      await call("team/computers/studio/threads", {
        method: "POST",
        headers: { "x-thread-member": '{"id":"owner"}' },
        body: JSON.stringify({ workspaceId: "workspace", actor: "owner" }),
      })
    ).status,
    200,
  );
  assert.deepEqual(
    JSON.parse(
      decodeURIComponent(forwarded[0]!.headers.get("x-thread-member")!),
    ),
    {
      id: "ada",
      label: "Ada",
    },
  );
  assert.equal(forwarded[0]!.headers.has("authorization"), false);
  assert.equal(
    (await call("team/computers/studio/proxy/server/settings")).status,
    403,
  );
  assert.equal(
    (await call("team/computers/studio/stream/notify/stream")).status,
    403,
  );
  assert.equal((await call("other-team/computers/studio/threads")).status, 404);
  assert.equal(
    (await call("team/computers/other-computer/threads")).status,
    404,
  );
  assert.equal(forwarded.length, 1);
});

test("browser writes require the same origin, while native clients authenticate with their session", async () => {
  const { call, forwarded } = setup();
  assert.equal(
    (
      await call("team/computers/studio/threads", {
        method: "POST",
        headers: { origin: "https://other.example" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("team/computers/studio/threads", {
        method: "POST",
        body: "{}",
      })
    ).status,
    200,
  );
  assert.equal(
    (await call("team/threads", { headers: { authorization: "Bearer wrong" } }))
      .status,
    401,
  );
  assert.equal(forwarded.length, 1);
});
