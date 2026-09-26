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

test("a ready pull request moves a ticket to PR review and a merged one closes it", () => {
  const board = project("Pull request statuses");
  const ticket = tickets.createTicket({ projectId: board.id, title: "Ship the picker", status: "in_progress" });

  // A draft is work still being written, so it moves nothing — but it does say
  // which branch to look for the pull request on later.
  tickets.syncTicketFromPullRequest(ticket.id, "draft", { branch: "padam/picker" });
  assert.equal(tickets.getTicket(ticket.id)?.status, "in_progress");
  assert.equal(tickets.getTicket(ticket.id)?.branch, "padam/picker");

  tickets.syncTicketFromPullRequest(ticket.id, "ready", { note: "remy/remy#7 is ready for review." });
  assert.equal(tickets.getTicket(ticket.id)?.status, "pr_review");

  tickets.syncTicketFromPullRequest(ticket.id, "merged", { note: "remy/remy#7 is merged." });
  const closed = tickets.getTicket(ticket.id);
  assert.equal(closed?.status, "done");
  assert.ok(closed?.closedAt, "a closed ticket records when");
});

test("a status note goes on the feed, not over the ticket's description", () => {
  const board = project("Status notes");
  const ticket = tickets.createTicket({
    projectId: board.id,
    title: "Keeps its description",
    body: "The picker drops the model when the provider changes.",
    status: "in_progress",
  });

  tickets.syncTicketFromPullRequest(ticket.id, "ready", { note: "remy/remy#3 is ready for review." });

  assert.equal(tickets.getTicket(ticket.id)?.body, "The picker drops the model when the provider changes.");
  const feed = tickets.ticketActivity(ticket.id);
  assert.equal(feed.find((entry) => entry.kind === "status")?.body, "remy/remy#3 is ready for review.");
  // And the description is not repeated as a note on the line that made it.
  assert.equal(feed.find((entry) => entry.kind === "create")?.body, undefined);
});

test("a card you move off PR review is not put back by the same pull request", () => {
  const board = project("Pull request override");
  const ticket = tickets.createTicket({ projectId: board.id, title: "More to do here", status: "in_progress" });
  const ready = "remy/remy#9 is ready for review.";

  tickets.syncTicketFromPullRequest(ticket.id, "ready", { note: ready });
  assert.equal(tickets.getTicket(ticket.id)?.status, "pr_review");
  tickets.setTicketStatus(ticket.id, "in_progress");

  // The same pull request is still open and still ready a minute later.
  tickets.syncTicketFromPullRequest(ticket.id, "ready", { note: ready });
  assert.equal(tickets.getTicket(ticket.id)?.status, "in_progress");

  // Merging it is something new, so that does land.
  tickets.syncTicketFromPullRequest(ticket.id, "merged", { note: "remy/remy#9 is merged." });
  assert.equal(tickets.getTicket(ticket.id)?.status, "done");

  // And once you have reopened that, no other pull request that mentions this
  // ticket closes it again — a stack has several, and some merged long ago.
  tickets.setTicketStatus(ticket.id, "todo");
  tickets.syncTicketFromPullRequest(ticket.id, "merged", { note: "remy/remy#4 is merged." });
  assert.equal(tickets.getTicket(ticket.id)?.status, "todo");
});

test("a pull request leaves a ticket you already closed alone", () => {
  const board = project("Pull request terminal");
  for (const status of ["done", "cancelled"] as const) {
    const ticket = tickets.createTicket({ projectId: board.id, title: `Keep ${status}`, status });
    tickets.syncTicketFromPullRequest(ticket.id, "merged", { note: "remy/remy#11 is merged." });
    assert.equal(tickets.getTicket(ticket.id)?.status, status);
  }
});

