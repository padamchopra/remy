import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { productionBridge } from "./local-production-bridge.mjs";
const { computerConnectionMessage } = await import("../../contract/src/index.ts");

const keys = generateKeyPairSync("ed25519");
const identity = {registration:{hubUrl:"https://app.tryremy.dev",ownership:"personal",ownerUserId:"owner",organizationId:"personal",computerId:"dev"},privateKey:keys.privateKey.export({format:"der",type:"pkcs8"}).toString("base64url")};
const incoming = (body,path="/thread-access") => new Request(`https://internal${path}`,{method:"POST",body:JSON.stringify(body)});

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
