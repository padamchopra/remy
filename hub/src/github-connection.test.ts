import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../test/sqlite-d1.js";
import { GitHubConnection } from "./github-connection.js";
import type { Connections, ConnectionDelivery } from "./connections.js";
function fixture() {
  const folder = new URL("../migrations/", import.meta.url),
    { db, sqlite } = sqliteD1(
      readdirSync(folder)
        .filter((f) => f.endsWith(".sql"))
        .sort()
        .map((f) => readFileSync(new URL(f, folder), "utf8"))
        .join("\n"),
    );
  sqlite.exec(
    "INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('ada','Ada','ada@example.test',1,1),('grace','Grace','grace@example.test',1,1); INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('studio','Studio',1,1); INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('m1','studio','ada','owner',1,1),('m2','studio','grace','member',1,1);",
  );
  const calls: {
      path: string;
      method: string;
      actor: string;
      body: unknown;
    }[] = [],
    comments: { id: number; body: string }[] = [];
  let lostReply = false;
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname,
      method = init?.method ?? "GET",
      actor = new Headers(init?.headers).get("authorization") ?? "",
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, actor, body });
    if (path === "/user/installations")
      return Response.json({
        installations: [
          { id: 20, app_id: 12, account: { login: "release" } },
          { id: 21, app_id: 999, account: { login: "wrong" } },
        ],
      });
    if (path === "/user/installations/20/repositories")
      return Response.json({
        repositories: [
          {
            id: 101,
            full_name: "release/remy",
            name: "Remy",
            html_url: "https://github.com/release/remy",
          },
        ],
      });
    if (path.endsWith("/comments")) {
      if (method === "POST") {
        comments.push({ id: comments.length + 1, body: body.body });
        if (lostReply) {
          lostReply = false;
          throw Error("lost response");
        }
        return Response.json(comments.at(-1));
      }
      return Response.json(comments);
    }
    return Response.json({ id: 1, number: 7 });
  }) as typeof fetch;
  const service = new GitHubConnection(
    db,
    {
      token: async (_org: string, _provider: string, user: string) =>
        `member-${user}`,
    } as Connections,
    "12",
    async () => {},
    send,
  );
  return {
    db,
    sqlite,
    service,
    calls,
    comments,
    loseReply: () => {
      lostReply = true;
    },
  };
}
test("repository selection verifies the app and member access and reuses the canonical workspace", async () => {
  const { service, sqlite } = fixture();
  const existing = await service.organizations.createWorkspace(
    "studio",
    "ada",
    { name: "Existing", origin: "git@github.com:release/remy.git" },
  );
  await assert.rejects(service.select("studio", "grace", 20, [101]));
  await assert.rejects(service.select("studio", "ada", 21, [101]));
  await assert.rejects(service.select("studio", "ada", 20, [999]));
  const selected = await service.select("studio", "ada", 20, [101]);
  assert.equal(selected.repositories[0].workspace_id, existing.id);
  await service.select("studio", "ada", 20, []);
  assert.equal((await service.list("studio", "ada")).repositories.length, 0);
  assert.equal(
    sqlite.prepare("SELECT count(*) n FROM organization_workspaces").get()?.n,
    1,
  );
});
test("PR actions use the caller identity and reject inaccessible workspaces", async () => {
  const { service, calls } = fixture(),
    selected = await service.select("studio", "ada", 20, [101]),
    workspace = selected.repositories[0].workspace_id;
  await service.action("studio", "grace", workspace, "comment", {
    number: 7,
    body: "Ready to review",
  });
  assert.equal(calls.at(-1)?.actor, "Bearer member-grace");
  await service.organizations.updateWorkspace("studio", "ada", workspace, {
    access: { teamIds: [], userIds: ["ada"] },
  });
  await assert.rejects(
    service.action("studio", "grace", workspace, "review", {
      number: 7,
      event: "APPROVE",
    }),
  );
  await assert.rejects(
    service.action("studio", "ada", workspace, "comment", {
      number: -1,
      body: "bad",
    }),
  );
});
test("mentions require explicit monitoring and mapped members; deliveries and uncertain replies deduplicate", async () => {
  const { service, sqlite, comments, loseReply } = fixture(),
    selected = await service.select("studio", "ada", 20, [101]),
    workspace = selected.repositories[0].workspace_id;
  sqlite
    .prepare(
      "INSERT INTO connections(id,organization_id,provider,subject,external_id,label,credentials,updated_at) VALUES('c','studio','github','grace','102','Grace','encrypted',1)",
    )
    .run();
  sqlite
    .prepare(
      "INSERT INTO connection_identities(connection_id,organization_id,user_id,external_user_id) VALUES('c','studio','grace','102')",
    )
    .run();
  let starts = 0;
  const start = async (_org: string, user: string) => {
    assert.equal(user, "grace");
    starts++;
    return { threadId: "thread-1", computerId: "mac-1" };
  };
  const delivery = (id: string, sender = 102): ConnectionDelivery => ({
    id,
    provider: "github",
    delivery_id: id,
    event: "issue_comment",
    payload: JSON.stringify({
      installation: { id: 20 },
      repository: { id: 101 },
      issue: { number: 7, pull_request: {} },
      comment: { body: "@remy please fix this" },
      sender: { id: sender },
      action: "created",
    }),
    status: "pending",
    received_at: 1,
  });
  await service.receive(delivery("off"), start);
  assert.equal(starts, 0);
  await service.configure("studio", "ada", workspace, 0, true, "agent-1");
  await service.receive(delivery("unknown", 999), start);
  assert.equal(starts, 0);
  await service.receive(delivery("work"), start);
  await service.receive(delivery("work"), start);
  assert.equal(starts, 1);
  loseReply();
  await assert.rejects(
    service.reply("studio", "thread-1", "Fixed and tested."),
  );
  await service.reply("studio", "thread-1", "Fixed and tested.");
  await service.reply("studio", "thread-1", "Fixed and tested.");
  assert.equal(comments.length, 1);
  await service.configure("studio", "ada", workspace, 7, false, null);
  await service.receive(delivery("override"), start);
  assert.equal(starts, 1);
});