test("a parent starts with its first sub-ticket and closes when they all do", () => {
  const board = project("Roll up");
  const parent = tickets.createTicket({ projectId: board.id, title: "Redesign the board" });
  const one = tickets.createTicket({ projectId: board.id, title: "Columns", parentId: parent.id });
  const two = tickets.createTicket({ projectId: board.id, title: "Cards", parentId: parent.id });

  tickets.setTicketStatus(one.id, "in_progress");
  tickets.syncParentTicket(one.id);
  assert.equal(tickets.getTicket(parent.id)?.status, "in_progress");

  tickets.setTicketStatus(one.id, "done");
  tickets.syncParentTicket(one.id);
  assert.equal(tickets.getTicket(parent.id)?.status, "in_progress", "one sub-ticket left");

  tickets.setTicketStatus(two.id, "done");
  tickets.syncParentTicket(two.id);
  assert.equal(tickets.getTicket(parent.id)?.status, "done");
});

test("sub-tickets that were all cancelled leave the parent where it is", () => {
  const board = project("Roll up cancelled");
  const parent = tickets.createTicket({ projectId: board.id, title: "Dropped idea" });
  const child = tickets.createTicket({ projectId: board.id, title: "Not doing this", parentId: parent.id });

  tickets.setTicketStatus(child.id, "cancelled");
  tickets.syncParentTicket(child.id);
  assert.equal(tickets.getTicket(parent.id)?.status, "backlog");
});

test("a closed parent is not reopened by a sub-ticket", () => {
  const board = project("Roll up terminal");
  for (const status of ["done", "cancelled"] as const) {
    const parent = tickets.createTicket({ projectId: board.id, title: `Closed ${status}` });
    const child = tickets.createTicket({ projectId: board.id, title: "Late arrival", parentId: parent.id });
    tickets.setTicketStatus(parent.id, status);
    tickets.setTicketStatus(child.id, "in_progress");
    tickets.syncParentTicket(child.id);
    assert.equal(tickets.getTicket(parent.id)?.status, status);
  }
});

test("your move on a parent stands until a sub-ticket moves again", () => {
  const board = project("Roll up override");
  const parent = tickets.createTicket({ projectId: board.id, title: "Bigger than it looked" });
  const one = tickets.createTicket({ projectId: board.id, title: "First", parentId: parent.id });
  const two = tickets.createTicket({ projectId: board.id, title: "Second", parentId: parent.id });

  tickets.setTicketStatus(one.id, "done");
  tickets.setTicketStatus(two.id, "done");
  tickets.syncParentTicket(two.id);
  assert.equal(tickets.getTicket(parent.id)?.status, "done");

  tickets.setTicketStatus(parent.id, "todo");
  tickets.syncParentTicket(two.id);
  assert.equal(tickets.getTicket(parent.id)?.status, "todo", "you had the last word");

  // Until the sub-tickets have something new to say.
  tickets.setTicketStatus(two.id, "in_progress");
  tickets.syncParentTicket(two.id);
  assert.equal(tickets.getTicket(parent.id)?.status, "in_progress");
});

test("deleting the last open sub-ticket closes the parent", () => {
  const board = project("Roll up delete");
  const parent = tickets.createTicket({ projectId: board.id, title: "Two halves" });
  const one = tickets.createTicket({ projectId: board.id, title: "Kept", parentId: parent.id });
  const two = tickets.createTicket({ projectId: board.id, title: "Dropped", parentId: parent.id });

  tickets.setTicketStatus(one.id, "done");
  tickets.syncParentTicket(one.id);
  assert.equal(tickets.getTicket(parent.id)?.status, "in_progress");

  tickets.deleteTicket(two.id);
  assert.equal(tickets.getTicket(parent.id)?.status, "done");
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

  tickets.commentOnTicket(ticket.id, "First draft");
  const yours = tickets.ticketActivity(ticket.id).at(-1)!;
  tickets.commentOnTicket(ticket.id, "A note from Remy", "remy");
  const theirs = tickets.ticketActivity(ticket.id).at(-1)!;

  tickets.editTicketComment(ticket.id, yours.id, "Final draft");
  const edited = tickets.ticketActivity(ticket.id).find((entry) => entry.id === yours.id);
  assert.equal(edited?.body, "Final draft");
  assert.ok(edited?.editedAt);
  assert.throws(
    () => tickets.editTicketComment(ticket.id, theirs.id, "Changed Remy's note"),
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
