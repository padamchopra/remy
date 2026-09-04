import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_VERSION, parseHubHealth } from "@remy/contract";

import { createHandler, handleRequest, type Env } from "./worker.js";

const env = {
  DB: {} as D1Database,
  ENVIRONMENT: "staging",
  RELEASE: "0123456789abcdef",
} satisfies Env;

test("reports the deployed hub contract", async () => {
  const response = await handleRequest(new Request("https://hub.example/health"), env);

  assert.equal(response.status, 200);
  assert.deepEqual(parseHubHealth(await response.json()), {
    contractVersion: CONTRACT_VERSION,
    environment: "staging",
    release: "0123456789abcdef",
  });
});

test("returns JSON for an unknown route", async () => {
  const response = await handleRequest(new Request("https://hub.example/missing"), env);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not found" });
});

test("emits one correlated outcome for success and missing routes", async () => {
  const events: unknown[] = [];
  let now = 10;
  const handler = createHandler({
    log: (event) => events.push(event),
    now: () => now++,
    requestId: () => "generated-id",
  });

  const health = await handler(
    new Request("https://hub.example/health", { headers: { "x-request-id": "caller-id" } }),
    env,
  );
  const missing = await handler(new Request("https://hub.example/missing"), env);

  assert.equal(health.headers.get("x-request-id"), "caller-id");
  assert.equal(missing.headers.get("x-request-id"), "generated-id");
  assert.deepEqual(events, [
    {
      event: "request.outcome",
      environment: "staging",
      release: "0123456789abcdef",
      requestId: "caller-id",
      method: "GET",
      route: "/health",
      status: 200,
      durationMs: 1,
      outcome: "success",
    },
    {
      event: "request.outcome",
      environment: "staging",
      release: "0123456789abcdef",
      requestId: "generated-id",
      method: "GET",
      route: "/missing",
      status: 404,
      durationMs: 1,
      outcome: "success",
    },
  ]);
});

test("turns an uncaught failure into one redacted error outcome", async () => {
  const events: unknown[] = [];
  const handler = createHandler({
    log: (event) => events.push(event),
    now: () => 10,
    requestId: () => "error-id",
    route: async () => {
      throw new Error("secret credential");
    },
  });

  const response = await handler(new Request("https://hub.example/fail"), env);

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("x-request-id"), "error-id");
  assert.deepEqual(await response.json(), { error: "Internal server error" });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    event: "request.outcome",
    environment: "staging",
    release: "0123456789abcdef",
    requestId: "error-id",
    method: "GET",
    route: "/fail",
    status: 500,
    durationMs: 0,
    outcome: "error",
  });
  assert.doesNotMatch(JSON.stringify(events), /secret credential/);
});
