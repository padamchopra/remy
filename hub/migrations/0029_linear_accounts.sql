CREATE TABLE linear_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  label TEXT NOT NULL,
  credentials TEXT NOT NULL,
  expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'connected',
  generation INTEGER NOT NULL DEFAULT 1,
  refresh_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, external_id)
);
CREATE INDEX linear_accounts_user_idx ON linear_accounts(user_id);

-- The organization points at a Linear workspace. The secret stays on the member's account.
CREATE TABLE organization_linear_links (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  label TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Leaving removes that person's sign-in from the organization. The link goes
-- only when nobody who remains has authorized that Linear workspace.
CREATE TRIGGER clear_linear_link_when_members_leave
AFTER DELETE ON memberships
BEGIN
  DELETE FROM organization_linear_links
  WHERE organization_id = OLD.organization_id
    AND NOT EXISTS (
      SELECT 1 FROM memberships m
      JOIN linear_accounts a ON a.user_id = m.user_id
        AND a.external_id = organization_linear_links.external_id
      WHERE m.organization_id = OLD.organization_id
    );
END;
