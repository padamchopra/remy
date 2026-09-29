/// Runs on the guest. The exec session is what keeps a Sprite awake, so this
/// process has to stay up until Remy is listening: the daemon clones the
/// workspace before it connects, and Fly pauses a Sprite once this session ends.
export const startProgram = `
const {spawn}=require("node:child_process");
const fs=require("node:fs");
const net=require("node:net");
const path=require("node:path");
const codexRoot=process.env.REMY_BOOT_CODEX_ROOT||"/usr/local/lib/node_modules/@openai/codex";
const host=fs.readdirSync(codexRoot,{recursive:true}).find(file=>String(file).endsWith("/bin/codex-code-mode-host"));
if(!host)throw Error("The Codex command helper is missing from this computer.");
const helperDirectory=path.dirname(path.join(codexRoot,String(host)));
process.env.PATH=["/usr/local/bin",helperDirectory,process.env.PATH||"/usr/bin:/bin"].join(":");
const entry=process.env.REMY_BOOT_ENTRY||"/opt/remy/server/dist/hosted-entry.js";
const port=Number(process.env.REMY_BOOT_PORT||8420);
const logPath=process.env.REMY_BOOT_LOG||"/tmp/remy-boot.log";
const pidPath=process.env.REMY_BOOT_PID||"/tmp/remy.pid";
const holdMs=Number(process.env.REMY_BOOT_HOLD_MS||480000);
const settleMs=Number(process.env.REMY_BOOT_SETTLE_MS||15000);
const alive=pid=>{
  if(!Number.isInteger(pid)||pid<2)return false;
  try{process.kill(pid,0);}catch{return false;}
  try{
    const state=fs.readFileSync("/proc/"+pid+"/stat","utf8").split(") ")[1];
    const args=fs.readFileSync("/proc/"+pid+"/cmdline","utf8").split("\\0");
    return !!state&&!state.startsWith("Z")&&args.includes(entry);
  }catch{return process.platform!=="linux";}
};
const listening=()=>new Promise(resolve=>{
  const socket=net.connect({port,host:"127.0.0.1"});
  const done=open=>{socket.destroy();resolve(open);};
  socket.setTimeout(400);
  socket.once("connect",()=>done(true));
  socket.once("timeout",()=>done(false));
  socket.once("error",()=>done(false));
});
(async()=>{
  let pid=0;
  try{pid=Number(fs.readFileSync(pidPath,"utf8"));}catch{}
  if(!alive(pid)){
    const fd=fs.openSync(logPath,"a");
    const child=spawn(process.execPath,[entry],{env:process.env,detached:true,stdio:["ignore",fd,fd]});
    pid=child.pid??0;
    fs.writeFileSync(pidPath,String(pid));
    child.unref();
    fs.closeSync(fd);
  }
  const started=Date.now();
  while(Date.now()-started<holdMs){
    if(await listening()){
      await new Promise(resolve=>setTimeout(resolve,settleMs));
      process.exit(0);
    }
    if(!alive(pid)){
      await new Promise(resolve=>setTimeout(resolve,50));
      let detail="";
      try{detail=fs.readFileSync(logPath,"utf8").trim().split(/\\r?\\n/).slice(-20).join("\\n");}catch{}
      if(detail)console.error(detail.slice(0,800));
      console.error("Remy stopped before it could join.");
      process.exit(1);
    }
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  console.error("Remy did not finish starting.");
  process.exit(1);
})().catch(error=>{console.error(error instanceof Error?error.message:"Remy could not start.");process.exit(1);});
`;
