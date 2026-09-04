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
  assert.ok(workflow.on.workflow_dispatch !== undefined);
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

test("staging follows validation automatically and production is explicit", () => {
  const staging = workflow.jobs["deploy-staging"];
  const production = workflow.jobs["deploy-production"];
  assert.equal(staging?.needs, "validate");
  assert.equal(staging?.environment, "staging");
  assert.match(staging?.if ?? "", /push/);
  assert.match(staging?.if ?? "", /refs\/heads\/main/);
  assert.equal(staging?.steps.at(-1)?.run, "npm run deploy --prefix hub -- staging");
  assert.deepEqual(Object.keys(staging?.env ?? {}).sort(), ["HUB_URL", "RELEASE"]);
  assert.deepEqual(Object.keys(staging?.steps.at(-1)?.env ?? {}).sort(), [
    "BETTER_AUTH_SECRET",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
  ]);
  assert.equal(production?.needs, "validate");
  assert.equal(production?.environment, "production");
  assert.match(production?.if ?? "", /workflow_dispatch/);
  assert.match(production?.if ?? "", /refs\/heads\/main/);
  assert.equal(production?.steps.at(-1)?.run, "npm run deploy --prefix hub -- production");
  assert.deepEqual(Object.keys(production?.env ?? {}).sort(), ["HUB_URL", "RELEASE"]);
  assert.deepEqual(Object.keys(production?.steps.at(-1)?.env ?? {}).sort(), [
    "BETTER_AUTH_SECRET",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
  ]);
});
