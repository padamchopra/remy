import test from "node:test";
import assert from "node:assert/strict";
import type {ComputerSummary,RoutingRule} from "@remy/contract";
import {resolveComputer} from "./routing.js";
const computer=(id:string,patch:Partial<ComputerSummary>={})=>({computerId:id,canUse:true,availability:"online",updateRequired:false,platform:"darwin",ownership:"organization",capabilities:{workspaces:[{id:"local",origin:"github.com/studio/android"}],emulator:true},...patch}) as ComputerSummary;
const input={workspaceId:"android",origin:"https://github.com/studio/android.git",teamIds:["mobile"],trigger:"manual"};
const rules:RoutingRule[]=[{id:"android",name:"Android on the office Mac mini",workspaceId:"android",teamId:"mobile",target:{computerId:"mini",emulator:true}},{id:"linux",name:"Linux",target:{class:"linux"}}];
test("Android routes to the eligible office Mac mini and hosted is the final fallback",()=>{
 const all=[computer("mini"),computer("hosted",{ownership:"hosted",platform:"linux"})];
 assert.equal(resolveComputer(rules,all,input).computerId,"mini");
 assert.equal(resolveComputer([],all,input).computerId,"hosted");
 assert.equal(resolveComputer(rules,[computer("mini",{canUse:false}),all[1]!],input).computerId,"hosted");
 assert.equal(resolveComputer(rules,[computer("mini",{availability:"offline"})],input).hostedWorkspaceId,"android");
});
test("overrides never bypass access, freshness, workspace or emulator requirements",()=>{
 assert.equal(resolveComputer(rules,[computer("mini",{updateRequired:true})],{...input,override:"mini"}).computerId,undefined);
 assert.equal(resolveComputer(rules,[computer("mini",{capabilities:{...computer("x").capabilities,workspaces:[]}})],input).computerId,undefined);
 assert.equal(resolveComputer(rules,[computer("mini",{capabilities:{...computer("x").capabilities,emulator:false}})],input).computerId,undefined);
 assert.equal(resolveComputer(rules,[computer("mini")],{...input,teamIds:[]}).computerId,undefined);
 assert.equal(resolveComputer([{...rules[0]!,trigger:"routine"}],[computer("mini")],input).computerId,undefined);
});
