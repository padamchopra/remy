import { existsSync } from "node:fs";
import { request } from "node:http";

export async function startHostedSpriteLease(socketPath = "/.sprite/api.sock", refreshMs = 30_000) {
  if (!existsSync(socketPath)) return { stop: async () => {} };
  const update = (method: "PUT" | "DELETE") => new Promise<void>((resolve, reject) => {
    const req = request({socketPath, host: "sprite", path: "/v1/tasks/remy", method,
      headers: {"Content-Type": "application/json"}}, response => {
      response.resume();
      response.once("end", () => response.statusCode && (response.statusCode < 300 || method === "DELETE" && response.statusCode === 404)
        ? resolve() : reject(new Error(`Cloud activity hold failed (HTTP ${response.statusCode}).`)));
    });
    req.setTimeout(5_000, () => req.destroy(new Error("Cloud activity hold timed out.")));
    req.once("error", reject);
    req.end(method === "PUT" ? JSON.stringify({expire: "2m"}) : undefined);
  });
  await update("PUT");
  let pending: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (!pending) pending = update("PUT").catch(() => {
      console.error("Your cloud computer could not renew its activity hold.");
    }).finally(() => { pending = undefined; });
  }, refreshMs);
  timer.unref();
  return {stop: async () => { clearInterval(timer); await pending; await update("DELETE"); }};
}
