import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BoardLogEvent } from "@remy/contract";
const dir = mkdtempSync(join(tmpdir(), "remy-hub-board-"));
process.env.MC_CONFIG_DIR = dir;
const { append, eventsSince } = await import("./board-log.js");
const {
  HubBoardSync,
  configureHubBoard,
  hubBoardList,
  hubBoardState,
  importHubBoard,
  appendHubBoard,
} = await import("./hub-board.js");
const { db } = await import("./db.js");
test.after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("consent isolates private history and imports a fixed set only once", async () => {
  append("ticket", "private", "create", { title: "Private", number: 1 });
  let calls = 0;
  const sync = new HubBoardSync("org", async () => {
    calls++;
    return { events: [], version: {} };
  });
  await sync.sync();
  assert.equal(calls, 0);
  configureHubBoard("org", true);
  assert.equal(hubBoardList("org", "tickets").items.length, 0);
  importHubBoard("org");
  assert.equal(hubBoardList("org", "tickets").items[0].fields.title, "Private");
  append("ticket", "later-private", "create", { title: "Still private" });
  importHubBoard("org");
  assert.equal(hubBoardList("org", "tickets").items.length, 1);
  assert.equal(hubBoardList("other", "tickets").items.length, 0);
  assert.equal(hubBoardState("org").imported, true);
  sync.stop();
});

test("wake catches up over multiple pages, retains offline reads and keeps organization data off peer sync", async () => {
  const events: BoardLogEvent[] = Array.from({ length: 1001 }, (_, i) => ({
    id: `remote-${i}`,
    deviceId: "hub",
    lamport: i + 1,
    at: i,
    entity: "ticket",
    entityId: `ticket-${i}`,
    kind: "create",
    payload: { title: `Task ${i}` },
    actor: { kind: "member", id: "ada", label: "Ada" },
  }));
  let offline = false;
  let active = 0;
  let maximum = 0;
  const org = "sleeping";
  configureHubBoard(org, true);
  const sync = new HubBoardSync(org, async ({ version, events: outgoing }) => {
    active++;
    maximum = Math.max(active, maximum);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (offline) throw new Error("offline");
      for (const e of outgoing)
        if (!events.some((v) => v.id === e.id)) events.push(e);
      return {
        events: events
          .filter((e) => e.lamport > (version[e.deviceId] ?? 0))
          .slice(0, 500),
        version: Object.fromEntries(
          [...new Set(events.map((e) => e.deviceId))].map((device) => [
            device,
            Math.max(
              ...events
                .filter((e) => e.deviceId === device)
                .map((e) => e.lamport),
            ),
          ]),
        ),
      };
    } finally {
      active--;
    }
  });
  await sync.sync();
  assert.equal(hubBoardList(org, "tickets").items.length, 1001);
  assert.ok(!eventsSince({}).some((e) => e.id.startsWith("remote-")));
  const local = appendHubBoard(org, {
    entity: "ticket",
    entityId: "local-org",
    kind: "create",
    payload: { title: "Shared" },
  });
  assert.ok(local.deviceId.startsWith("computer:"));
  assert.ok(local.deviceId.endsWith(`:organization:${org}`));
  await Promise.all([sync.sync(), sync.sync()]);
  assert.ok(events.some((e) => e.id === local.id));
  offline = true;
  await sync.sync();
  assert.equal(hubBoardList(org, "tickets").items.length, 1002);
  assert.equal(maximum, 1);
  sync.stop();
});
