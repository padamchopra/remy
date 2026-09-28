import test from "node:test";
import assert from "node:assert/strict";
import { hostedSettingsSchema } from "@remy/contract";
import { HostedLifecycle } from "./hosted-lifecycle.js";
import { hostedComputerName } from "./hosted-computer-name.js";
import type { KeyValueStorage } from "./durable-storage.js";
import type { ComputerRuntimeProvider } from "./computer-runtime.js";
function fixture() {
  const values = new Map<string, unknown>();
  let now = 1000,
    allocations = 0,
    restores = 0,
    checkpoints = 0;
  let connected = true;
  const phases: string[] = [];
  const storage = {
    delete: async (key: string) => {
      values.delete(key);
    },
    get: async (key: string) => structuredClone(values.get(key)),
    put: async (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
      if (value && typeof value === "object" && "phase" in value && typeof (value as {phase?: unknown}).phase === "string") {
        phases.push((value as {phase: string}).phase);
      }
    },
    list: async ({ prefix }: { prefix: string }) =>
      new Map(
        [...values]
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => [k, structuredClone(v)]),
      ),
  } as unknown as KeyValueStorage;
  storage.transaction = async action => action(storage);
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
        startedAt: now,
      };
    },
    start: async (runtime) => {
      restores++;
      return { ...runtime, startedAt: now };
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
    disconnect: () => {
      connected = false;
    },
    provider,
    tick: (ms: number) => {
      now += ms;
    },
    counts: () => ({ allocations, restores, checkpoints }),
    phases: () => phases,
  };
}
const settings = hostedSettingsSchema.parse({
  enabled: true,
  provider: "modal",
});
test("a prepared spare is claimed once and starts without allocating another computer", async () => {
  const f = fixture(), life = f.create();
  await life.prepareSpare("w", settings, "spare:owner-and-image");
  const spare = await life.get("w", "spare:owner-and-image");
  const results = await Promise.all(["one", "two"].map(task => life.claimSpare("w", settings, "spare:owner-and-image", task)));
  assert.deepEqual(results, [true, false]);
  const claimed = await life.ensure("w", settings, "one");
  assert.equal(claimed.computerId, spare!.computerId);
  assert.equal(claimed.taskId, "one");
  assert.equal(await life.get("w", "spare:owner-and-image"), undefined);
  assert.deepEqual(f.counts(), {allocations: 1, restores: 1, checkpoints: 0});
});
test("spares are bounded and cannot cross workspace, settings, owner or expiry", async () => {
  const f = fixture(), life = f.create();
  await life.prepareSpare("w", settings, "spare:owner");
  await life.prepareSpare("other", settings, "spare:other");
  assert.equal(f.counts().allocations, 1);
  assert.equal(await life.claimSpare("other", settings, "spare:owner", "one"), false);
  assert.equal(await life.claimSpare("w", settings, "spare:other", "one"), false);
  assert.equal(await life.claimSpare("w", {...settings, cpu: settings.cpu + 1}, "spare:owner", "one"), false);
  f.tick(15 * 60_000);
  assert.equal(await life.claimSpare("w", settings, "spare:owner", "one"), false);
  await life.idle();
  assert.equal((await life.list()).length, 0);
});
test("preparing a spare does not hold up a foreground allocation", {timeout: 1000}, async () => {
  const f = fixture(), life = f.create();
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  const provision = f.provider.provision;
  let calls = 0;
  f.provider.provision = async input => {
    if (++calls === 1) { started(); await waiting; }
    return provision(input);
  };
  const warming = life.prepareSpare("w", settings, "spare:owner");
  await entered;
  try {
    const foreground = await life.ensure("other", settings, "foreground");
    assert.equal(foreground.phase, "ready");
  } finally { release(); await warming; }
});
test("hosted computer names keep their suffix within the registration limit", () => {
  const computerId = "b14a5df3-4a34-438f-9a32-d1828f474ba8";
  const title = "A".repeat(120);
  const name = hostedComputerName("Remy", computerId, { title });
  assert.equal(name.length, 120);
  assert.match(name, / · b14a5d$/);
  assert.equal(hostedComputerName("W".repeat(120), computerId).length, 120);
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

test("wake records allocating, starting runtime, and connecting before ready", async () => {
  const f = fixture(),
    life = f.create();
  await life.ensure("w", settings);
  assert.deepEqual(
    [...new Set(f.phases())],
    ["allocating", "starting_runtime", "connecting", "ready"],
  );
  f.tick(13 * 60_000);
  await life.idle();
  assert.equal((await life.get("w"))?.phase, "asleep");
  f.phases().length = 0;
  await f.create().ensure("w", settings);
  assert.ok(f.phases().includes("restoring"));
  assert.ok(f.phases().includes("starting_runtime"));
  assert.ok(f.phases().includes("connecting"));
  assert.equal((await f.create().get("w"))?.phase, "ready");
});

test("a disconnected ready computer restarts and deletion waits for a wake", async () => {
  const f = fixture(),
    life = f.create();
  const first = await life.ensure("w", settings);
  f.disconnect();
  await life.ensure("w", settings);
  assert.equal(f.counts().restores, 1);
  await Promise.all([
    life.ensure("w", settings),
    life.remove(first.computerId),
  ]);
  assert.equal(await life.get("w"), undefined);
});

test("Modal rotates before expiry even during active work and preserves computer identity", async () => {
  const f = fixture(),
    life = f.create();
  const first = await life.ensure("w", settings);
  await life.activity(first.computerId, true);
  f.tick(23 * 60 * 60_000);
  await Promise.all([life.idle(), life.ensure("w", settings)]);
  const after = (await life.get("w"))!;
  assert.equal(after.computerId, first.computerId);
  assert.equal(after.phase, "ready");
  assert.deepEqual(f.counts(), { allocations: 1, checkpoints: 1, restores: 1 });
  await f.create().idle();
  assert.equal(f.counts().checkpoints, 1);
});

test("tasks in one workspace get separate computers and respect the concurrency limit", async()=>{
  const f=fixture(), life=f.create();
  const limited={...settings,maxComputers:2};
  const [a,b]=await Promise.all([life.ensure("w",limited,"task-a"),life.ensure("w",limited,"task-b")]);
  assert.notEqual(a.computerId,b.computerId);
  assert.equal((await life.ensure("w",limited,"task-a")).computerId,a.computerId);
  await assert.rejects(life.ensure("w",limited,"task-c"),/concurrency limit/);
  f.tick(20*60_000);await life.idle();
  await life.ensure("w",limited,"task-c");
  const resumed=await f.create().ensure("w",limited,"task-a");
  assert.equal(resumed.computerId,a.computerId);
  assert.ok(resumed.runtime?.snapshot);
  await life.remove(b.computerId);
  assert.equal(await life.get("w","task-b"),undefined);
  assert.ok(await life.get("w","task-a"));
  await assert.rejects(life.ensure("another",limited,"task-a"),/another workspace/);
});
