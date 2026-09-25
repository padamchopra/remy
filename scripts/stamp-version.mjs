#!/usr/bin/env node
// CI-only: {major}.{minor}.{GITHUB_RUN_NUMBER} so each main build is a new tag.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = process.env.GITHUB_RUN_NUMBER;
if (!run || !/^\d+$/.test(run)) {
  console.error("GITHUB_RUN_NUMBER is required");
  process.exit(1);
}

const base = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const [major, minor] = String(base).split(".");
if (!major || !minor) {
  console.error(`package.json version "${base}" is not major.minor.patch`);
  process.exit(1);
}
const version = `${major}.${minor}.${run}`;

for (const rel of ["package.json", "web/package.json", "server/package.json"]) {
  const path = join(root, rel);
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.version = version;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

process.stdout.write(version);
