import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../test/sqlite-d1.js";
import { D1ComputerStore } from "./computer-store.js";
import { D1OrganizationStore } from "./organization-store.js";
import { ComputerService } from "./computers.js";

test("Connect Codex on a computer with an older daemon asks you to update it", async () => {
  const folder = new URL("../migrations/", import.meta.url);
  const { db, sqlite } = sqliteD1(readdirSync(folder).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(new URL(f, folder), "utf8")).join("\n"));
  sqlite.exec("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('ada','Ada','ada@test.dev',1,1);");
  sqlite.exec("INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('org','Studio',1,1);");
  sqlite.exec("INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('m1','org','ada','owner',1,1);");
  const { HubCoordinator, CODEX_NEEDS_UPDATE } = await import("./worker.js");
  const computerId = "b7ebfcbe-f2f4-4a1b-8707-3029fa65d14b";
  try {
    await new ComputerService(new D1ComputerStore(db), Date.now, "0.1.0", new D1OrganizationStore(db)).register("org", "ada", {
      computerId, name: "Apollo", icon: "laptop", platform: "darwin", daemonVersion: "1.0.0", protocol: { minimum: 1, maximum: 1 }, publicKey: "k".repeat(44),
      capabilities: { providers: [], workspaces: [], worktrees: true, terminals: true, emulator: false },
    });
    const values = new Map<string, unknown>([["organizationId", "org"]]);
    const storage = { get: async (key: string) => values.get(key), put: async (key: string, value: unknown) => { values.set(key, value); }, delete: async (key: string) => values.delete(key), list: async () => new Map(), getAlarm: async () => null, setAlarm: async () => {}, transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(storage) };
    const coordinator = new HubCoordinator({ storage, blockConcurrencyWhile: async <T>(work: () => Promise<T>) => work(), getWebSockets: () => [], waitUntil: () => {} } as unknown as DurableObjectState, { DB: db, AUTH_SECRET: { get: async () => "test-encryption-root-with-at-least-thirty-two-characters" }, BETTER_AUTH_URL: "https://hub.example" } as never);
    let answer = Response.json({ error: "Choose a hosted computer." }, { status: 403 });
    (coordinator as unknown as { dispatchComputer: () => Promise<Response> }).dispatchComputer = async () => answer;
    const connect = () => coordinator.fetch(new Request(`https://internal/computer-account/${computerId}/codex/start`, { method: "POST", headers: { "x-organization-id": "org", "x-user-id": "ada" } }));

    const old = await connect();
    assert.equal(old.status, 403);
    assert.equal(((await old.json()) as { error: string }).error, CODEX_NEEDS_UPDATE);

    answer = Response.json({ phase: "pending", userCode: "ABCD-EFGH", verificationUrl: "https://auth.openai.com/codex/device" });
    const current = await connect();
    assert.equal(current.status, 200);
    assert.equal(((await current.json()) as { phase: string }).phase, "pending");
  } finally {
    sqlite.close();
  }
});
