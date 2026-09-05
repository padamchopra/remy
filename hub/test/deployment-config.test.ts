import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

type EnvironmentConfig = {
  name: string;
  workers_dev?: boolean;
  routes?: Array<{ pattern: string; custom_domain: boolean }>;
  vars: { ENVIRONMENT: string };
  d1_databases: Array<{ binding: string; database_id: string; database_name: string }>;
  durable_objects?: { bindings: Array<{ name: string; class_name: string }> };
  queues?: { producers: Array<{ binding: string; queue: string }>; consumers: Array<{ queue: string }> };
  r2_buckets?: Array<{ binding: string; bucket_name: string }>;
  secrets_store_secrets?: Array<{ binding: string; store_id: string; secret_name: string }>;
  triggers?: { crons: string[] };
};

const hubRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const rootPackage = JSON.parse(readFileSync(join(hubRoot, "../package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const config = JSON.parse(readFileSync(join(hubRoot, "wrangler.jsonc"), "utf8")) as {
  observability: { enabled: boolean; logs: { enabled: boolean; invocation_logs: boolean } };
  env: { staging: EnvironmentConfig; production: EnvironmentConfig };
};

test("Workers Builds has a short repository-level build command", () => {
  assert.equal(
    rootPackage.scripts["build:hub"],
    "npm ci --prefix contract --no-audit --no-fund && npm ci --prefix hub --no-audit --no-fund && npm test --prefix contract && npm run typecheck --prefix contract && npm test --prefix hub && npm run typecheck --prefix hub",
  );
});

test("staging and production have isolated deployable topology", () => {
  const { staging, production } = config.env;
  assert.equal(config.observability.enabled, true);
  assert.equal(config.observability.logs.enabled, true);
  assert.equal(config.observability.logs.invocation_logs, true);
  assert.equal(staging.vars.ENVIRONMENT, "staging");
  assert.equal(production.vars.ENVIRONMENT, "production");
  assert.equal(staging.workers_dev, false);
  assert.deepEqual(staging.routes, [{ pattern: "staging.tryremy.dev", custom_domain: true }]);
  assert.equal(production.name, "remy-prod");
  assert.equal(production.workers_dev, false);
  assert.deepEqual(production.routes, [{ pattern: "tryremy.dev", custom_domain: true }]);
  assert.notEqual(staging.name, production.name);
  assert.notEqual(staging.d1_databases[0]?.database_id, production.d1_databases[0]?.database_id);
  for (const environment of [staging, production]) {
    assert.equal(environment.d1_databases[0]?.binding, "DB");
    assert.match(environment.d1_databases[0]?.database_id ?? "", /^[0-9a-f-]{36}$/);
  }
});

test("production binds every service and schedules its uptime check", () => {
  const production = config.env.production;
  assert.deepEqual(production.durable_objects?.bindings, [{ name: "COORDINATOR", class_name: "HubCoordinator" }]);
  assert.deepEqual(production.r2_buckets, [
    { binding: "OBJECTS", bucket_name: "remy-hub-production-artifacts" },
  ]);
  assert.deepEqual(production.queues?.producers, [
    { binding: "JOBS", queue: "remy-hub-production-jobs" },
  ]);
  assert.equal(production.queues?.consumers[0]?.queue, "remy-hub-production-jobs");
  assert.deepEqual(production.secrets_store_secrets, [
    {
      binding: "AUTH_SECRET",
      store_id: "9f04524ffaa040fdaa53acbaaa06d064",
      secret_name: "BETTER_AUTH_SECRET",
    },
  ]);
  assert.deepEqual(production.triggers?.crons, ["*/5 * * * *"]);
});

for (const environment of ["staging", "production"] as const) {
  test(`Wrangler dry-runs the ${environment} service`, () => {
    const output = execFileSync(
      join(hubRoot, "node_modules/.bin/wrangler"),
      [
        "deploy",
        "--dry-run",
        "--env",
        environment,
        "--var",
        "RELEASE:test-release",
        "--var",
        `BETTER_AUTH_URL:https://${environment}.invalid`,
      ],
      { cwd: hubRoot, encoding: "utf8" },
    );
    assert.match(output, /Total Upload/);
  });
}
