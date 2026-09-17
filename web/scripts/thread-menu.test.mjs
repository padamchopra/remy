import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  absWorkingDir: root,
  entryPoints: ["src/lib/thread-menu.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  alias: { "@": resolve(root, "src") },
});
const { threadGroup, threadIsRunning, threadLink, threadMenuGroups, threadWorkspace } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

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
  assert.equal(threadLink("hosted", "https://app.tryremy.dev/app/threads/old?organization=team", { hosted: true }), "https://app.tryremy.dev/app/threads/hosted");
  assert.equal(threadLink("hosted", "https://app.tryremy.dev/app/inbox"), "https://app.tryremy.dev/app/threads/hosted");
});

test("Mac and hosted sidebar menus share items, order, and enablement", () => {
  const labels = (facts) => threadMenuGroups(facts).map((group) => group.map((entry) => [entry.kind, entry.label, Boolean(entry.disabled)]));
  const local = {
    online: true,
    pinned: false,
    workspace: true,
    running: false,
    groupRunning: false,
  };
  assert.deepEqual(labels(local), [
    [["pin", "Pin thread", false], ["rename", "Rename…", false], ["copy", "Copy thread link", false]],
    [["spawn", "Start subthread…", false], ["workspace", "Open workspace", false]],
    [["archive", "Archive thread", false]],
    [["delete", "Delete thread…", false]],
  ]);
  const hosted = { ...local, spawn: false };
  assert.deepEqual(labels(hosted), [
    [["pin", "Pin thread", false], ["rename", "Rename…", false], ["copy", "Copy thread link", false]],
    [["workspace", "Open workspace", false]],
    [["archive", "Archive thread", false]],
    [["delete", "Delete thread…", false]],
  ]);
  const cloud = { ...local, cloud: true };
  assert.deepEqual(labels(cloud), [
    [["pin", "Pin thread", true], ["rename", "Rename…", false], ["copy", "Copy thread link", false]],
    [["workspace", "Open workspace", false]],
    [["archive", "Archive thread", false]],
    [["delete", "Delete thread…", false]],
  ]);
  const hostedCloud = { ...cloud, spawn: false };
  assert.deepEqual(labels(hostedCloud), labels(cloud));
  assert.deepEqual(labels({ archive: true, online: true, cloud: true }), [
    [["unarchive", "Unarchive thread", true], ["copy", "Copy thread link", false]],
    [["delete", "Delete permanently…", false]],
  ]);
  const running = { ...local, running: true, groupRunning: true };
  assert.equal(labels(running)[2][0][1], "Stop agent");
  assert.equal(labels(running)[2][1][1], "Stop and archive…");
});

