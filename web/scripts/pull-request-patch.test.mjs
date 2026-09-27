import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function load(entry) {
  const bundled = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, write: false, platform: "node", format: "esm", alias: { "@": resolve(root, "src") } });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
}
const { parsePullRequestPatch } = await load("src/lib/pull-request-patch.ts");
const { githubReferenceNodes } = await load("src/lib/github-references.ts");

test("a GitHub patch becomes numbered hunks", () => {
  const hunks = parsePullRequestPatch("@@ -3,3 +3,4 @@ fun main() {\n a\n-b\n+c\n+d\n\\ No newline at end of file\n@@ -20 +21 @@\n-x\n+y");
  assert.equal(hunks.length, 2);
  assert.equal(hunks[0].header, "@@ -3,3 +3,4 @@ fun main() {");
  assert.deepEqual(hunks[0].lines, [
    { kind: "ctx", text: "a", oldLine: 3, newLine: 3 },
    { kind: "del", text: "b", oldLine: 4, newLine: null },
    { kind: "add", text: "c", oldLine: null, newLine: 4 },
    { kind: "add", text: "d", oldLine: null, newLine: 5 },
  ]);
  assert.deepEqual(hunks[1].lines, [
    { kind: "del", text: "x", oldLine: 20, newLine: null },
    { kind: "add", text: "y", oldLine: null, newLine: 21 },
  ]);
  assert.deepEqual(parsePullRequestPatch(""), []);
});

test("references in a description link to GitHub", () => {
  const links = (text) => (githubReferenceNodes(text, "jup-ag/mobile") ?? []).filter((node) => node.type === "link").map((node) => [node.children[0].value, node.url]);
  assert.deepEqual(links("merged: #9016, #9030 and jup-ag/wallet#12."), [
    ["#9016", "https://github.com/jup-ag/mobile/issues/9016"],
    ["#9030", "https://github.com/jup-ag/mobile/issues/9030"],
    ["jup-ag/wallet#12", "https://github.com/jup-ag/wallet/issues/12"],
  ]);
  assert.deepEqual(links("thanks @padamchopra, fixed in 1a2b3c4d5e"), [
    ["@padamchopra", "https://github.com/padamchopra"],
    ["1a2b3c4", "https://github.com/jup-ag/mobile/commit/1a2b3c4d5e"],
  ]);
  for (const text of ["mail a@b.com", "issue#12", "1234567 rows", "deadbeef", "a/b/c#x", "#0"]) {
    assert.deepEqual(links(text), [], text);
  }
  const nodes = githubReferenceNodes("see #1 now", "o/r");
  assert.deepEqual(nodes.map((node) => node.value ?? node.children[0].value), ["see ", "#1", " now"]);
});
