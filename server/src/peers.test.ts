import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Every module here opens the shared database at import time, so the suite runs
// against a throwaway directory. node:test gives each file its own process, so
// this override cannot leak sideways.
const stateDir = mkdtempSync(join(tmpdir(), "mc-peers-"));
process.env.MC_CONFIG_DIR = stateDir;

const { db } = await import("./db.js");
const log = await import("./board-log.js");
const projects = await import("./projects.js");
const memories = await import("./agent-memories.js");
const tickets = await import("./tickets.js");
const peers = await import("./peers.js");

/// An event as it would arrive from another machine: a device id that is not
/// ours, and a lamport of that machine's choosing.
function remoteEvent(
  from: string,
  lamport: number,
  overrides: Partial<{
    id: string;
    entity: string;
    entityId: string;
    kind: string;
    payload: Record<string, unknown>;
  }> = {},
) {
  return {
    id: overrides.id ?? `${from}-${lamport}`,
    deviceId: from,
    lamport,
    at: 1_700_000_000_000 + lamport,
    entity: overrides.entity ?? "project",
    entityId: overrides.entityId ?? "p-remote",
    kind: overrides.kind ?? "create",
    payload: overrides.payload ?? { name: "Remote", keyPrefix: "REM" },
  };
}

// ── the cursor ──────────────────────────────────────────────────────────────

test("the version vector holds one high-water mark per device", () => {
  db.exec("delete from board_log");
  log.mergeRemote([remoteEvent("alpha", 3), remoteEvent("alpha", 7), remoteEvent("beta", 4)]);

  assert.deepEqual(log.versionVector(), { alpha: 7, beta: 4 });
});

test("a device the cursor has never heard of contributes its whole history", () => {
  db.exec("delete from board_log");
  log.mergeRemote([remoteEvent("alpha", 1), remoteEvent("alpha", 2), remoteEvent("beta", 3)]);

  const forAlphaOnly = log.eventsSince({ alpha: 2 });
  assert.deepEqual(
    forAlphaOnly.map((event) => event.id),
    ["beta-3"],
    "beta is unknown to the caller, so all of beta goes",
  );

  const forNobody = log.eventsSince({});
  assert.equal(forNobody.length, 3, "an empty cursor asks for everything");
});

test("a third device's late event is not stepped over by the cursor", () => {
  db.exec("delete from board_log");
  // The shape a scalar cursor gets wrong: we pull up to lamport 9, and only
  // afterwards does an event from a third machine — written at 5 — reach the
  // peer. Asking "everything above 9" would never mention it again.
  log.mergeRemote([remoteEvent("alpha", 9)]);
  const cursor = log.versionVector();
  log.mergeRemote([remoteEvent("gamma", 5)]);

  const missed = log.eventsSince(cursor);
  assert.deepEqual(missed.map((event) => event.id), ["gamma-5"]);
});

// ── merging ─────────────────────────────────────────────────────────────────

test("merging keeps the device and lamport an event was written with", () => {
  db.exec("delete from board_log");
  const landed = log.mergeRemote([remoteEvent("alpha", 12)]);

  assert.equal(landed, 1);
  const [event] = log.eventsFor("project", "p-remote");
  assert.equal(event.deviceId, "alpha", "the writer is part of the order, not ours to change");
  assert.equal(event.lamport, 12);
});

test("the same event merged twice lands once", () => {
  db.exec("delete from board_log");
  assert.equal(log.mergeRemote([remoteEvent("alpha", 1)]), 1);
  assert.equal(log.mergeRemote([remoteEvent("alpha", 1)]), 0, "already here");
  assert.equal(log.eventsFor("project", "p-remote").length, 1);
});

test("a merged event notifies subscribers with the exact changed entity", async () => {
  db.exec("delete from board_log");
  const seen: string[] = [];
  const stop = log.onRemoteMerge((event) => seen.push(`${event.entity}:${event.entityId}`));
  log.mergeRemote([
    remoteEvent("alpha", 1, { entity: "ticket", entityId: "ticket-one" }),
    remoteEvent("alpha", 2, { entity: "agent", entityId: "agent-one" }),
  ]);
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  stop();
  assert.deepEqual(seen, ["ticket:ticket-one", "agent:agent-one"]);
});

test("a merged lamport carries this machine's clock forward", () => {
  db.exec("delete from board_log");
  log.mergeRemote([remoteEvent("alpha", 40)]);

  const mine = log.append("project", "p-local", "create", { name: "Local", keyPrefix: "LOC" });
  assert.ok(mine.lamport > 40, `${mine.lamport} should follow the merged 40`);
});

