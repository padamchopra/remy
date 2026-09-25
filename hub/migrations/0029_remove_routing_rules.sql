DROP TABLE IF EXISTS organization_routing;
UPDATE github_monitoring SET enabled=0, agent_id=NULL;
UPDATE linear_board_settings SET agent_map='{}';
