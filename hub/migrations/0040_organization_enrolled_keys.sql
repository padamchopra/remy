-- Exact Personal credentials a member enrolls for everyone in an organization.
-- Null preserves old provider-level grants by resolving the current active key.
ALTER TABLE organization_own_model_access ADD COLUMN key_ids TEXT;
ALTER TABLE organization_cloud_shares ADD COLUMN key_ids TEXT;
