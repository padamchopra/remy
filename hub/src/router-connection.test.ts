import test from "node:test";
import assert from "node:assert/strict";
import {routerModels} from "./router-connection.js";
import {modelSecrets} from "./cloud-connection.js";
test("Router reads the key-specific catalog without leaking cloud credentials",async()=>{
 const models=await routerModels("router-test-key",(async(url,init)=>{
  assert.equal(url,"https://api.router.com/v1/models");
  assert.equal(new Headers(init?.headers).get("authorization"),"Bearer router-test-key");
  return Response.json({data:[{id:"account-model"},{id:42}]});
 }) as typeof fetch);
 assert.deepEqual(models,["account-model"]);
 assert.deepEqual(modelSecrets({"cloud:modal":"private-cloud-key","model:router":JSON.stringify({apiKey:"router-test-key",model:"account-model"})}),{RAMP_ROUTER_API_KEY:"router-test-key",RAMP_ROUTER_MODEL:"account-model"});
 await assert.rejects(routerModels("invalid",(async()=>new Response(null,{status:401})) as typeof fetch),/rejected this key/);
});
