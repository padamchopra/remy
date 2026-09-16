CREATE TABLE member_computer_model_defaults (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (organization_id,user_id,computer_id),
  FOREIGN KEY (organization_id,user_id) REFERENCES memberships(organization_id,user_id) ON DELETE CASCADE
);
CREATE TRIGGER remove_deleted_computer_model_defaults AFTER DELETE ON organization_computers
BEGIN
  DELETE FROM member_computer_model_defaults WHERE organization_id=OLD.organization_id AND computer_id=OLD.id;
END;
