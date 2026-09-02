import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { WebSocket } from "ws";
import {
  attachNativeBrowserHost,
  nativeBrowserHostAvailable,
  onNativeBrowserHostAvailability,
  onNativeBrowserHostEvent,
  requestNativeBrowserHost,
} from "./browser-host.js";

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = this.OPEN;
  sent: Record<string, unknown>[] = [];

  send(text: string): void {
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
  }
}

test("the authenticated desktop stream hosts browser commands and events", async () => {
  const ignored = new FakeSocket();
  attachNativeBrowserHost(ignored as unknown as WebSocket, new URLSearchParams("client=browser&browserHost=1"));
  assert.equal(nativeBrowserHostAvailable(), false);

  const socket = new FakeSocket();
  const availability: boolean[] = [];
  const events: unknown[] = [];
  const offAvailability = onNativeBrowserHostAvailability((available) => availability.push(available));
  const offEvent = onNativeBrowserHostEvent((event) => events.push(event));
  attachNativeBrowserHost(socket as unknown as WebSocket, new URLSearchParams("client=desktop&browserHost=1"));
  assert.equal(nativeBrowserHostAvailable(), true);
  assert.deepEqual(availability, [true]);

  const requested = requestNativeBrowserHost<{ active: boolean }>("view", {
    chatId: "chat-one",
    browserId: "browser-one",
  });
  const command = socket.sent[0];
  assert.equal(command.type, "browser-host-command");
  assert.equal(command.action, "view");
  socket.emit("message", JSON.stringify({
    type: "browser-host-result",
    requestId: command.requestId,
    ok: true,
    view: { active: true },
  }));
  assert.deepEqual(await requested, { active: true });

  socket.emit("message", JSON.stringify({
    type: "browser-host-event",
    chatId: "chat-one",
    browserId: "browser-one",
    view: { active: true, revision: 2 },
  }));
  assert.deepEqual(events, [{
    chatId: "chat-one",
    browserId: "browser-one",
    view: { active: true, revision: 2 },
  }]);

  socket.readyState = 3;
  socket.emit("close");
  assert.equal(nativeBrowserHostAvailable(), false);
  assert.deepEqual(availability, [true, false]);
  offAvailability();
  offEvent();
});
