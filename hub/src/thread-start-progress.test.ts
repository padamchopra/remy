import test from "node:test";
import assert from "node:assert/strict";
import { threadStartProgress } from "./thread-start-progress.js";

test("hosted lifecycle phases map onto the start status the client shows", () => {
  assert.equal(threadStartProgress({}), "creating");
  assert.equal(threadStartProgress({ record: { phase: "creating" } }), "creating");
  assert.equal(threadStartProgress({ hostedPhase: "allocating" }), "waking");
  assert.equal(threadStartProgress({ hostedPhase: "restoring" }), "restoring");
  assert.equal(threadStartProgress({ hostedPhase: "starting_runtime" }), "starting_runtime");
  assert.equal(threadStartProgress({ hostedPhase: "connecting" }), "connecting");
  assert.equal(threadStartProgress({ hostedPhase: "ready" }), "connecting");
  assert.equal(threadStartProgress({ hostedPhase: "failed" }), "failed");
  assert.equal(threadStartProgress({ record: { phase: "preparing_branch" } }), "preparing_branch");
  assert.equal(
    threadStartProgress({ hostedPhase: "connecting", record: { phase: "preparing_branch" } }),
    "connecting",
  );
  assert.equal(
    threadStartProgress({ hostedPhase: "ready", record: { id: "thread", computerId: "computer" } }),
    "ready",
  );
  assert.equal(threadStartProgress({ record: { error: "Fly.io could not start." } }), "failed");
});
