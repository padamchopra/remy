import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { localAccount } from "./local-account.mjs";
const { AccountService } = await import("../src/accounts.ts");
const { D1AccountStore } = await import("../src/account-store.ts");

test("bootstrap persists only metadata and local session hashes across restarts", async()=>{
  const sqlite=new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),"utf8"));
    const prepare=(sql,values=[])=>({bind:(...next)=>prepare(sql,next),run:async()=>sqlite.prepare(sql).run(...values),first:async()=>sqlite.prepare(sql).get(...values),all:async()=>({results:sqlite.prepare(sql).all(...values)})});
    const db={prepare,batch:async statements=>{sqlite.exec("BEGIN");try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec("COMMIT");return results;}catch(e){sqlite.exec("ROLLBACK");throw e;}}};
    const bootstrap={profile:{id:"owner",name:"Developer",email:"dev@example.test",emailVerified:true},accounts:[{id:"personal",name:"Personal",personal:true,role:"owner",createdAt:1,updatedAt:1,workspaces:[{id:"workspace",organizationId:"personal",name:"Remy",origin:"github.com/example/remy",createdAt:1,updatedAt:1}]}]};
    const first=await localAccount(db,bootstrap);
    assert.equal(first.personalId,"personal");
    assert.equal((await new AccountService(new D1AccountStore(db)).authenticate(first.session.accessToken)).userId,"owner");
    const serialized=JSON.stringify(sqlite.prepare("SELECT * FROM auth_sessions").all());
    assert(!serialized.includes(first.session.accessToken));
    bootstrap.accounts[0].workspaces[0].name="Updated";
    await localAccount(db,bootstrap);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM memberships").get().count,1);
    assert.equal(sqlite.prepare("SELECT name FROM organization_workspaces").get().name,"Updated");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM organization_computers").get().count,0);
  } finally {sqlite.close();}
});
