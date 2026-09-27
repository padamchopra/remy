import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../test/sqlite-d1.js";
import { modelDefaults } from "./model-defaults.js";
test("defaults belong to a computer, isolate members, and have no account or workspace level", async()=>{
 const folder=new URL('../migrations/',import.meta.url);
 const {db,sqlite}=sqliteD1(readdirSync(folder).filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(new URL(f,folder),'utf8')).join('\n'));
 sqlite.exec("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('ada','Ada','ada@example.test',1,1),('grace','Grace','grace@example.test',1,1); INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('org','Org',1,1),('other','Other',1,1); INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('a','org','ada','owner',1,1),('b','org','grace','member',1,1),('c','other','ada','owner',1,1);");
 const call=async(user='ada',choice?:unknown,org='org',computer='',workspace='')=>modelDefaults(db,org,user,new Request(`https://hub.example/api/organizations/${org}/model-defaults?${new URLSearchParams({...workspace?{workspace}:{},...computer?{computer}:{}})}`,{method:choice===undefined?'GET':'PATCH',...(choice===undefined?{}:{body:JSON.stringify({choice})})}));
 try {
  const account={provider:'openrouter',model:'openrouter/auto',effort:''};
  assert.equal((await call('ada',account)).status,400,"An account-wide default cannot be saved");
  assert.equal((await call('ada',null)).status,400);
  assert.equal((await call('ada',account,'org','','repo')).status,400,"A workspace default cannot be saved");
  assert.deepEqual(await (await call('ada')).json(),{computer:null});
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('member_model_defaults','member_preferences','member_workspace_model_defaults')").get()?.count,0,"Account and workspace defaults leave no stored rows behind");
  const computerChoice={provider:'openrouter',model:'computer/model',effort:''};
  assert.equal((await call('ada',computerChoice,'org','cloud:fly-sprites')).status,200);
  assert.deepEqual(await (await call('ada',undefined,'org','cloud:fly-sprites')).json(),{computer:computerChoice});
  assert.equal((await (await call('grace',undefined,'org','cloud:fly-sprites')).json() as any).computer,null);
  assert.equal((await (await call('ada',undefined,'other','cloud:fly-sprites')).json() as any).computer,null);
  await assert.rejects(call('ada',computerChoice,'org','cloud:unknown'));
  assert.equal((await call('ada',{provider:'default',model:''},'org','cloud:fly-sprites')).status,400);
  await call('ada',null,'org','cloud:fly-sprites');
  assert.equal((await (await call('ada',undefined,'org','cloud:fly-sprites')).json() as any).computer,null);
  const {ComputerService}=await import('./computers.js');const {D1ComputerStore}=await import('./computer-store.js');const {D1OrganizationStore}=await import('./organization-store.js');
  const computerId='b7ebfcbe-f2f4-4a1b-8707-3029fa65d14b';
  await new ComputerService(new D1ComputerStore(db),Date.now,'0.1.0',new D1OrganizationStore(db)).register('org','ada',{computerId,name:'Mac',icon:'laptop',platform:'darwin',daemonVersion:'1.0.0',protocol:{minimum:1,maximum:1},publicKey:'k'.repeat(44),capabilities:{providers:[],workspaces:[],worktrees:true,terminals:true,emulator:false}});
  await call('ada',computerChoice,'org',computerId);
  await assert.rejects(call('grace',computerChoice,'org',computerId));
  sqlite.exec(`DELETE FROM organization_computers WHERE id='${computerId}'`);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM member_computer_model_defaults').get()?.count,0);
  await call('ada',computerChoice,'org','cloud:fly-sprites');
  sqlite.exec("DELETE FROM user WHERE id='ada'");
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM member_computer_model_defaults').get()?.count,0);
 } finally {sqlite.close();}
});
