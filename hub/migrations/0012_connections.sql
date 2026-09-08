CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  external_id TEXT NOT NULL,
  label TEXT NOT NULL,
  credentials TEXT NOT NULL,
  expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'connected',
  generation INTEGER NOT NULL DEFAULT 1,
  refresh_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE(organization_id, provider, subject)
);
CREATE TABLE connection_identities (
  connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id) ON DELETE CASCADE
);
CREATE TABLE connection_oauth_states (
  state_hash TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  epoch INTEGER NOT NULL
);
CREATE TABLE connection_deliveries (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  received_at INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE(provider,delivery_id)
);
CREATE INDEX connection_delivery_pending ON connection_deliveries(status,received_at);

CREATE TRIGGER delete_departed_connection AFTER DELETE ON connection_identities BEGIN
  DELETE FROM connections WHERE id=OLD.connection_id;
END;

CREATE TABLE connection_epochs (
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 provider TEXT NOT NULL,
 subject TEXT NOT NULL,
 generation INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(organization_id,provider,subject)
);
