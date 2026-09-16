import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { prepareHostedBranch } from "./hosted-branch.js";
test("cloud checkout fetches an explicit branch and preserves edits on retry", async () => {
  const root = mkdtempSync(join(tmpdir(), "remy-branch-"));
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, {cwd, encoding:"utf8", stdio:["ignore","pipe","pipe"]}).trim();
  try {
    git(root,"init","-b","main","origin");
    const origin=join(root,"origin"), clone=join(root,"clone");
    git(origin,"config","user.email","qa@example.test");git(origin,"config","user.name","QA");
    writeFileSync(join(origin,"file"),"main");git(origin,"add",".");git(origin,"commit","-m","Initial");
    git(origin,"checkout","-b","feature/selected");writeFileSync(join(origin,"file"),"selected");git(origin,"commit","-am","Selected");git(origin,"checkout","main");
    git(root,"clone","--depth=1",`file://${origin}`,clone);
    git(clone,"checkout","--detach");
    await prepareHostedBranch(clone,"feature/selected");
    assert.equal(git(clone,"branch","--show-current"),"feature/selected");
    assert.equal(readFileSync(join(clone,"file"),"utf8"),"selected");
    writeFileSync(join(clone,"file"),"keep edits");
    await prepareHostedBranch(clone,"feature/selected");
    assert.equal(readFileSync(join(clone,"file"),"utf8"),"keep edits");
    await assert.rejects(prepareHostedBranch(clone,"--upload-pack=bad"));
    await assert.rejects(prepareHostedBranch(clone,"missing"));
    assert.equal(git(clone,"branch","--show-current"),"feature/selected");
  } finally { rmSync(root,{recursive:true,force:true}); }
});
