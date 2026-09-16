import { D1OrganizationStore } from "./organization-store.js";

/// Account-owned scopes reuse the coordinator protocol without joining an organization.
export async function personalSpace(db: D1Database, userId: string) {
  const store = new D1OrganizationStore(db);
  let scope = await store.personalOrganization(userId);
  if (!scope) {
    const now = Date.now();
    await db.batch([
      db
        .prepare(
          "INSERT INTO organizations (id,name,createdAt,updatedAt,personal_owner_id) VALUES (?,'Personal',?,?,?) ON CONFLICT DO NOTHING",
        )
        .bind(crypto.randomUUID(), now, now, userId),
      db
        .prepare(
          "INSERT INTO memberships (id,organization_id,user_id,role,createdAt,updatedAt) SELECT ?,id,?,'owner',?,? FROM organizations WHERE personal_owner_id=? ON CONFLICT(organization_id,user_id) DO NOTHING",
        )
        .bind(crypto.randomUUID(), userId, now, now, userId),
    ]);
    scope = await store.personalOrganization(userId);
  }
  if (!scope)
    throw new Error("Your personal account could not be opened; try again.");
  return { ...scope, role: "owner" as const, personal: true as const };
}
