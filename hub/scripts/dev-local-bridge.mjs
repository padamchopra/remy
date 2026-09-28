import "tsx/esm";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { localComputerEnvironment } from "./local-development.mjs";

const state = process.env.REMY_LOCAL_STATE;
if (!state) throw new Error("Start the development bridge with npm run dev:local.");
const directory = join(state, "bridge");
mkdirSync(directory, {recursive:true, mode:0o700});
chmodSync(directory, 0o700);
const environment = localComputerEnvironment(process.env, directory);
for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
Object.assign(process.env, environment);
const { getKv, setKv } = await import("../../server/dist/db.js");
setKv("config", {...getKv("config"), hubMode:true, automaticUpdates:false, deviceName:"Remy local development"});
const { connectionAuthorization, registerHubComputerWithDeviceCode, stopHubComputerConnection } = await import("../../server/dist/hub-computer.js");
const production = "https://app.tryremy.dev";
const preview = "http://127.0.0.1:5174";

async function previewRequest(path, body) {
  const response = await fetch(new URL(path, preview), {
    method:body ? "POST" : "GET", headers:{origin:preview, "content-type":"application/json"},
    ...(body ? {body:JSON.stringify(body)} : {}), redirect:"error", signal:AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw Object.assign(new Error(`Your hosted preview could not authorize local development (HTTP ${response.status}). Sign in to the preview and try again.`), {status:response.status});
  return response.json();
}

try {
  let registration = getKv("hubComputerRegistration");
  if (!registration && process.argv.includes("--connect")) {
    const { personal } = await previewRequest("/api/personal");
    if (typeof personal?.id !== "string") throw new Error("Your personal account is unavailable.");
    let connection;
    try {
      const result = await previewRequest(`/api/organizations/${encodeURIComponent(personal.id)}/computers/connection-keys`, {ownership:"personal", name:"Remy local development"});
      const { decodeComputerConnectionKey } = await import("../../contract/src/index.ts");
      connection = decodeComputerConnectionKey(result.key);
    } catch (error) {
      if (error.status !== 403) throw error;
      const response = await fetch(new URL("/api/device/authorization", production), {
        method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({clientKind:"computer",clientName:"Remy local development"}),
        redirect:"error", signal:AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("Computer authorization could not start.");
      const authorization = await response.json();
      if (typeof authorization.deviceCode !== "string" || typeof authorization.userCode !== "string" || typeof authorization.expiresIn !== "number") throw new Error("Computer authorization was incomplete.");
      console.log(`Approve development computer code ${authorization.userCode} at ${production}/?computerCode=${encodeURIComponent(authorization.userCode)}`);
      const deadline = Date.now() + Math.min(authorization.expiresIn, 600) * 1000;
      while (Date.now() < deadline) {
        try {
          registration = await registerHubComputerWithDeviceCode(production, personal.id, authorization.deviceCode, "personal");
          break;
        } catch (pending) {
          if (!["Approve this computer, then try again.", "Wait a moment, then try again."].includes(pending.message)) throw pending;
          await new Promise(resolve => setTimeout(resolve, Math.max(5, Number(authorization.interval) || 5) * 1000));
        }
      }
      if (!registration) throw new Error("Development computer approval expired. Run the connection command again.");
    }
    if (connection) {
      if (connection.url !== production || connection.ownership !== "personal" || connection.organizationId !== personal.id)
        throw new Error("The preview did not authorize your personal production account.");
      registration = await registerHubComputerWithDeviceCode(connection.url, connection.organizationId, connection.key, "personal");
    }
    stopHubComputerConnection();
  }
  if (!registration) throw new Error("Run npm run dev:local -- --connect-account once while your hosted preview is signed in.");
  if (registration.hubUrl !== production || registration.ownership !== "personal") throw new Error("Use a personal development computer connected to the production account.");
  console.log(`Development computer: ${registration.computerId}`);
  if (process.argv.includes("--connect")) {
    console.log("The development identity is saved. Enable this computer ID in DEVELOPMENT_COMPUTER_IDS during the one-time bridge deployment.");
  } else {
    const key = getKv("hubComputerPrivateKey");
    if (typeof key !== "string") throw new Error("The development computer's signing key is unavailable.");
    const response = await fetch(new URL(`/api/development/${encodeURIComponent(registration.organizationId)}/bootstrap`, production), {
      method:"POST", headers:{authorization:connectionAuthorization(registration.organizationId, registration.computerId, key)},
      redirect:"error", signal:AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`The production bridge is unavailable (HTTP ${response.status}); its one-time deployment must enable this development computer.`);
    const bootstrap = await response.json();
    if (bootstrap.profile?.id !== registration.ownerUserId || !Array.isArray(bootstrap.accounts)) throw new Error("The bridge returned a different account.");
    console.log(`Your account is available with ${bootstrap.accounts.length} account scopes.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "The development bridge could not connect.");
  process.exitCode = 1;
} finally {
  stopHubComputerConnection();
}
