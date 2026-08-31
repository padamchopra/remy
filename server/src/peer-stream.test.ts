import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocketServer, type WebSocket } from "ws";

process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "remy-peer-stream-test-"));

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = this.OPEN;
  sent: Record<string, unknown>[] = [];

  send(text: string): void {
    const frame = JSON.parse(text) as Record<string, unknown>;
    this.sent.push(frame);
    this.emit("sent", frame);
  }

  terminate(): void {
    this.readyState = 3;
  }
}

test("peer stream authenticates and relays remote frames to local clients", async () => {
  const remote = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => remote.once("listening", resolve));
  const address = remote.address();
  assert(address && typeof address === "object");

  const { db } = await import("./db.js");
  db.prepare(
    "insert into peers (id, name, url, token, notify, paired_at) values (?, ?, ?, ?, ?, ?)",
  ).run("remote", "Remote", `http://127.0.0.1:${address.port}`, "secret", 0, Date.now());

  const notify = await import("./notify.js");
  const local = new FakeSocket();
  notify.attachNotifyStream(local as unknown as WebSocket, false);

  let requestUrl: string | undefined;
  let authorization: string | undefined;
  let connections = 0;
  const activity = { id: "activity:child", kind: "tool", activity: { id: "child", kind: "subagent", provider: "codex", title: "Review", status: "running", startedAt: 1, updatedAt: 2 } };
  remote.on("connection", (socket, request) => {
    connections += 1;
    requestUrl = request.url;
    authorization = request.headers.authorization;
    if (connections === 1) {
      socket.send(JSON.stringify({ type: "hello", push: true, streamId: "remote-stream", sequence: 4 }));
      socket.send(JSON.stringify({ type: "chat", chatId: "remote-chat", sequence: 5, entries: [activity] }));
    } else if (connections === 2) {
      socket.send(JSON.stringify({ type: "hello", push: true, streamId: "remote-stream", sequence: 6 }));
      const completed = { ...activity, activity: { ...activity.activity, status: "completed" } };
      for (let i = 0; i < 2; i++) socket.send(JSON.stringify({ type: "chat", chatId: "remote-chat", sequence: 6, entries: [completed] }));
      socket.send(JSON.stringify({ type: "replay-finished", sequence: 7 }));
    } else {
      socket.send(JSON.stringify({ type: "hello", push: true, streamId: "restarted-stream", sequence: 0 }));
      socket.send(JSON.stringify({ type: "chat", chatId: "remote-chat", sequence: 1, entries: [activity] }));
    }
  });

  const relayed = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("remote frame was not relayed")), 2_000);
    local.on("sent", (frame: Record<string, unknown>) => {
      if (frame.type !== "peer-frame") return;
      const payload = frame.payload as Record<string, unknown> | undefined;
      if (payload?.type !== "chat") return;
      clearTimeout(timeout);
      resolve(frame);
    });
  });

  const { startPeerStreamRelay } = await import("./peer-stream.js");
  const stop = startPeerStreamRelay();
  try {
    assert.deepEqual(await relayed, {
      type: "peer-frame",
      serverId: "remote",
      payload: { type: "chat", chatId: "remote-chat", sequence: 5, entries: [activity] },
    });
    assert.equal(authorization, "Bearer secret");
    assert.match(requestUrl ?? "", /^\/notify\/stream\?/);
    assert.match(requestUrl ?? "", /relay=1/);
    const waitFor = (predicate: (payload: Record<string, unknown>) => boolean) => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { local.off("sent", receive); reject(new Error("missing reconnect frame")); }, 2_000);
      const receive = (frame: Record<string, unknown>) => {
        const payload = frame.payload as Record<string, unknown> | undefined;
        if (!payload || !predicate(payload)) return;
        clearTimeout(timer);
        local.off("sent", receive);
        resolve();
      };
      local.on("sent", receive);
    });
    const replayed = waitFor((payload) => payload.type === "replay-finished");
    for (const socket of remote.clients) socket.terminate();
    await replayed;
    assert.match(requestUrl ?? "", /afterSequence=5/);
    const updates = local.sent.flatMap((frame) => frame.payload ? [frame.payload as Record<string, unknown>] : []);
    const completed = updates.filter((frame) => frame.type === "chat" && frame.sequence === 6);
    assert.equal(completed.length, 1);
    assert.equal((completed[0].entries as typeof activity[])[0].activity.status, "completed");
    const restarted = waitFor((payload) => payload.type === "chat" && payload.sequence === 1);
    for (const socket of remote.clients) socket.terminate();
    await restarted;
    assert.ok(local.sent.some((frame) => (frame.payload as Record<string, unknown>)?.type === "peer-reset"));
  } finally {
    stop();
    await new Promise<void>((resolve, reject) => {
      remote.close((error) => error ? reject(error) : resolve());
    });
  }
});
