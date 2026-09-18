import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const hubRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workflows = join(hubRoot, "../.github/workflows");

test("hub and website pull request checks live in one web workflow", () => {
  assert.equal(existsSync(join(workflows, "hub.yml")), false);
  assert.equal(existsSync(join(workflows, "website.yml")), false);
  assert.equal(existsSync(join(workflows, "web.yml")), true);
});

test("approval policy tests run only on policy files, without a skipped review job", () => {
  const workflow = parse(readFileSync(join(workflows, "approval-policy-tests.yml"), "utf8")) as {
    on: { pull_request: { paths: string[] }; pull_request_review: unknown };
    jobs: Record<string, { if?: string }>;
  };
  assert.ok(workflow.on.pull_request_review);
  assert.ok(workflow.on.pull_request.paths.includes(".github/scripts/owner-approval.cjs"));
  assert.ok(workflow.on.pull_request.paths.includes(".github/workflows/owner-approval.yml"));
  assert.deepEqual(Object.keys(workflow.jobs), ["test"]);
  assert.equal(workflow.jobs.test?.if, "github.event_name == 'pull_request'");
});

test("owner approval evaluates trusted main code once per PR head", () => {
  const workflow = parse(readFileSync(join(workflows, "owner-approval.yml"), "utf8")) as {
    on: {
      pull_request_target: { types: string[] };
      workflow_run: { workflows: string[]; types: string[] };
    };
    concurrency: { group: string; "cancel-in-progress": boolean };
    jobs: Record<string, { if?: string; steps: Array<{ uses?: string; with?: { ref?: string } }> }>;
  };
  assert.deepEqual(workflow.on.pull_request_target.types, ["opened", "synchronize", "reopened"]);
  assert.deepEqual(workflow.on.workflow_run.workflows, ["Approval policy tests"]);
  assert.deepEqual(workflow.on.workflow_run.types, ["completed"]);
  assert.match(workflow.concurrency.group, /pull_request\.head\.sha/);
  assert.equal(workflow.concurrency["cancel-in-progress"], true);
  assert.match(
    workflow.jobs.publish?.if ?? "",
    /workflow_run\.event == 'pull_request_review'/,
  );
  const checkout = workflow.jobs.publish?.steps.find((step) => step.uses === "actions/checkout@v4");
  assert.equal(checkout?.with?.ref, "main");
});
