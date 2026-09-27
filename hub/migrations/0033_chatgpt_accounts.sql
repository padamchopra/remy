-- A person's ChatGPT sign-in for cloud Codex, sealed under their Personal scope.
-- The hub is its only holder, so refresh-token rotation happens in one place.
CREATE TABLE IF NOT EXISTS personal_chatgpt_accounts (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
-- A person's choice not to use their ChatGPT sign-in in one organization.
-- No row means the default: available in every organization they belong to.
CREATE TABLE IF NOT EXISTS organization_chatgpt_access (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);
