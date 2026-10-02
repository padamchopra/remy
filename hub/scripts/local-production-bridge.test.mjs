import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { productionBridge, savedDevelopmentIdentity } from "./local-production-bridge.mjs";
const { computerConnectionMessage } = await import("../../contract/src/index.ts");

const keys = generateKeyPairSync("ed25519");
const identity = {registration:{hubUrl:"https://app.tryremy.dev",ownership:"personal",ownerUserId:"owner",organizationId:"personal",computerId:"dev"},privateKey:keys.privateKey.export({format:"der",type:"pkcs8"}).toString("base64url")};
const incoming = (body,path="/thread-access") => new Request(`https://internal${path}`,{method:"POST",body:JSON.stringify(body)});

test("missing development identity explains the one-time connection step",()=>{
  assert.throws(()=>savedDevelopmentIdentity("/nonexistent-remy-local-test", "/nonexistent-remy-local-home"),/--connect-account/);
});

test("connection access keeps actors and vendor routes bound to the approved computer", async () => {
  let calls = 0;
  const bridge = productionBridge(identity,async (url,options) => {
    calls++;
    assert.equal(url,"https://app.tryremy.dev/api/development/personal/chatgpt");
    assert.deepEqual(JSON.parse(options.body),{operation:"tokens"});
    return Response.json({accessToken:"short-lived",chatgptAccountId:"owner-account"});
  });
  assert.equal((await bridge.connections(incoming({userId:"someone-else",operation:"tokens"},"/chatgpt"))).status,403);
  assert.equal((await bridge.connections(incoming({userId:"owner"},"/export"))).status,404);
  const response = await bridge.connections(incoming({userId:"owner",operation:"tokens"},"/chatgpt"));
  assert.equal(response.status,200);
  assert.equal((await response.json()).accessToken,"short-lived");
  assert.equal(calls,1);
});

test("decoded connection responses drop upstream compression and byte counts",async()=>{
  const bridge=productionBridge(identity,async()=>new Response(JSON.stringify({configured:true}),{headers:{"content-type":"application/json","content-encoding":"gzip","content-length":"99"}}));
  for(const path of ["/secrets","/chatgpt","/github"]){
    const response=await bridge.connections(incoming({userId:"owner",organizationId:"personal",operation:"tokens",path:"/user"},path));
    assert.equal(response.status,200);
    assert.equal(response.headers.get("content-encoding"),null);
    assert.equal(response.headers.get("content-length"),null);
    assert.deepEqual(await response.json(),{configured:true});
  }
});

test("compressed JSON and Git bytes cross the native Workers connection intact",async()=>{
  const json=Buffer.from(JSON.stringify({configured:true}));
  const git=Buffer.from([0,255,1,128,10,13,37]);
  const server=createServer((request,response)=>{
    const binary=request.url === "/git/info/refs";
    const encoded=gzipSync(binary ? git : json);
    response.writeHead(200,{"content-type":binary?"application/octet-stream":"application/json","content-encoding":"gzip","content-length":encoded.length});
    response.end(encoded);
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const bridge=productionBridge(identity,(url,options)=>fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname.replace("/api/development/personal","")}`,options));
  const mf=new Miniflare(convertV4MiniflareOptions({host:"127.0.0.1",port:0,workers:[{name:"bridge-response-test",modules:true,compatibilityDate:"2026-09-04",script:`export default {async fetch(request,env){const path=new URL(request.url).pathname;return env.CONNECTIONS.fetch(new Request("https://internal"+path,{method:"POST",body:path.startsWith("/git/")?new Uint8Array([1,2]):JSON.stringify({organizationId:"personal"})}));}}`,serviceBindings:{CONNECTIONS:request=>bridge.connections(request)}}]}));
  try{
    await mf.ready;
    for(const [path,expected] of [["/secrets",json],["/git/info/refs",git]]){
      const response=await mf.dispatchFetch(`http://127.0.0.1${path}`);
      assert.equal(response.status,200);
      assert.equal(response.headers.get("content-encoding"),null);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected);
    }
  }finally{await mf.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test("signs fresh scoped requests and never forwards the supplied actor", async () => {
  const nonces = new Set();
  const bridge = productionBridge(identity,async (url,options) => {
    assert.equal(url,"https://app.tryremy.dev/api/development/personal/thread-access");
    assert.equal(options.redirect,"error");
    const auth = JSON.parse(Buffer.from(options.headers.authorization.split(" ")[1],"base64url"));
    assert(verify(null,Buffer.from(computerConnectionMessage("personal",auth)),keys.publicKey,Buffer.from(auth.signature,"base64url")));
    assert(!nonces.has(auth.nonce)); nonces.add(auth.nonce);
    assert.deepEqual(JSON.parse(options.body),{organizationId:"org",workspaceId:"workspace"});
    return Response.json({hubEnvironment:[],hubLinear:{kind:"off"}});
  });
  for (let i=0;i<2;i++) assert.equal((await bridge.execution(incoming({userId:"owner",organizationId:"org",workspaceId:"workspace",ignored:"value"}))).status,200);
});

test("GitHub read queries preserve their method and variables without forwarding the actor", async () => {
  const query = {query:"query Viewer { viewer { login } }",variables:{}};
  const bridge = productionBridge(identity,async (url,options) => {
    assert.equal(url,"https://app.tryremy.dev/api/development/personal/github");
    assert.deepEqual(JSON.parse(options.body),{organizationId:"org",path:"/graphql",method:"POST",input:query});
    return Response.json({data:{viewer:{login:"owner"}}});
  });
  assert.equal((await bridge.connections(incoming({userId:"owner",organizationId:"org",path:"/graphql",method:"POST",input:query},"/github"))).status,200);
});

test("rejects another actor and neighboring routes without requesting credentials", async () => {
  const bridge = productionBridge(identity,()=>assert.fail("No production request is allowed"));
  assert.equal((await bridge.execution(incoming({userId:"someone-else"}))).status,403);
  assert.equal((await bridge.execution(incoming({userId:"owner"},"/secrets"))).status,404);
  assert.equal((await bridge.execution(incoming({userId:"owner"}))).status,400);
});

test("revocation is checked on every turn and error bodies never leak", async () => {
  let calls=0;
  const bridge = productionBridge(identity,async()=>++calls===1?Response.json({hubEnvironment:[],hubLinear:{kind:"off"}}):new Response("sensitive upstream details",{status:403}));
  const body={userId:"owner",organizationId:"org",workspaceId:"workspace"};
  assert.equal((await bridge.execution(incoming(body))).status,200);
  const revoked=await bridge.execution(incoming(body));
  assert.equal(revoked.status,403);
  assert(!((await revoked.text()).includes("sensitive")));
});

test("bootstrap refuses another account and identities cannot redirect requests", async () => {
  const bridge=productionBridge(identity,async()=>Response.json({profile:{id:"other"},accounts:[]}));
  await assert.rejects(bridge.bootstrap(),/different account/);
  assert.throws(()=>productionBridge({...identity,registration:{...identity.registration,hubUrl:"http://127.0.0.1:8420"}}),/personal development computer/);
});
