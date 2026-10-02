import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import { savedDevelopmentIdentity, shareDevelopmentIdentity } from "./local-production-bridge.mjs";

const state = process.env.REMY_LOCAL_STATE;
if (!state) throw new Error("Enable your connection with npm run dev:local -- --enable-account.");
shareDevelopmentIdentity(state);
const { registration } = savedDevelopmentIdentity(state);
if (registration?.hubUrl !== "https://app.tryremy.dev" || registration.ownership !== "personal" ||
    !/^[0-9a-f-]{36}$/.test(registration.computerId) || !/^[a-zA-Z0-9_-]{1,200}$/.test(registration.ownerUserId))
  throw new Error("Approve your personal development computer first.");
const sql = `INSERT INTO development_computers(computer_id,user_id,approved_at) SELECT id,owner_user_id,${Date.now()} FROM organization_computers WHERE id='${registration.computerId}' AND owner_user_id='${registration.ownerUserId}' AND ownership='personal' ON CONFLICT(computer_id) DO UPDATE SET user_id=excluded.user_id,approved_at=excluded.approved_at;`;
const file = join(state,"enable-development.sql");
writeFileSync(file,sql,{mode:0o600});
try {
  const cwd = fileURLToPath(new URL("../",import.meta.url));
  await new Promise((resolve,reject)=>{
    const child = spawn(join(cwd,"node_modules/.bin/wrangler"),["d1","execute","DB","--remote","--env","production","--file",file],{cwd,stdio:"inherit"});
    child.once("error",reject);
    child.once("exit",code=>code===0?resolve():reject(new Error("Your development connection could not be enabled.")));
  });
  console.log("Your development connection is enabled. Other approved computers keep their access.");
} finally {unlinkSync(file);}
