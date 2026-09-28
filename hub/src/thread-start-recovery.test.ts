import assert from "node:assert/strict";
import test from "node:test";
import { HubCoordinator } from "./worker.js";

test("a created thread retries delivery with its original permission and message id", async () => {
  const id = "00000000-0000-4000-8000-000000000004";
  const key = `manual-task:ada:${id}`;
  const actor = {id: "ada", label: "Ada"};
  const values = new Map<string, any>([["organizationId", "org"], [key, {
    phase: "creating", command: {actor, requestId: id, workspaceId: "workspace", message: "Fix login.", permissionMode: "acceptEdits"},
  }]]);
  const storage = {get: async (key: string) => values.get(key), put: async (key: string, value: unknown) => {values.set(key, value);}, list: async () => new Map(), getAlarm: async () => null, setAlarm: async () => {}};
  const pending: Promise<unknown>[] = [];
  const coordinator = new HubCoordinator({storage, blockConcurrencyWhile: async (work: () => Promise<unknown>) => work(), getWebSockets: () => [], waitUntil: (work: Promise<unknown>) => pending.push(work)} as unknown as DurableObjectState, {DB: {}} as never);
  const calls: {path: string; input: any}[] = [];
  let failDelivery = true;
  Object.assign(coordinator, {
    taskComputer: async () => ({computerId: "computer", workspaceId: "workspace"}),
    computers: {computer: async () => ({ownership: "hosted"})},
    threads: {snapshot: async () => {}},
    prepareNextComputer: async () => {}, invalidateComputers: () => {},
    dispatchComputer: async (_computer: string, _actor: unknown, _method: string, path: string, input: any) => {
      calls.push({path, input});
      if(path === "/hub/threads") return Response.json({id, revision: 0, access: {organizationId: "org", owner: actor, participants: [], visibility: "private"}, detail: {id, title: "Fix login.", entries: []}});
      return failDelivery ? Response.json({error: "Delivery interrupted"}, {status: 503}) : Response.json({ok: true});
    },
  });
  const finish = (coordinator as unknown as {finishManualThread(key: string): Promise<void>}).finishManualThread.bind(coordinator);
  await finish(key);
  assert.equal(values.get(key).phase, "failed");
  assert.equal(values.get(key).id, id);
  assert.equal(values.get(key).messageSent, undefined);
  failDelivery = false;
  const {error: _error, ...retryable} = values.get(key);
  values.set(key, {...retryable, phase: "sending"});
  await finish(key);
  await Promise.all(pending);
  assert.equal(values.get(key).phase, "ready");
  assert.equal(values.get(key).messageSent, true);
  assert.equal(calls.filter(call => call.path === "/hub/threads").length, 1);
  assert.equal(calls[0].input.permissionMode, "acceptEdits");
  assert.deepEqual(calls.filter(call => call.path.endsWith("/message")).map(call => call.input.messageId), [`u-${id}`, `u-${id}`]);
});

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
