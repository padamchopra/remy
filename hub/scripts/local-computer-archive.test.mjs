import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { localComputerArchive } from "./local-computer-archive.mjs";
const exec = promisify(execFile);

test("cloud development archive uses current compiled code and excludes local credentials",async()=>{
  const temp = await mkdtemp(join(tmpdir(),"remy-local-archive-"));
  const root = join(temp,"checkout"), output = join(temp,"output");
  try {
    for (const folder of ["server","contract"]) {
      await mkdir(join(root,folder,"dist"),{recursive:true});
      await writeFile(join(root,folder,"dist/current.js"),"current code");
      await writeFile(join(root,folder,"package.json"),JSON.stringify({exports:{".":{default:"./src/index.ts"}}}));
      await writeFile(join(root,folder,"package-lock.json"),JSON.stringify({lockfileVersion:3}));
    }
    await mkdir(join(root,".wrangler"));
    await writeFile(join(root,".wrangler/private-key"),"must not ship");
    const archive = await localComputerArchive(root,join(temp,"state"));
    await mkdir(output);
    await exec("tar",["-xzf",archive,"-C",output]);
    assert.equal(await readFile(join(output,"opt/remy/server/dist/current.js"),"utf8"),"current code");
    assert.equal(JSON.parse(await readFile(join(output,"opt/remy/contract/package.json"),"utf8")).exports["."].default,"./dist/index.js");
    const {stdout} = await exec("tar",["-tzf",archive]);
    assert(!stdout.includes("usr/"));
    assert(!stdout.includes("private-key"));
    assert(!stdout.includes(".wrangler"));
  } finally {await rm(temp,{recursive:true,force:true});}
});