test("a malformed event is dropped rather than poisoning the log", () => {
  db.exec("delete from board_log");
  const landed = log.mergeRemote([
    { id: "no-device", lamport: 2, entity: "project", entityId: "p", kind: "create" },
    { ...remoteEvent("alpha", 3), entity: "spaceship" },
    { ...remoteEvent("alpha", 4), kind: "detonate" },
    { ...remoteEvent("alpha", 5), lamport: 0 },
    "not an event",
    remoteEvent("alpha", 6),
  ]);

  assert.equal(landed, 1, "only the well-formed one");
  assert.deepEqual(log.versionVector(), { alpha: 6 });
});

test("merging nothing is not a change", () => {
  db.exec("delete from board_log");
  assert.equal(log.mergeRemote([]), 0);
  assert.equal(log.mergeRemote(undefined), 0);
  assert.equal(log.mergeRemote({ not: "an array" }), 0);
});

// ── what a peer's events become ─────────────────────────────────────────────

test("a peer's events fold into a ticket on this machine", () => {
  db.exec("delete from board_log");
  db.exec("delete from tickets");
  db.exec("delete from projects");

  const events = [
    remoteEvent("alpha", 1, {
      id: "alpha-project",
      entity: "project",
      entityId: "p-shared",
      kind: "create",
      payload: { name: "Shared", keyPrefix: "SHR" },
    }),
    remoteEvent("alpha", 2, {
      id: "alpha-ticket",
      entity: "ticket",
      entityId: "t-shared",
      kind: "create",
      payload: { projectId: "p-shared", title: "Wire the peers", number: 1 },
    }),
    remoteEvent("alpha", 3, {
      id: "alpha-status",
      entity: "ticket",
      entityId: "t-shared",
      kind: "status",
      payload: { status: "in_progress" },
    }),
  ];

  assert.equal(peers.acceptEvents({ events }), 3);

  const ticket = tickets.getTicket("t-shared");
  assert.ok(ticket, "the ticket a peer wrote is a ticket here");
  assert.equal(ticket?.title, "Wire the peers");
  assert.equal(ticket?.status, "in_progress", "later events fold over earlier ones");
  assert.equal(projects.getProject("p-shared")?.name, "Shared");
});

test("a peer's memory event becomes durable agent context on this machine", () => {
  const events = [
    remoteEvent("alpha", 20, {
      id: "alpha-memory",
      entity: "memory",
      entityId: "memory-shared",
      kind: "create",
      payload: {
        agentId: "agent-shared",
        scope: "global",
        content: "Prefer direct progress updates.",
      },
    }),
  ];

  assert.equal(peers.acceptEvents({ events }), 1);
  assert.equal(memories.getMemory("memory-shared")?.content, "Prefer direct progress updates.");
});

// ── the peer list ───────────────────────────────────────────────────────────

test("a peer is offline until it has answered, and its token stays in the daemon", () => {
  db.exec("delete from peers");
  db.prepare(
    "insert into peers (id, name, url, token, notify, paired_at) values (?, ?, ?, ?, ?, ?)",
  ).run("alpha", "Studio", "https://studio.example.ts.net", "secret-token", 0, Date.now());

  const [view] = peers.peerViews();
  assert.equal(view.id, "alpha");
  assert.equal(view.online, false, "never seen, so not online");
  assert.equal((view as Record<string, unknown>).token, undefined, "a client never holds a peer's token");

  db.prepare("update peers set last_seen = ? where id = ?").run(Date.now(), "alpha");
  assert.equal(peers.peerViews()[0].online, true);
});

test("environment sync needs a paired-daemon signature beyond the API token", () => {
  db.exec("delete from peers");
  db.prepare(
    "insert into peers (id, name, url, token, notify, paired_at) values (?, ?, ?, ?, ?, ?)",
  ).run("alpha", "Studio", "https://studio.example.ts.net", "sender-token", 0, Date.now());
  const method = "POST";
  const path = "/peers/environments/sync";
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", "sender-token")
    .update(`remy-peer:alpha:${method}:${path}:${timestamp}`)
    .digest("base64url");

  assert.equal(peers.isAuthenticatedPeerRequest({
    "x-remy-peer": "alpha",
    "x-remy-peer-time": timestamp,
    "x-remy-peer-signature": signature,
  }, method, path), true);
  assert.equal(peers.isAuthenticatedPeerRequest({}, method, path), false);
});

