import assert from "node:assert/strict";
import test from "node:test";
import {
  PERFORMANCE_BUDGETS,
  budgetFailures,
  createFixture,
  groupRequests,
  percentile,
} from "./perf-fixture.mjs";

test("builds each required deterministic data size", () => {
  for (const entryCount of [10, 100, 500]) {
    const fixture = createFixture({ entryCount, threadCount: 25 });
    assert.equal(fixture.responses[`/chats/${fixture.primaryThreadId}`].entries.length, entryCount);
  }
  for (const threadCount of [25, 250]) {
    assert.equal(createFixture({ threadCount }).responses["/chats"].chats.length, threadCount);
  }
});

test("adds an unavailable device without changing the local catalogue", () => {
  const available = createFixture({ threadCount: 25 });
  const unavailable = createFixture({ threadCount: 25, unavailableDevice: true });
  assert.deepEqual(unavailable.responses["/chats"], available.responses["/chats"]);
  assert.equal(unavailable.responses["/peers"].peers.length, 1);
  assert.equal(unavailable.responses["/peers"].peers[0].online, false);
});

test("groups request count, elapsed time, and bytes by method and path", () => {
  assert.deepEqual(groupRequests([
    { method: "GET", path: "/chats", duration: 4, bytes: 100 },
    { method: "GET", path: "/chats", duration: 6, bytes: 120 },
    { method: "GET", path: "/board", duration: 3, bytes: 20 },
  ]), [
    { method: "GET", path: "/board", count: 1, durationMs: 3, bytes: 20 },
    { method: "GET", path: "/chats", count: 2, durationMs: 10, bytes: 220 },
  ]);
});

test("uses nearest-rank percentiles", () => {
  assert.equal(percentile([1, 2, 3, 4, 100], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 100], 95), 100);
});

test("passes results on the parent budgets and rejects regressions", () => {
  const passing = [
    { scenario: "cold-open", entryCount: 100, firstUsefulPaintMs: PERFORMANCE_BUDGETS.coldUsefulMs },
    { scenario: "warm-open", firstUsefulPaintMs: PERFORMANCE_BUDGETS.warmUsefulMs },
    { scenario: "cached-thread", firstUsefulPaintMs: PERFORMANCE_BUDGETS.cachedThreadMs },
    { scenario: "live-update", firstLivePaintP95Ms: PERFORMANCE_BUDGETS.livePaintP95Ms },
    { scenario: "reconnect", firstLivePaintP95Ms: PERFORMANCE_BUDGETS.livePaintP95Ms },
    { scenario: "sidebar", threadCount: 250, frameRate: PERFORMANCE_BUDGETS.minimumFrameRate },
    { scenario: "thread-scroll", entryCount: 500, frameRate: PERFORMANCE_BUDGETS.minimumFrameRate },
    { scenario: "idle", idleCpuPercent: PERFORMANCE_BUDGETS.idleCpuPercent },
    {
      scenario: "unavailable-device",
      firstUsefulPaintMs: PERFORMANCE_BUDGETS.coldUsefulMs,
      delayFromLocalMs: PERFORMANCE_BUDGETS.unavailableDelayMs,
    },
    { scenario: "shared-read-failure", usefulPreserved: true },
  ];
  assert.deepEqual(passing.flatMap((result) => budgetFailures(result)), []);

  assert.match(
    budgetFailures({ scenario: "live-update", firstLivePaintP95Ms: PERFORMANCE_BUDGETS.livePaintP95Ms + 1 })[0],
    /live update p95/,
  );
  assert.match(
    budgetFailures({ scenario: "idle", idleCpuPercent: PERFORMANCE_BUDGETS.idleCpuPercent + 0.1 })[0],
    /idle CPU/,
  );
  assert.match(
    budgetFailures({ scenario: "pane-devices", mutatingRequests: ["PATCH /server/identity"] })[0],
    /read-only guard/,
  );
  assert.match(
    budgetFailures({ scenario: "shared-read-failure", usefulPreserved: false })[0],
    /removed useful board state/,
  );
});

test("allows each shared resource once on every primary pane", () => {
  const requests = [
    { method: "GET", path: "/server/providers", count: 1 },
    { method: "GET", path: "/server/settings", count: 1 },
    { method: "GET", path: "/board", count: 1 },
    { method: "GET", path: "/pair/pending", count: 1 },
    { method: "GET", path: "/server/identity", count: 1 },
  ];
  for (const pane of ["threads", "workspaces", "tasks", "pull-requests", "devices"]) {
    assert.deepEqual(budgetFailures({ scenario: `pane-${pane}`, requests }), []);
  }

  assert.match(
    budgetFailures({
      scenario: "pane-devices",
      requests: [{ method: "GET", path: "/server/settings", count: 2 }],
    })[0],
    /shared read \/server\/settings/,
  );
  assert.match(
    budgetFailures({ scenario: "pane-threads", requests: [] })[0],
    /Threads provider catalogue/,
  );
});
