CREATE TABLE organization_cloud_shares_next (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('fly-sprites', 'modal', 'cursor-cloud')),
  shared_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  start_providers TEXT,
  PRIMARY KEY (organization_id, source_organization_id, provider),
  FOREIGN KEY (organization_id, shared_by) REFERENCES memberships(organization_id, user_id) ON DELETE CASCADE
);
INSERT INTO organization_cloud_shares_next
  SELECT organization_id, source_organization_id, provider, shared_by, created_at, start_providers
  FROM organization_cloud_shares;
DROP TABLE organization_cloud_shares;
ALTER TABLE organization_cloud_shares_next RENAME TO organization_cloud_shares;
CREATE INDEX organization_cloud_shares_source ON organization_cloud_shares(source_organization_id, provider);
