import assert from "node:assert/strict";
import test from "node:test";
import {
  explicitlyRequestedTicketStatus,
  REMY_TOOL_INSTRUCTIONS,
  THREAD_TICKET_STATUSES,
} from "./ticket-tool-contract.js";

test("ticket tools reserve status changes for an explicit request", () => {
  assert.match(REMY_TOOL_INSTRUCTIONS, /change it only when the person explicitly asks/);
  assert.match(REMY_TOOL_INSTRUCTIONS, /Never infer Done from finishing your work/);
  assert.ok(THREAD_TICKET_STATUSES.includes("done"));
});

test("ticket tools steer a handoff at the thread that already owns the work", () => {
  assert.match(REMY_TOOL_INSTRUCTIONS, /message that thread rather than starting another/);
  assert.match(REMY_TOOL_INSTRUCTIONS, /list_threads shows each thread's ticket key/);
  assert.match(REMY_TOOL_INSTRUCTIONS, /a thread with no agent carries no directives/);
});

test("a status write needs the person's exact affirmative instruction", () => {
  const request = "Please mark REMY-12 Done after you push it.";
  assert.equal(explicitlyRequestedTicketStatus(request, request, "done"), true);
  assert.equal(explicitlyRequestedTicketStatus(request, "mark REMY-12 Done", "done"), true);
  assert.equal(explicitlyRequestedTicketStatus(request, "mark it Done", "done"), false);
  assert.equal(explicitlyRequestedTicketStatus("I finished the work.", "I finished the work.", "done"), false);
  const refusal = "Do not mark REMY-12 Done.";
  assert.equal(explicitlyRequestedTicketStatus(refusal, refusal, "done"), false);
});
