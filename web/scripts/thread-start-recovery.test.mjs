import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const result = await build({entryPoints: [new URL("../src/lib/thread-start-recovery.ts", import.meta.url).pathname], bundle: true, write: false, platform: "node", format: "esm"});
const { recoverThreadStartRequest } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
test("a transient startup 500 recovers without losing the pending operation", async () => {
  let calls = 0;
  const delays = [];
  const result = await recoverThreadStartRequest(async () => {
    if (++calls === 1) throw {status: 500};
    return {phase: "sending"};
  }, () => true, async ms => {delays.push(ms);});
  assert.deepEqual(result, {phase: "sending"});
  assert.deepEqual(delays, [400]);
});
test("a real startup failure remains visible and does not loop", async () => {
  let calls = 0;
  await assert.rejects(recoverThreadStartRequest(async () => {calls++; throw Object.assign(new Error("Cannot start"), {status: 409});}, () => true), /Cannot start/);
  assert.equal(calls, 1);
});
test("persistent server errors have a bounded retry and cancellation stops reads", async () => {
  let calls = 0;
  await assert.rejects(recoverThreadStartRequest(async () => {calls++; throw Object.assign(new Error("Unavailable"), {status: 503});}, () => true, async () => {}), /Unavailable/);
  assert.equal(calls, 4);
  assert.equal(await recoverThreadStartRequest(async () => assert.fail("cancelled"), () => false), undefined);
});
