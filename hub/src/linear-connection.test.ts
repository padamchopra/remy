import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../test/sqlite-d1.js";
import { LinearConnection } from "./linear-connection.js";
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
    "INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('ada','Ada','ada@example.test',1,1),('grace','Grace','grace@example.test',1,1); INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('studio','Studio',1,1),('other','Other',1,1); INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('m1','studio','ada','owner',1,1),('m2','studio','grace','member',1,1); INSERT INTO connections(id,organization_id,provider,subject,external_id,label,credentials,updated_at) VALUES('linear','studio','linear','','linear-studio','Studio','encrypted',1);",
  );
  const calls: string[] = [];
  const send = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const { query, variables } = JSON.parse(String(init?.body));
    calls.push(query);
    const connection = (nodes: unknown[], hasNextPage = false) => ({
      nodes,
      pageInfo: { hasNextPage, endCursor: hasNextPage ? "second" : null },
    });
    if (query.includes("workflowStates"))
      return Response.json({
        data: {
          workflowStates: connection([
            { id: "todo", name: "Todo", type: "unstarted" },
            { id: "done", name: "Done", type: "completed" },
          ]),
        },
      });
    if (query.includes("projects("))
      return Response.json({
        data: {
          projects: connection([
            {
              id: "release",
              name: "Release",
              teams: { nodes: [{ id: "eng" }] },
            },
          ]),
        },
      });
    if (query.includes("users("))
      return Response.json({
        data: {
          users: connection([
            { id: "u1", name: "Ada Linear", email: "ada@example.test" },
            {
              id: "u2",
              name: "Unknown colleague",
              email: "unknown@example.test",
            },
          ]),
        },
      });
    return Response.json({
      data: {
        teams: variables.after
          ? connection([{ id: "design", name: "Design", key: "DSN" }])
          : connection([{ id: "eng", name: "Engineering", key: "ENG" }], true),
      },
    });
  }) as typeof fetch;
  const service = new LinearConnection(
    db,
    { token: async () => "only-in-hub" } as unknown as Connections,
    async () => {},
    send,
  );
  return { service, sqlite, calls };
}
test("catalog pagination lists every team and proposes member matches without exposing email", async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.refresh("studio", "grace"));
  const result = await service.refresh("studio", "ada");
  assert.equal(result.catalog.teams.length, 2);
  assert.equal(result.catalog.users[0].suggestedMemberId, "ada");
  assert.equal(result.catalog.users[1].name, "Unknown colleague");
  assert.equal(result.matches.length, 0);
  assert.ok(!JSON.stringify(result).includes("example.test"));
  assert.equal(calls.filter((q) => q.includes("teams(first")).length, 2);
  assert.equal((await service.list("studio", "grace")).catalog.teams.length, 0);
});
test("workspace and member mappings validate tenant, team membership and complete state mappings", async () => {
  const { service, sqlite } = fixture();
  await service.refresh("studio", "ada");
  const workspace = await service.organizations.createWorkspace(
    "studio",
    "ada",
    { name: "Remy", origin: "https://github.com/release/remy.git" },
  );
  const valid = {
    linearTeamId: "eng",
    linearProjectId: "release",
    statusMap: { todo: "todo", done: "done" },
  };
  await service.mapWorkspace("studio", "ada", workspace.id, valid);
  await assert.rejects(
    service.mapWorkspace("studio", "grace", workspace.id, valid),
  );
  await assert.rejects(
    service.mapWorkspace("studio", "ada", workspace.id, {
      ...valid,
      statusMap: { todo: "todo" },
    }),
  );
  await assert.rejects(
    service.mapWorkspace("studio", "ada", workspace.id, {
      ...valid,
      linearTeamId: "design",
    }),
  );
  await assert.rejects(
    service.mapWorkspace("studio", "ada", workspace.id, {
      ...valid,
      remyTeamId: "outside",
    }),
  );
  await service.mapMember("studio", "ada", "u1", "ada");
  await assert.rejects(service.mapMember("studio", "ada", "u2", "outside"));
  assert.equal((await service.list("studio", "ada")).matches.length, 1);
  sqlite
    .prepare(
      "DELETE FROM memberships WHERE organization_id='studio' AND user_id='ada'",
    )
    .run();
  assert.equal(
    sqlite.prepare("SELECT count(*) n FROM linear_member_mappings").get()?.n,
    0,
  );
});
test("verified updates route only to the connected organization and retain one durable receipt", async () => {
  const { service, sqlite } = fixture();
  const delivery = (
    id: string,
    organizationId: string,
  ): ConnectionDelivery => ({
    id,
    provider: "linear",
    delivery_id: id,
    event: "Issue",
    payload: JSON.stringify({
      organizationId,
      type: "Issue",
      action: "update",
      data: { id: "issue", stateId: "done" },
    }),
    status: "pending",
    received_at: 1,
  });
  await service.receive(delivery("foreign", "elsewhere"));
  await service.receive(delivery("one", "linear-studio"));
  await service.receive(delivery("one", "linear-studio"));
  assert.equal(
    sqlite.prepare("SELECT count(*) n FROM linear_updates").get()?.n,
    1,
  );
  assert.equal(
    sqlite.prepare("SELECT organization_id FROM linear_updates").get()
      ?.organization_id,
    "studio",
  );
});

test("replacing the Linear account hides previous mappings",async()=>{const {service,sqlite}=fixture();await service.refresh('studio','ada');const workspace=await service.organizations.createWorkspace('studio','ada',{name:'Remy',origin:'https://github.com/release/remy.git'});await service.mapWorkspace('studio','ada',workspace.id,{linearTeamId:'eng',statusMap:{todo:'todo',done:'done'}});await service.mapMember('studio','ada','u1','ada');sqlite.prepare("UPDATE connections SET external_id='replacement' WHERE id='linear'").run();await service.refresh('studio','ada');const current=await service.list('studio','ada');assert.equal(current.mappings.length,0);assert.equal(current.matches.length,0);await service.mapMember('studio','ada','u2','ada');assert.equal((await service.list('studio','ada')).matches[0].linear_user_id,'u2');});
