import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Every module here opens the shared database at import time, so the suite runs
// against a throwaway directory. node:test gives each file its own process, so
// this override cannot leak sideways.
const stateDir = mkdtempSync(join(tmpdir(), "mc-pairing-"));
process.env.MC_CONFIG_DIR = stateDir;

const config = await import("./config.js");
const log = await import("./board-log.js");
const pairing = await import("./pairing.js");

const THEM = "aaaaaaaa-1111-2222-3333-444444444444";

function ask(overrides: Record<string, unknown> = {}) {
  return pairing.askToPair({
    deviceId: THEM,
    name: "Studio Mac",
    url: "https://studio.example.ts.net",
    code: "418902",
    ...overrides,
  });
}

/// The caps are process-wide on purpose, so each test starts from nothing
/// rather than inheriting the previous one's flood.
function reset() {
  pairing.resetPairing();
}

// ── asking ──────────────────────────────────────────────────────────────────

test("asking to pair discloses nothing but an id", () => {
  reset();
  const asked = ask();

  assert.equal(Object.keys(asked).length, 1, "an id and nothing else");
  assert.ok(asked.requestId.length >= 32, "unguessable enough to be the capability");
});

test("a request waits on a person, and carries the code they compare", () => {
  reset();
  const { requestId } = ask({ icon: "monitor", tint: "violet" });

  const [waiting] = pairing.pendingPairRequests();
  assert.equal(waiting.id, requestId);
  assert.equal(waiting.code, "418902");
  assert.equal(waiting.fromName, "Studio Mac");
  assert.equal(waiting.fromUrl, "https://studio.example.ts.net");
  assert.equal(waiting.fromIcon, "monitor");
  assert.equal(waiting.fromTint, "violet");
  assert.equal(pairing.pairStatus(requestId).state, "pending");
});

test("nothing crosses before a person approves", () => {
  reset();
  const { requestId } = ask();

  const answer = pairing.pairStatus(requestId);
  assert.equal(answer.state, "pending");
  assert.equal(answer.token, undefined, "the token is the thing being protected");
  assert.equal(answer.name, undefined, "not even the name of this machine");
});

test("a request without a usable code or address is refused", () => {
  reset();
  assert.throws(() => ask({ code: "12345" }), /code/, "five digits is not a code");
  assert.throws(() => ask({ code: "abcdef" }), /code/);
  assert.throws(() => ask({ url: "file:///etc/passwd" }), /http/);
  assert.throws(() => ask({ deviceId: "" }), /which machine/);
  assert.equal(pairing.pendingPairRequests().length, 0, "none of them landed");
});

test("this machine will not pair with itself", () => {
  reset();
  assert.throws(() => ask({ deviceId: log.deviceId }), /this machine/);
});

test("one machine asking twice replaces its own request", () => {
  reset();
  const first = ask({ code: "111111" });
  const second = ask({ code: "222222" });

  const waiting = pairing.pendingPairRequests();
  assert.equal(waiting.length, 1, "not two prompts for one machine");
  assert.equal(waiting[0].id, second.requestId);
  assert.equal(waiting[0].code, "222222");
  assert.equal(pairing.pairStatus(first.requestId).state, "expired", "the first is gone");
});

test("a flood cannot bury a real request", () => {
  reset();
  // Each distinct machine gets its own prompt, up to the cap.
  for (let i = 0; i < 5; i += 1) {
    pairing.askToPair({
      deviceId: `machine-${i}`,
      name: `Machine ${i}`,
      url: `https://m${i}.example.ts.net`,
      code: "418902",
    });
  }
  assert.equal(pairing.pendingPairRequests().length, 5);
  // Either cap is a refusal, and both are the point: five prompts already
  // wait, and ten asks have landed inside the minute.
  assert.throws(() => ask({ deviceId: "machine-overflow" }), /too many/, "capped");
  reset();
});

test("the per-minute cap holds even when nothing is left waiting", () => {
  reset();
  for (let i = 0; i < 5; i += 1) {
    const asked = pairing.askToPair({
      deviceId: `burst-${i}`,
      name: `Burst ${i}`,
      url: `https://b${i}.example.ts.net`,
      code: "418902",
    });
    // Answered immediately, so the pending cap is never what stops the next one.
    pairing.denyPair(asked.requestId);
  }
  assert.equal(pairing.pendingPairRequests().length, 0, "nothing waiting");
  for (let i = 5; i < 10; i += 1) {
    const asked = pairing.askToPair({
      deviceId: `burst-${i}`,
      name: `Burst ${i}`,
      url: `https://b${i}.example.ts.net`,
      code: "418902",
    });
    pairing.denyPair(asked.requestId);
  }
  assert.throws(() => ask({ deviceId: "burst-overflow" }), /just now/, "the minute is spent");
  reset();
});

