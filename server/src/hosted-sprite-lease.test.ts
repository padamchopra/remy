import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startHostedSpriteLease } from "./hosted-sprite-lease.js";

test("a Sprite stays active through startup, renews its hold, and releases it on shutdown", async () => {
  const root = mkdtempSync(join(tmpdir(), "sprite-lease-"));
  const socket = join(root, "api.sock");
  const requests: {method?:string;path?:string;body:string}[] = [];
  let renew!:()=>void;
  const renewed = new Promise<void>(resolve=>{renew=resolve});
  const server = createServer(async (req,res) => {
    let body=""; for await(const chunk of req)body+=chunk;
    requests.push({method:req.method,path:req.url,body});
    res.writeHead(req.method === "DELETE" ? 204 : 200).end();
    if(requests.filter(r=>r.method === "PUT").length === 2)renew();
  });
  await new Promise<void>(resolve=>server.listen(socket,resolve));
  try {
    const lease=await startHostedSpriteLease(socket,20);
    await renewed;
    await lease.stop();
    assert.equal(requests[0].method,"PUT");
    assert.equal(requests.at(-1)?.method,"DELETE");
    assert.ok(requests.every(r=>r.path === "/v1/tasks/remy"));
    assert.ok(requests.filter(r=>r.method === "PUT").every(r=>JSON.parse(r.body).expire === "2m"));
    const count=requests.length;
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(requests.length,count);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
});
test("non-Sprite computers need no activity hold", async () => {
  const lease=await startHostedSpriteLease('/missing/remy-sprite-api.sock');
  await lease.stop();
});
