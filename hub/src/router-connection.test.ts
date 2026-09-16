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
 assert.deepEqual(modelSecrets({"cloud:modal":"private-cloud-key","model:router":JSON.stringify({apiKey:"router-test-key",model:"account-model"})}),{RAMP_ROUTER_API_KEY:"router-test-key",RAMP_ROUTER_MODELS:JSON.stringify(["account-model"])});
 await assert.rejects(routerModels("invalid",(async()=>new Response(null,{status:401})) as typeof fetch),/rejected this key/);
});

test("OpenRouter discovers user models and isolates execution credentials", async () => {
  const models = await routerModels("openrouter-test-key", (async (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/v1/models/user");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer openrouter-test-key");
    return Response.json({data: [{id: "vendor/model"}, {id: "vendor/model"}, {id: 42}]});
  }) as typeof fetch, "openrouter");
  assert.deepEqual(models, ["vendor/model"]);
  assert.deepEqual(modelSecrets({
    "cloud:modal": "private-cloud-key",
    "model:router": JSON.stringify({apiKey:"other-key",model:"other-model"}),
    "model:openrouter": JSON.stringify({apiKey:"openrouter-test-key",model:"vendor/model"}),
  }), {RAMP_ROUTER_API_KEY:"other-key",RAMP_ROUTER_MODELS:JSON.stringify(["other-model"]),OPENROUTER_API_KEY:"openrouter-test-key",OPENROUTER_MODELS:JSON.stringify(["vendor/model"])});
  await assert.rejects(routerModels("bad", (async () => new Response(null, {status:401})) as typeof fetch, "openrouter"), /OpenRouter rejected/);
});
