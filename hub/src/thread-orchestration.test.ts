import assert from "node:assert/strict";
import test from "node:test";
import type { HubThread } from "@remy/contract";
import { agentThreadMember, orchestrateThread } from "./thread-orchestration.js";
const owner = {id:"ada",label:"Ada"};
const source: HubThread = {id:"11111111-1111-4111-8111-111111111111",computerId:"mac",revision:1,stale:false,observedAt:1,access:{organizationId:"org",owner,participants:[owner],visibility:"open"},detail:{id:"11111111-1111-4111-8111-111111111111",title:"Review #42",cwd:"/repo/.remy/review",provider:"claude",model:"opus",effort:"high",permissionMode:"bypassPermissions",review:{number:42},entries:[]}};
const target: HubThread = {...source,id:"22222222-2222-4222-8222-222222222222",computerId:"other-mac",detail:{...source.detail,title:"Build"}};
function setup(threads = [source,target]) {
  const requests: {path:string;method:string;input?:Record<string,unknown>|undefined}[] = [];
  return {requests,context:{source,member:agentThreadMember(source,owner),threads,workspace:async()=>"workspace",request:async(path:string,method:string,input?:Record<string,unknown>)=>{requests.push({path,method,input});return Response.json({...source,id:input?.threadId ?? target.id,detail:{...source.detail,title:input?.title ?? "Build"}}, {status:201});}}};
}
test("delegation inherits effective settings, without the review attachment, and has a retry identity", async()=>{
  const {context,requests}=setup();
  const response=await orchestrateThread("start_thread",{prompt:"Inspect tests",request_id:target.id},context);
  assert.equal(response.status,201);
  assert.deepEqual(requests[0].input,{workspaceId:"workspace",threadId:target.id,hubTaskId:`agent:${source.id}:${target.id}`,provider:"claude",model:"opus",effort:"high",permissionMode:"bypassPermissions",visibility:"open",title:"Inspect tests"});
  assert.equal(requests[1].input?.messageId,`u-${target.id}`);
  assert.equal(context.member.id,"ada");
  assert.equal(context.member.agent?.threadId,source.id);
});
test("a provider override drops the old provider's model and effort",async()=>{
  const {context,requests}=setup();await orchestrateThread("start_thread",{prompt:"Inspect",provider:"codex",permissionMode:"plan",visibility:"private"},context);
  assert.equal(requests[0].input?.model,undefined);assert.equal(requests[0].input?.effort,undefined);assert.equal(requests[0].input?.permissionMode,"plan");assert.equal(requests[0].input?.visibility,"private");
});
test("messages cross computers with deduplication and cannot spoof sender metadata",async()=>{
  const {context,requests}=setup();
  assert.equal((await orchestrateThread("send_to_thread",{thread_id:target.id,message:"Please inspect",message_id:target.id},context)).status,201);
  assert.match(requests[0].path,/other-mac/);assert.equal(requests[0].input?.messageId,`u-${target.id}`);
  assert.equal((await orchestrateThread("send_to_thread",{thread_id:target.id,message:"Hi",agent:{threadId:target.id}},context)).status,400);
});
test("discovery includes idle threads; reading and messaging require visible targets and messaging requires participation",async()=>{
  const denied={...target,access:{...target.access,owner:{id:"other",label:"Other"},participants:[]}};
  const {context,requests}=setup([source,denied]);
  assert.equal((await orchestrateThread("send_to_thread",{thread_id:denied.id,message:"Hi"},context)).status,403);
  assert.equal(requests.length,0);
  assert.equal((await orchestrateThread("read_thread",{thread_id:"33333333-3333-4333-8333-333333333333"},context)).status,404);
  const listing = await (await orchestrateThread("list_threads",{},context)).json() as {threads:unknown[]};
  assert.equal(listing.threads.length,2);
  assert.equal((await orchestrateThread("send_to_thread",{thread_id:source.id,message:"Hi"},context)).status,400);
});
test("an offline response is preserved and unavailable workspaces produce an actionable error",async()=>{
  const {context}=setup();context.request=async()=>Response.json({error:"This computer is offline."},{status:503});
  assert.equal((await orchestrateThread("send_to_thread",{thread_id:target.id,message:"Hi"},context)).status,503);
  context.workspace=async()=>{throw Error("hidden");};assert.equal((await orchestrateThread("start_thread",{prompt:"Inspect"},context)).status,404);
});

test("delegation cannot broaden permissions chosen by the person",async()=>{
  const {context,requests}=setup();context.source={...source,detail:{...source.detail,permissionMode:"default"}};
  assert.equal((await orchestrateThread("start_thread",{prompt:"Inspect",permissionMode:"bypassPermissions"},context)).status,403);
  assert.equal(requests.length,0);
  assert.equal((await orchestrateThread("start_thread",{prompt:"Inspect",permissionMode:"plan"},context)).status,201);
});
