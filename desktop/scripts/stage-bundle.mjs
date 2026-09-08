// Stages the daemon next to the desktop app so the DMG is a single install.
// Matches T3 Code: no second Node binary, no Claude Agent SDK platform
// packages (~300MB each — chats use the Claude already on PATH), and only
// this Mac's node-pty prebuild. The packaged app runs the server with
// ELECTRON_RUN_AS_NODE.
//
// electron-builder skips a top-level `node_modules` in extraResources, so
// desktop/package.json copies `build/server/node_modules` as its own entry.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const serverSrc = join(root, "server");
const cacheDir = join(root, "desktop/build");
const out = join(cacheDir, "server");
const contractOut = join(cacheDir, "contract");
const electronVersion = JSON.parse(readFileSync(join(root, "desktop/node_modules/electron/package.json"), "utf8")).version;

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function pruneNativeExtras(serverDir) {
  const anthropic = join(serverDir, "node_modules/@anthropic-ai");
  if (existsSync(anthropic)) {
    for (const name of readdirSync(anthropic)) {
      if (name.startsWith("claude-agent-sdk-")) rmSync(join(anthropic, name), { recursive: true, force: true });
    }
  }

  const pty = join(serverDir, "node_modules/node-pty");
  const prebuilds = join(pty, "prebuilds");
  const keep = `${process.platform}-${process.arch}`;
  if (existsSync(prebuilds)) {
    for (const name of readdirSync(prebuilds)) {
      if (name !== keep) rmSync(join(prebuilds, name), { recursive: true, force: true });
    }
  }
  for (const extra of ["src", "third_party", "deps", "scripts", "typings"]) {
    rmSync(join(pty, extra), { recursive: true, force: true });
  }
}

rmSync(out, { recursive: true, force: true });
rmSync(contractOut, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

run("npm", ["run", "build"], serverSrc);

cpSync(join(serverSrc, "dist"), join(out, "dist"), {
  recursive: true,
  filter: (src) => !src.endsWith(".test.js") && !src.endsWith(".test.js.map"),
});
copyFileSync(join(serverSrc, "package.json"), join(out, "package.json"));
copyFileSync(join(serverSrc, "package-lock.json"), join(out, "package-lock.json"));
copyFileSync(join(serverSrc, ".npmrc"), join(out, ".npmrc"));
cpSync(join(root, "contract"), contractOut, {
  recursive: true,
  filter: (src) => !src.includes(`${join(root, "contract")}/node_modules`),
});
run(join(serverSrc, "node_modules/.bin/tsc"), [
  join(contractOut, "src/index.ts"),
  "--noCheck",
  "--module", "NodeNext",
  "--moduleResolution", "NodeNext",
  "--target", "ES2022",
  "--outDir", join(contractOut, "dist"),
], contractOut);
const contractPackagePath = join(contractOut, "package.json");
const contractPackage = JSON.parse(readFileSync(contractPackagePath, "utf8"));
contractPackage.exports["."].default = "./dist/index.js";
writeFileSync(contractPackagePath, `${JSON.stringify(contractPackage, null, 2)}\n`);
if (existsSync(join(serverSrc, "hooks"))) {
  cpSync(join(serverSrc, "hooks"), join(out, "hooks"), { recursive: true });
}

run("sips", ["-z", "1024", "1024", join(root, "web/src/assets/remy-mark.png"), "--out", join(cacheDir, "icon.png")]);

run("npm", ["ci", "--omit=dev", "--omit=optional"], out);
pruneNativeExtras(out);

console.log(`staged ${out} for Electron ${electronVersion} (${process.platform}-${process.arch})`);
