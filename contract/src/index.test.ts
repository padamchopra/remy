import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_VERSION, parseHubHealth } from "./index.js";

test("accepts a compatible hub health response", () => {
  const health = parseHubHealth({
    contractVersion: CONTRACT_VERSION,
    environment: "staging",
    release: "0123456789abcdef",
  });

  assert.equal(health.environment, "staging");
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
