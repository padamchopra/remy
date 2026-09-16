import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { configureHostedGit } from "./hosted-git-config.js";

test("hosted Git setup can repeat after a failed start without changing workspace files", () => {
  const path = mkdtempSync(join(tmpdir(), "remy-hosted-git-config-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", path, ...args], {encoding:"utf8"});
  try {
    git("init", "-q");
    writeFileSync(join(path,"unfinished.txt"), "keep my work");
    configureHostedGit(path, "/opt/remy/helper.js", "https://example.test/git/workspace");
    configureHostedGit(path, "/opt/remy/helper.js", "https://example.test/git/workspace");
    configureHostedGit(path, "/opt/remy/updated-helper.js", "https://example.test/git/workspace");
    assert.deepEqual(git("config","--local","--get-all","credential.helper").split("\n"), ["", "/opt/remy/updated-helper.js", ""]);
    assert.equal(git("config","--local","credential.useHttpPath").trim(), "true");
    assert.equal(readFileSync(join(path,"unfinished.txt"),"utf8"), "keep my work");
  } finally { rmSync(path, {recursive:true,force:true}); }
});
