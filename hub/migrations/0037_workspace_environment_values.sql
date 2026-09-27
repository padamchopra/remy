-- A workspace has one environment: a list of values, each shared with the
-- workspace or kept to the person who added it. Named environments and their
-- assignments are gone, and their values with them.
DROP TABLE IF EXISTS workspace_environment_bindings;
DROP TABLE IF EXISTS reusable_environments;
CREATE TABLE workspace_environment_values (
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('variable','secret')),
  ciphertext TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (organization_id, workspace_id, id),
  UNIQUE (organization_id, workspace_id, key),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES organization_workspaces(organization_id, id) ON DELETE CASCADE
);
-- Personal values follow their creator into every thread they start, in any
-- workspace of any organization, so they belong to the person alone.
CREATE TABLE personal_environment_values (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('variable','secret')),
  ciphertext TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, key)
);
