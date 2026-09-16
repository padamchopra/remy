export const startProgram = `
const {spawn}=require("node:child_process");
const fs=require("node:fs");
const entry="/opt/remy/server/dist/hosted-entry.js";
let running=false;
try {
  const pid=Number(fs.readFileSync("/tmp/remy.pid","utf8"));
  const state=fs.readFileSync("/proc/"+pid+"/stat","utf8").split(") ")[1];
  const args=fs.readFileSync("/proc/"+pid+"/cmdline","utf8").split("\\0");
  if(!state?.startsWith("Z") && args.includes(entry)){process.kill(pid,0);running=true;}
} catch {}
if(!running){
  const p=spawn("node",[entry],{env:process.env,detached:true,stdio:"ignore"});
  fs.writeFileSync("/tmp/remy.pid",String(p.pid));p.unref();
}
`;
