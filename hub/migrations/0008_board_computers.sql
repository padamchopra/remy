CREATE TABLE organization_board_computers (
  organization_id TEXT NOT NULL,
  computer_id TEXT NOT NULL REFERENCES organization_computers(id) ON DELETE CASCADE,
  granted_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (organization_id, computer_id),
  FOREIGN KEY (organization_id, granted_by) REFERENCES memberships(organization_id,user_id) ON DELETE CASCADE
);
