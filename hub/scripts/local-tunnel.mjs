import { spawn } from "node:child_process";

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
