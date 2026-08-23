import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "remy-announcements-"));
const { deliverAnnouncements } = await import("./announcements.js");
const { dmChatFor, getChat, listChats, listDms } = await import("./chat.js");
const { REMY_AGENT_ID } = await import("./remy-agent.js");
const { getKv, setKv } = await import("./db.js");

const DELIVERED = "announcementsDelivered";

function remyMessages(): string[] {
  const dm = listDms().find((chat) => chat.agentId === REMY_AGENT_ID);
  if (!dm) return [];
  return (getChat(dm.id)?.entries ?? [])
    .filter((entry) => entry.kind === "assistant")
    .map((entry) => entry.text ?? "");
}

test("a fresh install is greeted once, not caught up on every release", () => {
  deliverAnnouncements();

  const messages = remyMessages();
  assert.equal(messages.length, 1);
  assert.match(messages[0], /^Hi, I'm Remy\./);
  // Everything this build knows how to say is marked as said, so somebody who
  // installs after ten releases does not open the inbox to ten messages.
  assert.ok((getKv<string[]>(DELIVERED) ?? []).includes("hello"));
});

test("booting again says nothing twice", () => {
  deliverAnnouncements();
  deliverAnnouncements();
  assert.equal(remyMessages().length, 1);
});

test("somebody who has been greeted gets the next release's message", () => {
  // What an upgrade looks like: this build knows a message the machine has not
  // been told about.
  setKv(DELIVERED, ["hello", "a-release-that-came-and-went"]);
  const before = remyMessages().length;

  setKv(DELIVERED, ["a-release-that-came-and-went"]);
  deliverAnnouncements();

  assert.equal(remyMessages().length, before + 1);
  assert.deepEqual(getKv<string[]>(DELIVERED), ["hello"]);
});

test("Remy's conversation is an inbox one, never a thread", () => {
  deliverAnnouncements();
  const dm = dmChatFor(REMY_AGENT_ID);

  assert.equal(dm.dm, true);
  assert.equal(dm.agentId, REMY_AGENT_ID);
  assert.equal(listChats().some((chat) => chat.id === dm.id), false);
  assert.equal(listDms().filter((chat) => chat.agentId === REMY_AGENT_ID).length, 1);
});

test("picking a model for an agent picks it for its conversation", async () => {
  const { syncAgentDm } = await import("./chat.js");
  const { updateAgent } = await import("./agents.js");
  const dm = dmChatFor(REMY_AGENT_ID);

  // An inbox conversation is the agent, not a piece of work with a history the
  // other tool could not read — so it moves when the agent does.
  updateAgent(REMY_AGENT_ID, { provider: "claude", model: "sonnet", effort: "high" });
  syncAgentDm(REMY_AGENT_ID);

  const moved = listDms().find((chat) => chat.id === dm.id);
  assert.equal(moved?.provider, "claude");
  assert.equal(moved?.model, "sonnet");
  assert.equal(moved?.effort, "high");
});

test("an agent's conversation goes with the agent", async () => {
  const { createAgent, deleteAgent } = await import("./agents.js");
  const { pruneOrphanDms, syncAgentDm } = await import("./chat.js");

  const doomed = createAgent({ name: "Passing through" });
  const dm = dmChatFor(doomed.id);
  assert.ok(listDms().some((chat) => chat.id === dm.id));

  deleteAgent(doomed.id);

  // Hidden the moment the agent is gone, whether or not the row has been
  // cleared out yet — that is what keeps a deleted agent out of the inbox on a
  // machine that learned about the deletion from a peer.
  assert.equal(listDms().some((chat) => chat.id === dm.id), false);

  syncAgentDm(doomed.id);
  assert.equal(getChat(dm.id), undefined);

  pruneOrphanDms();
  assert.equal(getChat(dm.id), undefined);
});

test("a message Remy posted is unread until it is opened", async () => {
  const dm = dmChatFor(REMY_AGENT_ID);
  const { markChatRead } = await import("./chat.js");

  assert.equal(listDms().find((chat) => chat.id === dm.id)?.unread, true);
  markChatRead(dm.id);
  assert.equal(listDms().find((chat) => chat.id === dm.id)?.unread, undefined);
});