test("notifications route only to the peers that asked for them", () => {
  db.exec("delete from peers");
  const insert = db.prepare(
    "insert into peers (id, name, url, token, notify, paired_at) values (?, ?, ?, ?, ?, ?)",
  );
  insert.run("alpha", "Studio", "https://studio.example.ts.net", "t1", 1, Date.now());
  insert.run("beta", "Mini", "https://mini.example.ts.net", "t2", 0, Date.now());

  assert.deepEqual(peers.notifyPeers().map((peer) => peer.id), ["alpha"]);

  peers.updatePeer("beta", { notify: true });
  assert.deepEqual(peers.notifyPeers().map((peer) => peer.id).sort(), ["alpha", "beta"]);

  peers.updatePeer("alpha", { notify: false });
  assert.deepEqual(peers.notifyPeers().map((peer) => peer.id), ["beta"]);
});

test("renaming a peer leaves its address and token alone", () => {
  db.exec("delete from peers");
  db.prepare(
    "insert into peers (id, name, url, token, notify, paired_at) values (?, ?, ?, ?, ?, ?)",
  ).run("alpha", "studio-mac", "https://studio.example.ts.net", "secret", 0, Date.now());

  const view = peers.updatePeer("alpha", { name: "  The Studio  " });
  assert.equal(view.name, "The Studio", "trimmed");
  assert.equal(view.url, "https://studio.example.ts.net");
  assert.equal(peers.getPeer("alpha")?.token, "secret");

  peers.updatePeer("alpha", { name: "   " });
  assert.equal(peers.getPeer("alpha")?.name, "The Studio", "a blank name is not a name");
});

test("an announcement without a reachable address is refused", () => {
  db.exec("delete from peers");
  assert.throws(
    () => peers.acceptAnnouncement({ deviceId: "alpha", name: "Studio", url: "file:///etc/passwd", token: "t" }),
    /http/,
  );
  assert.throws(
    () => peers.acceptAnnouncement({ deviceId: "alpha", name: "Studio", url: "https://studio.example", token: "" }),
    /token/,
  );
  assert.throws(
    () => peers.acceptAnnouncement({ name: "Studio", url: "https://studio.example", token: "t" }),
    /device/,
  );
  assert.equal(peers.listPeers().length, 0);
});

test("a client can forward image bytes to the device that owns its thread", async () => {
  const originalFetch = globalThis.fetch;
  const image = Buffer.from([137, 80, 78, 71]);
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("content-type"), "image/png");
    assert.equal(new Headers(init?.headers).get("x-filename"), "screen.png");
    assert.deepEqual(Buffer.from(await new Response(init?.body).arrayBuffer()), image);
    return new Response(JSON.stringify({ attachment: { id: "remote" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const result = await peers.callPeer<{ attachment: { id: string } }>(
      { url: "https://remote.test", token: "secret" },
      "/chats/thread/upload",
      { method: "POST", rawBody: image, filename: "screen.png", contentType: "image/png" },
    );
    assert.equal(result.attachment.id, "remote");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("this machine will not pair with itself", () => {
  assert.throws(
    () => peers.acceptAnnouncement({ deviceId: log.deviceId, url: "https://me.example", token: "t" }),
    /this machine/,
  );
});

test("an announcement pairs the far side and normalises its address", () => {
  db.exec("delete from peers");
  const view = peers.acceptAnnouncement({
    deviceId: "alpha",
    name: "Studio",
    icon: "monitor",
    tint: "violet",
    url: "https://studio.example.ts.net/",
    token: "secret",
  });

  assert.equal(view.id, "alpha");
  assert.equal(view.url, "https://studio.example.ts.net", "no trailing slash to double up on");
  assert.equal(view.icon, "monitor");
  assert.equal(view.tint, "violet");
  assert.equal(view.notify, false, "a new device is not buzzed until you say so");
  assert.equal(peers.getPeer("alpha")?.token, "secret");
});

test("pairing again with the same machine updates it rather than doubling it", () => {
  db.exec("delete from peers");
  peers.acceptAnnouncement({
    deviceId: "alpha",
    name: "Studio",
    icon: "monitor",
    tint: "violet",
    url: "https://old.example.ts.net",
    token: "old",
  });
  peers.updatePeer("alpha", { name: "Desk", icon: "house", tint: "amber", notify: true });
  peers.acceptAnnouncement({
    deviceId: "alpha",
    name: "Studio renamed itself",
    icon: "server",
    tint: "blue",
    url: "https://new.example.ts.net",
    token: "new",
  });

  assert.equal(peers.listPeers().length, 1);
  const peer = peers.getPeer("alpha");
  assert.equal(peer?.url, "https://new.example.ts.net");
  assert.equal(peer?.token, "new");
  assert.equal(peer?.name, "Desk", "the name chosen here stays local");
  assert.equal(peer?.icon, "house", "the mark chosen here stays local");
  assert.equal(peer?.tint, "amber", "the tint chosen here stays local");
  assert.equal(peer?.notify, true, "where its notifications go is yours, not the handshake's");
});
