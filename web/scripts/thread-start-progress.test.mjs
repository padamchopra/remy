import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  absWorkingDir: root,
  entryPoints: ["src/lib/thread-start-progress.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { threadStartProgressLabel } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

test("thread start status uses the approved copy for each real phase", () => {
  assert.equal(threadStartProgressLabel(), "Creating thread…");
  assert.equal(threadStartProgressLabel("creating"), "Creating thread…");
  assert.equal(threadStartProgressLabel("unknown"), "Creating thread…");
  assert.equal(threadStartProgressLabel("waking"), "Waking computer…");
  assert.equal(threadStartProgressLabel("restoring"), "Restoring computer…");
  assert.equal(threadStartProgressLabel("starting_runtime"), "Starting runtime…");
  assert.equal(threadStartProgressLabel("connecting"), "Connecting…");
  assert.equal(threadStartProgressLabel("preparing_branch"), "Preparing branch…");
  assert.equal(threadStartProgressLabel("sending"), "Sending message…");
});
