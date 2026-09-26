#!/usr/bin/env node
// Stages a publishable @padamchopra/remy tree: compiled server dist plus the
// contract compiled into vendor/contract, so npm never sees file:../contract.
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CLI_PACKAGE_NAME = "@padamchopra/remy";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function cliPackageManifest(serverPkg) {
  if (!serverPkg?.version) throw new Error("server package.json is missing a version");
  const manifest = {
    name: CLI_PACKAGE_NAME,
    version: serverPkg.version,
    description: "Run Claude Code, Codex, and Cursor on your own machines from anywhere.",
    type: "module",
    bin: { remy: "dist/cli.js" },
    files: ["dist", "vendor", "README.md"],
    engines: { node: ">=22.5.0" },
    dependencies: { ...serverPkg.dependencies, "@remy/contract": "file:./vendor/contract" },
    publishConfig: { access: "public" },
    repository: { type: "git", url: "git+https://github.com/padamchopra/remy.git" },
    homepage: "https://github.com/padamchopra/remy#readme",
    bugs: { url: "https://github.com/padamchopra/remy/issues" },
    keywords: ["remy", "cli", "claude", "codex", "cursor"],
  };
  if (serverPkg.scripts?.postinstall) manifest.scripts = { postinstall: serverPkg.scripts.postinstall };
  if (serverPkg.overrides) manifest.overrides = serverPkg.overrides;
  return manifest;
}

export function contractPackageManifest(contractPkg) {
  return {
    name: "@remy/contract",
    version: contractPkg.version,
    type: "module",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        default: "./dist/index.js",
      },
    },
    files: ["dist"],
    dependencies: { zod: contractPkg.dependencies.zod },
  };
}

export function assertPublishable(manifest) {
  const deps = { ...manifest.dependencies, ...manifest.optionalDependencies };
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec === "string" && spec.startsWith("file:") && spec !== "file:./vendor/contract") {
      throw new Error(`${name} still points at ${spec}; the published package cannot use a workspace path.`);
    }
  }
  if (manifest.private) throw new Error("the published package must not be private");
  if (manifest.name !== CLI_PACKAGE_NAME) throw new Error(`published name must be ${CLI_PACKAGE_NAME}`);
  if (manifest.bin?.remy !== "dist/cli.js") throw new Error("published bin must stay remy");
  if (manifest.engines?.node !== ">=22.5.0") throw new Error("published engines.node must be >=22.5.0");
}

function copyRuntime(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (/\.test\.[cm]?js$/.test(entry.name) || entry.name.endsWith(".test.js.map")) continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyRuntime(from, to);
    else cpSync(from, to);
  }
}

function tsc(projectDir, args) {
  const binary = join(projectDir, "node_modules/typescript/bin/tsc");
  if (!existsSync(binary)) {
    throw new Error(`TypeScript is not installed in ${projectDir}. Run npm run install:computer first.`);
  }
  execFileSync(process.execPath, [binary, ...args], { cwd: projectDir, stdio: "inherit" });
}

export function stageCliPackage(outDir = join(root, ".npm-package")) {
  const serverPkg = JSON.parse(readFileSync(join(root, "server/package.json"), "utf8"));
  const contractPkg = JSON.parse(readFileSync(join(root, "contract/package.json"), "utf8"));
  const manifest = cliPackageManifest(serverPkg);
  assertPublishable(manifest);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "vendor/contract"), { recursive: true });

  tsc(join(root, "contract"), [
    "--pretty", "false",
    "--noEmit", "false",
    "--declaration", "true",
    "--rootDir", "src",
    "--outDir", join(outDir, "vendor/contract/dist"),
  ]);
  writeFileSync(
    join(outDir, "vendor/contract/package.json"),
    `${JSON.stringify(contractPackageManifest(contractPkg), null, 2)}\n`,
  );
  for (const name of readdirSync(join(outDir, "vendor/contract/dist"))) {
    if (name.includes(".test.")) rmSync(join(outDir, "vendor/contract/dist", name));
  }

  tsc(join(root, "server"), ["--pretty", "false"]);
  copyRuntime(join(root, "server/dist"), join(outDir, "dist"));
  chmodSync(join(outDir, "dist/cli.js"), 0o755);

  writeFileSync(join(outDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(outDir, "README.md"),
    `# ${CLI_PACKAGE_NAME}

Remy is a remote for Claude Code, Codex, and Cursor on your own machines.

\`\`\`sh
npm i -g ${CLI_PACKAGE_NAME}
remy login <key>
remy start
remy update
\`\`\`

Requires Node 22.5 or newer. Create a connection key in Remy on the web under Settings → Computers → Connected.

https://github.com/padamchopra/remy
`,
  );
  return outDir;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  const out = stageCliPackage(process.argv[2]);
  process.stdout.write(`${out}\n`);
}
