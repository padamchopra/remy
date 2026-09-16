import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../test/sqlite-d1.js";
import {D1OrganizationStore} from "./organization-store.js";
import {OrganizationService} from "./organizations.js";

test("workspace identity persists, keeps partial changes, and enforces administration", async()=>{
  const folder=new URL("../migrations/",import.meta.url);
  const {db,sqlite}=sqliteD1(readdirSync(folder).filter(f=>f.endsWith(".sql")).sort().map(f=>readFileSync(new URL(f,folder),"utf8")).join("\n"));
  sqlite.exec("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('owner','Owner','owner@example.test',1,1),('member','Member','member@example.test',1,1); INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('org','Org',1,1); INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('o','org','owner','owner',1,1),('m','org','member','member',1,1);");
  const service=new OrganizationService(new D1OrganizationStore(db));
  const workspace=await service.createWorkspace('org','owner',{name:'Repo',origin:'https://github.com/example/repo'});
  await service.updateWorkspace('org','owner',workspace.id,{icon:'code'});
  await service.updateWorkspace('org','owner',workspace.id,{tint:'blue'});
  const fresh=await new OrganizationService(new D1OrganizationStore(db)).workspace('org','owner',workspace.id);
  assert.equal(fresh.icon,'code');assert.equal(fresh.tint,'blue');
  await assert.rejects(service.updateWorkspace('org','member',workspace.id,{icon:'box'}));
  await assert.rejects(service.updateWorkspace('org','owner',workspace.id,{icon:'../../secret'}));
  await assert.rejects(service.updateWorkspace('org','owner',workspace.id,{tint:'invalid'}));
  await service.updateWorkspace('org','owner',workspace.id,{name:'Renamed'});
  assert.equal((await service.workspace('org','owner',workspace.id)).icon,'code');
  sqlite.close();
});
