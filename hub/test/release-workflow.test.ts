import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const hubRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workflow = parse(readFileSync(join(hubRoot, "../.github/workflows/release-pr.yml"), "utf8")) as {
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
const releaseWorkflow = parse(readFileSync(join(hubRoot, "../.github/workflows/release.yml"), "utf8")) as {
  on: { push: { paths: string[] } };
  jobs: Record<string, { steps?: Array<{ id?: string; name?: string; uses?: string; run?: string; with?: Record<string, string>; env?: Record<string, string> }> }>;
};
const testflightWorkflow = parse(readFileSync(join(hubRoot, "../.github/workflows/testflight.yml"), "utf8")) as {
  on: { push: { paths: string[] } };
};

test("the required computer check reports on every pull request", () => {
  assert.ok("pull_request" in workflow.on);
  assert.equal(workflow.on.pull_request, null);
  assert.deepEqual(Object.keys(workflow.jobs), ["build"]);
  assert.equal(workflow.jobs.build?.name, "Build computer");
  assert.equal(workflow.jobs.build?.if, undefined);
});

test("the expensive steps run only for relevant changes", () => {
  const steps = workflow.jobs.build?.steps ?? [];
  assert.equal(steps[1]?.id, "paths");
  assert.match(steps[1]?.run ?? "", /server\/\*\*/);
  assert.match(steps[1]?.run ?? "", /echo "build=false"/);
  const expensive = steps.filter((step) => step.if === "steps.paths.outputs.build == 'true'");
  assert.ok(expensive.some((step) => step.name === "Install"));
  assert.ok(expensive.some((step) => step.name === "Test the daemon and the CLI"));
  assert.ok(expensive.some((step) => step.name === "Build the web app"));
});

test("main release workflows do not preflight unrelated changes", () => {
  assert.ok(releaseWorkflow.on.push.paths.includes("server/**"));
  assert.ok(!releaseWorkflow.on.push.paths.includes("hub/**"));
  assert.ok(!releaseWorkflow.on.push.paths.includes("desktop/**"));
  assert.deepEqual(testflightWorkflow.on.push.paths, [
    "mobile/**",
    ".github/workflows/testflight.yml",
    ".github/actions/**",
    "!**/*.md",
  ]);
});

test("a release publishes the computer image and its Linux archive", () => {
  const steps = releaseWorkflow.jobs.computer?.steps ?? [];
  const image = steps.find((step) => step.name === "Build and publish the computer image");
  const publish = steps.find((step) => step.uses?.startsWith("ncipollo/release-action"));
  assert.match(image?.run ?? "", /remy-computer:\$VERSION/);
  assert.match(image?.run ?? "", /remy-computer-linux\.tar\.gz/);
  assert.match(publish?.with?.artifacts ?? "", /remy-computer-linux\.tar\.gz/);
  assert.equal(steps.some((step) => step.run === "npm run pack:mac"), false);
});
