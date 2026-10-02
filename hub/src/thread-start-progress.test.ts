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
  assert.equal(threadStartProgress({ hostedPhase: "ready" }), "preparing_branch");
  assert.equal(threadStartProgress({ hostedPhase: "failed" }), "failed");
  assert.equal(threadStartProgress({ record: { phase: "preparing_branch" } }), "preparing_branch");
  assert.equal(
    threadStartProgress({ hostedPhase: "connecting", record: { phase: "preparing_branch" } }),
    "preparing_branch",
  );
  assert.equal(threadStartProgress({ record: { id: "thread", computerId: "computer", phase: "sending" } }), "sending");
  assert.equal(
    threadStartProgress({ hostedPhase: "ready", record: { id: "thread", computerId: "computer", phase: "ready", messageSent: true } }),
    "ready",
  );
  assert.equal(threadStartProgress({ record: { error: "Fly.io could not start." } }), "failed");
});

test("retrying a start does not report the previous cloud failure", () => {
  assert.equal(threadStartProgress({hostedPhase:"failed",record:{phase:"creating"}}),"creating");
  assert.equal(threadStartProgress({hostedPhase:"starting_runtime",record:{phase:"creating"}}),"starting_runtime");
  assert.equal(threadStartProgress({hostedPhase:"failed",record:{phase:"failed",error:"New failure"}}),"failed");
});
