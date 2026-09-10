import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";
import type { ComputerCapabilities } from "@remy/contract";

const state = mkdtempSync(join(tmpdir(), "remy-hub-computer-"));
process.env.MC_CONFIG_DIR = state;
const { HubComputerConnection, hubRegistrationScope } = await import("./hub-computer.js");

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
  const connection = new HubComputerConnection({ icon: "", ownership: "personal", access: { mode: "owner", userIds: [], teamIds: [] }, computerId: "b7ebfcbe-f2f4-4a1b-8707-3029fa65d14b", organizationId: "org-1", ownerUserId: "owner-1", name: "Studio", platform: "darwin", daemonVersion: "0.1.0", protocol: { minimum: 1, maximum: 1 }, publicKey: "unused", capabilities, registeredAt: 1, updatedAt: 1, hubUrl: `http://127.0.0.1:${address.port}` }, async () => capabilities);
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


test("personal computer authorization resolves its account on the server and keeps explicit organization registration", async t => {
  const calls: {url:string; authorization:string|null}[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    calls.push({url: String(input), authorization: new Headers(init?.headers).get("authorization")});
    return Response.json({personal: {id:"private-account",personal:true}});
  });
  assert.equal(await hubRegistrationScope("https://hub.example", "", "native-session", "personal"),"private-account");
  assert.deepEqual(calls,[{url:"https://hub.example/api/personal",authorization:"Bearer native-session"}]);
  assert.equal(await hubRegistrationScope("https://hub.example", "studio", "native-session", "personal"),"studio");
  assert.equal(calls.length,1);
  await assert.rejects(hubRegistrationScope("https://hub.example", "", "native-session", "organization"),/Choose an organization/);
  t.mock.method(globalThis,"fetch",async()=>Response.json({personal:{id:"shared"}}));
  await assert.rejects(hubRegistrationScope("https://hub.example", "", "native-session", "personal"));
  t.mock.method(globalThis,"fetch",async()=>new Response(null,{status:401}));
  await assert.rejects(hubRegistrationScope("https://hub.example", "", "expired", "personal"));
});
