import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../test/sqlite-d1.js";
import { MemoryBoard } from "../test/memory-board.js";
import { OrganizationBoard } from "./organization-board.js";
import { LinearConnection } from "./linear-connection.js";
import { LinearBoard, type LinearIssue } from "./linear-board.js";
import type { Connections } from "./connections.js";
async function fixture() {
  const folder = new URL("../migrations/", import.meta.url),
    { db, sqlite } = sqliteD1(
      readdirSync(folder)
        .filter((f) => f.endsWith(".sql"))
        .sort()
        .map((f) => readFileSync(new URL(f, folder), "utf8"))
        .join("\n"),
    );
  sqlite.exec(
    "INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('ada','Ada','ada@example.test',1,1); INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('studio','Studio',1,1); INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('m','studio','ada','owner',1,1); INSERT INTO connections(id,organization_id,provider,subject,external_id,label,credentials,updated_at) VALUES('linear','studio','linear','','external','Studio','encrypted',1);",
  );
  const catalog = {
    teams: [
      {
        id: "eng",
        key: "ENG",
        name: "Engineering",
        states: [
          { id: "ready", name: "Ready", type: "unstarted" },
          { id: "working", name: "Working", type: "started" },
          { id: "done", name: "Done", type: "completed" },
        ],
      },
    ],
    projects: [],
    users: [
      { id: "linear-ada", name: "Ada" },
      { id: "linear-agent", name: "Remy" },
    ],
  };
  sqlite
    .prepare("INSERT INTO linear_catalog VALUES(?,?,?,?)")
    .run("studio", "external", JSON.stringify(catalog), 1);
  const linear = new LinearConnection(db, {} as Connections, async () => {}),
    workspace = await linear.organizations.createWorkspace("studio", "ada", {
      name: "Remy",
      origin: "github.com/release/remy",
    });
  await linear.mapWorkspace("studio", "ada", workspace.id, {
    linearTeamId: "eng",
    statusMap: { ready: "todo", working: "in_progress", done: "done" },
  });
  await linear.mapMember("studio", "ada", "linear-ada", "ada");
  const issues = new Map<string, LinearIssue>(),
    comments = new Map<string, { id: string; issueId: string; body: string }>(),
    calls: { query: string; variables: Record<string, any> }[] = [];
  let now = 2000,
    lost = false;
  const initial: LinearIssue = {
    id: "initial",
    identifier: "ENG-7",
    number: 7,
    url: "https://linear.app/release/issue/ENG-7",
    title: "Review release",
    description: "Prepare notes",
    updatedAt: new Date(1000).toISOString(),
    team: { id: "eng", key: "ENG" },
    project: null,
    state: { id: "ready", name: "Ready" },
    assignee: null,
    labels: { nodes: [{ id: "release-label", name: "Release" }] },
    parent: null,
  };
  issues.set(initial.id, initial);
  linear.query = async <T>(
    _org: string,
    query: string,
    variables: Record<string, any> = {},
  ) => {
    calls.push({ query, variables: structuredClone(variables) });
    let result: unknown;
    if (query.includes("issueCreate(")) {
      if (issues.has(variables.input.id)) throw Error("duplicate ID");
      const input = variables.input,
        issue = {
          ...initial,
          id: input.id,
          identifier: `ENG-${issues.size + 7}`,
          number: issues.size + 7,
          title: input.title,
          description: input.description ?? "",
          state: { id: input.stateId ?? "ready", name: "Ready" },
          parent: input.parentId ? { id: input.parentId } : null,
          updatedAt: new Date(now).toISOString(),
        };
      issues.set(issue.id, issue);
      result = { issueCreate: { success: true, issue } };
    } else if (query.includes("issueUpdate(")) {
      const issue = issues.get(variables.id);
      if (!issue) throw Error("missing");
      const input = variables.input;
      Object.assign(issue, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.stateId
          ? { state: { id: input.stateId, name: input.stateId } }
          : {}),
        ...(input.assigneeId !== undefined
          ? {
              assignee: input.assigneeId
                ? { id: input.assigneeId, name: "Assigned" }
                : null,
            }
          : {}),
        ...(input.parentId !== undefined
          ? { parent: input.parentId ? { id: input.parentId } : null }
          : {}),
        updatedAt: new Date(now).toISOString(),
      });
      result = { issueUpdate: { success: true } };
    } else if (query.includes("commentCreate(")) {
      if (comments.has(variables.input.id)) throw Error("duplicate comment ID");
      comments.set(variables.input.id, variables.input);
      if (lost) {
        lost = false;
        throw Error("response lost");
      }
      result = { commentCreate: { success: true } };
    } else if (query.includes("comment(id:"))
      result = { comment: comments.get(variables.id) ?? null };
    else if (query.includes("issue(id:")) {
      const issue =
        issues.get(variables.id) ??
        [...issues.values()].find((i) => i.identifier === variables.id);
      if (!issue) throw Error("missing");
      result = { issue };
    } else if (query.includes("issueLabels("))
      result = {
        issueLabels: {
          nodes: [
            { id: "release-label", name: "Release", team: { id: "eng" } },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      };
    else
      result = {
        issues: {
          nodes: [...issues.values()],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      };
    return structuredClone(result) as T;
  };
  const storage = new MemoryBoard(),
    board = new OrganizationBoard(storage, { now: () => now }),
    starts: { user: string; workspace: string; agent: string }[] = [],
    service = new LinearBoard(
      "studio",
      linear,
      board,
      storage,
      async (user, workspace, agent) => {
        starts.push({ user, workspace, agent });
        return { threadId: "thread-1", computerId: "mac" };
      },
      "https://remy.test",
    );
  await service.configure("ada", workspace.id, true, {
    "linear-agent": "builder",
  });
  await service.tick();
  return {
    service,
    linear,
    board,
    storage,
    issues,
    comments,
    calls,
    workspace,
    starts,
    initial,
    now: (value: number) => {
      now = value;
    },
    lose: () => {
      lost = true;
    },
  };
}
test("field timestamps converge in both directions and old writes restore the winner", async () => {
  const f = await fixture(),
    ticket = (await f.board.list("tickets")).items[0];
  assert.equal(ticket.fields.keyPrefix, "ENG");
  assert.equal(ticket.fields.number, 7);
  f.now(3000);
  await f.board.append(
    {
      entity: "ticket",
      entityId: ticket.id,
      kind: "field",
      payload: { title: "Remy change" },
    },
    { kind: "member", id: "ada", label: "Ada" },
  );
  await f.service.tick();
  assert.equal(f.issues.get("initial")?.title, "Remy change");
  const remote = {
    ...f.initial,
    title: "Newer Linear change",
    updatedAt: new Date(4000).toISOString(),
  };
  f.issues.set("initial", remote);
  await f.service.importIssue(remote, "newer");
  await f.service.importIssue(
    { ...remote, title: "Old retry", updatedAt: new Date(2500).toISOString() },
    "old",
  );
  assert.equal(
    (await f.board.detail("tickets", ticket.id))?.fields.title,
    "Newer Linear change",
  );
  f.now(3500);
  await f.board.append(
    {
      entity: "ticket",
      entityId: ticket.id,
      kind: "field",
      payload: { title: "Late old local write" },
    },
    { kind: "member", id: "ada", label: "Ada" },
  );
  await f.service.tick();
  assert.equal(
    (await f.board.detail("tickets", ticket.id))?.fields.title,
    "Newer Linear change",
  );
  assert.equal(f.issues.get("initial")?.title, "Newer Linear change");
});
test("fifty rapid edits and comments replay without duplicate Linear comments", async () => {
  const f = await fixture(),
    ticket = (await f.board.list("tickets")).items[0];
  for (let n = 0; n < 50; n++) {
    f.now(5000 + n);
    await f.board.append(
      {
        entity: "ticket",
        entityId: ticket.id,
        kind: "field",
        payload: { title: `Edit ${n}` },
      },
      { kind: "member", id: "ada", label: "Ada" },
    );
    await f.board.append(
      {
        entity: "ticket",
        entityId: ticket.id,
        kind: "comment",
        payload: { text: `Comment ${n}` },
      },
      { kind: "member", id: "ada", label: "Ada" },
    );
  }
  f.lose();
  await f.service.tick();
  await f.service.tick();
  assert.equal(f.comments.size, 50);
  assert.equal(new Set([...f.comments.values()].map((c) => c.body)).size, 50);
  assert.equal(f.issues.get("initial")?.title, "Edit 49");
  for (const comment of f.comments.values())
    await f.service.receive(
      {
        type: "Comment",
        action: "create",
        data: { ...comment, createdAt: new Date(6000).toISOString() },
      },
      `echo:${comment.id}`,
    );
  assert.equal(
    (await f.board.detail("tickets", ticket.id))?.activity.filter(
      (a) => a.kind === "comment",
    ).length,
    50,
  );
});
test("turning sync off preserves both sides and starts no new mirror writes", async () => {
  const f = await fixture(),
    ticket = (await f.board.list("tickets")).items[0];
  await f.service.configure("ada", f.workspace.id, false, {});
  const before = f.calls.length;
  await f.board.append(
    {
      entity: "ticket",
      entityId: ticket.id,
      kind: "field",
      payload: { title: "Only Remy" },
    },
    { kind: "member", id: "ada", label: "Ada" },
  );
  await f.service.tick();
  assert.equal(f.calls.length, before);
  assert.equal(f.issues.get("initial")?.title, "Review release");
  assert.equal(
    (await f.board.detail("tickets", ticket.id))?.fields.title,
    "Only Remy",
  );
});
test("assigned agents use the mapped actor and uncertain replies reconcile by stable comment id", async () => {
  const f = await fixture(),
    issue = {
      ...f.initial,
      assignee: { id: "linear-agent", name: "Remy" },
      updatedAt: new Date(8000).toISOString(),
    };
  f.issues.set("initial", issue);
  const payload = {
    type: "Issue",
    action: "update",
    actor: { id: "linear-ada" },
    data: issue,
    updatedFrom: { assigneeId: null },
  };
  await f.service.receive(payload, "assign");
  await f.service.receive(payload, "assign");
  assert.equal(f.starts.length, 1);
  assert.equal(f.starts[0].user, "ada");
  f.lose();
  await assert.rejects(f.service.reply("mac", "thread-1", "Completed"));
  await f.service.reply("mac", "thread-1", "Completed");
  await f.service.reply("mac", "thread-1", "Completed");
  assert.equal(f.comments.size, 2);
  assert.ok(
    [...f.comments.values()].every((c) =>
      c.body.includes("https://remy.test/#/threads/"),
    ),
  );
});
test("sub-tickets create sub-issues and unknown actors cannot launch an agent", async () => {
  const f = await fixture(),
    parent = (await f.board.list("tickets")).items[0];
  await f.board.append(
    {
      entity: "ticket",
      entityId: "child",
      kind: "create",
      payload: {
        projectId: f.workspace.id,
        title: "Child",
        status: "todo",
        parentId: parent.id,
      },
    },
    { kind: "member", id: "ada", label: "Ada" },
  );
  await f.service.tick();
  assert.equal(
    [...f.issues.values()].find((i) => i.title === "Child")?.parent?.id,
    "initial",
  );
  const issue = {
    ...f.initial,
    assignee: { id: "linear-agent", name: "Remy" },
    updatedAt: new Date(9000).toISOString(),
  };
  f.issues.set("initial", issue);
  await f.service.receive(
    {
      type: "Issue",
      action: "update",
      actor: { id: "outsider" },
      data: issue,
      updatedFrom: { assigneeId: null },
    },
    "outside",
  );
  assert.equal(f.starts.length, 0);
  assert.equal(
    (await f.service.resolve("ada", f.workspace.id, "ENG-7")).issue.id,
    "initial",
  );
});

test("resolving a sub-issue imports its parent before linking the ticket", async () => {
  const f = await fixture();
  const parent = {
    ...f.initial,
    id: "remote-parent",
    identifier: "ENG-20",
    number: 20,
    title: "Remote parent",
  };
  const child = {
    ...f.initial,
    id: "remote-child",
    identifier: "ENG-21",
    number: 21,
    parent: { id: parent.id },
  };
  f.issues.set(parent.id, parent);
  f.issues.set(child.id, child);
  const resolved = await f.service.resolve(
    "ada",
    f.workspace.id,
    child.identifier,
  );
  const ticket = await f.board.detail("tickets", resolved.ticketId!);
  const linked = await f.board.detail(
    "tickets",
    String(ticket?.fields.parentId),
  );
  assert.equal(linked?.fields.linearIssueId, parent.id);
});
