import assert from "node:assert/strict";
import test from "node:test";
import { HubCoordinator } from "./worker.js";

test("reading an interrupted durable thread start resumes the same thread id", async () => {
  const requestId = "00000000-0000-4000-8000-000000000004";
  const key = `manual-task:ada:${requestId}`;
  const values = new Map<string, unknown>([["organizationId", "org"], [key, {
    started: true,
    phase: "creating",
    workspaceId: "workspace",
    at: 1,
    updatedAt: 1,
    command: {
      actor: { id: "ada", label: "Ada" },
      workspaceId: "workspace",
      requestId,
      message: "Fix the login.",
    },
  }]]);
  const pending: Promise<unknown>[] = [];
  const storage = {
    get: async (storedKey: string) => values.get(storedKey),
    put: async (storedKey: string, value: unknown) => { values.set(storedKey, value); },
    delete: async (storedKey: string) => values.delete(storedKey),
    list: async (options?: { prefix?: string }) => new Map([...values].filter(([storedKey]) => storedKey.startsWith(options?.prefix ?? ""))),
    getAlarm: async () => null,
    setAlarm: async () => {},
  };
  const coordinator = new HubCoordinator({
    storage,
    blockConcurrencyWhile: async <T>(work: () => Promise<T>) => work(),
    getWebSockets: () => [],
    waitUntil: (work: Promise<unknown>) => { pending.push(work); },
  } as unknown as DurableObjectState, { DB: {} } as never);
  (coordinator as unknown as { hostedService: () => { get: () => Promise<undefined> } }).hostedService = () => ({ get: async () => undefined });
  (coordinator as unknown as { finishManualThread: (storedKey: string) => Promise<void> }).finishManualThread = async (storedKey) => {
    const current = values.get(storedKey) as Record<string, unknown>;
    values.set(storedKey, { ...current, phase: "ready", id: requestId, computerId: "computer", messageSent: true });
  };

  const progress = (coordinator as unknown as { manualThreadProgress: (userId: string, id: string) => Promise<{ phase: string; id?: string }> }).manualThreadProgress.bind(coordinator);
  assert.equal((await progress("ada", requestId)).phase, "creating");
  await Promise.all(pending);
  assert.deepEqual(await progress("ada", requestId), { phase: "ready", id: requestId, computerId: "computer" });
});
