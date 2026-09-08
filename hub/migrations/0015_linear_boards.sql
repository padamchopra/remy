CREATE TABLE linear_board_settings (
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL REFERENCES organization_workspaces(id) ON DELETE CASCADE,
 external_id TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0,
 bootstrap INTEGER NOT NULL DEFAULT 1,
 agent_map TEXT NOT NULL DEFAULT '{}',
 error TEXT,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(organization_id,workspace_id)
);
ALTER TABLE linear_updates ADD COLUMN processed INTEGER NOT NULL DEFAULT 0;
CREATE INDEX linear_updates_pending ON linear_updates(organization_id,processed,received_at);
