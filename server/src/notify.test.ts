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

const settleFrames = () => new Promise((resolve) => setTimeout(resolve, 25));

test("peer relays resume sequenced frames without echoing relayed traffic", async () => {
  const notify = await import("./notify.js");
  const local = new FakeSocket();
  notify.attachNotifyStream(local as unknown as WebSocket, false);

  notify.broadcast({ type: "chat", chatId: "one" });
  await settleFrames();
  assert.equal(local.sent[1]?.sequence, 1);

  const relay = new FakeSocket();
  notify.attachNotifyStream(
    relay as unknown as WebSocket,
    false,
    new URLSearchParams(`relay=1&afterSequence=0&streamId=${local.sent[0]?.streamId}`),
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

test("scoped clients receive only owned surfaces and acquire detail explicitly", async () => {
  const notify = await import("./notify.js");
  const scoped = new FakeSocket();
  notify.attachNotifyStream(
    scoped as unknown as WebSocket,
    false,
    new URLSearchParams("scoped=1&topic=sidebar&topic=thread%3Aone"),
  );

  notify.broadcast({ type: "board" });
  notify.broadcast({ type: "chat-list", operation: "upsert", chat: { id: "new" } });
  notify.broadcast({ type: "chat", chatId: "one", entries: [{ id: "a", text: "first" }] });
  notify.broadcast({ type: "chat", chatId: "two", entries: [{ id: "b", text: "hidden" }] });
  await settleFrames();

  assert.equal(scoped.sent.some((frame) => frame.type === "board"), true);
  assert.equal(scoped.sent.some((frame) => frame.type === "chat-list"), true);
  assert.equal(scoped.sent.some((frame) => frame.type === "chat" && frame.chatId === "one"), true);
  assert.equal(scoped.sent.some((frame) => frame.type === "chat" && frame.chatId === "two"), false);

  scoped.emit("message", JSON.stringify({ type: "subscribe", topics: ["sidebar", "thread:two"] }));
  assert.deepEqual(scoped.sent.at(-1)?.topics, ["thread:two"]);
  assert.equal(scoped.sent.at(-1)?.type, "reset");
});

test("chat bursts coalesce independently by thread", async () => {
  const notify = await import("./notify.js");
  const scoped = new FakeSocket();
  notify.attachNotifyStream(
    scoped as unknown as WebSocket,
    false,
    new URLSearchParams("scoped=1&topic=thread%3Abusy&topic=thread%3Aother"),
  );
  notify.broadcast({ type: "chat", chatId: "busy", entries: [{ id: "same", text: "one" }] });
  notify.broadcast({ type: "chat", chatId: "busy", entries: [{ id: "same", text: "two" }] });
  notify.broadcast({ type: "chat", chatId: "other", entries: [{ id: "other", text: "ready" }] });
  await settleFrames();

  const chats = scoped.sent.filter((frame) => frame.type === "chat");
  assert.equal(chats.length, 2);
  const busy = chats.find((frame) => frame.chatId === "busy");
  assert.equal((busy?.entries as { text: string }[])[0]?.text, "two");
  assert.equal(chats.some((frame) => frame.chatId === "other"), true);
});

test("a bounded cursor replays its topics and a stale cursor resets", async () => {
  const notify = await import("./notify.js");
  const first = new FakeSocket();
  notify.attachNotifyStream(first as unknown as WebSocket, false, new URLSearchParams("scoped=1&topic=sidebar"));
  const hello = first.sent[0];
  const after = Number(hello.sequence);
  notify.broadcast({ type: "sessions", marker: "replay me" });
  notify.broadcast({ type: "quick-replies", marker: "not this topic" });

  const resumed = new FakeSocket();
  notify.attachNotifyStream(
    resumed as unknown as WebSocket,
    false,
    new URLSearchParams(`scoped=1&topic=sidebar&afterSequence=${after}&streamId=${hello.streamId}`),
  );
  assert.equal(resumed.sent[0]?.reset, undefined);
  assert.equal(resumed.sent.some((frame) => frame.marker === "replay me"), true);
  assert.equal(resumed.sent.some((frame) => frame.marker === "not this topic"), false);

  for (let index = 0; index < 1_001; index += 1) {
    notify.broadcast({ type: "sessions", marker: index });
  }
  const stale = new FakeSocket();
  notify.attachNotifyStream(
    stale as unknown as WebSocket,
    false,
    new URLSearchParams(`scoped=1&topic=sidebar&afterSequence=${after}&streamId=${hello.streamId}`),
  );
  assert.equal(stale.sent[0]?.reset, true);
  assert.deepEqual(stale.sent[0]?.topics, ["sidebar"]);
  assert.equal(stale.sent.length, 1);
});
