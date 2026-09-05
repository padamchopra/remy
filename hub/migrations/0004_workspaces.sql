CREATE UNIQUE INDEX organization_teams_org_id_uidx ON organization_teams(organization_id, id);

CREATE TABLE organization_workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  origin TEXT NOT NULL,
  restricted INTEGER NOT NULL DEFAULT 0 CHECK (restricted IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (organization_id, origin)
);
CREATE INDEX organization_workspaces_org_name_idx ON organization_workspaces(organization_id, name);
CREATE UNIQUE INDEX organization_workspaces_org_id_uidx ON organization_workspaces(organization_id, id);

CREATE TABLE organization_workspace_teams (
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization_workspaces(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES organization_teams(id) ON DELETE CASCADE,
  PRIMARY KEY (workspace_id, team_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES organization_workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, team_id) REFERENCES organization_teams(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE organization_workspace_members (
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES organization_workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES organization_workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships(organization_id, user_id) ON DELETE CASCADE
);
