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
          "SELECT l.external_id,l.organization_id,o.personal_owner_id FROM member_linear_links l JOIN organizations o ON o.id=l.organization_id WHERE l.user_id=?",
        )
        .bind(user)
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
    await this.notifyAvailability(user);
  }

  async link(org: string, user: string): Promise<LinearLinkView> {
    const row = await this.db
      .prepare("SELECT external_id,label FROM member_linear_links WHERE organization_id=? AND user_id=?")
      .bind(org, user)
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
        .prepare("DELETE FROM member_linear_links WHERE organization_id=? AND user_id=?")
        .bind(org, user)
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
        "INSERT INTO member_linear_links(organization_id,user_id,external_id,label,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(organization_id,user_id) DO UPDATE SET external_id=excluded.external_id,label=excluded.label,updated_at=excluded.updated_at",
      )
      .bind(org, user, account.external_id, account.label, this.now())
      .run();
    await this.notifyLink(org, user);
    return this.view(org, user);
  }

  /// Linear always runs as the acting member. An organization never supplies
  /// another person's workspace choice or token.
  async accessToken(org: string, user: string) {
    return (await this.accessCredentials(org, user)).access_token;
  }

  private async accessCredentials(org: string, user: string) {
    const current = await this.effectiveLink(org, user);
    if (!current) throw new ConnectionError("Choose a Linear account for this organization.");
    const row = await this.memberAccount(org, user, current.externalId);
    if (!row || row.status !== "connected")
      throw new ConnectionError("Reconnect your account to continue.", 409);
    return this.openCredentials(row);
  }

  /// One GraphQL request to Linear as this member.
  async linearGraphql<T>(org: string, user: string, query: string, variables: Record<string, unknown>): Promise<T | undefined> {
    const tokens = await this.accessCredentials(org, user);
    const send = this.oauth.send ?? fetch;
    const response = await send("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        authorization: tokens.token_type === "api-key" ? tokens.access_token : `Bearer ${tokens.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401) throw new ConnectionError(LINEAR_REAUTH_NOTICE, 409);
    if (!response.ok) throw new ConnectionError("Linear could not answer.", 502);
    const value = (await response.json()) as { data?: T };
    return value.data;
  }

  /// The Linear issue a pull request belongs to, as your own Linear account
  /// sees it: one the pull request is attached to, else the issue its branch
  /// was made for, else an identifier in the branch or title. Null when
  /// nothing matches or Linear is not connected here.
  async pullRequestTicket(org: string, user: string, pull: { url: string; branch: string; title: string }): Promise<LinearTicket | null> {
    const key = `${org}:${user}:${pull.url}`;
    const cached = ticketCache.get(key);
    if (cached && this.now() - cached.at < TICKET_CACHE_MS) return cached.ticket;
    const ticket = await this.findTicket(org, user, pull);
    ticketCache.set(key, { at: this.now(), ticket });
    if (ticketCache.size > 500) ticketCache.delete(ticketCache.keys().next().value!);
    return ticket;
  }

  private async findTicket(org: string, user: string, pull: { url: string; branch: string; title: string }) {
    const attached = await this.linearGraphql<{ attachmentsForURL?: { nodes?: { issue?: unknown }[] } }>(org, user,
      `query Attached($url: String!) { attachmentsForURL(url: $url) { nodes { issue { ${TICKET_FIELDS} } } } }`, { url: pull.url });
    for (const node of attached?.attachmentsForURL?.nodes ?? []) {
      const ticket = linearTicket(node?.issue);
      if (ticket) return ticket;
    }
    if (pull.branch) {
      const branch = await this.linearGraphql<{ issueVcsBranchSearch?: unknown }>(org, user,
        `query Branch($branch: String!) { issueVcsBranchSearch(branchName: $branch) { ${TICKET_FIELDS} } }`, { branch: pull.branch }).catch(() => undefined);
      const ticket = linearTicket(branch?.issueVcsBranchSearch);
      if (ticket) return ticket;
    }
    for (const identifier of ticketIdentifiers(`${pull.branch} ${pull.title}`)) {
      const issue = await this.linearGraphql<{ issue?: unknown }>(org, user,
        `query Issue($id: String!) { issue(id: $id) { ${TICKET_FIELDS} } }`, { id: identifier }).catch(() => undefined);
      const ticket = linearTicket(issue?.issue);
      if (ticket) return ticket;
    }
    return null;
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
      const token = (await this.openCredentials(row)).access_token;
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

  private async memberAccount(org: string, user: string, externalId: string) {
    if (!(await this.isMember(org, user)))
      throw new ConnectionError("This connection action is unavailable.", 403);
    return this.db
      .prepare("SELECT * FROM linear_accounts WHERE user_id=? AND external_id=?")
      .bind(user, externalId)
      .first<AccountRow>();
  }

  private async effectiveLink(org: string, user: string) {
    const direct = await this.link(org, user);
    if (direct) return direct;
    const personal = await this.db
      .prepare("SELECT id FROM organizations WHERE personal_owner_id=?")
      .bind(user)
      .first<{ id: string }>();
    return personal ? this.link(personal.id, user) : null;
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

  private async openCredentials(row: AccountRow) {
    const context = `linear:${row.user_id}:${row.id}`;
    const tokens = await this.vault.open<ConnectionTokens>(row.credentials, context);
    if (!row.expires_at || row.expires_at > this.now() + 60_000) return tokens;
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
      return next;
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

export type LinearTicket = { identifier: string; title: string; url: string; state: "backlog" | "unstarted" | "started" | "completed" | "canceled" | "triage" | "" };
const TICKET_FIELDS = "identifier title url state { type }";
const TICKET_CACHE_MS = 5 * 60_000;
const ticketCache = new Map<string, { at: number; ticket: LinearTicket | null }>();
export function clearLinearTicketCache() {
  ticketCache.clear();
}
const TICKET_STATES = new Set(["backlog", "unstarted", "started", "completed", "canceled", "triage"]);

export function linearTicket(value: unknown): LinearTicket | null {
  if (!value || typeof value !== "object") return null;
  const issue = value as { identifier?: unknown; title?: unknown; url?: unknown; state?: { type?: unknown } | null };
  if (typeof issue.identifier !== "string" || !/^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/.test(issue.identifier) || typeof issue.title !== "string") return null;
  const url = typeof issue.url === "string" && /^https:\/\/linear\.app\//.test(issue.url) ? issue.url : "";
  const state = typeof issue.state?.type === "string" && TICKET_STATES.has(issue.state.type) ? issue.state.type as LinearTicket["state"] : "";
  return { identifier: issue.identifier, title: issue.title.slice(0, 300), url, state };
}

/// Issue identifiers written into a branch or title, such as REMY-214 or
/// remy-214-search, first seen first, at most three.
export function ticketIdentifiers(text: string) {
  const found: string[] = [];
  for (const match of text.matchAll(/(?:^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9]{0,9}-\d{1,7})(?![A-Za-z0-9])/g)) {
    const identifier = match[1]!.toUpperCase();
    if (!found.includes(identifier)) found.push(identifier);
    if (found.length === 3) break;
  }
  return found;
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
