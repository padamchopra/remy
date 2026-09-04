import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const hubRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workflow = parse(readFileSync(join(hubRoot, "../.github/workflows/mac-pr.yml"), "utf8")) as {
  on: { pull_request: null | { paths?: string[] } };
  jobs: Record<string, { if?: string; name?: string; needs?: string | string[] }>;
};

test("the required Mac check reports on every pull request", () => {
  assert.ok("pull_request" in workflow.on);
  assert.equal(workflow.on.pull_request, null);
  assert.equal(workflow.jobs.required?.name, "Build Mac app");
  assert.equal(workflow.jobs.required?.if, "always()");
  assert.deepEqual(workflow.jobs.required?.needs, ["changes", "package"]);
});

test("the expensive package job runs only for relevant changes", () => {
  assert.equal(workflow.jobs.package?.if, "needs.changes.outputs.build == 'true'");
  assert.equal(workflow.jobs.package?.needs, "changes");
});
