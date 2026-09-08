CREATE TABLE github_repositories (
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL REFERENCES organization_workspaces(id) ON DELETE CASCADE,
 repository_id INTEGER NOT NULL,
 full_name TEXT NOT NULL,
 installation_id INTEGER NOT NULL,
 PRIMARY KEY(organization_id,workspace_id),
 UNIQUE(organization_id,repository_id)
);
CREATE TABLE github_monitoring (
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL REFERENCES organization_workspaces(id) ON DELETE CASCADE,
 pull_number INTEGER NOT NULL DEFAULT 0,
 enabled INTEGER NOT NULL DEFAULT 0,
 agent_id TEXT,
 PRIMARY KEY(organization_id,workspace_id,pull_number)
);
CREATE TABLE github_activity (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL REFERENCES organization_workspaces(id) ON DELETE CASCADE,
 event TEXT NOT NULL,
 pull_number INTEGER NOT NULL,
 summary TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 phase TEXT NOT NULL DEFAULT 'received',
 thread_id TEXT,
 computer_id TEXT,
 member_id TEXT,
 reply_id INTEGER
);

CREATE UNIQUE INDEX connection_member_external ON connections(organization_id,provider,external_id) WHERE subject<>'';
