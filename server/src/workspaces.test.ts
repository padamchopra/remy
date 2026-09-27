import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// workspaces.ts opens the database at import time, so the suite runs against a
// throwaway directory. node:test gives each file its own process.
const stateDir = mkdtempSync(join(tmpdir(), "remy-workspaces-test-"));
process.env.MC_CONFIG_DIR = stateDir;
process.env.HOME = stateDir;

const {
  addWorkspace,
  checkoutWorkspaceBranch,
  closeWorkspaceWorktree,
  listWorkspaceWorktrees,
  listWorkspaces,
  updateWorkspace,
  worktreeDirtyMap,
} = await import("./workspaces.js");

test("renames a workspace", async () => {
  const added = await addWorkspace("renamed", mkdtempSync(join(tmpdir(), "remy-ws-renamed-")));
  const saved = await updateWorkspace(added.id, { name: "Renamed" });
  assert.equal(saved.name, "Renamed");
});

test("loads worktree changes on demand and protects them from safe cleanup", async () => {
  const path = mkdtempSync(join(tmpdir(), "remy-worktree-cleanup-"));
  execFileSync("git", ["init", "-b", "main", path]);
  execFileSync("git", ["-C", path, "config", "user.name", "Remy Test"]);
  execFileSync("git", ["-C", path, "config", "user.email", "remy@example.test"]);
  writeFileSync(join(path, "README.md"), "main\n");
  execFileSync("git", ["-C", path, "add", "README.md"]);
  execFileSync("git", ["-C", path, "commit", "-m", "Initial commit"]);

  const linked = mkdtempSync(join(tmpdir(), "remy-linked-cleanup-"));
  rmSync(linked, { recursive: true });
  execFileSync("git", ["-C", path, "worktree", "add", "-b", "cleanup-test", linked]);
  writeFileSync(join(linked, "dirty.txt"), "keep me\n");
  const added = await addWorkspace("cleanup", path);

  await assert.rejects(closeWorkspaceWorktree(added.id, realpathSync(path), true), /primary worktree/);
  await assert.rejects(closeWorkspaceWorktree(added.id, "/", true), /unregistered/);

  const dirty = await worktreeDirtyMap(added.id);
  assert.equal(dirty[realpathSync(path)], false);
  assert.equal(dirty[realpathSync(linked)], true);
  await assert.rejects(closeWorkspaceWorktree(added.id, realpathSync(linked), false), /uncommitted changes/);
  assert.equal(existsSync(linked), true);

  await closeWorkspaceWorktree(added.id, realpathSync(linked), true);
  assert.equal(existsSync(linked), false);
  assert.deepEqual((await listWorkspaceWorktrees(added.id)).map((tree) => tree.path), [realpathSync(path)]);

  const newPath = join(path, "..", `fresh-${Date.now()}`);
  execFileSync("git", ["-C", path, "worktree", "add", "-b", "fresh-tree", newPath]);
  assert.equal((await listWorkspaceWorktrees(added.id)).some((tree) => tree.path === realpathSync(newPath)), true);
  await closeWorkspaceWorktree(added.id, realpathSync(newPath), false);
  assert.equal(existsSync(newPath), false);
});

test("switches the main checkout before a thread starts and preserves Git's failure reason", async () => {
  const path = mkdtempSync(join(tmpdir(), "remy-main-checkout-"));
  execFileSync("git", ["init", "-b", "main", path]);
  execFileSync("git", ["-C", path, "config", "user.name", "Remy Test"]);
  execFileSync("git", ["-C", path, "config", "user.email", "remy@example.test"]);
  writeFileSync(join(path, "README.md"), "main\n");
  execFileSync("git", ["-C", path, "add", "README.md"]);
  execFileSync("git", ["-C", path, "commit", "-m", "Main commit"]);
  execFileSync("git", ["-C", path, "switch", "-c", "feature"]);
  writeFileSync(join(path, "README.md"), "feature\n");
  execFileSync("git", ["-C", path, "commit", "-am", "Feature commit"]);
  execFileSync("git", ["-C", path, "switch", "main"]);

  const added = await addWorkspace("main checkout", path);
  const switched = await checkoutWorkspaceBranch(added.id, "feature", "main");
  assert.equal(switched.path, realpathSync(path));
  assert.equal(execFileSync("git", ["-C", path, "branch", "--show-current"], { encoding: "utf8" }).trim(), "feature");

  writeFileSync(join(path, "README.md"), "uncommitted\n");
  await assert.rejects(
    checkoutWorkspaceBranch(added.id, "main", "main"),
    /Commit or stash on this checkout before you switch\./,
  );
  assert.equal(execFileSync("git", ["-C", path, "branch", "--show-current"], { encoding: "utf8" }).trim(), "feature");
});


test("hosted workspace identity stays canonical while Git uses its capability proxy", async () => {
  const { setKv } = await import("./db.js");
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "remy-hosted-origin-")));
  execFileSync("git", ["init", "-q", folder]);
  const proxy = "https://hub.example/api/organizations/studio/git/release";
  execFileSync("git", ["-C", folder, "remote", "add", "origin", proxy]);
  setKv("hostedWorkspaceRepository", { path: folder, origin: "github.com/studio/release" });
  try {
    const hosted = await addWorkspace("Hosted release", folder);
    assert.equal(hosted.origin, "github.com/studio/release");
    assert.equal(execFileSync("git", ["-C", folder, "remote", "get-url", "origin"], {encoding:"utf8"}).trim(), proxy);
    const ordinary = await addWorkspace("unrelated", mkdtempSync(join(tmpdir(), "remy-ws-unrelated-")));
    assert.equal(ordinary.origin, null);
  } finally { setKv("hostedWorkspaceRepository", null); rmSync(folder, {recursive:true, force:true}); }
});
