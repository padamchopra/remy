import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
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
  listWorkspaces,
  updateWorkspace,
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

test("gives a ticket a stable detached worktree", async () => {
  const path = mkdtempSync(join(tmpdir(), "remy-ticket-worktree-"));
  execFileSync("git", ["init", "-b", "main", path]);
  execFileSync("git", ["-C", path, "config", "user.name", "Remy Test"]);
  execFileSync("git", ["-C", path, "config", "user.email", "remy@example.test"]);
  writeFileSync(join(path, "README.md"), "ticket worktree\n");
  execFileSync("git", ["-C", path, "add", "README.md"]);
  execFileSync("git", ["-C", path, "commit", "-m", "Initial commit"]);

  const added = await addWorkspace("tickets", path);
  const first = await checkoutTicketWorktree(added, "REMY-42");
  assert.equal(first, join(realpathSync(path), ".remy", "tickets", "remy-42"));
  assert.equal(existsSync(first), true);
  assert.equal(execFileSync("git", ["-C", first, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim(), "HEAD");

  const refreshed = (await listWorkspaces()).find((entry) => entry.id === added.id)!;
  assert.equal(await checkoutTicketWorktree(refreshed, "REMY-42"), first);
  assert.equal(refreshed.worktrees.filter((entry) => entry.path === first).length, 1);
});

test("keeps tickets in place when a folder is not a Git checkout", async () => {
  const added = await workspace("non-git-ticket");
  assert.equal(await checkoutTicketWorktree(added, "PLAIN-1"), added.path);
});
