import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Every module here opens the shared database at import time, so the suite runs
// against a throwaway directory. node:test gives each file its own process, so
// this override cannot leak sideways.
const stateDir = mkdtempSync(join(tmpdir(), "mc-tickets-"));
process.env.MC_CONFIG_DIR = stateDir;

const { db } = await import("./db.js");
const config = await import("./config.js");
const log = await import("./board-log.js");
const projects = await import("./projects.js");
const tickets = await import("./tickets.js");
const agents = await import("./agents.js");
const runner = await import("./ticket-runner.js");

function project(name: string) {
  return projects.createProject({ name });
}

// ── ordering ────────────────────────────────────────────────────────────────

test("a rank always sorts between the two it was asked for", () => {
  const first = tickets.rankBetween();
  const before = tickets.rankBetween(undefined, first);
  const after = tickets.rankBetween(first);
  const middle = tickets.rankBetween(first, after);

  assert.ok(before < first, `${before} should sort before ${first}`);
  assert.ok(first < middle, `${first} should sort before ${middle}`);
  assert.ok(middle < after, `${middle} should sort before ${after}`);
});

test("ranks stay orderable when a card is dropped into the same gap repeatedly", () => {
  let low = tickets.rankBetween();
  const high = tickets.rankBetween(low);
  for (let i = 0; i < 50; i += 1) {
    const next = tickets.rankBetween(low, high);
    assert.ok(low < next && next < high, `${low} < ${next} < ${high} failed on pass ${i}`);
    low = next;
  }
});

// ── keys ────────────────────────────────────────────────────────────────────

test("keys are minted from the project prefix and never repeat", () => {
  const remy = project("Remy");
  const one = tickets.createTicket({ projectId: remy.id, title: "First" });
  const two = tickets.createTicket({ projectId: remy.id, title: "Second" });

  assert.equal(one.key, "REMY-1");
  assert.equal(two.key, "REMY-2");

  // A deleted ticket must not hand its number to the next one, or a link in an
  // old comment would point at different work.
  tickets.deleteTicket(two.id);
  const three = tickets.createTicket({ projectId: remy.id, title: "Third" });
  assert.equal(three.key, "REMY-3");
});

test("two projects get distinct prefixes even when their names collide", () => {
  const a = project("Atlas");
  const b = project("Atlas");
  assert.notEqual(a.keyPrefix, b.keyPrefix);
});

test("renaming a project's slug re-keys every ticket it has", () => {
  const board = project("Rename me");
  const one = tickets.createTicket({ projectId: board.id, title: "First" });
  const two = tickets.createTicket({ projectId: board.id, title: "Second" });
  assert.equal(one.key, `${board.keyPrefix}-1`);
  assert.equal(two.key, `${board.keyPrefix}-2`);

  projects.updateProject(board.id, { keyPrefix: "zeta" });

  // The numbers are what the tickets own; the slug in front of them belongs to
  // the project, so both keys move together and neither is renumbered.
  assert.equal(tickets.getTicket(one.id)?.key, "ZETA-1");
  assert.equal(tickets.getTicket(two.id)?.key, "ZETA-2");
  assert.equal(tickets.ticketByKey("ZETA-2")?.id, two.id);

  // And a ticket made afterwards carries on from where they left off.
  assert.equal(tickets.createTicket({ projectId: board.id, title: "Third" }).key, "ZETA-3");
});

test("a slug is cleaned, and two projects cannot share one", () => {
  const first = project("Slugs one");
  const second = project("Slugs two");
  assert.equal(projects.updateProject(first.id, { keyPrefix: " my proj! " }).keyPrefix, "MYPROJ");
  assert.throws(() => projects.updateProject(second.id, { keyPrefix: "myproj" }), /already uses/);
  assert.throws(() => projects.updateProject(second.id, { keyPrefix: "!!!" }), /letter or digit/);
});

