CREATE TABLE linear_catalog (
 organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
 external_id TEXT NOT NULL,
 catalog TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE linear_workspace_mappings (
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL REFERENCES organization_workspaces(id) ON DELETE CASCADE,
 external_id TEXT NOT NULL,
 linear_team_id TEXT NOT NULL,
 linear_project_id TEXT NOT NULL DEFAULT '',
 remy_team_id TEXT REFERENCES organization_teams(id) ON DELETE SET NULL,
 status_map TEXT NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(organization_id,workspace_id),
 UNIQUE(organization_id,external_id,linear_team_id,linear_project_id)
);
CREATE TABLE linear_member_mappings (
 organization_id TEXT NOT NULL,
 external_id TEXT NOT NULL,
 linear_user_id TEXT NOT NULL,
 member_id TEXT NOT NULL,
 PRIMARY KEY(organization_id,external_id,linear_user_id),
 UNIQUE(organization_id,external_id,member_id),
 FOREIGN KEY(organization_id,member_id) REFERENCES memberships(organization_id,user_id) ON DELETE CASCADE
);
CREATE TABLE linear_updates (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 type TEXT NOT NULL,
 payload TEXT NOT NULL,
 received_at INTEGER NOT NULL
);
