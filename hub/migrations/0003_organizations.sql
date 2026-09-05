CREATE TABLE organization_invites (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  email TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  expires_at INTEGER NOT NULL,
  accepted_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  accepted_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX organization_invites_org_idx ON organization_invites(organization_id);

CREATE TABLE organization_teams (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (organization_id, name)
);

CREATE TABLE organization_team_members (
  organization_id TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES organization_teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id),
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships(organization_id, user_id) ON DELETE CASCADE
);
CREATE INDEX organization_team_members_org_idx ON organization_team_members(organization_id);

CREATE TABLE organization_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX organization_audit_events_org_created_idx ON organization_audit_events(organization_id, created_at);
