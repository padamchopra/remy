import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const hubRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workflow = parse(readFileSync(join(hubRoot, "../.github/workflows/hub.yml"), "utf8")) as {
  on: Record<string, unknown>;
  jobs: Record<
    string,
    {
      environment?: string;
      env?: Record<string, string>;
      if?: string;
      needs?: string;
      steps: Array<{ env?: Record<string, string>; run?: string }>;
    }
  >;
};

test("hub workflow validates pull requests and main pushes", () => {
  assert.ok(workflow.on.pull_request);
  assert.ok(workflow.on.push);
  assert.deepEqual(Object.keys(workflow.jobs), ["validate"]);
  const validateCommands = workflow.jobs.validate?.steps.flatMap((step) => (step.run ? [step.run] : []));
  assert.deepEqual(validateCommands, [
    "npm ci --prefix contract --no-audit --no-fund",
    "npm ci --prefix hub --no-audit --no-fund",
    "npm test --prefix contract",
    "npm run typecheck --prefix contract",
    "npm test --prefix hub",
    "npm run typecheck --prefix hub",
  ]);
});
