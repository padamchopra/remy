import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync,readdirSync } from "node:fs";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare,convertV4MiniflareOptions } from "miniflare";
import { localAccount } from "./local-account.mjs";
const {decodeComputerConnectionKey}=await import("../../contract/src/index.ts");

test("current local hub accepts bootstrap sign-in and authorizes a computer without another approval",async()=>{
  const root=fileURLToPath(new URL("../../",import.meta.url));
  const bundle=await build({absWorkingDir:root,entryPoints:["hub/scripts/dev-local-worker.ts"],bundle:true,write:false,format:"esm",platform:"neutral",mainFields:["module","main"],conditions:["workerd","worker","browser"],external:["node:*","cloudflare:*"],plugins:[{name:"builtins",setup(b){b.onResolve({filter:/^[a-z]/},({path})=>builtinModules.includes(path)?{path:`node:${path}`,external:true}:undefined);}}],banner:{js:'import {createRequire} from "node:module";const require=createRequire("file:///worker.js");'},logLevel:"silent"});
  const state=await mkdtemp(join(tmpdir(),"remy-local-runtime-"));
  const options=convertV4MiniflareOptions({resourcePersistencePath:state,host:"127.0.0.1",port:0,workers:[{name:"local-runtime-test",script:bundle.outputFiles[0].text,modules:true,compatibilityDate:"2026-09-04",compatibilityFlags:["nodejs_compat"],d1Databases:["DB"],r2Buckets:["OBJECTS"],durableObjects:{COORDINATOR:{className:"HubCoordinator",useSQLite:true}},bindings:{ENVIRONMENT:"staging",RELEASE:"local",LOCAL_AUTH_SECRET:"disposable-local-runtime-secret-for-tests",BETTER_AUTH_URL:"http://127.0.0.1:5175",WEB_APP_URL:"http://127.0.0.1:5175",PREVIEW_ORIGINS:"http://127.0.0.1:5175"}}]});
  let mf=new Miniflare(options);
  try {
    await mf.ready;
    const db=await mf.getD1Database("DB");
    for(const name of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort()) {
      const statements=readFileSync(new URL(`../migrations/${name}`,import.meta.url),"utf8").split(/;(?=\s*(?:CREATE|INSERT|DROP|ALTER|PRAGMA|$))/i).map(s=>s.trim()).filter(Boolean);
      await db.batch(statements.map(sql=>db.prepare(sql)));
    }
    const {session}=await localAccount(db,{profile:{id:"owner",name:"Developer",email:"local@example.test",emailVerified:true},accounts:[{id:"personal",name:"Personal",personal:true,role:"owner",createdAt:1,updatedAt:1,workspaces:[]}]});
    const headers={authorization:`Bearer ${session.accessToken}`,origin:"http://127.0.0.1:5175","content-type":"application/json"};
    const personal=await mf.dispatchFetch("http://127.0.0.1:5184/api/personal",{headers});
    assert.equal(personal.status,200);
    assert.equal((await personal.json()).personal.id,"personal");
    const response=await mf.dispatchFetch("http://127.0.0.1:5184/api/organizations/personal/computers/connection-keys",{method:"POST",headers,body:JSON.stringify({ownership:"personal",name:"Local development"})});
    assert.equal(response.status,200);
    const connection=decodeComputerConnectionKey((await response.json()).key);
    assert.equal(connection.url,"http://127.0.0.1:5184");
    const exchange=await mf.dispatchFetch("http://127.0.0.1:5184/api/device/token",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({deviceCode:connection.key})});
    assert.equal(exchange.status,200);
    assert.equal((await exchange.json()).status,"approved");
    const foreign=await mf.dispatchFetch("http://127.0.0.1:5184/api/organizations/personal/computers/connection-keys",{method:"POST",headers:{...headers,origin:"https://foreign.test"},body:"{}"});
    assert.equal(foreign.status,403);
    await mf.dispose();
    mf=new Miniflare(options);
    await mf.ready;
    const resumed=await mf.dispatchFetch("http://127.0.0.1:5184/api/personal",{headers});
    assert.equal(resumed.status,200);
    assert.equal((await resumed.json()).personal.id,"personal");
    const replay=await mf.dispatchFetch("http://127.0.0.1:5184/api/device/token",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({deviceCode:connection.key})});
    assert.equal(replay.status,400);
  } finally {await mf.dispose();await rm(state,{recursive:true,force:true});}
});
