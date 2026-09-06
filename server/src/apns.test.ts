import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const stateDir = mkdtempSync(join(tmpdir(), "remy-apns-test-"));
process.env.MC_CONFIG_DIR = stateDir;
process.env.HOME = stateDir;

const { apnsDeviceToken, apnsHost, apnsJwt, apnsPayload, setApnsCredentialsForTest } = await import("./apns.js");

function pem(): string {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

test("accepts a native Apple device token and rejects junk", () => {
  const token = "a".repeat(64);
  assert.equal(apnsDeviceToken(token), token);
  assert.equal(apnsDeviceToken(token.toUpperCase()), token);
  assert.equal(apnsDeviceToken("not-a-token"), undefined);
  assert.equal(apnsDeviceToken("gg".repeat(32)), undefined);
  assert.equal(apnsDeviceToken(""), undefined);
});

test("sandbox and production hosts are the ones Apple documents", () => {
  assert.equal(apnsHost(false), "https://api.sandbox.push.apple.com");
  assert.equal(apnsHost(true), "https://api.push.apple.com");
});

test("payload carries the alert and the remy deep link", () => {
  const body = apnsPayload({
    token: "a".repeat(64),
    title: "Needs you",
    body: "A thread is waiting.",
    click: "remy://chat/abc",
    session: "abc",
    deviceId: "computer-1",
    highPriority: true,
  });
  assert.deepEqual(body.aps, {
    alert: { title: "Needs you", body: "A thread is waiting." },
    sound: "default",
    "thread-id": "abc",
  });
  assert.equal(body.click, "remy://chat/abc");
  assert.equal(body.session, "abc");
  assert.equal(body.deviceId, "computer-1");
});

test("JWT is ES256, named by the key, and issued by the team", () => {
  const creds = {
    keyId: "ABCDE12345",
    teamId: "TEAM12ID34",
    bundleId: "me.padamchopra.remy",
    key: pem(),
    production: false,
  };
  setApnsCredentialsForTest(creds);
  const token = apnsJwt(creds, 1_700_000_000);
  const [header, claims, signature] = token.split(".");
  assert.ok(header && claims && signature);
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "ES256", kid: "ABCDE12345" });
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url").toString()), { iss: "TEAM12ID34", iat: 1_700_000_000 });
  // IEEE P1363 for P-256 is 64 bytes. DER would be longer and variable.
  assert.equal(Buffer.from(signature, "base64url").length, 64);
});
