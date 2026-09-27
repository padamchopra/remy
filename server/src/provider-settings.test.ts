import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const stateDir = mkdtempSync(join(tmpdir(), "remy-provider-settings-"));
process.env.MC_CONFIG_DIR = stateDir;
process.env.HOME = stateDir;

const { patchSettings } = await import("./config.js");
const { setProviderEnabled } = await import("./provider-settings.js");

test("disabled provider overrides return to Remy's default", () => {
  patchSettings({ remyProvider: "cursor", remyModel: "auto" });

  const settings = setProviderEnabled("cursor", false);

  assert.equal(settings.defaultProvider, "claude");
  assert.equal(settings.remyProvider, "claude");
});
