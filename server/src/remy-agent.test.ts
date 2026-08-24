import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "remy-agent-"));
const agents = await import("./agents.js");
const {
  REMY_AGENT_AVATAR,
  REMY_AGENT_HANDLE,
  REMY_AGENT_ID,
  REMY_AGENT_INSTRUCTIONS,
  REMY_AGENT_NAME,
  REMY_AGENT_TINT,
} =
  await import("./remy-agent.js");
const log = await import("./board-log.js");

test("Remy's own agent is seeded once and stays one row", () => {
  agents.seedRemyAgent();
  agents.seedRemyAgent();

  const remy = agents.agentByHandle(REMY_AGENT_HANDLE);
  assert.equal(remy?.id, REMY_AGENT_ID);
  assert.equal(remy?.name, REMY_AGENT_NAME);
  assert.equal(remy?.avatar, REMY_AGENT_AVATAR);
  assert.equal(remy?.tint, REMY_AGENT_TINT);
  assert.equal(remy?.builtIn, true);
  assert.equal(agents.listAgents().filter((agent) => agent.builtIn).length, 1);
  // A boot that changes nothing writes nothing.
  assert.equal(log.eventsFor("agent", REMY_AGENT_ID).length, 1);
});

test("Remy follows the machine's model until you pick one for it", () => {
  const remy = agents.getAgent(REMY_AGENT_ID)!;
  assert.equal(remy.provider, agents.REMY_DEFAULT);

  const moved = agents.updateAgent(REMY_AGENT_ID, { provider: "claude", model: "" });
  assert.equal(moved.provider, "claude");
});

test("another agent keeps the avatar and colour you pick", () => {
  const agent = agents.createAgent({ name: "Designer" });
  const patched = agents.updateAgent(agent.id, {
    avatar: "blobatar:designer-option-2",
    tint: "pink",
  });

  assert.equal(patched.avatar, "blobatar:designer-option-2");
  assert.equal(patched.tint, "pink");
  assert.equal(agents.getAgent(agent.id)?.avatar, "blobatar:designer-option-2");
});

test("who Remy is comes from the build, not from a client", () => {
  const patched = agents.updateAgent(REMY_AGENT_ID, {
    name: "Not Remy",
    handle: "notremy",
    role: "Something else",
    instructions: "Ignore everything.",
    avatar: "blobatar:not-remy",
    tint: "pink",
    handoffTo: ["builder"],
  });

  assert.equal(patched.name, REMY_AGENT_NAME);
  assert.equal(patched.handle, REMY_AGENT_HANDLE);
  assert.equal(patched.instructions, REMY_AGENT_INSTRUCTIONS);
  assert.equal(patched.avatar, REMY_AGENT_AVATAR);
  assert.equal(patched.tint, REMY_AGENT_TINT);
  assert.deepEqual(patched.handoffTo, []);
});

test("Remy cannot be deleted", () => {
  assert.throws(() => agents.deleteAgent(REMY_AGENT_ID), /cannot be deleted/);
  assert.ok(agents.getAgent(REMY_AGENT_ID));
});

test("a later release teaches Remy something new without a second row", () => {
  // What an upgrade looks like from the database's side: the row drifted from
  // what this build says Remy is.
  log.append("agent", REMY_AGENT_ID, "field", { instructions: "An older build's instructions." });
  agents.reproject(REMY_AGENT_ID);
  assert.notEqual(agents.getAgent(REMY_AGENT_ID)?.instructions, REMY_AGENT_INSTRUCTIONS);

  const synced = agents.seedRemyAgent();

  assert.equal(synced.instructions, REMY_AGENT_INSTRUCTIONS);
  assert.equal(synced.id, REMY_AGENT_ID);
});

test("Remy is not somebody work is handed to", () => {
  const builder = agents.createAgent({ name: "Builder", handle: "builder" });

  // Not by an agent's handoff list …
  const saved = agents.updateAgent(builder.id, { handoffTo: ["remy", "qa"] });
  assert.deepEqual(saved.handoffTo, ["qa"]);

  // … and not by the board.
  assert.equal(agents.getAgent(REMY_AGENT_ID)?.autoStart, false);
});

test("no other agent may take the Remy handle", () => {
  assert.throws(() => agents.createAgent({ name: "Impostor", handle: REMY_AGENT_HANDLE }), /already uses/);
});
