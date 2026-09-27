CREATE TABLE member_linear_links (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  label TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships(organization_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, external_id) REFERENCES linear_accounts(user_id, external_id) ON DELETE CASCADE
);

INSERT INTO member_linear_links(organization_id,user_id,external_id,label,updated_at)
SELECT l.organization_id,m.user_id,l.external_id,l.label,l.updated_at
FROM organization_linear_links l
JOIN memberships m ON m.organization_id=l.organization_id
JOIN linear_accounts a ON a.user_id=m.user_id AND a.external_id=l.external_id;

DROP TRIGGER clear_linear_link_when_members_leave;
DROP TABLE organization_linear_links;
