import {
  ConnectionError,
  ConnectionVault,
  connectionHash,
  type ConnectionTokens,
} from "./connections.js";
import type { OrganizationService } from "./organizations.js";

export const LINEAR_MCP_URL = "https://mcp.linear.app/mcp";
export const LINEAR_MISSING_NOTICE =
  "Connect your Linear account in Connections.";
export const LINEAR_REAUTH_NOTICE = "Reconnect your account in Connections.";

export type LinearAccountView = {
  id: string;
  externalId: string;
  label: string;
  status: string;
  updatedAt: number;
  general: boolean;
  organizationIds: string[];
};
export type LinearLinkView = { externalId: string; label: string } | null;
export type LinearThreadAccess =
  | { kind: "off" }
  | { kind: "notice"; notice: string }
  | { kind: "ready"; token: string; url: string; fingerprint: string };

type AccountRow = {
  id: string;
  user_id: string;
  external_id: string;
  label: string;
  credentials: string;
  expires_at: number | null;
  status: string;
  generation: number;
  refresh_until: number;
  updated_at: number;
};

type OAuthConfig = {
  clientId?: string | undefined;
  clientSecret?: (() => Promise<string>) | undefined;
  send?: typeof fetch | undefined;
};

/// A person's Linear sign-in. The organization stores which workspace it uses,
/// never a copy of the token.
export class LinearAccounts {
  constructor(
    private readonly db: D1Database,
    private readonly vault: ConnectionVault,
    private readonly organizations: OrganizationService,
    private readonly changed: (org: string) => Promise<void>,
    private readonly now = Date.now,
    private readonly oauth: OAuthConfig = {},
  ) {}

  async list(user: string): Promise<LinearAccountView[]> {
    const [rows, links] = await Promise.all([this.db
      .prepare(
        "SELECT id,external_id,label,status,updated_at FROM linear_accounts WHERE user_id=? ORDER BY updated_at,external_id",
      )
      .bind(user)
      .all<{
        id: string;
        external_id: string;
        label: string;
        status: string;
        updated_at: number;
      }>(), this.db
        .prepare(
          "SELECT l.external_id,l.organization_id,o.personal_owner_id FROM organization_linear_links l JOIN organizations o ON o.id=l.organization_id WHERE o.personal_owner_id=? OR EXISTS(SELECT 1 FROM memberships m WHERE m.organization_id=l.organization_id AND m.user_id=?)",
        )
        .bind(user, user)
        .all<{ external_id: string; organization_id: string; personal_owner_id: string | null }>()]);
    return rows.results.map((row) => ({
      id: row.id,
      externalId: row.external_id,
      label: row.label,
      status: row.status,
      updatedAt: row.updated_at,
      general: links.results.some((link) => link.external_id === row.external_id && link.personal_owner_id === user),
      organizationIds: links.results.filter((link) => link.external_id === row.external_id && !link.personal_owner_id).map((link) => link.organization_id),
    }));
  }

  async save(
    user: string,
    tokens: ConnectionTokens,
    identity: { id: string; label: string },
  ) {
    const id = await connectionHash(`linear:${user}:${identity.id}`);
    const context = `linear:${user}:${id}`;
    const credentials = await this.vault.seal(tokens, context);
    const expires = tokens.expires_in ? this.now() + tokens.expires_in * 1000 : null;
    await this.db
      .prepare(
        "INSERT INTO linear_accounts(id,user_id,external_id,label,credentials,expires_at,status,updated_at) VALUES(?,?,?,?,?,?,'connected',?) ON CONFLICT(user_id,external_id) DO UPDATE SET label=excluded.label,credentials=excluded.credentials,expires_at=excluded.expires_at,status='connected',refresh_until=0,generation=linear_accounts.generation+1,updated_at=excluded.updated_at",
      )
      .bind(id, user, identity.id, identity.label, credentials, expires, this.now())
      .run();
    return id;
  }

  async disconnect(user: string, accountId: string) {
    const row = await this.db
      .prepare("SELECT external_id FROM linear_accounts WHERE id=? AND user_id=?")
      .bind(accountId, user)
      .first<{ external_id: string }>();
    if (!row) throw new ConnectionError("Choose a Linear account.", 404);
    await this.db
      .prepare("DELETE FROM linear_accounts WHERE id=? AND user_id=?")
      .bind(accountId, user)
      .run();
    // A second Linear workspace can still be mid-consent. Disconnecting this
    // row must not burn that state or the shared OAuth epoch.
    await this.clearOrphanLinks(row.external_id);
    await this.notifyAvailability(user);
  }

