import assert from "node:assert/strict";
import test from "node:test";
import type { ComputerCapabilities } from "@remy/contract";
import type { ComputerStore, StoredComputer } from "./computer-store.js";
import { ComputerService } from "./computers.js";
import { OrganizationError } from "./organizations.js";
import { createRouteHandler, type Env } from "./worker.js";

class MemoryStore implements ComputerStore {
  rows: StoredComputer[] = [];
  nonces = new Set<string>();
  async computer(org: string, id: string) { return this.rows.find((row) => row.organizationId === org && row.computerId === id); }
  async computers(org: string) { return this.rows.filter((row) => row.organizationId === org); }
  async register(computer: StoredComputer) { const existing = this.rows.find((row) => row.computerId === computer.computerId); if (existing && (existing.organizationId !== computer.organizationId || existing.ownerUserId !== computer.ownerUserId)) return "conflict" as const; if (existing) Object.assign(existing, computer); else this.rows.push(computer); return existing ? "updated" as const : "created" as const; }
  async seen(org: string, id: string, at: number, capabilities?: ComputerCapabilities, daemonVersion?: string) { const row = await this.computer(org, id); if (!row) return false; row.lastSeenAt = at; if (capabilities) row.capabilities = capabilities; if (daemonVersion) row.daemonVersion = daemonVersion; return true; }
  async claimNonce(id: string, nonce: string) { const key = `${id}:${nonce}`; if (this.nonces.has(key)) return false; this.nonces.add(key); return true; }
}

const capabilities = { providers: [], workspaces: [], worktrees: true, terminals: true, emulator: false };
const input = { computerId: "b7ebfcbe-f2f4-4a1b-8707-3029fa65d14b", name: "Studio", platform: "darwin" as const, daemonVersion: "1.0.0", protocol: { minimum: 1, maximum: 1 }, publicKey: "k".repeat(44), capabilities };

test("registration stays bound to its organization and owner while a fresh authorization can rotate its key", async () => {
  const store = new MemoryStore(); const service = new ComputerService(store, () => 100);
  await service.register("org-1", "owner-1", input);
  await service.register("org-1", "owner-1", { ...input, name: "Desk" });
  await service.register("org-1", "owner-1", { ...input, publicKey: "n".repeat(44) });
  await assert.rejects(service.register("org-2", "owner-1", input), (error: unknown) => error instanceof OrganizationError && error.status === 409);
  await assert.rejects(service.register("org-1", "owner-2", input), (error: unknown) => error instanceof OrganizationError && error.status === 409);
  assert.equal(store.rows[0]?.publicKey, "n".repeat(44));
});

test("availability expires while the last capability snapshot remains", async () => {
  const store = new MemoryStore(); let now = 100; const service = new ComputerService(store, () => now);
  await service.register("org-1", "owner-1", input);
  await store.seen("org-1", input.computerId, now, capabilities);
  assert.equal((await service.list("org-1"))[0]?.availability, "available");
  now += 45_001;
  const stale = (await service.list("org-1"))[0]!;
  assert.equal(stale.availability, "offline");
  assert.equal(stale.capabilities.terminals, true);
  assert.equal("publicKey" in stale, false);
});

test("the hub can require a newer daemon independently of protocol rollout", async () => {
  const store = new MemoryStore();
  await new ComputerService(store, () => 100).register("org-1", "owner-1", input);
  assert.equal((await new ComputerService(store, () => 100, "1.1.0").list("org-1"))[0]?.updateRequired, true);
  assert.equal((await new ComputerService(store, () => 100, "1.0.0").list("org-1"))[0]?.updateRequired, false);
});

test("a computer session registers and an organization member can list the safe snapshot", async () => {
  const store = new MemoryStore();
  const route = createRouteHandler({
    accountStore: () => ({}) as never,
    accountService: () => ({ authenticate: async () => ({ sessionId: "session", userId: "owner-1", clientKind: "computer" }) }) as never,
    organizationStore: () => ({}) as never,
    organizationService: () => ({ member: async () => ({ role: "owner" }) }) as never,
    computerStore: () => store,
  });
  const environment = { AUTH_SECRET: {} as SecretsStoreSecret, BETTER_AUTH_URL: "https://hub.example", COORDINATOR: {} as DurableObjectNamespace, DB: {} as D1Database, ENVIRONMENT: "staging", JOBS: {} as Queue, OBJECTS: {} as R2Bucket, RELEASE: "test" } satisfies Env;
  const registered = await route(new Request("https://hub.example/api/organizations/org-1/computers", { method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: JSON.stringify(input) }), environment);
  assert.equal(registered.status, 201);
  const listed = await route(new Request("https://hub.example/api/organizations/org-1/computers", { headers: { authorization: "Bearer token" } }), environment);
  const payload = await listed.json() as { computers: Record<string, unknown>[] };
  assert.equal(payload.computers[0]?.name, "Studio");
  assert.equal("publicKey" in payload.computers[0]!, false);
});
