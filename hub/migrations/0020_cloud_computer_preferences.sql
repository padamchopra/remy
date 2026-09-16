CREATE TABLE member_computer_preferences_next (
 organization_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES organization_workspaces(id) ON DELETE CASCADE,
 computer_id TEXT NOT NULL,
 PRIMARY KEY(organization_id,user_id,workspace_id),
 FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id) ON DELETE CASCADE
);
INSERT INTO member_computer_preferences_next SELECT organization_id,user_id,workspace_id,computer_id FROM member_computer_preferences;
DROP TABLE member_computer_preferences;
ALTER TABLE member_computer_preferences_next RENAME TO member_computer_preferences;
CREATE TRIGGER remove_deleted_computer_preferences AFTER DELETE ON organization_computers
BEGIN
 DELETE FROM member_computer_preferences WHERE organization_id=OLD.organization_id AND computer_id=OLD.id;
END;
