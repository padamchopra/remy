ALTER TABLE hosted_workspace_bindings RENAME TO hosted_workspace_bindings_legacy;
CREATE TABLE hosted_workspace_bindings (
 computer_id TEXT PRIMARY KEY REFERENCES organization_computers(id) ON DELETE CASCADE,
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL,
 FOREIGN KEY (organization_id, workspace_id) REFERENCES organization_workspaces(organization_id, id) ON DELETE CASCADE
);
INSERT INTO hosted_workspace_bindings SELECT * FROM hosted_workspace_bindings_legacy;
DROP TABLE hosted_workspace_bindings_legacy;
CREATE INDEX hosted_workspace_bindings_workspace ON hosted_workspace_bindings(organization_id, workspace_id);

CREATE TABLE reusable_environments (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (organization_id, id)
);
CREATE TABLE workspace_environment_bindings (
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  PRIMARY KEY (organization_id, workspace_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES organization_workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, environment_id) REFERENCES reusable_environments(organization_id, id) ON DELETE CASCADE
);
