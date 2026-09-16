CREATE TABLE member_model_favorites (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  model_key TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id, model_key)
);
