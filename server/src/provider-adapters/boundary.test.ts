import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("provider SDK imports stay inside the adapter boundary", () => {
  const source = join(process.cwd(), "src");
  const outside = globSync("**/*.ts", { cwd: source })
    .filter((file) => !file.startsWith("provider-adapters/"))
    .filter((file) => {
      const contents = readFileSync(join(source, file), "utf8");
      return contents.includes("@anthropic-ai/claude-agent-sdk")
        || contents.includes("@agentclientprotocol/sdk");
    });
  assert.deepEqual(outside, []);
});
