import { spawn } from "node:child_process";
import { builtinModules } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, chmodSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { productionBridge, savedDevelopmentIdentity } from "./local-production-bridge.mjs";
import { localAccount } from "./local-account.mjs";
import { localComputerArchive } from "./local-computer-archive.mjs";
import { localHubTunnel, localHubReachable } from "./local-tunnel.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const state = join(root, ".wrangler/remy-local");
if (process.argv.includes("--help")) {
  console.log(`Usage: npm run dev:local [-- --connect-account | --bridge-status | --enable-account | --isolated | --connect] [--browser-computer <ssh-host>]\nApp: http://127.0.0.1:5175\nHub: http://127.0.0.1:5184\nComputer: 127.0.0.1:8421\nState persists in ${state}; port 8420 stays untouched.\nDefault startup runs the current web, hub, computer, and cloud startup code with your production connections after the one-time bridge setup. Cloud testing requires cloudflared.\n--connect-account saves a dedicated production development identity once.\n--bridge-status checks whether production has enabled that identity.\n--enable-account adds only your approved identity to production development access.\n--browser-computer forwards the preview to that SSH computer on loopback port 5175.\n--isolated runs a separate local account without production connections.\n--connect manually connects a computer to the isolated local account.\nReal installed providers use your existing provider sign-ins and may incur usage.\nRestart to rebuild backend changes; refresh for frontend changes.`);
  process.exit(0);
}
mkdirSync(state, {recursive:true,mode:0o700});
chmodSync(state,0o700);
const env = {...process.env, REMY_LOCAL_STATE:state};
delete env.REMY_HOSTED_PREVIEW_URL;
delete env.VITE_REMY_HUB_URL;
const children = new Set();
let mf;
let stopping = false;
const stop = async code => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  await mf?.dispose();
  process.exitCode = code;
};
for (const signal of ["SIGINT","SIGTERM"]) process.on(signal,()=>void stop(0));
const run = (file,args,extra={}) => new Promise((resolve,reject)=>{
  const child = spawn(file,args,{cwd:root,env,stdio:"inherit",...extra});
  children.add(child);
  child.once("error",reject);
  child.once("exit",code=>{children.delete(child);code===0?resolve():reject(new Error(`${file} exited with ${code}.`));});
});
try {
  await run("npm",["run","typecheck","--prefix","contract"]);
  await run("npm",["run","build","--prefix","server"]);
  await run(join(root,"contract/node_modules/.bin/tsc"),["--project","contract","--noEmit","false","--outDir","contract/dist","--rootDir","contract/src"]);
  if (process.argv.includes("--enable-account")) {
    await run(process.execPath,["hub/scripts/dev-local-enable.mjs"]);
  } else if (process.argv.includes("--connect-account") || process.argv.includes("--bridge-status")) {
    await run(process.execPath,["hub/scripts/dev-local-bridge.mjs", ...(process.argv.includes("--connect-account") ? ["--connect"] : [])]);
  } else if (process.argv.includes("--connect")) {
    await run(process.execPath,["hub/scripts/dev-local-computer.mjs","--connect"]);
  } else {
    const bridge = process.argv.includes("--isolated") ? undefined : productionBridge(savedDevelopmentIdentity(state));
    const bootstrap = bridge ? await bridge.bootstrap() : undefined;
    let publicHub = "http://127.0.0.1:5184";
    let archive;
    let baseArchive;
    const runtimeToken = randomBytes(32).toString("base64url");
    if (bridge) {
      console.log("Starting the local hub tunnel.");
      const tunnel = localHubTunnel();
      children.add(tunnel.child);
      publicHub = await tunnel.ready;
      console.log(`Local hub tunnel: ${publicHub}`);
      const config = JSON.parse(readFileSync(join(root,"hub/wrangler.jsonc"),"utf8"));
      baseArchive = config.env.production.vars.HOSTED_ARCHIVE;
      archive = await localComputerArchive(root,state);
    }
    const secretFile = join(state,"auth-secret");
    if (!existsSync(secretFile)) writeFileSync(secretFile,randomBytes(48).toString("base64url"),{mode:0o600,flag:"wx"});
    const bundle = await build({
      entryPoints:[join(root,"hub/scripts/dev-local-worker.ts")],bundle:true,write:false,format:"esm",platform:"neutral",
      mainFields:["module","main"],conditions:["workerd","worker","browser"],external:["node:*","cloudflare:*"],
      plugins:[{name:"node-builtins",setup(build){build.onResolve({filter:/^[a-z]/},({path})=>builtinModules.includes(path)?{path:`node:${path}`,external:true}:undefined);}}],
      banner:{js:'import { createRequire } from "node:module"; const require = createRequire("file:///worker.js");'},logLevel:"silent",
    });
    mf = new Miniflare(convertV4MiniflareOptions({host:"127.0.0.1",port:5184,
      resourcePersistencePath:join(state,"resources"),
      workers:[{name:"remy-local",script:bundle.outputFiles[0].text,modules:true,compatibilityDate:"2026-09-04",compatibilityFlags:["nodejs_compat"],
        d1Databases:["DB"],r2Buckets:["OBJECTS"],durableObjects:{COORDINATOR:{className:"HubCoordinator",useSQLite:true}},
        queueProducers:{JOBS:"local-connections"},queueConsumers:{"local-connections":{maxBatchSize:1,maxBatchTimeout:0}},
        ...(bridge ? {serviceBindings:{DEVELOPMENT_EXECUTION:request=>bridge.execution(request),DEVELOPMENT_CONNECTIONS:request=>bridge.connections(request),LOCAL_COMPUTER_ARCHIVE:()=>new Response(Readable.toWeb(createReadStream(archive)),{headers:{"content-type":"application/gzip","cache-control":"no-store"}})}} : {}),
        bindings:{ENVIRONMENT:"staging",RELEASE:"local",BETTER_AUTH_URL:bridge ? publicHub : "http://127.0.0.1:5175",WEB_APP_URL:"http://127.0.0.1:5175",PREVIEW_ORIGINS:"http://127.0.0.1:5175",LOCAL_AUTH_SECRET:readFileSync(secretFile,"utf8"),...(bridge ? {HOSTED_CONTROL_URL:"http://127.0.0.1:5186",LOCAL_RUNTIME_TOKEN:runtimeToken,HOSTED_IMAGE:"local",HOSTED_ARCHIVE:`${publicHub}/__dev/computer.tar.gz`,DEVELOPMENT_BASE_ARCHIVE:baseArchive} : {})},
      }],
    }));
    await mf.ready;
    const db = await mf.getD1Database("DB");
    await db.prepare("CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)").run();
    const applied = new Set((await db.prepare("SELECT name FROM local_migrations").all()).results.map(row=>row.name));
    for (const name of readdirSync(join(root,"hub/migrations")).filter(name=>name.endsWith(".sql")).sort()) {
      if (applied.has(name)) continue;
      const statements = readFileSync(join(root,"hub/migrations",name),"utf8").split(/;(?=\s*(?:CREATE|INSERT|DROP|ALTER|PRAGMA|$))/i).map(s=>s.trim()).filter(Boolean);
      await db.batch([...statements.map(sql=>db.prepare(sql)),db.prepare("INSERT INTO local_migrations (name) VALUES (?)").bind(name)]);
    }
    await db.prepare("CREATE TABLE IF NOT EXISTS local_emails (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT, subject TEXT, body TEXT)").run();
    const account = bootstrap ? await localAccount(db,bootstrap) : undefined;
    if (bridge) {
      console.log("Checking that cloud computers can reach the local hub.");
      const deadline = Date.now() + 60_000;
      while (true) {
        const ready = await localHubReachable(publicHub);
        if (ready) break;
        if (Date.now() >= deadline) throw new Error("The local hub tunnel could not be reached. Restart the preview to retry.");
        await new Promise(resolve=>setTimeout(resolve,1_000));
      }
    }
    const browserComputer = process.argv[process.argv.indexOf("--browser-computer") + 1];
    if (process.argv.includes("--browser-computer")) {
      if (!browserComputer || browserComputer.startsWith("-") || !/^[a-zA-Z0-9@._-]+$/.test(browserComputer)) throw new Error("Choose a valid SSH computer name.");
      const tunnel = spawn("ssh",["-N","-o","BatchMode=yes","-o","ExitOnForwardFailure=yes","-o","ServerAliveInterval=30","-R","127.0.0.1:5175:127.0.0.1:5175",browserComputer],{stdio:"inherit"});
      children.add(tunnel);
      tunnel.once("error",error=>{console.error(error.message);void stop(1);});
      tunnel.once("exit",code=>{if(!stopping){console.error("The shared browser connection stopped.");void stop(code??1);}});
    }
    console.log(account
      ? "Local Remy: http://127.0.0.1:5175\nYour account is connected. Threads stay local; execution reads your approved production connections."
      : "Local Remy: http://127.0.0.1:5175\nLocal email: http://127.0.0.1:5175/__dev/mail\nYour data persists across restarts. This is a separate account from production.\nConnect this computer with npm run dev:local -- --connect in another terminal.");
    await Promise.all([
      ...(bridge ? [run(process.execPath,["hub/runtime/node_modules/tsx/dist/cli.mjs","hub/runtime/src/server.ts"],{env:{...env,REMY_RUNTIME_TOKEN:runtimeToken,PORT:"5186"}})] : []),
      run(process.execPath,["hub/scripts/dev-local-computer.mjs"],{env:{...env,...(account?{REMY_LOCAL_ACCOUNT_SESSION:account.session.accessToken,REMY_LOCAL_PERSONAL_ID:account.personalId,REMY_LOCAL_PUBLIC_HUB:publicHub}:{})}}),
      run("npm",["--prefix","web","run","dev","--","--port","5175"],{env:{...env,REMY_LOCAL_HUB_URL:"http://127.0.0.1:5184",...(account?{REMY_LOCAL_PREVIEW_SESSION:JSON.stringify(account.session)}:{})}}),
    ]);
  }
} catch (error) { console.error(error.message); await stop(1); }
