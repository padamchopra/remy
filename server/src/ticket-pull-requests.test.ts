import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Every module here opens the shared database at import time, so the suite runs
// against a throwaway directory.
const stateDir = mkdtempSync(join(tmpdir(), "mc-ticket-prs-"));
process.env.MC_CONFIG_DIR = stateDir;

const projects = await import("./projects.js");
const tickets = await import("./tickets.js");
const { ticketForPullRequest, ticketKeyFromWorktree } = await import("./ticket-pull-requests.js");
const { parseMergedPullRequests } = await import("./pull-requests.js");

const board = projects.createProject({ name: "Remy" });
const one = tickets.createTicket({ projectId: board.id, title: "Ship the picker", status: "in_progress" });
const two = tickets.createTicket({ projectId: board.id, title: "Widen the pane", status: "in_progress" });
const open = () => [tickets.getTicket(one.id)!, tickets.getTicket(two.id)!];

test("a Remy worktree path names the ticket it was checked out for", () => {
  assert.equal(ticketKeyFromWorktree("/code/remy/.remy/tickets/remy-12"), "REMY-12");
  assert.equal(ticketKeyFromWorktree("/worktrees/.remy/remy/tickets/remy-12/"), "REMY-12");
  assert.equal(ticketKeyFromWorktree("/code/remy/.remy/prs/41"), undefined);
  assert.equal(ticketKeyFromWorktree(null), undefined);
});

test("the worktree Remy checked the branch out into names the pull request's ticket", () => {
  const found = ticketForPullRequest(
    { headRefName: "padam/anything", title: "Untitled", worktreePath: `/code/remy/.remy/tickets/${two.key.toLowerCase()}` },
    open(),
  );
  assert.equal(found?.id, two.id);
});

test("a recorded branch beats a key mentioned somewhere else", () => {
  tickets.updateTicket(two.id, { branch: "padam/widen-the-pane" });
  const found = ticketForPullRequest(
    { headRefName: "padam/widen-the-pane", title: `Also touches ${one.key}`, worktreePath: null },
    open(),
  );
  assert.equal(found?.id, two.id);
});

test("a ticket key in the branch or the title finds the ticket", () => {
  assert.equal(
    ticketForPullRequest({ headRefName: `padam/${one.key.toLowerCase()}-picker`, title: "Ship it", worktreePath: null }, open())?.id,
    one.id,
  );
  assert.equal(
    ticketForPullRequest({ headRefName: "padam/picker", title: `Ship the picker (${one.key})`, worktreePath: null }, open())?.id,
    one.id,
  );
  // A longer key that merely starts with this one is a different ticket.
  assert.equal(
    ticketForPullRequest({ headRefName: `padam/${one.key.toLowerCase()}3-picker`, title: "Ship it", worktreePath: null }, open()),
    undefined,
  );
  assert.equal(
    ticketForPullRequest({ headRefName: "padam/picker", title: "No key here", worktreePath: null }, open()),
    undefined,
  );
});

test("merged pull requests carry the branch a ticket can be matched on", () => {
  const merged = parseMergedPullRequests(
    JSON.stringify([
      { url: "https://github.com/acme/control/pull/7", number: 7, title: "Ship it", headRefName: "padam/picker", mergedAt: "2026-08-30T10:00:00Z" },
      { number: 8, title: "No url" },
    ]),
    {
      id: "workspace-1",
      name: "Control",
      path: "/code/control",
      origin: "github.com/acme/control",
      icon: null,
      tint: null,
      provider: null,
      model: null,
      effort: null,
      worktrees: [{ path: "/code/control", branch: "main", isMain: true, dirty: false }],
    },
  );

  assert.deepEqual(merged, [{
    url: "https://github.com/acme/control/pull/7",
    number: 7,
    title: "Ship it",
    repository: "acme/control",
    headRefName: "padam/picker",
    mergedAt: "2026-08-30T10:00:00Z",
    workspaceId: "workspace-1",
  }]);
});
