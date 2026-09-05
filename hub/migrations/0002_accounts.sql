CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  client_kind TEXT NOT NULL CHECK (client_kind IN ('web', 'phone', 'computer', 'cli')),
  client_name TEXT NOT NULL,
  access_token_hash TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT UNIQUE,
  access_expires_at INTEGER NOT NULL,
  refresh_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);

CREATE TABLE device_authorizations (
  id TEXT PRIMARY KEY NOT NULL,
  device_code_hash TEXT NOT NULL UNIQUE,
  user_code_hash TEXT NOT NULL UNIQUE,
  client_kind TEXT NOT NULL CHECK (client_kind IN ('phone', 'computer', 'cli')),
  client_name TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  interval_seconds INTEGER NOT NULL,
  last_polled_at INTEGER,
  approved_user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  denied_at INTEGER,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE verified_emails (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  verified_at INTEGER NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX verified_emails_user_id_idx ON verified_emails(user_id);

CREATE TABLE organization_domains (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain TEXT PRIMARY KEY NOT NULL,
  verified_at INTEGER,
  sso_enforced INTEGER NOT NULL DEFAULT 0 CHECK (sso_enforced IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE TABLE email_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  recipient TEXT NOT NULL,
  template TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
