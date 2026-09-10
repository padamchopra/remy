ALTER TABLE organizations ADD COLUMN personal_owner_id TEXT REFERENCES user(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX organizations_personal_owner ON organizations(personal_owner_id) WHERE personal_owner_id IS NOT NULL;

CREATE TRIGGER personal_membership_insert BEFORE INSERT ON memberships
WHEN EXISTS (SELECT 1 FROM organizations WHERE id=NEW.organization_id AND personal_owner_id IS NOT NULL AND (personal_owner_id!=NEW.user_id OR NEW.role!='owner'))
BEGIN SELECT RAISE(ABORT, 'Personal access belongs to its account'); END;
CREATE TRIGGER personal_membership_update BEFORE UPDATE ON memberships
WHEN EXISTS (SELECT 1 FROM organizations WHERE id=NEW.organization_id AND personal_owner_id IS NOT NULL AND (personal_owner_id!=NEW.user_id OR NEW.role!='owner'))
BEGIN SELECT RAISE(ABORT, 'Personal access belongs to its account'); END;
CREATE TRIGGER personal_invite_insert BEFORE INSERT ON organization_invites
WHEN EXISTS (SELECT 1 FROM organizations WHERE id=NEW.organization_id AND personal_owner_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Personal access cannot be shared'); END;
CREATE TRIGGER personal_team_insert BEFORE INSERT ON organization_teams
WHEN EXISTS (SELECT 1 FROM organizations WHERE id=NEW.organization_id AND personal_owner_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Personal access cannot be shared'); END;
CREATE TRIGGER personal_owner_update BEFORE UPDATE OF personal_owner_id ON organizations
WHEN OLD.personal_owner_id IS NOT NEW.personal_owner_id
BEGIN SELECT RAISE(ABORT, 'Personal ownership cannot change'); END;
