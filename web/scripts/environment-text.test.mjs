import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({ absWorkingDir: root, entryPoints: ["src/lib/environment-text.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { parseEnvironmentText } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

test("a pasted .env file becomes one row per key", () => {
  assert.deepEqual(parseEnvironmentText([
    "# local settings",
    "export API_URL=https://api.example.test",
    'GREETING="hello world"',
    "SINGLE='a # b'",
    "PORT=8080 # default",
    "not a line",
    "PORT=9090",
    "",
  ].join("\r\n")), [
    { key: "API_URL", value: "https://api.example.test" },
    { key: "GREETING", value: "hello world" },
    { key: "SINGLE", value: "a # b" },
    { key: "PORT", value: "9090" },
  ]);
  assert.deepEqual(parseEnvironmentText("just text"), []);
});
