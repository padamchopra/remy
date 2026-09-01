import assert from "node:assert/strict";
import test from "node:test";
import {
  invalidateSharedResource,
  readSharedResource,
  resetSharedResources,
  seedSharedResource,
} from "../src/lib/shared-read.ts";

test.beforeEach(() => resetSharedResources());

test("shares one concurrent read and clears it after success", async () => {
  let reads = 0;
  let finish;
  const source = () => {
    reads += 1;
    return new Promise((resolve) => { finish = resolve; });
  };

  const first = readSharedResource("providers", "local", source);
  const second = readSharedResource("providers", "local", source);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(reads, 1);
  finish({ version: 1 });
  assert.deepEqual(await first, { version: 1 });

  invalidateSharedResource("providers", "local");
  assert.deepEqual(await readSharedResource("providers", "local", async () => ({ version: ++reads })), { version: 2 });
});

test("clears a failed read so the next consumer can retry", async () => {
  let reads = 0;
  const source = async () => {
    reads += 1;
    if (reads === 1) throw new Error("offline");
    return "ready";
  };

  const first = readSharedResource("identity", "local", source);
  const second = readSharedResource("identity", "local", source);
  assert.equal(first, second);
  await assert.rejects(first, /offline/);
  assert.equal(await readSharedResource("identity", "local", source), "ready");
  assert.equal(reads, 2);
});

test("a failed refresh does not block the next fresh read", async () => {
  seedSharedResource("settings", "local", { theme: "known" });
  invalidateSharedResource("settings", "local");
  await assert.rejects(
    readSharedResource("settings", "local", async () => { throw new Error("offline"); }),
    /offline/,
  );

  let reads = 0;
  assert.deepEqual(
    await readSharedResource("settings", "local", async () => {
      reads += 1;
      return { theme: "fresh" };
    }),
    { theme: "fresh" },
  );
  assert.equal(reads, 1);
});

test("uses the explicit freshness window and reads again after it expires", async () => {
  let time = 1_000;
  let reads = 0;
  const source = async () => ++reads;
  const options = { now: () => time };

  assert.equal(await readSharedResource("board", "local", source, options), 1);
  time = 1_999;
  assert.equal(await readSharedResource("board", "local", source, options), 1);
  time = 2_000;
  assert.equal(await readSharedResource("board", "local", source, options), 2);
});

test("does not let a read from before invalidation replace the next revision", async () => {
  let finishStale;
  let active = 0;
  let mostActive = 0;
  const stale = readSharedResource("pairing", "local", () => {
    active += 1;
    mostActive = Math.max(mostActive, active);
    return new Promise((resolve) => {
      finishStale = (value) => {
        active -= 1;
        resolve(value);
      };
    });
  });
  invalidateSharedResource("pairing", "local");
  const fresh = readSharedResource("pairing", "local", async () => {
    active += 1;
    mostActive = Math.max(mostActive, active);
    active -= 1;
    return "fresh";
  });
  const alsoFresh = readSharedResource("pairing", "local", async () => "duplicate");
  assert.equal(fresh, alsoFresh);
  await Promise.resolve();
  assert.equal(active, 1);
  finishStale("stale");

  assert.equal(await stale, "stale");
  assert.equal(await fresh, "fresh");
  assert.equal(await readSharedResource("pairing", "local", async () => "unexpected"), "fresh");
  assert.equal(mostActive, 1);
});
