import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

process.env.MC_CONFIG_DIR=mkdtempSync(join(tmpdir(),"remy-ephemeral-access-"));
process.env.MC_EPHEMERAL_TASK_ACCESS="1";
const {db,setKv}=await import("./db.js");
const environment=await import("./environments.js");
const linear=await import("./linear-session.js");
const {LINEAR_MCP_URL}=await import("./linear-mcp.js");

test("development execution values and Linear access never reach SQLite",async()=>{
  setKv("hubThreadAccess",{thread:{}});
  environment.setTaskEnvironment("thread",{values:{SERVICE_TOKEN:"ephemeral-environment-value"},secrets:["SERVICE_TOKEN"]});
  linear.setHubLinear("thread",{kind:"ready",token:"ephemeral-linear-value",url:LINEAR_MCP_URL});
  assert.equal((await environment.taskEnvironment("thread")).SERVICE_TOKEN,"ephemeral-environment-value");
  assert.equal(linear.linearHttpAttachment("thread")?.token,"ephemeral-linear-value");
  assert.equal(environment.redactForThread("thread","ephemeral-environment-value ephemeral-linear-value"),"[REDACTED] [REDACTED]");
  assert.equal(db.prepare("SELECT value FROM kv WHERE key=?").get("taskEnvironment:thread"),undefined);
  assert.equal(db.prepare("SELECT value FROM kv WHERE key=?").get("hubLinear:thread"),undefined);
  assert.equal(db.prepare("SELECT value FROM kv WHERE key=?").get("workspaceEnvironmentKey"),undefined);
  environment.setTaskEnvironment("thread",{values:{},secrets:[]});
  linear.setHubLinear("thread",{kind:"off"});
  assert.deepEqual(await environment.taskEnvironment("thread"),{});
  assert.equal(linear.linearHttpAttachment("thread"),undefined);
});

test("memory-only execution does not reopen older persisted access",async()=>{
  setKv("taskEnvironment:old",{invalid:"sealed data must not be opened"});
  setKv("hubLinear:old",{kind:"notice",notice:"persisted notice"});
  setKv("hubThreadAccess",{old:{}});
  assert.deepEqual(await environment.taskEnvironment("old"),{});
  assert.equal(linear.linearNotice("old"),undefined);
});
