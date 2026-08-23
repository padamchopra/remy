import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const appConfig = JSON.parse(
  readFileSync(new URL("../app.json", import.meta.url), "utf8"),
);

test("declares exempt-only encryption for iOS builds", () => {
  assert.equal(appConfig.expo.ios.config.usesNonExemptEncryption, false);
});
