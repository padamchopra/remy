import assert from "node:assert/strict";
import test from "node:test";
import { cleanWorktreeSelection, worktreeKey, worktreeCopyKey } from "../src/lib/worktree-selection.ts";

const target = (serverId, path, dirty = false, isMain = false) => ({
  key: worktreeKey(serverId, path), workspaceId: "workspace", serverId, deviceName: serverId,
  tree: { path, branch: path, dirty, isMain },
});

test("identical paths and workspace IDs on different devices remain distinct", () => {
  assert.notEqual(worktreeKey("one", "/same"), worktreeKey("two", "/same"));
  assert.notEqual(worktreeCopyKey({ id: "same", serverId: "one" }), worktreeCopyKey({ id: "same", serverId: "two" }));
});

test("bulk cleanup forces only the dirty worktrees explicitly confirmed", async () => {
  const calls = [];
  await cleanWorktreeSelection([target("one", "/clean"), target("one", "/dirty", true)], true,
    async (entry, force) => { calls.push([entry.tree.path, force]); }, () => {});
  assert.deepEqual(calls, [["/clean", false], ["/dirty", true]]);
});

test("main checkouts and unconfirmed dirty folders never reach the cleanup API", async () => {
  const errors = [];
  let calls = 0;
  await cleanWorktreeSelection([target("one", "/main", false, true), target("one", "/dirty", true)], false,
    async () => { calls++; }, (_, error) => errors.push(error.message));
  assert.equal(calls, 0);
  assert.equal(errors.length, 2);
});

test("a failed device does not cancel other removals and results identify exact targets", async () => {
  const results = [];
  const targets = [target("offline", "/same"), target("online", "/same"), target("online", "/next")];
  await cleanWorktreeSelection(targets, false, async (entry) => {
    if (entry.serverId === "offline") throw new Error("Device offline");
  }, (entry, error) => results.push([entry.key, Boolean(error)]));
  assert.deepEqual(new Map(results), new Map(targets.map((entry) => [entry.key, entry.serverId === "offline"])));
});
