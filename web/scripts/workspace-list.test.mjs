import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  absWorkingDir: root,
  entryPoints: ["src/lib/workspace-list.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  alias: { "@": resolve(root, "src") },
});
const { compareWorkspaces, hubThreadActivity, hubThreadWorkspace, workspaceMatches, workspaceOriginLabel } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function thread(detail, computerId = "mac") {
  return { computerId, observedAt: 5, stale: false, access: { organizationId: "team" }, detail: { id: "t", title: "T", entries: [], ...detail } };
}
const computers = [{ computerId: "mac", capabilities: { workspaces: [{ id: "local-remy", path: "/Users/p/remy", origin: "git@github.com:padamchopra/remy.git" }] } }];
const workspaces = [{ id: "remy", origin: "https://github.com/padamchopra/remy" }, { id: "app", origin: "https://github.com/example/app" }];

test("a thread that names its workspace is taken at its word", () => {
  assert.equal(hubThreadWorkspace(thread({ workspaceId: "app", cwd: "/Users/p/remy" }), computers, workspaces)?.id, "app");
});

test("a thread on a connected computer is matched by folder, then origin", () => {
  assert.equal(hubThreadWorkspace(thread({ cwd: "/Users/p/remy/.remy/branch" }), computers, workspaces)?.id, "remy");
  assert.equal(hubThreadWorkspace(thread({ cwd: "/Users/p/remy-other" }), computers, workspaces), undefined);
  assert.equal(hubThreadWorkspace(thread({ cwd: "/Users/p/remy" }, "elsewhere"), computers, workspaces), undefined);
});

test("activity prefers the last update", () => {
  assert.equal(hubThreadActivity(thread({ updatedAt: 9, createdAt: 3 })), 9);
  assert.equal(hubThreadActivity(thread({ createdAt: 3 })), 3);
  assert.equal(hubThreadActivity(thread({})), 5);
});

test("origins read as owner/repo on GitHub and host/path elsewhere", () => {
  assert.equal(workspaceOriginLabel("https://github.com/padamchopra/remy"), "padamchopra/remy");
  assert.equal(workspaceOriginLabel("git@github.com:jup-ag/chainkit.git"), "jup-ag/chainkit");
  assert.equal(workspaceOriginLabel("https://git.sr.ht/~padam/agent-sync"), "git.sr.ht/~padam/agent-sync");
  assert.equal(workspaceOriginLabel("ssh://git@gitlab.example.com:2222/team/app.git"), "gitlab.example.com:2222/team/app");
  assert.equal(workspaceOriginLabel("https://user:token@bitbucket.org/team/app/"), "bitbucket.org/team/app");
});

test("search matches name, repository and owner", () => {
  const row = { name: "jupiter-mobile", origin: "https://github.com/jup-ag/jupiter-mobile", owner: "Raccoons" };
  assert.ok(workspaceMatches("", row));
  assert.ok(workspaceMatches("JUPITER", row));
  assert.ok(workspaceMatches("jup-ag/", row));
  assert.ok(workspaceMatches("racc", row));
  assert.ok(!workspaceMatches("chainkt", row));
});

test("newest thread first, then workspaces without a thread by name", () => {
  const rows = [{ name: "beta" }, { name: "old", lastThreadAt: 1 }, { name: "Alpha" }, { name: "new", lastThreadAt: 9 }];
  assert.deepEqual(rows.sort(compareWorkspaces).map((row) => row.name), ["new", "old", "Alpha", "beta"]);
});
