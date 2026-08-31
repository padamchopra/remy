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
  checkoutTicketWorktree,
  checkoutWorkspaceBranch,
  closeWorkspaceWorktree,
  listWorkspaceWorktrees,
  listWorkspaces,
  updateWorkspace,
  worktreeDirtyMap,
} = await import("./workspaces.js");

/// A folder is all a workspace needs to be; the git metadata is attached when
/// there is any, and these tests are about the choice stored beside it.
async function workspace(name: string) {
  return addWorkspace(name, mkdtempSync(join(tmpdir(), `remy-ws-${name}-`)));
}

test("follows the machine until the workspace is given a provider of its own", async () => {
  const added = await workspace("plain");
  assert.equal(added.provider, null);
  assert.equal(added.model, null);
  assert.equal(added.effort, null);
});

test("stores a workspace's provider and model as one choice", async () => {
  const added = await workspace("codex");
  const saved = await updateWorkspace(added.id, {
    provider: "codex",
    model: "gpt-5.6-terra",
    effort: "xhigh",
  });
  assert.equal(saved.provider, "codex");
  assert.equal(saved.model, "gpt-5.6-terra");
  assert.equal(saved.effort, "xhigh");
});

test("drops a model the workspace's provider would refuse", async () => {
  const added = await workspace("mixed");
  // `sonnet` is Claude's word, and Codex has never heard of it, so the pair
  // lands on Codex's own default rather than on a model it would reject.
  const saved = await updateWorkspace(added.id, { provider: "codex", model: "sonnet" });
  assert.equal(saved.provider, "codex");
  assert.equal(saved.model, null);
});

test("moving to another provider takes the model with it", async () => {
  const added = await workspace("moved");
  await updateWorkspace(added.id, { provider: "claude", model: "opus", effort: "high" });
  const saved = await updateWorkspace(added.id, { provider: "codex" });
  assert.equal(saved.provider, "codex");
  assert.equal(saved.model, null);
  assert.equal(saved.effort, "high");
});

test("clearing the provider puts the workspace back on the machine's default", async () => {
  const added = await workspace("cleared");
  await updateWorkspace(added.id, { provider: "claude", model: "opus", effort: "high" });
  const saved = await updateWorkspace(added.id, { provider: null });
  // A model with no provider in front of it belongs to nobody, so it goes too.
  assert.equal(saved.provider, null);
  assert.equal(saved.model, null);
  assert.equal(saved.effort, null);
});

test("leaves the choice alone when a patch does not mention it", async () => {
  const added = await workspace("renamed");
  await updateWorkspace(added.id, { provider: "claude", model: "haiku", effort: "low" });
  const saved = await updateWorkspace(added.id, { name: "Renamed" });
  assert.equal(saved.name, "Renamed");
  assert.equal(saved.provider, "claude");
  assert.equal(saved.model, "haiku");
  assert.equal(saved.effort, "low");
});

test("gives a ticket a stable detached worktree from the remote default", async () => {
  const path = mkdtempSync(join(tmpdir(), "remy-ticket-worktree-"));
  execFileSync("git", ["init", "-b", "main", path]);
  execFileSync("git", ["-C", path, "config", "user.name", "Remy Test"]);
  execFileSync("git", ["-C", path, "config", "user.email", "remy@example.test"]);
  writeFileSync(join(path, "README.md"), "ticket worktree\n");
  execFileSync("git", ["-C", path, "add", "README.md"]);
  execFileSync("git", ["-C", path, "commit", "-m", "Initial commit"]);
  const remoteDefault = execFileSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  execFileSync("git", ["-C", path, "update-ref", "refs/remotes/origin/main", remoteDefault]);
  execFileSync("git", ["-C", path, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  execFileSync("git", ["-C", path, "switch", "-c", "feature"]);
  writeFileSync(join(path, "README.md"), "feature checkout\n");
  execFileSync("git", ["-C", path, "commit", "-am", "Feature commit"]);

  const added = await addWorkspace("tickets", path);
  const first = await checkoutTicketWorktree(added, "REMY-42");
  assert.equal(first, join(realpathSync(path), ".remy", "tickets", "remy-42"));
  assert.equal(existsSync(first), true);
  assert.equal(execFileSync("git", ["-C", first, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim(), "HEAD");
  assert.equal(execFileSync("git", ["-C", first, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), remoteDefault);

  const refreshed = (await listWorkspaces()).find((entry) => entry.id === added.id)!;
  assert.equal(await checkoutTicketWorktree(refreshed, "REMY-42"), first);
  assert.equal(refreshed.worktrees.filter((entry) => entry.path === first).length, 1);
});

test("keeps tickets in place when a folder is not a Git checkout", async () => {
  const added = await workspace("non-git-ticket");
  assert.equal(await checkoutTicketWorktree(added, "PLAIN-1"), added.path);
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
