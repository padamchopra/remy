-- Tasks and Linear ticket sync are gone. Each person's Linear sign-in
-- (linear_accounts) and an organization's chosen Linear workspace
-- (organization_linear_links) stay for the Linear MCP in threads.
DROP TABLE IF EXISTS organization_board_computers;
DROP TABLE IF EXISTS linear_board_settings;
DROP TABLE IF EXISTS linear_catalog;
DROP TABLE IF EXISTS linear_workspace_mappings;
DROP TABLE IF EXISTS linear_member_mappings;
DROP TABLE IF EXISTS linear_updates;
-- Linear webhook deliveries fed only ticket sync, and the hub no longer accepts them.
DELETE FROM connection_deliveries WHERE provider = 'linear';
