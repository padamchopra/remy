import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const root = mkdtempSync(join(tmpdir(), "remy-hub-branch-"));
process.env.MC_CONFIG_DIR = join(root, "config");
const {hubThreadBranch, refreshHubThreadBranch} = await import("./hub-thread-branch.js");

test("snapshots keep the actual checkout branch across switches, worktrees and unavailable computers", async () => {
  const repo = join(root, "repo"); mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], {stdio: "pipe"});
  try {
    git("init", "-b", "main"); git("-c", "user.name=QA", "-c", "user.email=qa@example.com", "commit", "--allow-empty", "-m", "Initial");
    assert.equal(await refreshHubThreadBranch(repo), "main");
    git("switch", "-c", "feature/actual");
    assert.equal(await refreshHubThreadBranch(repo), "feature/actual");
    const tree = join(root, "tree"); git("worktree", "add", "--detach", tree, "HEAD");
    assert.equal(await refreshHubThreadBranch(tree), "detached");
    execFileSync("git", ["-C", tree, "switch", "-c", "feature/worktree"], {stdio: "pipe"});
    assert.equal(await refreshHubThreadBranch(tree), "feature/worktree");
    assert.equal(hubThreadBranch(repo, () => assert.fail("fresh cache needs no read")), "feature/actual");
    rmSync(repo, {recursive:true,force:true});
    assert.equal(await refreshHubThreadBranch(repo), "feature/actual");
  } finally { rmSync(root,{recursive:true,force:true}); }
});