  async link(org: string): Promise<LinearLinkView> {
    const row = await this.db
      .prepare("SELECT external_id,label FROM organization_linear_links WHERE organization_id=?")
      .bind(org)
      .first<{ external_id: string; label: string }>();
    return row ? { externalId: row.external_id, label: row.label } : null;
  }

  async view(org: string, user: string) {
    if (!(await this.isMember(org, user)))
      throw new ConnectionError("This connection action is unavailable.", 403);
    return { accounts: await this.list(user), link: await this.effectiveLink(org, user) };
  }

  async setLink(org: string, user: string, accountId: string | null) {
    if (!(await this.isMember(org, user)))
      throw new ConnectionError("This connection action is unavailable.", 403);
    if (!accountId) {
      await this.db
        .prepare("DELETE FROM organization_linear_links WHERE organization_id=?")
        .bind(org)
        .run();
      await this.notifyLink(org, user);
      return this.view(org, user);
    }
    const account = await this.db
      .prepare("SELECT external_id,label FROM linear_accounts WHERE id=? AND user_id=?")
      .bind(accountId, user)
      .first<{ external_id: string; label: string }>();
    if (!account) throw new ConnectionError("Choose one of your Linear accounts.");
    await this.db
      .prepare(
        "INSERT INTO organization_linear_links(organization_id,external_id,label,updated_at) VALUES(?,?,?,?) ON CONFLICT(organization_id) DO UPDATE SET external_id=excluded.external_id,label=excluded.label,updated_at=excluded.updated_at",
      )
      .bind(org, account.external_id, account.label, this.now())
      .run();
    await this.notifyLink(org, user);
    return this.view(org, user);
  }

  /// Sync may use the acting member, or the latest remaining member who still
  /// has this workspace. It never reads a token stored on the organization.
  async accessToken(org: string, user?: string) {
    const current = user ? await this.effectiveLink(org, user) : await this.link(org);
    if (!current) throw new ConnectionError("Choose a Linear account for this organization.");
    const row = user
      ? await this.memberAccount(org, user, current.externalId)
      : await this.db
          .prepare(
            "SELECT a.* FROM linear_accounts a JOIN memberships m ON m.user_id=a.user_id WHERE m.organization_id=? AND a.external_id=? AND a.status='connected' ORDER BY a.updated_at DESC LIMIT 1",
          )
          .bind(org, current.externalId)
          .first<AccountRow>();
    if (!row || row.status !== "connected")
      throw new ConnectionError("Reconnect your account to continue.", 409);
    return this.openToken(row);
  }

  async forThread(org: string, user: string): Promise<LinearThreadAccess> {
    const current = await this.effectiveLink(org, user);
    if (!current || !(await this.isMember(org, user))) return { kind: "off" };
    const row = await this.db
      .prepare("SELECT * FROM linear_accounts WHERE user_id=? AND external_id=?")
      .bind(user, current.externalId)
      .first<AccountRow>();
    if (!row) return { kind: "notice", notice: LINEAR_MISSING_NOTICE };
    if (row.status !== "connected") return { kind: "notice", notice: LINEAR_REAUTH_NOTICE };
    try {
      const token = await this.openToken(row);
      return {
        kind: "ready",
        token,
        url: LINEAR_MCP_URL,
        fingerprint: await linearFingerprint(token),
      };
    } catch {
      return { kind: "notice", notice: LINEAR_REAUTH_NOTICE };
    }
  }

  async accessNotice(org: string, user: string) {
    if (!(await this.isMember(org, user)))
      throw new ConnectionError("This connection action is unavailable.", 403);
    const access = await this.forThread(org, user);
    return access.kind === "notice" ? access.notice : null;
  }

  async markRevoked(org: string, externalId: string) {
    await this.db
      .prepare(
        "UPDATE linear_accounts SET status='reauth',updated_at=? WHERE external_id=? AND user_id IN (SELECT user_id FROM memberships WHERE organization_id=?)",
      )
      .bind(this.now(), externalId, org)
      .run();
    await this.changed(org);
  }

  private async memberAccount(org: string, user: string, externalId: string) {
    if (!(await this.isMember(org, user)))
      throw new ConnectionError("This connection action is unavailable.", 403);
    return this.db
      .prepare("SELECT * FROM linear_accounts WHERE user_id=? AND external_id=?")
      .bind(user, externalId)
      .first<AccountRow>();
  }

  private async effectiveLink(org: string, user: string) {
    const direct = await this.link(org);
    if (direct) return direct;
    const personal = await this.db
      .prepare("SELECT id FROM organizations WHERE personal_owner_id=?")
      .bind(user)
      .first<{ id: string }>();
    return personal ? this.link(personal.id) : null;
  }