// ── answering ───────────────────────────────────────────────────────────────

test("approving hands over the token exactly once", () => {
  reset();
  config.patchSettings({ deviceName: "The Studio", deviceIcon: "monitor", deviceTint: "violet" });
  const { requestId } = ask();
  pairing.approvePair(requestId, "https://me.example.ts.net");

  const first = pairing.pairStatus(requestId);
  assert.equal(first.state, "approved");
  assert.equal(first.token, config.config.token, "their way in, now that you said yes");
  assert.equal(first.deviceId, log.deviceId);
  assert.equal(first.url, "https://me.example.ts.net");
  assert.equal(first.name, "The Studio");
  assert.equal(first.icon, "monitor");
  assert.equal(first.tint, "violet");

  const second = pairing.pairStatus(requestId);
  assert.equal(second.state, "expired", "single use");
  assert.equal(second.token, undefined);
  config.patchSettings({ deviceName: "", deviceIcon: "", deviceTint: "" });
});

test("denying closes the request without a token", () => {
  reset();
  const { requestId } = ask();
  pairing.denyPair(requestId);

  const answer = pairing.pairStatus(requestId);
  assert.equal(answer.state, "denied");
  assert.equal(answer.token, undefined);
  assert.equal(pairing.pendingPairRequests().length, 0);
});

test("a request cannot be approved twice, or after a denial", () => {
  reset();
  const { requestId } = ask();
  pairing.approvePair(requestId, "https://me.example.ts.net");
  assert.throws(() => pairing.approvePair(requestId, "https://me.example.ts.net"), /no longer waiting/);

  reset();
  const second = ask({ deviceId: "another-machine" });
  pairing.denyPair(second.requestId);
  assert.throws(() => pairing.approvePair(second.requestId, "https://me.example.ts.net"), /no longer waiting/);
});

test("an id nobody minted gets nothing", () => {
  reset();
  const answer = pairing.pairStatus("not-an-id-anyone-issued");
  assert.equal(answer.state, "expired");
  assert.equal(answer.token, undefined);
});

test("a code is read in two groups of three", () => {
  assert.equal(pairing.formatCode("418902"), "418 902");
});

// ── the asking side ─────────────────────────────────────────────────────────

test("this machine will not ask until something can reach it back", async () => {
  await assert.rejects(
    pairing.startPairing({ url: "https://studio.example.ts.net", self: { url: "", name: "Mine" } }),
    /Reachable/,
    "a pairing it cannot be answered on is not worth starting",
  );
});

test("checking a pairing nobody started is refused", async () => {
  await assert.rejects(
    pairing.checkPairing("no-such-attempt", async () => ({ id: "x" })),
    /no longer waiting/,
  );
});

test("an immediately approved request completes once without exposing credentials to the client", async (t) => {
  reset();
  let collected = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/pair/request")) return new Response(JSON.stringify({ requestId: "private-claim" }));
    assert.ok(url.endsWith("/pair/status?id=private-claim"));
    assert.equal(collected, false);
    collected = true;
    return new Response(JSON.stringify({ state: "approved", token: "temporary-peer-token", deviceId: THEM, name: "Studio Mac" }));
  });
  const started = await pairing.startPairing({ url: "https://studio.example.ts.net", self: { url: "https://mine.example.ts.net", name: "Mine" } });
  let completions = 0;
  const complete = async (claim: { token: string; deviceId: string; url: string }) => {
    completions++;
    assert.equal(claim.token, "temporary-peer-token");
    assert.equal(claim.deviceId, THEM);
    assert.equal(claim.url, "https://studio.example.ts.net");
    return { id: THEM };
  };
  const finished = await pairing.checkPairing(started.id, complete);
  assert.equal(finished.state, "approved");
  assert.equal(finished.peerId, THEM);
  assert.equal(JSON.stringify(finished).includes("temporary-peer-token"), false);
  assert.equal(JSON.stringify(finished).includes("private-claim"), false);
  assert.deepEqual(await pairing.checkPairing(started.id, complete), finished);
  assert.equal(completions, 1);
});
