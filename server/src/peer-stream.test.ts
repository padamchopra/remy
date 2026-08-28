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
  remote.on("connection", (socket, request) => {
    requestUrl = request.url;
    authorization = request.headers.authorization;
    socket.send(JSON.stringify({ type: "hello", push: true, streamId: "remote-stream", sequence: 4 }));
    socket.send(JSON.stringify({ type: "chat", chatId: "remote-chat", sequence: 5 }));
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
      payload: { type: "chat", chatId: "remote-chat", sequence: 5 },
    });
    assert.equal(authorization, "Bearer secret");
    assert.match(requestUrl ?? "", /^\/notify\/stream\?/);
    assert.match(requestUrl ?? "", /relay=1/);
  } finally {
    stop();
    await new Promise<void>((resolve, reject) => {
      remote.close((error) => error ? reject(error) : resolve());
    });
  }
});
