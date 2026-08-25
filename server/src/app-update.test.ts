import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { WebSocket } from "ws";

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = this.OPEN;
  sent: string[] = [];

  send(value: string): void {
    this.sent.push(value);
  }
}

test("a packaged desktop connection can receive a guarded update request", async () => {
  const updates = await import("./app-update.js");
  const socket = new FakeSocket();
  updates.attachAppUpdateHost(
    socket as unknown as WebSocket,
    new URLSearchParams("client=desktop&updates=1&version=0.1.42&arch=arm64"),
  );

  assert.deepEqual(updates.appUpdateStatus(0), {
    supported: true,
    version: "0.1.42",
    arch: "arm64",
    state: "idle",
    busyThreads: 0,
  });
  assert.throws(() => updates.requestAppUpdate(1), /Stop the running threads/);
  assert.equal(socket.sent.length, 0);

  const started = updates.requestAppUpdate(0);
  assert.equal(started.state, "starting");
  const command = JSON.parse(socket.sent[0]) as { type: string; action: string; requestId: string };
  assert.equal(command.type, "app-update");
  assert.equal(command.action, "install-latest");

  const downloading = updates.reportAppUpdate({ requestId: command.requestId, state: "downloading" }, 0);
  assert.equal(downloading.state, "downloading");
  const failed = updates.reportAppUpdate({ requestId: command.requestId, state: "failed", error: "No release" }, 0);
  assert.equal(failed.error, "No release");

  socket.emit("close");
  assert.equal(updates.appUpdateStatus(0).supported, false);
});

test("a browser connection cannot register itself as an updater", async () => {
  const updates = await import("./app-update.js");
  const socket = new FakeSocket();
  updates.attachAppUpdateHost(socket as unknown as WebSocket, new URLSearchParams("client=browser&version=9.9.9"));
  assert.equal(updates.appUpdateStatus(0).supported, false);
});
