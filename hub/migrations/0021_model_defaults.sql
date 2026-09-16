CREATE TABLE member_model_defaults (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL DEFAULT ''
);
CREATE TABLE member_workspace_model_defaults (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES organization_workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, workspace_id)
);
