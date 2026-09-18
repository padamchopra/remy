import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const hubRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const macPack = readFileSync(join(hubRoot, "../desktop/scripts/pack-mac.mjs"), "utf8");
const workflow = parse(readFileSync(join(hubRoot, "../.github/workflows/mac-pr.yml"), "utf8")) as {
  on: { pull_request: null | { paths?: string[] } };
  jobs: Record<
    string,
    {
      if?: string;
      name?: string;
      needs?: string | string[];
      "runs-on"?: string;
      steps?: Array<{ id?: string; if?: string; name?: string; run?: string }>;
    }
  >;
};
const releaseWorkflow = parse(readFileSync(join(hubRoot, "../.github/workflows/mac.yml"), "utf8")) as {
  on: { push: { paths: string[] } };
  jobs: Record<string, { steps?: Array<{ name?: string; uses?: string; run?: string; env?: Record<string, string> }> }>;
};
const testflightWorkflow = parse(readFileSync(join(hubRoot, "../.github/workflows/testflight.yml"), "utf8")) as {
  on: { push: { paths: string[] } };
};

test("the required Mac check reports on every pull request", () => {
  assert.ok("pull_request" in workflow.on);
  assert.equal(workflow.on.pull_request, null);
  assert.deepEqual(Object.keys(workflow.jobs), ["build"]);
  assert.equal(workflow.jobs.build?.name, "Build Mac app");
  assert.equal(workflow.jobs.build?.if, undefined);
});

test("the expensive package steps run only for relevant changes", () => {
  const steps = workflow.jobs.build?.steps ?? [];
  assert.equal(steps[1]?.id, "paths");
  assert.match(steps[1]?.run ?? "", /desktop\/\*\*/);
  assert.match(steps[1]?.run ?? "", /echo "build=false"/);
  const expensive = steps.filter((step) => step.if === "steps.paths.outputs.build == 'true'");
  assert.ok(expensive.some((step) => step.name === "Install"));
  assert.ok(expensive.some((step) => step.name === "Test update handoff"));
  assert.ok(expensive.some((step) => step.name === "Build unsigned app"));
  assert.ok(expensive.some((step) => step.run === "npm run pack:mac"));
});

test("main release workflows do not preflight unrelated changes", () => {
  assert.ok(releaseWorkflow.on.push.paths.includes("desktop/**"));
  assert.ok(!releaseWorkflow.on.push.paths.includes("hub/**"));
  assert.deepEqual(testflightWorkflow.on.push.paths, [
    "mobile/**",
    ".github/workflows/testflight.yml",
    ".github/actions/**",
    "!**/*.md",
  ]);
});

test("the Mac release imports its certificate before packaging", () => {
  const steps = releaseWorkflow.jobs.dmg?.steps ?? [];
  const certificate = steps.find((step) => step.name === "Import signing certificate");
  const identity = steps.find((step) => step.name === "Verify signing identity");
  const packageStep = steps.find((step) => step.name === "Build, sign, and notarize");
  assert.equal(certificate?.uses, "apple-actions/import-codesign-certs@v7");
  assert.equal(
    identity?.run,
    "security find-identity -v -p codesigning signing_temp.keychain | grep -q 'Developer ID Application:'",
  );
  assert.equal(packageStep?.env?.CSC_KEYCHAIN, "signing_temp.keychain");
  assert.equal(packageStep?.env?.CSC_LINK, undefined);
  assert.equal(packageStep?.env?.CSC_KEY_PASSWORD, undefined);
});

test("the Mac packager recognises an imported signing keychain", () => {
  assert.match(macPack, /process\.env\.CSC_LINK \|\| process\.env\.CSC_KEYCHAIN/);
});
