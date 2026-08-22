import assert from "node:assert/strict";
import test from "node:test";
import { prepareSubmitConfig } from "./prepare-eas-submit.mjs";

test("adds the App Store Connect app to the TestFlight submit profile", () => {
  const config = { submit: { testflight: { ios: {} } } };
  const prepared = prepareSubmitConfig(config, "1234567890");

  assert.equal(prepared.submit.testflight.ios.ascAppId, "1234567890");
  assert.equal(config.submit.testflight.ios.ascAppId, undefined);
});

test("rejects a malformed App Store Connect app id", () => {
  assert.throws(() => prepareSubmitConfig({}, "not-an-id"), /numeric Apple ID/);
});
