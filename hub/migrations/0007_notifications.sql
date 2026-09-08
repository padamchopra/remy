CREATE TABLE member_push_devices (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  token TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('production','sandbox')),
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(organization_id,token),
  FOREIGN KEY (organization_id,user_id) REFERENCES memberships(organization_id,user_id) ON DELETE CASCADE
);
CREATE TABLE hub_notifications (
  id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  PRIMARY KEY (organization_id,id,user_id),
  FOREIGN KEY (organization_id,user_id) REFERENCES memberships(organization_id,user_id) ON DELETE CASCADE,
  FOREIGN KEY (computer_id) REFERENCES organization_computers(id) ON DELETE CASCADE
);
CREATE TABLE notification_pushes (
  organization_id TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES member_push_devices(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  PRIMARY KEY (organization_id,notification_id,user_id,device_id),
  FOREIGN KEY (organization_id,notification_id,user_id) REFERENCES hub_notifications(organization_id,id,user_id) ON DELETE CASCADE
);
CREATE TRIGGER queue_member_push AFTER INSERT ON hub_notifications BEGIN
  INSERT INTO notification_pushes (organization_id,notification_id,user_id,device_id,next_attempt_at)
    SELECT NEW.organization_id,NEW.id,NEW.user_id,id,NEW.created_at FROM member_push_devices
    WHERE organization_id=NEW.organization_id AND user_id=NEW.user_id AND enabled=1;
END;
