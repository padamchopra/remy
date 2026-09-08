import { computerCapabilitiesSchema, computerRegistrationSchema, type ComputerCapabilities, type ComputerRegistration } from "@remy/contract";

export type StoredComputer = ComputerRegistration & { lastSeenAt: number | null };

export interface ComputerStore {
  computer(organizationId: string, computerId: string): Promise<StoredComputer | undefined>;
  computers(organizationId: string): Promise<StoredComputer[]>;
  register(computer: StoredComputer): Promise<"created" | "updated" | "conflict">;
  seen(organizationId: string, computerId: string, at: number, capabilities?: ComputerCapabilities, daemonVersion?: string): Promise<boolean>;
  claimNonce(computerId: string, nonce: string, expiresAt: number, now: number): Promise<boolean>;
}

type Row = Record<string, unknown>;

function fromRow(row: Row): StoredComputer {
  return {
    ...computerRegistrationSchema.parse({
      computerId: row.id,
      organizationId: row.organization_id,
      ownerUserId: row.owner_user_id,
      name: row.name,
      platform: row.platform,
      daemonVersion: row.daemon_version,
      protocol: { minimum: row.protocol_minimum, maximum: row.protocol_maximum },
      publicKey: row.public_key,
      capabilities: JSON.parse(String(row.capabilities)),
      registeredAt: row.registered_at,
      updatedAt: row.updated_at,
    }),
    lastSeenAt: row.last_seen_at === null || row.last_seen_at === undefined ? null : Number(row.last_seen_at),
  };
}

export class D1ComputerStore implements ComputerStore {
  constructor(private readonly db: D1Database) {}

  async computer(organizationId: string, computerId: string) {
    const row = await this.db.prepare("SELECT * FROM organization_computers WHERE organization_id=? AND id=?").bind(organizationId, computerId).first<Row>();
    return row ? fromRow(row) : undefined;
  }

  async computers(organizationId: string) {
    const rows = await this.db.prepare("SELECT * FROM organization_computers WHERE organization_id=? ORDER BY lower(name),id").bind(organizationId).all<Row>();
    return rows.results.map(fromRow);
  }

  async register(computer: StoredComputer) {
    const existing = await this.db.prepare("SELECT organization_id,owner_user_id,public_key FROM organization_computers WHERE id=?").bind(computer.computerId).first<Row>();
    if (existing && (existing.organization_id !== computer.organizationId || existing.owner_user_id !== computer.ownerUserId)) return "conflict" as const;
    await this.db.prepare(`INSERT INTO organization_computers (id,organization_id,owner_user_id,name,platform,daemon_version,protocol_minimum,protocol_maximum,public_key,capabilities,last_seen_at,registered_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,platform=excluded.platform,daemon_version=excluded.daemon_version,protocol_minimum=excluded.protocol_minimum,protocol_maximum=excluded.protocol_maximum,public_key=excluded.public_key,capabilities=excluded.capabilities,updated_at=excluded.updated_at`)
      .bind(computer.computerId, computer.organizationId, computer.ownerUserId, computer.name, computer.platform, computer.daemonVersion, computer.protocol.minimum, computer.protocol.maximum, computer.publicKey, JSON.stringify(computer.capabilities), computer.lastSeenAt, computer.registeredAt, computer.updatedAt).run();
    return existing ? "updated" as const : "created" as const;
  }

  async seen(organizationId: string, computerId: string, at: number, capabilities?: ComputerCapabilities, daemonVersion?: string) {
    const result = capabilities && daemonVersion
      ? await this.db.prepare("UPDATE organization_computers SET last_seen_at=?,capabilities=?,daemon_version=?,updated_at=? WHERE organization_id=? AND id=?").bind(at, JSON.stringify(computerCapabilitiesSchema.parse(capabilities)), daemonVersion, at, organizationId, computerId).run()
      : await this.db.prepare("UPDATE organization_computers SET last_seen_at=? WHERE organization_id=? AND id=?").bind(at, organizationId, computerId).run();
    return result.meta.changes === 1;
  }

  async claimNonce(computerId: string, nonce: string, expiresAt: number, now: number) {
    await this.db.prepare("DELETE FROM computer_connection_nonces WHERE expires_at<?").bind(now).run();
    try { await this.db.prepare("INSERT INTO computer_connection_nonces (computer_id,nonce,expires_at) VALUES (?,?,?)").bind(computerId, nonce, expiresAt).run(); return true; } catch { return false; }
  }
}
