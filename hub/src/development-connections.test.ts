import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../test/sqlite-d1.js";
import { HostedSettingsStore } from "./hosted-settings.js";
import { developmentConnection } from "./development-connections.js";
import { personalSpace } from "./personal-space.js";
import type { Env } from "./worker.js";

test("development reads only the approved owner's execution keys and does not persist their values locally", async () => {
  const folder = new URL("../migrations/", import.meta.url);
  const {db,sqlite} = sqliteD1(readdirSync(folder).filter(file=>file.endsWith(".sql")).sort().map(file=>readFileSync(new URL(file,folder),"utf8")).join("\n"));
  try {
    sqlite.exec("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('owner','Owner','owner@test.dev',1,1),('other','Other','other@test.dev',1,1)");
    const owner = await personalSpace(db,"owner");
    const other = await personalSpace(db,"other");
    const secret = async () => "fixture-encryption-root-with-at-least-thirty-two-characters";
    const store = new HostedSettingsStore(db,secret);
    await store.setSecret(owner.id,"access:openrouter","owner-key");
    await store.setSecret(owner.id,"PRIVATE_OTHER_VALUE","excluded");
    await store.setSecret(other.id,"access:openrouter","other-key");
    const env = {DB:db,AUTH_SECRET:{get:secret}} as Env;
    const request = (input: unknown) => new Request("https://hub/development/secrets",{method:"POST",body:JSON.stringify(input)});
    const response = await developmentConnection(request({organizationId:owner.id}),"owner","secrets",env);
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{"access:openrouter":"owner-key"});
    assert.equal((await developmentConnection(request({organizationId:other.id}),"owner","secrets",env)).status,404);
    assert.equal((await developmentConnection(request({organizationId:owner.id,userId:"other"}),"owner","secrets",env)).status,400);
    const local = new HostedSettingsStore({prepare:()=>assert.fail("Local credentials must not touch the database")} as unknown as D1Database,secret,{fetch:async()=>Response.json({"access:openrouter":"owner-key"})} as unknown as Fetcher);
    assert.deepEqual(await local.secrets(owner.id),{"access:openrouter":"owner-key"});
    assert.deepEqual(await local.secretNames(owner.id),["access:openrouter"]);
    await assert.rejects(local.setSecret(owner.id,"access:openrouter","replacement"),/Edit this connection/);
  } finally {sqlite.close();}
});

test("development vendor access refuses arbitrary routes and malformed requests before resolving credentials",async()=>{
  const env = {DB:{prepare:()=>assert.fail("No credential read is allowed")}} as unknown as Env;
  for (const path of ["https://attacker.test", "//attacker.test", "/app/installations/1/access_tokens"]) {
    const response = await developmentConnection(new Request("https://hub/development/github",{method:"POST",body:JSON.stringify({organizationId:"org",path})}),"owner","github",env);
    assert.equal(response.status,400);
  }
  const oversized = await developmentConnection(new Request("https://hub/development/secrets",{method:"POST",body:"x".repeat(8193)}),"owner","secrets",env);
  assert.equal(oversized.status,413);
});
