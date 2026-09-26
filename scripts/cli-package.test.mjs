import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CLI_PACKAGE_NAME,
  assertPublishable,
  cliPackageManifest,
  contractPackageManifest,
  stageCliPackage,
} from "./cli-package.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverPkg = JSON.parse(readFileSync(join(root, "server/package.json"), "utf8"));
const contractPkg = JSON.parse(readFileSync(join(root, "contract/package.json"), "utf8"));

test("the published manifest is @padamchopra/remy with a bundled contract", () => {
  const manifest = cliPackageManifest(serverPkg);
  assert.equal(manifest.name, CLI_PACKAGE_NAME);
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.bin.remy, "dist/cli.js");
  assert.equal(manifest.engines.node, ">=22.5.0");
  assert.equal(manifest.dependencies["@remy/contract"], "file:./vendor/contract");
  assert.equal(manifest.dependencies["node-pty"], serverPkg.dependencies["node-pty"]);
  assert.equal(manifest.publishConfig.access, "public");
  assertPublishable(manifest);
});

test("a workspace file dependency is not publishable", () => {
  assert.throws(
    () => assertPublishable({
      ...cliPackageManifest(serverPkg),
      dependencies: { "@remy/contract": "file:../contract" },
    }),
    /workspace path/,
  );
});

test("the bundled contract ships compiled JavaScript", () => {
  const manifest = contractPackageManifest(contractPkg);
  assert.equal(manifest.name, "@remy/contract");
  assert.equal(manifest.exports["."].default, "./dist/index.js");
  assert.equal(manifest.dependencies.zod, contractPkg.dependencies.zod);
});

test("staging packs remy, the compiled contract, and no tests", () => {
  const out = stageCliPackage(join(mkdtempSync(join(tmpdir(), "remy-cli-pack-")), "pkg"));
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--dry-run"], {
    cwd: out,
    encoding: "utf8",
  }));
  const files = packed[0].files.map((file) => file.path).sort();
  assert.ok(files.includes("dist/cli.js"));
  assert.ok(files.includes("dist/index.js"));
  assert.ok(files.includes("vendor/contract/dist/index.js"));
  assert.ok(files.includes("vendor/contract/package.json"));
  assert.ok(files.includes("package.json"));
  assert.ok(!files.some((file) => file.includes(".test.")));
  assert.ok(!files.some((file) => file.startsWith("src/")));
  const manifest = JSON.parse(readFileSync(join(out, "package.json"), "utf8"));
  assert.equal(manifest.name, CLI_PACKAGE_NAME);
  assert.equal(manifest.bin.remy, "dist/cli.js");
  const cli = readFileSync(join(out, "dist/cli.js"), "utf8");
  assert.ok(cli.startsWith("#!/usr/bin/env node"));
});
