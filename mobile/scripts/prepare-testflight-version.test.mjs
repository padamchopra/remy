import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import {
  versionForTestFlightRun,
  withTestFlightVersion,
} from "./prepare-testflight-version.mjs";

test("uses the TestFlight workflow run number as the patch version", () => {
  assert.equal(versionForTestFlightRun("42"), "0.1.42");
});

test("stamps the Expo version without changing the remaining config", () => {
  const config = {
    expo: {
      name: "Remy",
      version: "1.0.0",
      ios: { bundleIdentifier: "me.padamchopra.remy" },
    },
  };

  assert.deepEqual(withTestFlightVersion(config, "7"), {
    expo: {
      name: "Remy",
      version: "0.1.7",
      ios: { bundleIdentifier: "me.padamchopra.remy" },
    },
  });
  assert.equal(config.expo.version, "1.0.0");
});

test("rejects a missing or invalid workflow run number", () => {
  for (const runNumber of [undefined, "", "0", "-1", "1.2", "run-2"]) {
    assert.throws(
      () => versionForTestFlightRun(runNumber),
      /must be a positive integer/,
    );
  }
});

test("requires an Expo app configuration", () => {
  assert.throws(
    () => withTestFlightVersion({}, "1"),
    /must contain an expo configuration/,
  );
});

test("the command stamps app.json for the workflow runner", () => {
  const fixtureDirectory = mkdtempSync(
    join(tmpdir(), "remy-testflight-version-"),
  );
  const scriptsDirectory = join(fixtureDirectory, "scripts");
  const scriptPath = join(scriptsDirectory, "prepare-testflight-version.mjs");
  const appConfigPath = join(fixtureDirectory, "app.json");

  try {
    mkdirSync(scriptsDirectory);
    cpSync(
      new URL("./prepare-testflight-version.mjs", import.meta.url),
      scriptPath,
    );
    writeFileSync(
      appConfigPath,
      `${JSON.stringify({ expo: { name: "Remy", version: "1.0.0" } })}\n`,
    );

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      env: { ...process.env, TESTFLIGHT_RUN_NUMBER: "42" },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /TestFlight version: 0\.1\.42/);
    assert.equal(
      JSON.parse(readFileSync(appConfigPath, "utf8")).expo.version,
      "0.1.42",
    );
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
});
