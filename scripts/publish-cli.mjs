#!/usr/bin/env node
// Publishes the staged CLI package. Skips when NPM_TOKEN is unset so a
// computer image still ships before the first npm credential is configured.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI_PACKAGE_NAME, stageCliPackage } from "./cli-package.mjs";

const token = process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN;
if (!token) {
  console.warn(`NPM_TOKEN is not set — skipping npm publish of ${CLI_PACKAGE_NAME}.`);
  process.exit(0);
}

const outDir = stageCliPackage(join(process.env.RUNNER_TEMP || tmpdir(), "remy-cli-package"));
writeFileSync(join(outDir, ".npmrc"), "//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n");
execFileSync("npm", ["publish", "--access", "public"], {
  cwd: outDir,
  stdio: "inherit",
  env: { ...process.env, NODE_AUTH_TOKEN: token },
});
