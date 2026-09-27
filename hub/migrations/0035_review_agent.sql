-- The review agent. A review is an ordinary thread with a pull request
-- attached; these tables hold what the hub knows about it. Rules are
-- personal: owned by one person, never shared, in every organization.
CREATE TABLE review_rules (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 -- owner/name, lower case, so a rule follows the repository across
 -- computers and organizations; NULL applies to all your workspaces.
 repository TEXT,
 text TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1,
 source_repository TEXT,
 source_number INTEGER,
 source_finding_id TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX review_rules_user ON review_rules(user_id, repository);

-- One row per review thread. head_sha is the commit the next review turn is
-- about; reviewed_sha is the last commit findings were reported for.
CREATE TABLE review_threads (
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 computer_id TEXT NOT NULL,
 thread_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL REFERENCES organization_workspaces(id) ON DELETE CASCADE,
 repository TEXT NOT NULL,
 pull_number INTEGER NOT NULL,
 title TEXT NOT NULL,
 base_ref TEXT NOT NULL,
 head_ref TEXT NOT NULL,
 started_sha TEXT NOT NULL,
 head_sha TEXT NOT NULL,
 reviewed_sha TEXT,
 provider TEXT,
 model TEXT,
 rules_applied INTEGER NOT NULL DEFAULT 0,
 summary TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(organization_id, computer_id, thread_id)
);
CREATE INDEX review_threads_pull ON review_threads(organization_id, user_id, repository, pull_number, created_at);

CREATE TABLE review_findings (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL,
 computer_id TEXT NOT NULL,
 thread_id TEXT NOT NULL,
 path TEXT NOT NULL,
 start_line INTEGER NOT NULL,
 end_line INTEGER NOT NULL,
 side TEXT NOT NULL CHECK(side IN ('RIGHT','LEFT')),
 severity TEXT NOT NULL CHECK(severity IN ('must','should','note')),
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 suggestion TEXT,
 rule_ids TEXT NOT NULL DEFAULT '[]',
 depends_on INTEGER,
 commit_sha TEXT NOT NULL,
 -- open | dismissed | added-to-github | resolved (the agent found it fixed)
 status TEXT NOT NULL DEFAULT 'open',
 github_comment_id TEXT,
 position INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 FOREIGN KEY(organization_id, computer_id, thread_id) REFERENCES review_threads(organization_id, computer_id, thread_id) ON DELETE CASCADE
);
CREATE INDEX review_findings_thread ON review_findings(organization_id, computer_id, thread_id, position);

-- What the agent suggests after a correction. Nothing here is a rule until
-- its owner accepts it.
CREATE TABLE review_rule_proposals (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL,
 computer_id TEXT NOT NULL,
 thread_id TEXT NOT NULL,
 text TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(scope IN ('repository','all')),
 reason TEXT NOT NULL,
 finding_id TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','discarded')),
 rule_id TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 FOREIGN KEY(organization_id, computer_id, thread_id) REFERENCES review_threads(organization_id, computer_id, thread_id) ON DELETE CASCADE
);
CREATE INDEX review_rule_proposals_thread ON review_rule_proposals(organization_id, computer_id, thread_id, created_at);
