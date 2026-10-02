import "tsx/esm";
import { createInterface } from "node:readline/promises";
import { localComputerConfig, localComputerEnvironment } from "./local-development.mjs";
const state = process.env.REMY_LOCAL_STATE;
const accountSession = process.env.REMY_LOCAL_ACCOUNT_SESSION;
const personalId = process.env.REMY_LOCAL_PERSONAL_ID;
const computerHub = process.env.REMY_LOCAL_COMPUTER_HUB ?? "http://127.0.0.1:5184";
if (!state) throw new Error("Start this computer with npm run dev:local.");
const environment = localComputerEnvironment(process.env, state);
for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
Object.assign(process.env, environment);
if (accountSession) process.env.MC_EPHEMERAL_TASK_ACCESS = "1";
const { getKv, setKv } = await import("../../server/dist/db.js");
setKv("config", localComputerConfig(getKv("config")));
const { patchSettings } = await import("../../server/dist/config.js");
patchSettings({hubMode: true, deviceName: "Local development"});
if (accountSession && personalId) {
  const registration = getKv("hubComputerRegistration");
  if (registration && registration.organizationId !== personalId)
    throw new Error("Your local computer belongs to another account. Use a separate development state directory.");
  if (registration && registration.hubUrl !== computerHub) {
    const previous = new URL(registration.hubUrl);
    if (!(previous.origin === "http://127.0.0.1:5184" || (previous.protocol === "https:" && previous.hostname.endsWith(".trycloudflare.com"))))
      throw new Error("Your local computer belongs to another hub. Use a separate development state directory.");
    setKv("hubComputerRegistration", { ...registration, hubUrl: computerHub });
  }
  if (!registration) {
    const response = await fetch(`${computerHub}/api/organizations/${encodeURIComponent(personalId)}/computers/connection-keys`, {
      method:"POST",headers:{authorization:`Bearer ${accountSession}`,"content-type":"application/json"},
      body:JSON.stringify({ownership:"personal",name:"Local development"}),redirect:"error",signal:AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Your local computer could not connect (HTTP ${response.status}).`);
    const { decodeComputerConnectionKey } = await import("../../contract/src/index.ts");
    const connection = decodeComputerConnectionKey((await response.json()).key);
    if (connection.url !== computerHub || connection.organizationId !== personalId || connection.ownership !== "personal")
      throw new Error("Your local computer received an invalid connection key.");
    const {registerHubComputerWithDeviceCode,stopHubComputerConnection} = await import("../../server/dist/hub-computer.js");
    await registerHubComputerWithDeviceCode(computerHub,personalId,connection.key,"personal");
    stopHubComputerConnection();
  }
  const {addWorkspace,listWorkspaces} = await import("../../server/dist/workspaces.js");
  if (!(await listWorkspaces()).some(workspace=>workspace.path===process.cwd())) await addWorkspace("Remy",process.cwd());
}
if (process.argv.includes("--connect")) {
  const input = createInterface({input:process.stdin,output:process.stdout});
  const key = (await input.question("Paste the connection key from your local Remy account: ")).trim();
  input.close();
  const { decodeComputerConnectionKey } = await import("../../contract/src/index.ts");
  const connection = decodeComputerConnectionKey(key);
  if (new URL(connection.url).origin !== "http://127.0.0.1:5175") throw new Error("Use a connection key from your local account at http://127.0.0.1:5175.");
  const { registerHubComputerWithDeviceCode, stopHubComputerConnection } = await import("../../server/dist/hub-computer.js");
  await registerHubComputerWithDeviceCode(connection.url, connection.organizationId, connection.key, connection.ownership);
  stopHubComputerConnection();
  console.log("Your local computer is connected. Restart npm run dev:local to load it.");
  process.exit(0);
}
await import("../../server/dist/index.js");