  private async notifyLink(org: string, user: string) {
    await this.changed(org);
    const personal = await this.db
      .prepare("SELECT 1 FROM organizations WHERE id=? AND personal_owner_id=?")
      .bind(org, user)
      .first();
    if (personal) await this.notifyAvailability(user, org);
  }

  private async notifyAvailability(user: string, except?: string) {
    const memberships = await this.db
      .prepare("SELECT organization_id FROM memberships WHERE user_id=?")
      .bind(user)
      .all<{ organization_id: string }>();
    for (const membership of memberships.results)
      if (membership.organization_id !== except) await this.changed(membership.organization_id);
  }

  private async isMember(org: string, user: string) {
    try {
      await this.organizations.member(org, user);
      return true;
    } catch {
      return false;
    }
  }

  private async clearOrphanLinks(externalId: string) {
    const orgs = await this.db
      .prepare(
        "SELECT organization_id FROM organization_linear_links WHERE external_id=? AND NOT EXISTS (SELECT 1 FROM memberships m JOIN linear_accounts a ON a.user_id=m.user_id AND a.external_id=organization_linear_links.external_id WHERE m.organization_id=organization_linear_links.organization_id)",
      )
      .bind(externalId)
      .all<{ organization_id: string }>();
    if (!orgs.results.length) return;
    await this.db
      .prepare(
        "DELETE FROM organization_linear_links WHERE external_id=? AND NOT EXISTS (SELECT 1 FROM memberships m JOIN linear_accounts a ON a.user_id=m.user_id AND a.external_id=organization_linear_links.external_id WHERE m.organization_id=organization_linear_links.organization_id)",
      )
      .bind(externalId)
      .run();
    for (const row of orgs.results) await this.changed(row.organization_id);
  }

  private async openToken(row: AccountRow) {
    const context = `linear:${row.user_id}:${row.id}`;
    const tokens = await this.vault.open<ConnectionTokens>(row.credentials, context);
    if (!row.expires_at || row.expires_at > this.now() + 60_000) return tokens.access_token;
    if (!tokens.refresh_token || !this.oauth.clientId || !this.oauth.clientSecret) {
      await this.markReauth(row);
      throw new ConnectionError("Reconnect your account to continue.", 409);
    }
    const lease = this.now() + 60_000;
    const lock = await this.db
      .prepare(
        "UPDATE linear_accounts SET refresh_until=? WHERE id=? AND generation=? AND refresh_until<? AND status='connected' RETURNING id",
      )
      .bind(lease, row.id, row.generation, this.now())
      .first();
    if (!lock) throw new ConnectionError("Your account is refreshing; try again.", 503);
    try {
      const next = await this.refresh(tokens.refresh_token);
      next.refresh_token ??= tokens.refresh_token;
      const updated = await this.db
        .prepare(
          "UPDATE linear_accounts SET credentials=?,expires_at=?,refresh_until=0,generation=generation+1,status='connected',updated_at=? WHERE id=? AND generation=? AND refresh_until=? RETURNING id",
        )
        .bind(
          await this.vault.seal(next, context),
          next.expires_in ? this.now() + next.expires_in * 1000 : null,
          this.now(),
          row.id,
          row.generation,
          lease,
        )
        .first();
      if (!updated) throw new ConnectionError("Your connection changed; try again.", 409);
      return next.access_token;
    } catch (error) {
      await this.markReauth(row, lease);
      if (error instanceof ConnectionError) throw error;
      throw new ConnectionError("Reconnect your account to continue.", 409);
    }
  }

  private async markReauth(row: AccountRow, lease = row.refresh_until) {
    await this.db
      .prepare(
        "UPDATE linear_accounts SET status='reauth',refresh_until=0,updated_at=? WHERE id=? AND generation=? AND refresh_until=?",
      )
      .bind(this.now(), row.id, row.generation, lease)
      .run();
    await this.notifyAvailability(row.user_id);
  }

  private async refresh(refreshToken: string): Promise<ConnectionTokens> {
    const send = this.oauth.send ?? fetch;
    const response = await send("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.oauth.clientId!,
        client_secret: await this.oauth.clientSecret!(),
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new ConnectionError("Reconnect your account to continue.", 409);
    const result = (await response.json()) as ConnectionTokens;
    if (typeof result.access_token !== "string" || !result.access_token)
      throw new ConnectionError("Reconnect your account to continue.", 409);
    return result;
  }
}

export function assertLinearPerson(clientKind: string | undefined) {
  if (clientKind === "computer")
    throw new ConnectionError("Connect Linear from Remy.", 403);
}

export async function linearFingerprint(token: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
