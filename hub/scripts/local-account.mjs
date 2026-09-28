import "tsx/esm";
import { randomUUID } from "node:crypto";
const { AccountService } = await import("../src/accounts.ts");
const { D1AccountStore } = await import("../src/account-store.ts");

export async function localAccount(db, bootstrap) {
  const {profile,accounts} = bootstrap;
  if (!profile?.id || !profile.email || !Array.isArray(accounts)) throw new Error("Your account details are incomplete.");
  const now=Date.now();
  const statements=[db.prepare("INSERT INTO user (id,name,email,emailVerified,image,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,emailVerified=excluded.emailVerified,image=excluded.image,updatedAt=excluded.updatedAt")
    .bind(profile.id,profile.name,profile.email,profile.emailVerified?1:0,profile.image??null,now,now)];
  for (const account of accounts) {
    statements.push(db.prepare("INSERT INTO organizations (id,name,createdAt,updatedAt,personal_owner_id) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updatedAt=excluded.updatedAt")
      .bind(account.id,account.name,account.createdAt,account.updatedAt,account.personal?profile.id:null));
    statements.push(db.prepare("INSERT INTO memberships (id,organization_id,user_id,role,createdAt,updatedAt) VALUES (?,?,?,?,?,?) ON CONFLICT(organization_id,user_id) DO UPDATE SET role=excluded.role,updatedAt=excluded.updatedAt")
      .bind(randomUUID(),account.id,profile.id,account.role,now,now));
    for (const workspace of account.workspaces) {
      if (workspace.organizationId !== account.id) throw new Error("Your workspace belongs to a different account.");
      statements.push(db.prepare("INSERT INTO organization_workspaces (id,organization_id,name,origin,created_at,updated_at,icon,tint) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,origin=excluded.origin,updated_at=excluded.updated_at,icon=excluded.icon,tint=excluded.tint")
        .bind(workspace.id,account.id,workspace.name,workspace.origin,workspace.createdAt,workspace.updatedAt,workspace.icon??"folder",workspace.tint??"zinc"));
    }
  }
  await db.batch(statements);
  const personal=accounts.find(account=>account.personal);
  if (!personal) throw new Error("Your personal account is unavailable.");
  const session=await new AccountService(new D1AccountStore(db)).createSession(profile.id,"web","Local development");
  return {session,personalId:personal.id};
}
