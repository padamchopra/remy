CREATE TABLE computers_with_policy (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id TEXT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  ownership TEXT NOT NULL DEFAULT 'personal' CHECK (ownership IN ('personal','organization','hosted')),
  access TEXT NOT NULL DEFAULT '{"mode":"owner","userIds":[],"teamIds":[]}',
  platform TEXT NOT NULL CHECK (platform IN ('darwin','linux')),
  daemon_version TEXT NOT NULL,
  protocol_minimum INTEGER NOT NULL,
  protocol_maximum INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  capabilities TEXT NOT NULL,
  last_seen_at INTEGER,
  registered_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id, owner_user_id) REFERENCES memberships(organization_id,user_id) ON DELETE CASCADE,
  CHECK ((ownership='personal' AND owner_user_id IS NOT NULL) OR (ownership!='personal' AND owner_user_id IS NULL))
);
INSERT INTO computers_with_policy (id,organization_id,owner_user_id,name,platform,daemon_version,protocol_minimum,protocol_maximum,public_key,capabilities,last_seen_at,registered_at,updated_at)
  SELECT id,organization_id,owner_user_id,name,platform,daemon_version,protocol_minimum,protocol_maximum,public_key,capabilities,last_seen_at,registered_at,updated_at FROM organization_computers;
CREATE TABLE saved_computer_nonces AS SELECT * FROM computer_connection_nonces;
DROP TABLE computer_connection_nonces;
DROP TABLE organization_computers;
ALTER TABLE computers_with_policy RENAME TO organization_computers;
CREATE INDEX organization_computers_org ON organization_computers(organization_id,lower(name),id);
CREATE TABLE computer_connection_nonces (
  computer_id TEXT NOT NULL REFERENCES organization_computers(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (computer_id,nonce)
);

INSERT INTO computer_connection_nonces SELECT * FROM saved_computer_nonces;
DROP TABLE saved_computer_nonces;
