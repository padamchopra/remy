CREATE TABLE organization_hosted_settings (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL DEFAULT '',
  settings TEXT NOT NULL,
  PRIMARY KEY (organization_id, workspace_id)
);
CREATE TABLE organization_secrets (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  PRIMARY KEY (organization_id, name)
);
