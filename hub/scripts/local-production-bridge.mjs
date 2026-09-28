import "tsx/esm";
import { DatabaseSync } from "node:sqlite";
import { createPrivateKey, randomBytes, sign } from "node:crypto";
import { join } from "node:path";
const { computerConnectionMessage } = await import("../../contract/src/index.ts");

const production = "https://app.tryremy.dev";

export function savedDevelopmentIdentity(state) {
  const db = new DatabaseSync(join(state, "bridge/computer/remy.db"), {readOnly:true});
  try {
    const get = key => JSON.parse(db.prepare("SELECT value FROM kv WHERE key = ?").get(key)?.value ?? "null");
    return {registration:get("hubComputerRegistration"), privateKey:get("hubComputerPrivateKey")};
  } finally { db.close(); }
}

export function productionBridge({registration, privateKey}, request = fetch) {
  if (registration?.hubUrl !== production || registration?.ownership !== "personal" ||
      !registration.ownerUserId || !registration.organizationId || !registration.computerId || typeof privateKey !== "string")
    throw new Error("Connect your personal development computer first.");
  const key = createPrivateKey({key:Buffer.from(privateKey,"base64url"), format:"der", type:"pkcs8"});
  async function call(operation, body) {
    const unsigned = {computerId:registration.computerId, timestamp:Date.now(), nonce:randomBytes(18).toString("base64url")};
    const signature = sign(null, Buffer.from(computerConnectionMessage(registration.organizationId,unsigned)), key).toString("base64url");
    const response = await request(`${production}/api/development/${encodeURIComponent(registration.organizationId)}/${operation}`, {
      method:"POST", redirect:"error", signal:AbortSignal.timeout(30_000),
      headers:{authorization:`RemyComputer ${Buffer.from(JSON.stringify({...unsigned,signature})).toString("base64url")}`, "content-type":"application/json"},
      ...(body ? {body:JSON.stringify(body)} : {}),
    });
    if (!response.ok) throw Object.assign(new Error(`Your production connection is unavailable (HTTP ${response.status}).`), {status:response.status});
    return response.json();
  }
  return {
    async bootstrap() {
      const value = await call("bootstrap");
      if (value?.profile?.id !== registration.ownerUserId || !Array.isArray(value.accounts)) throw new Error("Your production connection returned a different account.");
      return value;
    },
    async execution(incoming) {
      const reply = (status, body) => Response.json(body,{status,headers:{"cache-control":"no-store"}});
      if (incoming.method !== "POST" || new URL(incoming.url).pathname !== "/thread-access") return reply(404,{error:"This development connection is unavailable."});
      let input;
      try { input = await incoming.json(); } catch { return reply(400,{error:"Choose a workspace."}); }
      if (input?.userId !== registration.ownerUserId) return reply(403,{error:"Use your own development connection."});
      if (typeof input.organizationId !== "string" || !input.organizationId || typeof input.workspaceId !== "string" || !input.workspaceId)
        return reply(400,{error:"Choose a workspace."});
      try { return reply(200,await call("thread-access",{organizationId:input.organizationId,workspaceId:input.workspaceId})); }
      catch (error) { return reply(error.status === 403 ? 403 : 503,{error:"Your production connection is unavailable. Check your development access and try again."}); }
    },
  };
}
