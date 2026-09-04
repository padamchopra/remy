import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_VERSION, parseHubHealth } from "@remy/contract";

import { handleRequest, type Env } from "./worker.js";

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
