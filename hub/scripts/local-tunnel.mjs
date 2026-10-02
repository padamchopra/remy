import { spawn } from "node:child_process";
import { get } from "node:https";
import { Resolver } from "node:dns";

/// Query DNS directly because macOS can retain an initial negative cache entry
/// for a newly allocated tunnel after its authoritative DNS has propagated.
export function localHubReachable(url) {
  const dns = new Resolver({timeout:2_000,tries:1});
  dns.setServers(["1.1.1.1","1.0.0.1"]);
  return new Promise(resolve => {
    const request = get(new URL("/health",url), {lookup:(hostname,options,callback)=>dns.resolve4(hostname,(error,addresses)=>options.all ? callback(error,addresses?.map(address=>({address,family:4}))) : callback(error,addresses?.[0],4))}, response=>{
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.setTimeout(5_000,()=>request.destroy());
    request.once("error",()=>resolve(false));
  });
}

/// Publish the authenticated local hub so a cloud computer can connect out.
/// The daemon and runtime management port remain on loopback.
export function localHubTunnel() {
  const child = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:5184"], { stdio: ["ignore", "ignore", "pipe"] });
  const ready = new Promise((resolve, reject) => {
    let text = "";
    const timeout = setTimeout(() => { child.kill(); reject(new Error("Your local hub tunnel could not start.")); }, 45000);
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("exit", () => { clearTimeout(timeout); reject(new Error("Your local hub tunnel stopped.")); });
    child.stderr.on("data", chunk => {
      text = (text + chunk.toString()).slice(-16000);
      const url = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (url) { clearTimeout(timeout); resolve(url[0]); }
    });
  });
  return { child, ready };
}
