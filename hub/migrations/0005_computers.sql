CREATE TABLE organization_computers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('darwin','linux')),
  daemon_version TEXT NOT NULL,
  protocol_minimum INTEGER NOT NULL,
  protocol_maximum INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  capabilities TEXT NOT NULL,
  last_seen_at INTEGER,
  registered_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, owner_user_id) REFERENCES memberships(organization_id, user_id) ON DELETE CASCADE
);

CREATE INDEX organization_computers_org ON organization_computers(organization_id, lower(name), id);

CREATE TABLE computer_connection_nonces (
  computer_id TEXT NOT NULL REFERENCES organization_computers(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (computer_id, nonce)
);
