CREATE TABLE organization_routing (
 organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
 rules TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE member_computer_preferences (
 organization_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES organization_workspaces(id) ON DELETE CASCADE,
 computer_id TEXT NOT NULL REFERENCES organization_computers(id) ON DELETE CASCADE,
 PRIMARY KEY(organization_id,user_id,workspace_id),
 FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id) ON DELETE CASCADE
);
