import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { localComputerArchive } from "./local-computer-archive.mjs";
const exec = promisify(execFile);

test("cloud development archive uses current compiled code and excludes local credentials",async()=>{
  const temp = await mkdtemp(join(tmpdir(),"remy-local-archive-"));
  const root = join(temp,"checkout"), base = join(temp,"base"), output = join(temp,"output");
  let server;
  try {
    for (const folder of ["server","contract"]) {
      await mkdir(join(root,folder,"dist"),{recursive:true});
      await mkdir(join(base,"opt/remy",folder,"dist"),{recursive:true});
      await writeFile(join(root,folder,"dist/current.js"),"current code");
      await writeFile(join(base,"opt/remy",folder,"dist/old.js"),"old code");
      await writeFile(join(root,folder,"package.json"),JSON.stringify({exports:{".":{default:"./src/index.ts"}}}));
      await writeFile(join(root,folder,"package-lock.json"),JSON.stringify({lockfileVersion:3}));
    }
    await mkdir(join(base,"usr/local"),{recursive:true});
    await mkdir(join(root,".wrangler"));
    await writeFile(join(root,".wrangler/private-key"),"must not ship");
    const baseArchive = join(temp,"base.tar.gz");
    await exec("tar",["-czf",baseArchive,"-C",base,"opt","usr"]);
    server = createServer(async(_request,response)=>response.end(await readFile(baseArchive)));
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const archive = await localComputerArchive(root,join(temp,"state"),`http://127.0.0.1:${server.address().port}/computer.tar.gz`);
    await mkdir(output);
    await exec("tar",["-xzf",archive,"-C",output]);
    assert.equal(await readFile(join(output,"opt/remy/server/dist/current.js"),"utf8"),"current code");
    assert.equal(JSON.parse(await readFile(join(output,"opt/remy/contract/package.json"),"utf8")).exports["."].default,"./dist/index.js");
    const {stdout} = await exec("tar",["-tzf",archive]);
    assert(!stdout.includes("old.js"));
    assert(!stdout.includes("private-key"));
    assert(!stdout.includes(".wrangler"));
  } finally {await new Promise(resolve=>server ? server.close(resolve) : resolve());await rm(temp,{recursive:true,force:true});}
});
