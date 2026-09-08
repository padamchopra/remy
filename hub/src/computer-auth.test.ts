import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { computerConnectionMessage, type ComputerConnectionAuthorization } from "@remy/contract";
import { authenticateComputer } from "./computer-auth.js";
import type { ComputerStore, StoredComputer } from "./computer-store.js";

const pair = generateKeyPairSync("ed25519");
const row: StoredComputer = {
  computerId: "b7ebfcbe-f2f4-4a1b-8707-3029fa65d14b", organizationId: "org-1", ownerUserId: "owner-1", name: "Studio", platform: "darwin", daemonVersion: "1.0.0",
  protocol: { minimum: 1, maximum: 1 }, publicKey: Buffer.from(pair.publicKey.export({ format: "der", type: "spki" })).toString("base64url"), capabilities: { providers: [], workspaces: [], worktrees: true, terminals: true, emulator: false }, registeredAt: 1, updatedAt: 1, lastSeenAt: null,
};
const nonces = new Set<string>();
const store: ComputerStore = { computer: async (org, id) => org === row.organizationId && id === row.computerId ? row : undefined, computers: async () => [row], register: async () => "created", seen: async () => true, claimNonce: async (id, nonce) => { const key = `${id}:${nonce}`; if (nonces.has(key)) return false; nonces.add(key); return true; } };

function request(at: number, key = pair.privateKey): Request {
  const unsigned = { computerId: row.computerId, timestamp: at, nonce: "a-safe-single-use-nonce" };
  const authorization: ComputerConnectionAuthorization = { ...unsigned, signature: Buffer.from(sign(null, Buffer.from(computerConnectionMessage(row.organizationId, unsigned)), key)).toString("base64url") };
  return new Request("https://hub.example/connect", { headers: { authorization: `RemyComputer ${Buffer.from(JSON.stringify(authorization)).toString("base64url")}` } });
}

test("a registered computer reconnects by proving its private key", async () => {
  const signed = request(10_000);
  assert.equal((await authenticateComputer(signed, "org-1", store, () => 10_000))?.computerId, row.computerId);
  assert.equal(await authenticateComputer(signed, "org-1", store, () => 10_000), undefined);
  const other = generateKeyPairSync("ed25519");
  assert.equal(await authenticateComputer(request(10_000, other.privateKey), "org-1", store, () => 10_000), undefined);
  assert.equal(await authenticateComputer(request(1), "org-1", store, () => 100_000), undefined);
});
