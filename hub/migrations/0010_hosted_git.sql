CREATE TABLE organization_git_installations (
 organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
 installation_id INTEGER NOT NULL UNIQUE,
 account TEXT NOT NULL
);
CREATE TABLE workspace_git_policies (
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL REFERENCES organization_workspaces(id) ON DELETE CASCADE,
 branches TEXT NOT NULL DEFAULT '[]',
 PRIMARY KEY (organization_id, workspace_id)
);
CREATE TABLE hosted_workspace_bindings (
 computer_id TEXT PRIMARY KEY REFERENCES organization_computers(id) ON DELETE CASCADE,
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL REFERENCES organization_workspaces(id) ON DELETE CASCADE,
 UNIQUE(organization_id,workspace_id)
);
