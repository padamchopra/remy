import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";
import type { ComputerCapabilities } from "@remy/contract";

const state = mkdtempSync(join(tmpdir(), "remy-hub-computer-"));
process.env.MC_CONFIG_DIR = state;
const { HubComputerConnection } = await import("./hub-computer.js");

test.after(() => rmSync(state, { recursive: true, force: true }));

test("the daemon reconnects outbound with a fresh signed authorization and capability hello", async (context) => {
  const remote = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  context.after(() => remote.close());
  await new Promise<void>((resolve) => remote.once("listening", resolve));
  const address = remote.address();
  if (!address || typeof address === "string") throw new Error("The test server did not bind.");
  const capabilities: ComputerCapabilities = { providers: [{ id: "codex", models: ["default"] }], workspaces: [], worktrees: true, terminals: true, emulator: false };
  const authorizations: string[] = [];
  const hellos: unknown[] = [];
  const connectedTwice = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("The computer did not reconnect.")), 4_000);
    remote.on("connection", (socket, request) => {
      authorizations.push(String(request.headers.authorization ?? ""));
      socket.on("message", (message) => {
        const frame = JSON.parse(message.toString());
        if (frame.kind !== "hello") return;
        hellos.push(frame);
        if (authorizations.length === 1) socket.close();
        else { clearTimeout(timeout); resolve(); }
      });
    });
  });
  const connection = new HubComputerConnection({ computerId: "b7ebfcbe-f2f4-4a1b-8707-3029fa65d14b", organizationId: "org-1", ownerUserId: "owner-1", name: "Studio", platform: "darwin", daemonVersion: "0.1.0", protocol: { minimum: 1, maximum: 1 }, publicKey: "unused", capabilities, registeredAt: 1, updatedAt: 1, hubUrl: `http://127.0.0.1:${address.port}` }, async () => capabilities);
  context.after(() => connection.stop());
  connection.start();
  await connectedTwice;
  assert.equal(authorizations.length, 2);
  assert.ok(authorizations.every((header) => header.startsWith("RemyComputer ")));
  assert.notEqual(authorizations[0], authorizations[1]);
  assert.deepEqual(hellos.map((frame) => (frame as { kind: string }).kind), ["hello", "hello"]);
  assert.deepEqual((hellos[1] as { capabilities: ComputerCapabilities }).capabilities, capabilities);
  connection.stop();
});
