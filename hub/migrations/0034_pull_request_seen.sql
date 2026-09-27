-- Monitoring left the per-computer poller and the unused github_monitoring
-- table; nothing replaces them.
DROP TABLE IF EXISTS github_monitoring;
-- When each member last opened a pull request's Activity, so its tab can
-- count what arrived since.
CREATE TABLE pull_request_seen (
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL REFERENCES organization_workspaces(id) ON DELETE CASCADE,
 pull_number INTEGER NOT NULL,
 seen_at INTEGER NOT NULL,
 PRIMARY KEY(organization_id,user_id,workspace_id,pull_number)
);
