import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { WebSocket } from "ws";

process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "remy-notify-test-"));

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = this.OPEN;
  sent: Record<string, unknown>[] = [];

  send(text: string): void {
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
  }

  terminate(): void {
    this.readyState = 3;
  }
}

test("peer relays resume sequenced frames without echoing relayed traffic", async () => {
  const notify = await import("./notify.js");
  const local = new FakeSocket();
  notify.attachNotifyStream(local as unknown as WebSocket, false);

  notify.broadcast({ type: "chat", chatId: "one" });
  assert.equal(local.sent[1]?.sequence, 1);

  const relay = new FakeSocket();
  notify.attachNotifyStream(
    relay as unknown as WebSocket,
    false,
    new URLSearchParams("relay=1&afterSequence=0"),
  );
  assert.equal(relay.sent[0]?.type, "hello");
  assert.deepEqual(relay.sent[1], local.sent[1]);

  notify.broadcastPeer("peer-one", { type: "chat", chatId: "remote" });
  assert.deepEqual(local.sent.at(-1), {
    type: "peer-frame",
    serverId: "peer-one",
    payload: { type: "chat", chatId: "remote" },
  });
  assert.equal(relay.sent.length, 2);
});
