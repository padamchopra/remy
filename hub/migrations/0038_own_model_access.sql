-- A person's choice to run the cloud threads they start in one organization on
-- their own Personal API key for one provider. No row means off. The key stays
-- in their Personal model access; only threads they start here may use it.
CREATE TABLE IF NOT EXISTS organization_own_model_access (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('anthropic','openai','router','openrouter')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (organization_id, user_id, provider)
);
