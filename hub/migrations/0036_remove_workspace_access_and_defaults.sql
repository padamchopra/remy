-- Every member of an organization reaches every workspace in it, and a
-- workspace has no default model of its own: the composer and the computer
-- choose. The restricted column stays, always 0, so no table is rebuilt.
UPDATE organization_workspaces SET restricted=0;
DROP TABLE IF EXISTS organization_workspace_teams;
DROP TABLE IF EXISTS organization_workspace_members;
DROP TABLE IF EXISTS member_workspace_model_defaults;
