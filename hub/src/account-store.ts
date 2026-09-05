export type ClientKind = "web" | "phone" | "computer" | "cli";

export type SessionRecord = {
  id: string;
  userId: string;
  clientKind: ClientKind;
  clientName: string;
  accessTokenHash: string;
  refreshTokenHash?: string;
  accessExpiresAt: number;
  refreshExpiresAt?: number;
  createdAt: number;
  lastSeenAt: number;
  revokedAt?: number;
};

export type DeviceAuthorizationRecord = {
  id: string;
  deviceCodeHash: string;
  userCodeHash: string;
  clientKind: Exclude<ClientKind, "web">;
  clientName: string;
  expiresAt: number;
  intervalSeconds: number;
  lastPolledAt?: number;
  approvedUserId?: string;
  deniedAt?: number;
  consumedAt?: number;
  createdAt: number;
};

export type ProfileRecord = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string;
  verifiedEmails: string[];
};

export type SsoPolicy = {
  organizationId: string;
  domain: string;
  enforced: boolean;
  verified: boolean;
  providerId?: string;
  protocol?: "oidc" | "saml";
};

export interface AccountStore {
  createSession(session: SessionRecord): Promise<void>;
  sessionByAccessHash(hash: string): Promise<SessionRecord | undefined>;
  sessionByRefreshHash(hash: string): Promise<SessionRecord | undefined>;
  rotateSession(id: string, currentRefreshHash: string, values: Pick<SessionRecord, "accessTokenHash" | "refreshTokenHash" | "accessExpiresAt" | "refreshExpiresAt" | "lastSeenAt">): Promise<boolean>;
  revokeSession(id: string, at: number): Promise<void>;
  revokeSessions(userId: string, at: number): Promise<void>;
  sessionsFor(userId: string): Promise<SessionRecord[]>;
  createDeviceAuthorization(record: DeviceAuthorizationRecord): Promise<void>;
  deviceAuthorizationByDeviceHash(hash: string): Promise<DeviceAuthorizationRecord | undefined>;
  deviceAuthorizationByUserHash(hash: string): Promise<DeviceAuthorizationRecord | undefined>;
  updateDeviceAuthorization(id: string, patch: Partial<DeviceAuthorizationRecord>): Promise<void>;
  consumeDeviceAuthorization(id: string, at: number): Promise<boolean>;
  profile(userId: string): Promise<ProfileRecord | undefined>;
  updateProfile(userId: string, patch: { name?: string; image?: string | null }): Promise<ProfileRecord>;
  ssoPolicyForDomain(domain: string): Promise<SsoPolicy | undefined>;
}

type Row = Record<string, unknown>;

function number(row: Row, key: string): number {
  return Number(row[key]);
}

function optionalNumber(row: Row, key: string): number | undefined {
  return row[key] === null || row[key] === undefined ? undefined : Number(row[key]);
}

function sessionFrom(row: Row): SessionRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    clientKind: String(row.client_kind) as ClientKind,
    clientName: String(row.client_name),
    accessTokenHash: String(row.access_token_hash),
    ...(row.refresh_token_hash ? { refreshTokenHash: String(row.refresh_token_hash) } : {}),
    accessExpiresAt: number(row, "access_expires_at"),
    ...(optionalNumber(row, "refresh_expires_at") !== undefined ? { refreshExpiresAt: number(row, "refresh_expires_at") } : {}),
    createdAt: number(row, "created_at"),
    lastSeenAt: number(row, "last_seen_at"),
    ...(optionalNumber(row, "revoked_at") !== undefined ? { revokedAt: number(row, "revoked_at") } : {}),
  };
}

function deviceFrom(row: Row): DeviceAuthorizationRecord {
  return {
    id: String(row.id),
    deviceCodeHash: String(row.device_code_hash),
    userCodeHash: String(row.user_code_hash),
    clientKind: String(row.client_kind) as Exclude<ClientKind, "web">,
    clientName: String(row.client_name),
    expiresAt: number(row, "expires_at"),
    intervalSeconds: number(row, "interval_seconds"),
    ...(optionalNumber(row, "last_polled_at") !== undefined ? { lastPolledAt: number(row, "last_polled_at") } : {}),
    ...(row.approved_user_id ? { approvedUserId: String(row.approved_user_id) } : {}),
    ...(optionalNumber(row, "denied_at") !== undefined ? { deniedAt: number(row, "denied_at") } : {}),
    ...(optionalNumber(row, "consumed_at") !== undefined ? { consumedAt: number(row, "consumed_at") } : {}),
    createdAt: number(row, "created_at"),
  };
}

export class D1AccountStore implements AccountStore {
  constructor(private readonly db: D1Database) {}