test("a sub-ticket hangs off its parent and cannot nest further", () => {
  const board = project("Nesting");
  const parent = tickets.createTicket({ projectId: board.id, title: "Parent" });
  const child = tickets.createTicket({ projectId: board.id, title: "Child", parentId: parent.id });
  assert.equal(child.parentId, parent.id);

  const other = tickets.createTicket({ projectId: board.id, title: "Grandchild" });
  assert.throws(() => tickets.updateTicket(other.id, { parentId: child.id }), /already a sub-ticket/);
  assert.throws(() => tickets.updateTicket(parent.id, { parentId: parent.id }), /its own parent/);
});

// ── status rules ────────────────────────────────────────────────────────────

test("auto-start becomes ready regardless of whether Todo or assignee changes first", () => {
  const board = project("Order independent start");
  const agent = agents.createAgent({ name: "Autostarter" });

  const statusFirst = tickets.createTicket({ projectId: board.id, title: "Status first" });
  tickets.setTicketStatus(statusFirst.id, "todo");
  assert.equal(runner.shouldAutoStart(tickets.getTicket(statusFirst.id)!), false);
  tickets.updateTicket(statusFirst.id, { assigneeAgentId: agent.id });
  assert.equal(runner.shouldAutoStart(tickets.getTicket(statusFirst.id)!), true);

  const assigneeFirst = tickets.createTicket({ projectId: board.id, title: "Assignee first" });
  tickets.updateTicket(assigneeFirst.id, { assigneeAgentId: agent.id });
  assert.equal(runner.shouldAutoStart(tickets.getTicket(assigneeFirst.id)!), false);
  tickets.setTicketStatus(assigneeFirst.id, "todo");
  assert.equal(runner.shouldAutoStart(tickets.getTicket(assigneeFirst.id)!), true);
});

test("a linked thread moves a ticket between In progress and Needs input", () => {
  const board = project("Statuses");
  const ticket = tickets.createTicket({ projectId: board.id, title: "Flaky login test" });
  tickets.linkThread(ticket.id, { chatId: "chat-1" });
  assert.equal(tickets.getTicket(ticket.id)?.status, "in_progress");
  tickets.syncTicketFromThread("chat-1", "needs_input");
  assert.equal(tickets.getTicket(ticket.id)?.status, "needs_input");

  tickets.syncTicketFromThread("chat-1", "working");
  assert.equal(tickets.getTicket(ticket.id)?.status, "in_progress");

  // An errored thread is something waiting on a person, not a finished ticket.
  tickets.syncTicketFromThread("chat-1", "error");
  assert.equal(tickets.getTicket(ticket.id)?.status, "needs_input");

  // What you set by hand is never dragged back by the next turn that ends.
  tickets.setTicketStatus(ticket.id, "done");
  tickets.syncTicketFromThread("chat-1", "working");
  assert.equal(tickets.getTicket(ticket.id)?.status, "done");
});

test("starting a ticket hands You and Nobody to the workspace agent", () => {
  const board = project("Start assignees");
  const nobody = tickets.createTicket({ projectId: board.id, title: "Unassigned", status: "backlog" });
  const mine = tickets.createTicket({
    projectId: board.id,
    title: "Mine",
    status: "todo",
    assigneeAgentId: tickets.YOU,
  });
  const builder = agents.createAgent({ name: "Start builder" });
  const assigned = tickets.createTicket({
    projectId: board.id,
    title: "Assigned",
    status: "todo",
    assigneeAgentId: builder.id,
  });

  assert.deepEqual(tickets.prepareTicketStart(nobody.id), {
    ticket: tickets.getTicket(nobody.id),
  });
  assert.equal(tickets.getTicket(nobody.id)?.assigneeAgentId, agents.WORKSPACE_AGENT);
  assert.deepEqual(tickets.prepareTicketStart(mine.id), {
    ticket: tickets.getTicket(mine.id),
  });
  assert.equal(tickets.getTicket(mine.id)?.assigneeAgentId, agents.WORKSPACE_AGENT);
  assert.equal(tickets.prepareTicketStart(assigned.id).agentId, builder.id);

  tickets.setTicketStatus(assigned.id, "in_progress");
  assert.throws(() => tickets.prepareTicketStart(assigned.id), /Backlog or Todo/);
});

