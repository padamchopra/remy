import test from "node:test";
import assert from "node:assert/strict";
import {hostedGatewayAvailable,hostedGatewayModels,hostedModelSelection} from "./hosted-models.js";
test("gateway models coexist and resolve only the selected provider",()=>{
  const names=["OPENROUTER_API_KEY","OPENROUTER_MODELS","RAMP_ROUTER_API_KEY","RAMP_ROUTER_MODELS"];
  const before=names.map(name=>process.env[name]);
  try {
    process.env.OPENROUTER_API_KEY="private-openrouter";
    process.env.OPENROUTER_MODELS=JSON.stringify(["vendor/model"]);
    process.env.RAMP_ROUTER_API_KEY="private-router";
    process.env.RAMP_ROUTER_MODELS=JSON.stringify(["vendor/model"]);
    assert.deepEqual(hostedGatewayModels().map(m=>m.value),["remy:router:vendor/model","remy:openrouter:vendor/model"]);
    assert.deepEqual(hostedModelSelection("remy:router:vendor/model"),{model:"vendor/model",provider:"remy_router"});
    assert.deepEqual(hostedModelSelection("remy:openrouter:vendor/model"),{model:"vendor/model",provider:"remy_openrouter"});
    assert.deepEqual(hostedModelSelection("gpt-5.6-sol"),{model:"gpt-5.6-sol",provider:undefined});
    assert.equal(hostedGatewayAvailable("remy:openrouter:openrouter/auto"),true);
    delete process.env.OPENROUTER_API_KEY;
    assert.throws(()=>hostedModelSelection("remy:openrouter:vendor/model"),/unavailable/);
  }finally{names.forEach((name,i)=>{if(before[i]===undefined)delete process.env[name];else process.env[name]=before[i];});}
});