  async createSession(s: SessionRecord): Promise<void> {
    await this.db.prepare("INSERT INTO auth_sessions (id,user_id,client_kind,client_name,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(s.id, s.userId, s.clientKind, s.clientName, s.accessTokenHash, s.refreshTokenHash ?? null, s.accessExpiresAt, s.refreshExpiresAt ?? null, s.createdAt, s.lastSeenAt).run();
  }

  async sessionByAccessHash(hash: string): Promise<SessionRecord | undefined> {
    const row = await this.db.prepare("SELECT * FROM auth_sessions WHERE access_token_hash = ?").bind(hash).first<Row>();
    return row ? sessionFrom(row) : undefined;
  }

  async sessionByRefreshHash(hash: string): Promise<SessionRecord | undefined> {
    const row = await this.db.prepare("SELECT * FROM auth_sessions WHERE refresh_token_hash = ?").bind(hash).first<Row>();
    return row ? sessionFrom(row) : undefined;
  }

  async rotateSession(id: string, currentRefreshHash: string, values: Pick<SessionRecord, "accessTokenHash" | "refreshTokenHash" | "accessExpiresAt" | "refreshExpiresAt" | "lastSeenAt">): Promise<boolean> {
    const result = await this.db.prepare("UPDATE auth_sessions SET access_token_hash=?,refresh_token_hash=?,access_expires_at=?,refresh_expires_at=?,last_seen_at=? WHERE id=? AND refresh_token_hash=? AND revoked_at IS NULL")
      .bind(values.accessTokenHash, values.refreshTokenHash ?? null, values.accessExpiresAt, values.refreshExpiresAt ?? null, values.lastSeenAt, id, currentRefreshHash).run();
    return result.meta.changes === 1;
  }

  async revokeSession(id: string, at: number): Promise<void> {
    await this.db.prepare("UPDATE auth_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL").bind(at, id).run();
  }

  async revokeSessions(userId: string, at: number): Promise<void> {
    await this.db.prepare("UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(at, userId).run();
  }

  async sessionsFor(userId: string): Promise<SessionRecord[]> {
    const result = await this.db.prepare("SELECT * FROM auth_sessions WHERE user_id=? ORDER BY last_seen_at DESC").bind(userId).all<Row>();
    return result.results.map(sessionFrom);
  }

  async createDeviceAuthorization(d: DeviceAuthorizationRecord): Promise<void> {
    await this.db.prepare("INSERT INTO device_authorizations (id,device_code_hash,user_code_hash,client_kind,client_name,expires_at,interval_seconds,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(d.id, d.deviceCodeHash, d.userCodeHash, d.clientKind, d.clientName, d.expiresAt, d.intervalSeconds, d.createdAt).run();
  }

  async deviceAuthorizationByDeviceHash(hash: string): Promise<DeviceAuthorizationRecord | undefined> {
    const row = await this.db.prepare("SELECT * FROM device_authorizations WHERE device_code_hash=?").bind(hash).first<Row>();
    return row ? deviceFrom(row) : undefined;
  }

  async deviceAuthorizationByUserHash(hash: string): Promise<DeviceAuthorizationRecord | undefined> {
    const row = await this.db.prepare("SELECT * FROM device_authorizations WHERE user_code_hash=?").bind(hash).first<Row>();
    return row ? deviceFrom(row) : undefined;
  }

  async updateDeviceAuthorization(id: string, patch: Partial<DeviceAuthorizationRecord>): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];
    const mapping = { lastPolledAt: "last_polled_at", approvedUserId: "approved_user_id", deniedAt: "denied_at", consumedAt: "consumed_at" } as const;
    for (const key of Object.keys(mapping) as (keyof typeof mapping)[]) {
      if (patch[key] === undefined) continue;
      fields.push(`${mapping[key]}=?`);
      values.push(patch[key]);
    }
    if (!fields.length) return;
    await this.db.prepare(`UPDATE device_authorizations SET ${fields.join(",")} WHERE id=?`).bind(...values, id).run();
  }

  async consumeDeviceAuthorization(id: string, at: number): Promise<boolean> {
    const result = await this.db.prepare("UPDATE device_authorizations SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND denied_at IS NULL AND approved_user_id IS NOT NULL AND expires_at>?")
      .bind(at, id, at).run();
    return result.meta.changes === 1;
  }

  async profile(userId: string): Promise<ProfileRecord | undefined> {
    const user = await this.db.prepare("SELECT id,name,email,emailVerified,image FROM user WHERE id=?").bind(userId).first<Row>();
    if (!user) return undefined;
    const emails = await this.db.prepare("SELECT email FROM verified_emails WHERE user_id=? ORDER BY is_primary DESC,created_at").bind(userId).all<Row>();
    return { id: String(user.id), name: String(user.name), email: String(user.email), emailVerified: Boolean(user.emailVerified), ...(user.image ? { image: String(user.image) } : {}), verifiedEmails: emails.results.map((row) => String(row.email)) };
  }

  async updateProfile(userId: string, patch: { name?: string; image?: string | null }): Promise<ProfileRecord> {
    if (patch.name !== undefined) await this.db.prepare("UPDATE user SET name=?,updatedAt=? WHERE id=?").bind(patch.name, Date.now(), userId).run();
    if (patch.image !== undefined) await this.db.prepare("UPDATE user SET image=?,updatedAt=? WHERE id=?").bind(patch.image, Date.now(), userId).run();
    const profile = await this.profile(userId);
    if (!profile) throw new Error("Profile not found");
    return profile;
  }

  async ssoPolicyForDomain(domain: string): Promise<SsoPolicy | undefined> {
    const row = await this.db.prepare("SELECT d.organization_id,d.domain,d.verified_at,d.sso_enforced,p.providerId,p.oidcConfig,p.samlConfig FROM organization_domains d LEFT JOIN ssoProvider p ON p.organizationId=d.organization_id AND lower(p.domain)=lower(d.domain) WHERE lower(d.domain)=lower(?)")
      .bind(domain).first<Row>();
    if (!row) return undefined;
    return { organizationId: String(row.organization_id), domain: String(row.domain), verified: row.verified_at !== null, enforced: Boolean(row.sso_enforced), ...(row.providerId ? { providerId: String(row.providerId), protocol: row.samlConfig ? "saml" : "oidc" } : {}) };
  }
}