test("a status change records who made it", () => {
  const board = project("Actors");
  const ticket = tickets.createTicket({ projectId: board.id, title: "Who moved it" });
  tickets.setTicketStatus(ticket.id, "in_progress");
  tickets.linkThread(ticket.id, { chatId: "chat-actor" });
  tickets.syncTicketFromThread("chat-actor", "needs_input");

  const activity = tickets.ticketActivity(ticket.id);
  const derived = activity.filter((entry) => entry.kind === "status");
  assert.equal(derived.at(-1)?.actor, "remy");
  assert.equal(derived.at(-2)?.actor, "you");
});

// ── threads ─────────────────────────────────────────────────────────────────

test("a thread belongs to at most one ticket", () => {
  const board = project("Links");
  const first = tickets.createTicket({ projectId: board.id, title: "First" });
  const second = tickets.createTicket({ projectId: board.id, title: "Second" });

  tickets.linkThread(first.id, { chatId: "shared" });
  assert.throws(() => tickets.linkThread(second.id, { chatId: "shared" }), /already on/);

  // Detaching frees it, because a mis-attach should not be permanent.
  tickets.unlinkThread(first.id, "shared");
  const moved = tickets.linkThread(second.id, { chatId: "shared" });
  assert.equal(moved.threads.length, 1);
  assert.equal(tickets.ticketForChat("shared")?.id, second.id);
});

test("a cross-device thread keeps the device it actually runs on", () => {
  const board = project("Remote links");
  const ticket = tickets.createTicket({ projectId: board.id, title: "Run elsewhere", status: "todo" });
  tickets.linkThread(ticket.id, { chatId: "remote-chat", deviceId: "remote-device" });

  tickets.syncTicketFromThread("remote-chat", "working", "remote-device");
  assert.equal(tickets.getTicket(ticket.id)?.status, "in_progress");
  assert.equal(tickets.getTicket(ticket.id)?.threads[0].deviceId, "remote-device");

  tickets.unlinkThread(ticket.id, "remote-chat", "remote-device");
  assert.equal(tickets.getTicket(ticket.id)?.threads.length, 0);
});

test("an explicit work request links its ticket before the turn starts", () => {
  const board = project("Prompts");
  const ticket = tickets.createTicket({ projectId: board.id, title: "Prompt work", status: "backlog" });

  const linked = tickets.linkTicketFromWorkPrompt("chat-prompt", `Please work on ${ticket.key}`);
  assert.equal(linked?.id, ticket.id);
  assert.equal(tickets.ticketForChat("chat-prompt")?.id, ticket.id);
  assert.equal(tickets.getTicket(ticket.id)?.status, "in_progress");

  const spaced = tickets.createTicket({ projectId: board.id, title: "Spaced prompt", status: "todo" });
  const spacedKey = spaced.key.replace("-", " ");
  assert.equal(tickets.linkTicketFromWorkPrompt("chat-spaced", `Work on ${spacedKey}`)?.id, spaced.id);
  assert.equal(tickets.ticketForChat("chat-spaced")?.id, spaced.id);
  assert.equal(tickets.getTicket(spaced.id)?.status, "in_progress");

  const question = tickets.createTicket({ projectId: board.id, title: "Prompt question" });
  assert.equal(tickets.linkTicketFromWorkPrompt("chat-question", `What is ${question.key}?`), undefined);
});

