import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const hubRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workflow = parse(readFileSync(join(hubRoot, "../.github/workflows/web.yml"), "utf8")) as {
  on: { pull_request?: { paths?: string[] }; push?: { branches?: string[]; paths?: string[] } };
  jobs: Record<
    string,
    {
      environment?: string;
      env?: Record<string, string>;
      if?: string;
      needs?: string;
      steps: Array<{ env?: Record<string, string>; run?: string; uses?: string }>;
    }
  >;
};

test("web workflow validates hub and website checks together", () => {
  assert.ok(workflow.on.pull_request);
  assert.deepEqual(workflow.on.push?.branches, ["main"]);
  assert.deepEqual(Object.keys(workflow.jobs), ["validate"]);
  const paths = new Set([
    ...(workflow.on.pull_request?.paths ?? []),
    ...(workflow.on.push?.paths ?? []),
  ]);
  for (const path of [".github/workflows/web.yml", "contract/**", "hub/**", "web/**", "package.json"]) {
    assert.ok(paths.has(path), path);
  }
  const validateCommands = workflow.jobs.validate?.steps.flatMap((step) => (step.run ? [step.run] : []));
  assert.ok(validateCommands?.some(command => command.includes("hub-website-check.mjs")));
  assert.ok(validateCommands?.some(command => command.includes("hosted-runtime-check.mjs")));
  assert.ok(validateCommands?.some(command => command.includes("qa-hosted-account.test.mjs")));
  assert.ok(validateCommands?.some(command => command.includes("website-check.mjs")));
  assert.ok(validateCommands?.some(command => command.includes("website-performance.mjs")));
  assert.ok(workflow.jobs.validate?.steps.some((step) => step.uses === "actions/upload-artifact@v4"));
  assert.deepEqual(validateCommands?.filter((command) => (
    !command.includes("hub-website-check.mjs")
    && !command.includes("website-check.mjs")
    && !command.includes("playwright-core install")
  )), [
    "npm ci --prefix contract --no-audit --no-fund",
    "npm ci --prefix hub --no-audit --no-fund",
    "npm ci --prefix web --no-audit --no-fund",
    "npm ci --prefix hub/runtime --no-audit --no-fund",
    "npm run build:hub --prefix web",
    "node hub/scripts/check-runtime-bundle.mjs",
    "npm test --prefix contract",
    "npm run typecheck --prefix contract",
    "npm test --prefix hub",
    "npm run typecheck --prefix hub",
    "npm run test --prefix hub/runtime",
    "npm run typecheck --prefix hub/runtime",
  ]);
});
