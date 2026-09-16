CREATE TABLE organization_computer_shares (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  computer_id TEXT NOT NULL REFERENCES organization_computers(id) ON DELETE CASCADE,
  shared_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (organization_id, computer_id),
  FOREIGN KEY (organization_id, shared_by) REFERENCES memberships(organization_id, user_id) ON DELETE CASCADE
);

CREATE INDEX organization_computer_shares_source ON organization_computer_shares(source_organization_id, computer_id);

CREATE TABLE organization_cloud_shares (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('fly-sprites', 'modal')),
  shared_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (organization_id, source_organization_id, provider),
  FOREIGN KEY (organization_id, shared_by) REFERENCES memberships(organization_id, user_id) ON DELETE CASCADE
);

CREATE INDEX organization_cloud_shares_source ON organization_cloud_shares(source_organization_id, provider);