test("attaching a thread starts non-terminal work and preserves terminal states", () => {
  const board = project("Attachment status");
  for (const status of ["backlog", "todo", "needs_input"] as const) {
    const ticket = tickets.createTicket({ projectId: board.id, title: `Start ${status}`, status });
    const after = tickets.linkThread(ticket.id, { chatId: `chat-${status}` });
    assert.equal(after.status, "in_progress");
    assert.equal(after.threads[0].linkedBy, "you");
  }

  for (const status of ["pr_review", "done", "cancelled"] as const) {
    const ticket = tickets.createTicket({ projectId: board.id, title: `Keep ${status}`, status });
    const after = tickets.linkThread(ticket.id, { chatId: `chat-${status}` });
    assert.equal(after.status, status);
  }
});

test("your ticket comment continues the newest runner thread with the same body", async () => {
  const board = project("Comment continuity");
  const ticket = tickets.createTicket({ projectId: board.id, title: "Keep working" });
  tickets.linkThread(ticket.id, { chatId: "runner-old", linkedBy: "runner" });
  tickets.linkThread(ticket.id, { chatId: "context-only" });
  tickets.linkThread(ticket.id, { chatId: "runner-current", linkedBy: "runner" });

  let delivered: { chatId: string; body: string } | undefined;
  const resumed = await runner.resumeTicketFromComment(
    ticket.id,
    "Use the workspace icon here too.",
    async (thread, body) => {
      delivered = { chatId: thread.chatId, body };
      return true;
    },
  );

  assert.equal(resumed, true);
  assert.equal(delivered?.chatId, "runner-current");
  assert.equal(delivered?.body, "Use the workspace icon here too.");
});

test("a ticket comment does not start a manually attached thread", async () => {
  const board = project("Comment context");
  const ticket = tickets.createTicket({ projectId: board.id, title: "Do not resume this" });
  tickets.linkThread(ticket.id, { chatId: "manual-context" });

  let delivered = false;
  const resumed = await runner.resumeTicketFromComment(ticket.id, "A note", async () => {
    delivered = true;
    return true;
  });

  assert.equal(resumed, false);
  assert.equal(delivered, false);
});

test("a deleted thread leaves the ticket and its story behind", () => {
  const board = project("Forget");
  const ticket = tickets.createTicket({ projectId: board.id, title: "Outlives its thread" });
  tickets.linkThread(ticket.id, { chatId: "chat-gone" });
  tickets.forgetChat("chat-gone");

  const after = tickets.getTicket(ticket.id);
  assert.equal(after?.threads.length, 0);
  assert.ok(
    tickets.ticketActivity(ticket.id).some((entry) => entry.kind === "link"),
    "the feed should still record that a thread worked on this",
  );
});

// ── the projection ──────────────────────────────────────────────────────────

