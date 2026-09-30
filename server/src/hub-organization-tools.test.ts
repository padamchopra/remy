import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
process.env.MC_CONFIG_DIR=mkdtempSync(join(tmpdir(),"remy-orchestration-auth-"));
const {getKv,setKv}=await import("./db.js");
const {hubOrganizationTool}=await import("./hub-organization-tools.js");
const {createChat,deleteChat}=await import("./chat.js");
const {shareHubThread}=await import("./hub-threads.js");
test("thread tools never generate a replacement computer identity when its key is missing",async()=>{
  setKv("hubComputerRegistration",{organizationId:"personal",computerId:"mac",hubUrl:"https://hub.example"});
  await assert.rejects(hubOrganizationTool("unknown","list_threads"),/not connected to Remy/);
  assert.equal(getKv("hubComputerPrivateKey"),undefined);
});
test("a shared computer signs with its registered identity and targets the thread's organization",async()=>{
  setKv("hubComputerPrivateKey",generateKeyPairSync("ed25519").privateKey.export({format:"der",type:"pkcs8"}).toString("base64url"));
  const thread=createChat({cwd:process.env.MC_CONFIG_DIR,provider:"claude",title:"Shared work"});
  shareHubThread(thread.id,"team",{id:"ada",label:"Ada"},"manual");
  const original=globalThis.fetch;
  const calls:{url:string;input?:RequestInit}[]=[];
  globalThis.fetch=async(url,input)=>{calls.push({url:String(url),input});return Response.json({threads:[]});};
  try {
    await hubOrganizationTool(thread.id,"list_threads");
    assert.match(calls[0].url,/organizations\/personal\/computers\/organization-tools\/.+\?organization=team$/);
    assert.match(new Headers(calls[0].input?.headers).get("authorization")!,/^RemyComputer /);
    assert.deepEqual(JSON.parse(String(calls[0].input?.body)),{action:"list_threads",input:{}});
  } finally {globalThis.fetch=original;deleteChat(thread.id);}
});
