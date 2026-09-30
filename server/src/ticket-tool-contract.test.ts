import assert from "node:assert/strict";
import test from "node:test";
import {
  remyProviderInstructions,
  REMY_BROWSER_INSTRUCTIONS,
  REMY_TOOL_INSTRUCTIONS,
} from "./ticket-tool-contract.js";

test("the Remy tools describe only workspaces and threads", () => {
  assert.doesNotMatch(REMY_TOOL_INSTRUCTIONS, /ticket|routine|memor/i);
});

test("provider instructions prefer Remy's attached browser over global browser systems", () => {
  assert.match(REMY_BROWSER_INSTRUCTIONS, /Open the target page with browser_open before deciding that no browser is available/);
  assert.match(REMY_BROWSER_INSTRUCTIONS, /Do not switch to a global Browser skill/);
  assert.match(REMY_TOOL_INSTRUCTIONS, /browser_open/);
  assert.equal(remyProviderInstructions("Keep answers terse."), `Keep answers terse.\n\n${REMY_TOOL_INSTRUCTIONS}`);
  assert.equal(remyProviderInstructions(), REMY_TOOL_INSTRUCTIONS);
});