test("a ticket projects the same whatever order its events arrive in", () => {
  const board = project("Convergence");
  const ticket = tickets.createTicket({ projectId: board.id, title: "Ordered" });
  tickets.setTicketStatus(ticket.id, "in_progress");
  tickets.updateTicket(ticket.id, { title: "Renamed once" });
  tickets.setTicketStatus(ticket.id, "pr_review");
  const expected = tickets.getTicket(ticket.id);

  // Replay the same events with their rows shuffled. The fold sorts by
  // (lamport, deviceId, id), so insertion order must not matter — this is the
  // property a second machine depends on, since it receives events in whatever
  // order the network hands them over.
  const rows = db
    .prepare("select * from board_log where entity = 'ticket' and entity_id = ?")
    .all(ticket.id) as Record<string, string | number>[];
  const shuffled = [...rows].reverse();
  db.prepare("delete from board_log where entity = 'ticket' and entity_id = ?").run(ticket.id);
  const insert = db.prepare(
    `insert into board_log (id, device_id, lamport, at, entity, entity_id, kind, json)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of shuffled) {
    insert.run(row.id, row.device_id, row.lamport, row.at, row.entity, row.entity_id, row.kind, row.json);
  }
  const replayed = tickets.reproject(ticket.id);

  assert.ok(expected && replayed, "both projections should exist");
  const { threads: _threads, ...fields } = expected;
  assert.deepEqual(replayed, fields);
});

test("two machines editing the same field converge on the same answer", () => {
  const board = project("Peers");
  const ticket = tickets.createTicket({ projectId: board.id, title: "Contested" });

  // Two field events at the same lamport, from different devices — exactly what
  // a partition produces. The tie breaks on device id, so both machines fold to
  // the same title rather than each keeping its own.
  const insert = db.prepare(
    `insert into board_log (id, device_id, lamport, at, entity, entity_id, kind, json)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const at = Date.now();
  insert.run("evt-b", "device-b", 9999, at, "ticket", ticket.id, "field", JSON.stringify({ title: "From B" }));
  insert.run("evt-a", "device-a", 9999, at, "ticket", ticket.id, "field", JSON.stringify({ title: "From A" }));

  assert.equal(tickets.reproject(ticket.id)?.title, "From B", "the higher device id should win the tie");

  // And it stays that way however many times it is replayed.
  assert.equal(tickets.reproject(ticket.id)?.title, "From B");
});

test("every board write is an event, so nothing changes without a record", () => {
  const board = project("Auditing");
  const ticket = tickets.createTicket({ projectId: board.id, title: "Traceable" });
  const before = log.eventsFor("ticket", ticket.id).length;
  tickets.commentOnTicket(ticket.id, "A note for whoever picks this up");
  tickets.setTicketStatus(ticket.id, "todo");
  assert.equal(log.eventsFor("ticket", ticket.id).length, before + 2);
});

test("your comments can be edited and deleted without rewriting the board log", () => {
  const board = project("Comments");
  const ticket = tickets.createTicket({ projectId: board.id, title: "Discuss this" });
  const agent = agents.createAgent({ name: "Reviewer" });

  tickets.commentOnTicket(ticket.id, "First draft @reviewer");
  const yours = tickets.ticketActivity(ticket.id).at(-1)!;
  tickets.commentOnTicket(ticket.id, "Agent note", agent.handle);
  const theirs = tickets.ticketActivity(ticket.id).at(-1)!;

  tickets.editTicketComment(ticket.id, yours.id, "Final draft @you");
  const edited = tickets.ticketActivity(ticket.id).find((entry) => entry.id === yours.id);
  assert.equal(edited?.body, "Final draft @you");
  assert.deepEqual(edited?.mentions, [{ handle: "you", id: "you" }]);
  assert.ok(edited?.editedAt);
  assert.throws(
    () => tickets.editTicketComment(ticket.id, theirs.id, "Changed agent note"),
    /only change your own comments/,
  );

  tickets.deleteTicketComment(ticket.id, yours.id);
  assert.equal(tickets.ticketActivity(ticket.id).some((entry) => entry.id === yours.id), false);
  assert.equal(
    log.eventsFor("ticket", ticket.id).filter((event) => event.kind.startsWith("comment")).length,
    4,
  );
  assert.throws(() => tickets.deleteTicketComment(ticket.id, yours.id), /comment is gone/);
  assert.throws(
    () => tickets.deleteTicketComment(ticket.id, theirs.id),
    /only change your own comments/,
  );
});

// ── agents ──────────────────────────────────────────────────────────────────

test("an agent handle is unique and usable in a tool call", () => {
  const first = agents.createAgent({ name: "Iris the Scout" });
  assert.equal(first.handle, "iris-the-scout");

  // A handle derived from a name is only a default, so a clash steps aside —
  // which is what lets New agent be pressed twice.
  const second = agents.createAgent({ name: "iris the scout" });
  assert.equal(second.handle, "iris-the-scout-2");

  // One you typed has to be the one you get, so a clash is an error.
  assert.throws(() => agents.createAgent({ name: "Someone", handle: "iris-the-scout" }), /already uses/);

  // Renaming to a free handle is fine; the clash check exempts the agent itself.
  const renamed = agents.updateAgent(first.id, { handle: "iris" });
  assert.equal(renamed.handle, "iris");
  assert.equal(agents.updateAgent(first.id, { handle: "iris" }).handle, "iris");
});

test("commit attribution decides whether an agent authors a commit", () => {
  const off = agents.createAgent({ name: "Quiet", gitIdentity: "off" });
  assert.deepEqual(agents.gitIdentityEnv(off), {});

  const author = agents.createAgent({ name: "Writer", gitIdentity: "author" });
  const authorEnv = agents.gitIdentityEnv(author);
  assert.equal(authorEnv.GIT_AUTHOR_NAME, "Writer");
  assert.equal(authorEnv.GIT_AUTHOR_EMAIL, "writer@remy.invalid", "no GitHub login here, so Remy names itself");
  // Author-only deliberately leaves the human as committer.
  assert.equal(authorEnv.GIT_COMMITTER_NAME, undefined);

  const legacy = agents.createAgent({ name: "Legacy", gitIdentity: "full" });
  assert.equal(legacy.gitIdentity, "author");
  assert.equal(agents.gitIdentityEnv(legacy).GIT_COMMITTER_NAME, undefined);

  assert.deepEqual(agents.gitIdentityEnv(undefined), {}, "a thread with no agent keeps your identity");
});

test("an inherited agent follows later model and git identity defaults", () => {
  const previous = {
    provider: config.config.defaultProvider,
    model: config.config.defaultModel,
    effort: config.config.defaultEffort,
    identity: config.config.defaultGitIdentity,
  };
  try {
    config.config.defaultProvider = "claude";
    config.config.defaultModel = "sonnet";
    config.config.defaultEffort = "high";
    config.config.defaultGitIdentity = "author";
    const agent = agents.createAgent({ name: "Follower" });

    assert.equal(agent.provider, "default");
    assert.equal(agent.gitIdentity, "default");
    assert.deepEqual(agents.resolvedAgentModel(agent), { provider: "claude", model: "sonnet", effort: "high" });
    assert.equal(agents.gitIdentityEnv(agent).GIT_COMMITTER_NAME, undefined);

    config.config.defaultProvider = "codex";
    config.config.defaultModel = "gpt-5.6-terra";
    config.config.defaultEffort = "xhigh";
    config.config.defaultGitIdentity = "off";
    assert.deepEqual(agents.resolvedAgentModel(agent), { provider: "codex", model: "gpt-5.6-terra", effort: "xhigh" });
    assert.deepEqual(agents.gitIdentityEnv(agent), {});

    const fixed = agents.updateAgent(agent.id, {
      provider: "claude",
      model: "opus",
      effort: "low",
      gitIdentity: "off",
    });
    assert.deepEqual(agents.resolvedAgentModel(fixed), { provider: "claude", model: "opus", effort: "low" });
    assert.deepEqual(agents.gitIdentityEnv(fixed), {});
  } finally {
    config.config.defaultProvider = previous.provider;
    config.config.defaultModel = previous.model;
    config.config.defaultEffort = previous.effort;
    config.config.defaultGitIdentity = previous.identity;
  }
});

test("existing agents inherit defaults unless a field records an override", () => {
  const inheritedId = "legacy-inherited-agent";
  log.append("agent", inheritedId, "create", {
    name: "Legacy follower",
    handle: "legacy-follower",
    provider: "claude",
    gitIdentity: "author",
  });
  agents.reproject(inheritedId);

  const fixedId = "legacy-fixed-agent";
  log.append("agent", fixedId, "create", {
    name: "Legacy fixed",
    handle: "legacy-fixed",
    provider: "claude",
    gitIdentity: "author",
  });
  log.append("agent", fixedId, "field", {
    provider: "codex",
    model: "gpt-5.6-terra",
    gitIdentity: "full",
  });
  agents.reproject(fixedId);

  agents.seedPresetAgents();
  assert.equal(agents.getAgent(inheritedId)?.provider, "default");
  assert.equal(agents.getAgent(inheritedId)?.gitIdentity, "default");
  assert.equal(agents.getAgent(fixedId)?.provider, "codex");
  assert.equal(agents.getAgent(fixedId)?.model, "gpt-5.6-terra");
  assert.equal(agents.getAgent(fixedId)?.gitIdentity, "author");

  const migratedEventCount = log.eventsFor("agent", inheritedId).length;
  agents.seedPresetAgents();
  assert.equal(log.eventsFor("agent", inheritedId).length, migratedEventCount);
});

test("an agent's commit address is derived, not set", () => {
  const agent = agents.createAgent({ name: "Picky", handle: "picky" });
  assert.equal(agent.gitEmail, "picky@remy.invalid");

  // Nothing a client sends can move it, so no commit can claim a real mailbox.
  const ignored = agents.updateAgent(agent.id, { gitEmail: "picky@example.com" });
  assert.equal(ignored.gitEmail, "picky@remy.invalid");
  assert.equal(agents.gitIdentityEnv(ignored).GIT_AUTHOR_EMAIL, "picky@remy.invalid");
});

test("the commit address follows a renamed handle", () => {
  const agent = agents.createAgent({ name: "Drifter", handle: "before" });
  assert.equal(agent.gitEmail, "before@remy.invalid");

  const renamed = agents.updateAgent(agent.id, { handle: "after" });
  assert.equal(renamed.gitEmail, "after@remy.invalid", "derived, so it cannot go stale");
  assert.equal(agents.gitIdentityEnv(renamed).GIT_AUTHOR_EMAIL, "after@remy.invalid");
});

test("the commit address carries whoever the machine is signed in as", () => {
  const agent = agents.createAgent({ name: "Owned", handle: "planner" });
  config.config.githubLogin = "padamchopra";
  try {
    assert.equal(agents.reproject(agent.id)?.gitEmail, "planner@padamchopra.invalid");
    assert.equal(
      agents.gitIdentityEnv(agents.getAgent(agent.id)).GIT_AUTHOR_EMAIL,
      "planner@padamchopra.invalid",
    );
  } finally {
    config.config.githubLogin = "";
  }
});

test("a login that is not one is dropped rather than passed into an address", () => {
  assert.equal(config.githubAccount("padamchopra"), "padamchopra");
  assert.equal(config.githubAccount("has space"), "");
  assert.equal(config.githubAccount("bad@login"), "");
  assert.equal(config.githubAccount("-leading"), "");
  assert.equal(config.githubAccount(undefined), "");
});

test("the built-in agents seed once and stay editable", () => {
  agents.seedPresetAgents();
  const first = agents.listAgents().filter((agent) => agent.preset).length;
  agents.seedPresetAgents();
  assert.equal(agents.listAgents().filter((agent) => agent.preset).length, first);
  assert.equal(first, 3, "PM, Builder, and QA should be there");
  assert.deepEqual(
    agents.listAgents().filter((agent) => agent.preset).map((agent) => agent.id).sort(),
    ["remy-preset-builder", "remy-preset-critic", "remy-preset-scout"],
  );

  const pm = agents.agentByHandle("pm");
  const qa = agents.agentByHandle("qa");
  assert.equal(pm?.handoffTo[0], "builder");
  assert.equal(qa?.handoffTo[0], "builder");

  const builder = agents.agentByHandle("builder");
  assert.ok(builder, "builder should be seeded");
  // An agent runs while you are not watching, so there are two modes it can be
  // in and `auto` is where every one of them starts.
  assert.equal(pm?.permissionMode, "auto");
  assert.equal(qa?.permissionMode, "auto");
  assert.equal(builder.permissionMode, "auto");
  assert.equal(builder.gitIdentity, "default");
  const edited = agents.updateAgent(builder.id, { role: "Changed by hand" });
  assert.equal(edited.role, "Changed by hand");
});

test("a ticket can be yours as well as an agent's", () => {
  const mine = project("Mine");
  const ticket = tickets.createTicket({ projectId: mine.id, title: "Something I keep" });

  const kept = tickets.updateTicket(ticket.id, { assigneeAgentId: tickets.YOU });
  assert.equal(kept.assigneeAgentId, tickets.YOU, "you are an assignee, not an agent lookup");

  const agent = agents.createAgent({ name: "Handoff" });
  const theirs = tickets.updateTicket(ticket.id, { assigneeAgentId: agent.id });
  assert.equal(theirs.assigneeAgentId, agent.id);

  // The sentinel is the only name that is not an agent; anything else is still
  // a typo worth refusing.
  assert.throws(
    () => tickets.updateTicket(ticket.id, { assigneeAgentId: "nobody-by-that-id" }),
    /no such agent/,
  );

  const cleared = tickets.updateTicket(ticket.id, { assigneeAgentId: "" });
  assert.equal(cleared.assigneeAgentId, undefined, "clearing leaves nobody on it");
});

test("a ticket can be the workspace's own, without an agent being written first", () => {
  const mine = project("Workspaces");
  const ticket = tickets.createTicket({
    projectId: mine.id,
    title: "Bump the dependencies",
    assigneeAgentId: agents.WORKSPACE_AGENT,
  });
  assert.equal(ticket.assigneeAgentId, agents.WORKSPACE_AGENT);

  // It is not a row, so nothing can rename or delete it — and what runs the
  // turn is this machine's own default model.
  assert.equal(agents.getAgent(agents.WORKSPACE_AGENT), undefined);
  const stand_in = agents.assignedAgent(agents.WORKSPACE_AGENT);
  assert.equal(stand_in?.handle, "workspace");
  assert.equal(stand_in?.model, undefined, "an empty model is this machine's default");
  assert.equal(stand_in?.instructions, "", "no persona in front of it");

  assert.throws(
    () => agents.createAgent({ name: "Impostor", handle: "workspace" }),
    /workspace agent/,
    "no agent may take the handle the workspace answers to",
  );
  // One derived from a name gets out of the way instead of failing.
  assert.equal(agents.createAgent({ name: "Workspace" }).handle, "workspace-2");
});

test("a comment can name the workspace agent", () => {
  const board = project("Naming");
  const ticket = tickets.createTicket({ projectId: board.id, title: "Ask the workspace" });
  tickets.commentOnTicket(ticket.id, "@workspace can you read the changelog?");
  const comment = tickets.ticketActivity(ticket.id).at(-1);
  assert.deepEqual(comment?.mentions, [{ handle: "workspace", id: "workspace" }]);
});

test("a comment records who it named, so renaming an agent renames the mention", () => {
  const board = project("Talkers");
  const ticket = tickets.createTicket({ projectId: board.id, title: "Scope me" });
  const pm = agents.createAgent({ name: "Product", handle: "product" });

  tickets.commentOnTicket(ticket.id, "@product what is the scope here? @you should weigh in. team@example.com");
  const comment = tickets.ticketActivity(ticket.id).at(-1);
  assert.ok(comment, "the comment should be on the feed");
  assert.deepEqual(
    comment.mentions,
    [{ handle: "product", id: pm.id }, { handle: "you", id: "you" }],
    "an email address is not a mention, and an unknown name is not either",
  );

  // The prose still says `@pm`, and the id still says who that was — which is
  // the whole point of storing the pair.
  agents.updateAgent(pm.id, { handle: "product-renamed" });
  const after = tickets.ticketActivity(ticket.id).at(-1)?.mentions?.[0];
  assert.equal(after?.handle, "product", "the prose still says what was typed");
  assert.equal(agents.getAgent(after!.id)?.handle, "product-renamed", "and the id says who that is now");
});

test("an unknown name in a comment stays plain text", () => {
  const board = project("Quiet");
  const ticket = tickets.createTicket({ projectId: board.id, title: "Nobody home" });
  tickets.commentOnTicket(ticket.id, "@nosuchagent are you there?");
  const comment = tickets.ticketActivity(ticket.id).at(-1);
  assert.deepEqual(comment?.mentions, [], "nothing was named, so nothing is recorded");
});
