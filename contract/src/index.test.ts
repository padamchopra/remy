import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_VERSION, computerHeartbeatSchema, parseHubHealth, uptimeCheckFrameSchema } from "./index.js";

test("accepts a compatible hub health response", () => {
  const health = parseHubHealth({
    contractVersion: CONTRACT_VERSION,
    environment: "staging",
    release: "0123456789abcdef",
    status: "ok",
    dependencies: {
      database: "ready",
      coordinator: "ready",
      objectStore: "ready",
      queue: "ready",
      secrets: "ready",
    },
  });

  assert.equal(health.environment, "staging");
});

test("validates shared computer and uptime frames", () => {
  assert.equal(computerHeartbeatSchema.parse({
    computerId: "computer-1",
    availability: "available",
    observedAt: "2026-09-04T12:00:00.000Z",
  }).computerId, "computer-1");
  assert.equal(uptimeCheckFrameSchema.parse({
    contractVersion: CONTRACT_VERSION,
    kind: "uptime.check",
    checkedAt: "2026-09-04T12:00:00.000Z",
    environment: "production",
    release: "abc",
    status: "ok",
    statusCode: 200,
  }).status, "ok");
});

test("rejects incompatible hub health responses", () => {
  assert.throws(
    () => parseHubHealth({ contractVersion: "2", environment: "staging", release: "abc" }),
    /incompatible/,
  );
  assert.throws(
    () => parseHubHealth({ contractVersion: CONTRACT_VERSION, environment: "preview", release: "abc" }),
    /incompatible/,
  );
  assert.throws(
    () => parseHubHealth({ contractVersion: CONTRACT_VERSION, environment: "production", release: "" }),
    /incompatible/,
  );
});
