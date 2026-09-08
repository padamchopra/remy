import test from "node:test";
import assert from "node:assert/strict";
import { hostedSettingsSchema } from "@remy/contract";
import { HostedLifecycle } from "./hosted-lifecycle.js";
import type { BoardStorage } from "./organization-board.js";
import type { ComputerRuntimeProvider } from "./computer-runtime.js";
function fixture() {
  const values = new Map<string, unknown>();
  let now = 1000,
    allocations = 0,
    restores = 0,
    checkpoints = 0;
  let connected = true;
  const storage = {
    delete: async (key: string) => { values.delete(key); },
    get: async (key: string) => structuredClone(values.get(key)),
    put: async (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
    },
    list: async ({ prefix }: { prefix: string }) =>
      new Map(
        [...values]
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => [k, structuredClone(v)]),
      ),
  } as BoardStorage;
  const provider: ComputerRuntimeProvider = {
    id: "modal",
    capabilities: { checkpoints: true, persistentFilesystem: true },
    provision: async (input) => {
      allocations++;
      await new Promise((r) => setTimeout(r, 5));
      return {
        id: input.computerId,
        provider: "modal",
        providerReference: "sb-test",
      };
    },
    start: async (runtime) => {
      restores++;
      return runtime;
    },
    stop: async () => {},
    checkpoint: async (runtime) => {
      checkpoints++;
      return { ...runtime, snapshot: "im-test", snapshotBytes: 1024 };
    },
    destroy: async () => {},
  };
  const prepare = async (
    state: Awaited<ReturnType<HostedLifecycle["get"]>>,
  ) => ({
    organizationId: "org",
    computerId: state!.computerId,
    settings: state!.settings,
    image: "image",
    archive: "archive",
    environment: {},
    allowedDomains: [],
  });
  const create = () =>
    new HostedLifecycle(
      storage,
      () => provider,
      prepare,
      async () => {},
      () => now,
      () => connected,
    );
  return {
    create,
    disconnect: () => { connected = false; },
    provider,
    tick: (ms: number) => {
      now += ms;
    },
    counts: () => ({ allocations, restores, checkpoints }),
  };
}
const settings = hostedSettingsSchema.parse({
  enabled: true,
  provider: "modal",
});
test("concurrent triggers reuse one warm computer across lifecycle reconstruction", async () => {
  const f = fixture(),
    life = f.create();
  const states = await Promise.all(
    Array.from({ length: 10 }, () => life.ensure("w", settings)),
  );
  assert.equal(new Set(states.map((s) => s.computerId)).size, 1);
  assert.equal(f.counts().allocations, 1);
  await f.create().ensure("w", settings);
  assert.equal(f.counts().allocations, 1);
});
test("active work stays warm and idle checkpoint preserves identity and metering", async () => {
  const f = fixture(),
    life = f.create(),
    initial = await life.ensure("w", settings);
  await life.activity(initial.computerId, true);
  f.tick(20 * 60_000);
  await life.idle();
  assert.equal(f.counts().checkpoints, 0);
  await life.activity(initial.computerId, false);
  f.tick(12 * 60_000);
  await life.idle();
  const asleep = (await life.get("w"))!;
  assert.equal(asleep.phase, "asleep");
  assert.equal(asleep.usage.activeMs, 20 * 60_000);
  assert.equal(asleep.usage.warmIdleMs, 12 * 60_000);
  f.tick(1000);
  const restored = await f.create().ensure("w", settings);
  assert.equal(restored.computerId, initial.computerId);
  assert.equal(restored.usage.snapshotByteMs, 1024 * 1000);
  assert.equal(f.counts().restores, 1);
});
test("failed checkpoint stays visible and a waiting wake retries after it", async () => {
  const f = fixture(),
    life = f.create();
  await life.ensure("w", settings);
  f.tick(13 * 60_000);
  f.provider.checkpoint = async () => {
    throw Error("vendor response containing secret must not escape");
  };
  await life.idle();
  assert.equal((await life.get("w"))?.phase, "failed");
  assert.ok(!(await life.get("w"))?.error?.includes("secret"));
  await life.ensure("w", settings);
  assert.equal((await life.get("w"))?.phase, "ready");
});
test("disabled workspaces never allocate and provider changes cannot silently lose storage", async () => {
  const f = fixture(),
    life = f.create();
  await assert.rejects(life.ensure("w", { ...settings, enabled: false }));
  assert.equal(f.counts().allocations, 0);
  await life.ensure("w", settings);
  f.tick(13 * 60_000);
  await life.idle();
  await assert.rejects(
    life.ensure("w", { ...settings, provider: "fly-sprites" }),
  );
});

test("a disconnected ready computer restarts and deletion waits for a wake", async () => {
 const f = fixture(), life = f.create();
 const first = await life.ensure("w", settings); f.disconnect();
 await life.ensure("w", settings); assert.equal(f.counts().restores, 1);
 await Promise.all([life.ensure("w", settings), life.remove(first.computerId)]);
 assert.equal(await life.get("w"), undefined);
});
