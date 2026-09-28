import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  absWorkingDir: root,
  entryPoints: ["src/lib/thread-entry-display.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { threadEntryText, visibleThreadEntries } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

test("empty assistant rows do not separate visible transcript messages", () => {
  const first = { id: "one", kind: "assistant", text: "First paragraph." };
  const empty = { id: "empty", kind: "assistant", text: "" };
  const whitespace = { id: "whitespace", kind: "thinking", text: "  \n" };
  const second = { id: "two", kind: "assistant", text: "Second paragraph." };
  assert.deepEqual(visibleThreadEntries([first, empty, whitespace, second]), [first, second]);
});

test("assistant artifacts and images remain visible without prose", () => {
  const artifact = { kind: "assistant", artifacts: [{ title: "ANDROID-1270" }] };
  const image = { kind: "assistant", attachments: [{ remoteId: "image-1" }] };
  assert.deepEqual(visibleThreadEntries([artifact, image]), [artifact, image]);
  assert.equal(threadEntryText({ output: "Tool output" }), "Tool output");
});
