CREATE TABLE member_preferences (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  permission_mode TEXT NOT NULL DEFAULT 'default' CHECK(permission_mode IN ('default','auto','acceptEdits','plan','bypassPermissions'))
);
