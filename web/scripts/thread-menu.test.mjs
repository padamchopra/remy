import assert from "node:assert/strict";
import test from "node:test";
import { threadGroup, threadIsRunning, threadLink, threadWorkspace } from "../src/lib/thread-menu.ts";

test("parent lifecycle includes only its own device's children", () => {
  const parent = { id: "parent", serverId: "remote", state: "idle" };
  const child = { id: "child", serverId: "remote", parentChatId: "parent", state: "needs_input" };
  const unrelated = { id: "other", serverId: "local", parentChatId: "parent", state: "working" };
  assert.deepEqual(threadGroup(parent, [parent, child, unrelated]), [parent, child]);
  assert.equal(threadGroup(parent, [parent, child]).some(threadIsRunning), true);
  assert.deepEqual(threadGroup(child, [parent, child]), [child]);
  assert.equal(threadIsRunning({ state: "idle" }), false);
  assert.equal(threadIsRunning({ state: "error" }), false);
});

test("workspace navigation respects device ownership and worktrees", () => {
  const local = { id: "local", serverId: "local", path: "/repo", worktrees: [] };
  const remote = { id: "remote", serverId: "remote", path: "/repo", worktrees: [{ path: "/worktree" }] };
  assert.equal(threadWorkspace({ serverId: "remote", cwd: "/repo" }, [local, remote]), remote);
  assert.equal(threadWorkspace({ serverId: "remote", cwd: "/worktree" }, [local, remote]), remote);
  assert.equal(threadWorkspace({ serverId: "remote", cwd: "/missing" }, [local, remote]), undefined);
});

test("copied links target the clicked thread without stale layout or query parameters", () => {
  assert.equal(threadLink("new/id", "http://127.0.0.1:5173/?temporary=1#/threads/old?layout=x&focus=y"), "http://127.0.0.1:5173/#/threads/new%2Fid");
  assert.equal(threadLink("archived", "https://remy.example/ui/#/settings/providers"), "https://remy.example/ui/#/threads/archived");
  assert.equal(threadLink("desktop", "file:///Applications/Remy.app/Contents/Resources/web/index.html"), "remy://chat/desktop");
});
