CREATE TABLE development_computers (
  computer_id TEXT PRIMARY KEY REFERENCES organization_computers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  approved_at INTEGER NOT NULL
);
