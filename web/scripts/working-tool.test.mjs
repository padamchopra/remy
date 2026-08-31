import assert from "node:assert/strict";
import test from "node:test";
import { workingToolGroupId } from "../src/lib/working-tool.ts";
import { elapsedSince } from "../src/lib/elapsed.ts";

const entry = (id, kind, status) => ({ id, kind, status });

test("only the latest tool passage shimmers, even after completed or failed calls", () => {
  const entries = [entry("u", "user"), entry("old", "tool", "done"), entry("a", "assistant"), entry("latest", "tool", "error"), entry("next", "tool", "done")];
  assert.equal(workingToolGroupId(entries, true), "latest");
  assert.equal(workingToolGroupId([...entries, entry("prose", "assistant")], true), "latest");
  assert.equal(workingToolGroupId([...entries, entry("prose", "assistant"), entry("new", "tool")], true), "new");
});

test("stopped, completed and approval-paused turns do not shimmer", () => {
  assert.equal(workingToolGroupId([entry("tool", "tool", "running")], false), undefined);
});

test("a new turn never reactivates a prior turn's tools", () => {
  assert.equal(workingToolGroupId([entry("old", "tool"), entry("new-turn", "user"), entry("thinking", "thinking")], true), undefined);
  assert.equal(workingToolGroupId([], true), undefined);
  assert.equal(workingToolGroupId([entry("assistant", "assistant")], true), undefined);
});

test("the status uses the sidebar's seconds, minutes, and hours formatter", () => {
  const start = 1000;
  assert.equal(elapsedSince(start, start + 12000), "12s");
  assert.equal(elapsedSince(start, start + 83000), "1m 23s");
  assert.equal(elapsedSince(start, start + 3723000), "1h 2m");
  assert.equal(elapsedSince(start, start - 1000), "0s");
});
