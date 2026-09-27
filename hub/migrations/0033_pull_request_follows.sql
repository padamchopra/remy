-- Monitoring moved from a per-computer poller and the unused github_monitoring
-- table to the hub: a pull request is watched by one thread, and verified
-- webhooks reach that thread as messages.
DROP TABLE IF EXISTS github_monitoring;
CREATE TABLE pull_request_follows (
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL REFERENCES organization_workspaces(id) ON DELETE CASCADE,
 pull_number INTEGER NOT NULL,
 computer_id TEXT NOT NULL,
 thread_id TEXT NOT NULL,
 member_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(organization_id,workspace_id,pull_number)
);
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
-- A receipt for a watched pull request carries the message its thread gets;
-- delivered_at is set once the thread accepted it, and attempted_at claims a
-- try so the receipt and the retry sweep do not send it twice.
ALTER TABLE github_activity ADD COLUMN message TEXT;
ALTER TABLE github_activity ADD COLUMN delivered_at INTEGER;
ALTER TABLE github_activity ADD COLUMN attempted_at INTEGER;
CREATE INDEX github_activity_undelivered ON github_activity(created_at) WHERE message IS NOT NULL AND delivered_at IS NULL;
CREATE INDEX github_activity_pull ON github_activity(organization_id,workspace_id,pull_number,created_at);
