import type { OrganizationService } from "./organizations.js";

const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const decode = (value: string) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
const bytes = (value: string) => new TextEncoder().encode(value);
export const connectionHash = async (value: string) =>
  encode(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(value))));
export type ConnectionTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};
export type Connection = {
  id: string;
  organization_id: string;
  provider: string;
  subject: string;
  external_id: string;
  label: string;
  credentials: string;
  expires_at: number | null;
  status: string;
  generation: number;
  refresh_until: number;
  updated_at: number;
};
export type ConnectionDelivery = {
  id: string;
  provider: string;
  delivery_id: string;
  event: string;
  payload: string;
  status: string;
  received_at: number;
};
export type ConnectionJob = { kind: "connection.webhook"; id: string };
export type ConnectionProvider = {
  id: string;
  name: string;
  subjects: ("organization" | "member")[];
  clientId?: string | undefined;
  clientSecret?: (() => Promise<string>) | undefined;
  webhookSecret?: (() => Promise<string>) | undefined;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  authorizeParameters?: Record<string, string>;
  identity: (
    token: string,
    send: typeof fetch,
  ) => Promise<{ id: string; label: string; userId?: string | undefined }>;
  verifyWebhook: (
    request: Request,
    raw: string,
    secret: string,
    now: number,
  ) => Promise<{ id: string; event: string }>;
  receive?: (delivery: ConnectionDelivery) => Promise<void>;
};

export class ConnectionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export class ConnectionVault {
  constructor(private readonly secret: () => Promise<string>) {}
  private async key() {
    return crypto.subtle.importKey(
      "raw",
      await crypto.subtle.digest(
        "SHA-256",
        bytes(`remy-connections:${await this.secret()}`),
      ),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
  }
  async seal(value: unknown, context: string) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: bytes(context) },
      await this.key(),
      bytes(JSON.stringify(value)),
    );
    return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
  }
  async open<T>(value: string, context: string): Promise<T> {
    const [iv, ciphertext] = value.split(".");
    return JSON.parse(
      new TextDecoder().decode(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: decode(iv), additionalData: bytes(context) },
          await this.key(),
          decode(ciphertext),
        ),
      ),
    ) as T;
  }
}

export class Connections {
  readonly vault: ConnectionVault;
  constructor(
    readonly db: D1Database,
    readonly providers: ConnectionProvider[],
    secret: () => Promise<string>,
    private readonly organizations: OrganizationService,
    private readonly changed: (org: string) => Promise<void>,
    private readonly send: typeof fetch = (input, init) => fetch(input, init),
    private readonly now = Date.now,
  ) {
    this.vault = new ConnectionVault(secret);
  }
  provider(id: string) {
    const provider = this.providers.find((p) => p.id === id);
    if (!provider) throw new ConnectionError("Connection not found.", 404);
    return provider;
  }
  async authorize(org: string, user: string, subject: string) {
    const member = await this.organizations.member(org, user);
    if ((subject && subject !== user) || (!subject && member.role === "member"))
      throw new ConnectionError(
        "Only an administrator can change your organization's connection.",
        403,
      );
    return member;
  }
  async list(org: string, user: string) {
    const member = await this.organizations.member(org, user);
    const rows = await this.db
      .prepare(
        "SELECT id,provider,subject,external_id,label,status,updated_at FROM connections WHERE organization_id=? AND (subject='' OR subject=?)",
      )
      .bind(org, user)
      .all();
    return {
      canManage: member.role !== "member",
      providers: this.providers.map((p) => ({
        id: p.id,
        name: p.name,
        subjects: p.subjects,
        configured: !!p.clientId && !!p.clientSecret,
      })),
      connections: rows.results,
    };
  }
  async get(org: string, provider: string, subject = "") {
    return this.db
      .prepare(
        "SELECT * FROM connections WHERE organization_id=? AND provider=? AND subject=?",
      )
      .bind(org, provider, subject)
      .first<Connection>();
  }
  private async epoch(org: string, provider: string, subject: string) {
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO connection_epochs(organization_id,provider,subject) VALUES(?,?,?)",
      )
      .bind(org, provider, subject)
      .run();
    return (await this.db
      .prepare(
        "SELECT generation FROM connection_epochs WHERE organization_id=? AND provider=? AND subject=?",
      )
      .bind(org, provider, subject)
      .first<{ generation: number }>())!.generation;
  }
  async begin(
    org: string,
    user: string,
    providerId: string,
    subject: string,
    origin: string,
  ) {
    await this.authorize(org, user, subject);
    const provider = this.provider(providerId);
    if (!provider.subjects.includes(subject ? "member" : "organization"))
      throw new ConnectionError("Choose a supported connection.");
    if (!provider.clientId || !provider.clientSecret)
      throw new ConnectionError(
        "Ask your administrator to configure this connection.",
        409,
      );
    const state = encode(crypto.getRandomValues(new Uint8Array(32))),
      hash = await connectionHash(state),
      verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
    await this.db
      .prepare("DELETE FROM connection_oauth_states WHERE expires_at<?")
      .bind(this.now())
      .run();
    await this.db
      .prepare("INSERT INTO connection_oauth_states VALUES(?,?,?,?,?,?,?,?)")
      .bind(
        hash,
        org,
        user,
        providerId,
        subject,
        await this.vault.seal(verifier, hash),
        this.now() + 600_000,
        await this.epoch(org, providerId, subject),
      )
      .run();
    const url = new URL(provider.authorizeUrl);
    for (const [key, value] of Object.entries({
      ...provider.authorizeParameters,
      client_id: provider.clientId,
      redirect_uri: `${origin}/api/connections/${providerId}/callback`,
      response_type: "code",
      scope: provider.scope,
      state,
      code_challenge: await connectionHash(verifier),
      code_challenge_method: "S256",
    }))
      url.searchParams.set(key, value);
    return { url: url.href };
  }
  async finish(
    user: string,
    providerId: string,
    state: string,
    code: string,
    origin: string,
  ) {
    if (!state || !code || state.length > 200 || code.length > 2000)
      throw new ConnectionError("Reconnect your account.");
    const hash = await connectionHash(state);
    const saved = await this.db
      .prepare(
        "DELETE FROM connection_oauth_states WHERE state_hash=? AND user_id=? AND provider=? AND expires_at>? RETURNING *",
      )
      .bind(hash, user, providerId, this.now())
      .first<{
        organization_id: string;
        subject: string;
        verifier: string;
        epoch: number;
      }>();
    if (!saved)
      throw new ConnectionError("This connection link expired; connect again.");
    await this.authorize(saved.organization_id, user, saved.subject);
    const provider = this.provider(providerId),
      verifier = await this.vault.open<string>(saved.verifier, hash);
    const tokens = await this.exchange(provider, {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: `${origin}/api/connections/${providerId}/callback`,
    });
    const identity = await provider.identity(tokens.access_token, this.send);
    await this.authorize(saved.organization_id, user, saved.subject);
    const existing = await this.get(
      saved.organization_id,
      providerId,
      saved.subject,
    );
    if (existing && existing.external_id !== identity.id)
      throw new ConnectionError(
        "Disconnect the current account before choosing another.",
        409,
      );
    const id =
        existing?.id ??
        (await connectionHash(
          `${saved.organization_id}:${providerId}:${saved.subject}`,
        )),
      context = `${saved.organization_id}:${providerId}:${id}`;
    const credentials = await this.vault.seal(tokens, context),
      expires = tokens.expires_in
        ? this.now() + tokens.expires_in * 1000
        : null;
    const statements = [
      this.db
        .prepare(
          "INSERT INTO connections(id,organization_id,provider,subject,external_id,label,credentials,expires_at,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM connection_epochs WHERE organization_id=? AND provider=? AND subject=? AND generation=?) ON CONFLICT(organization_id,provider,subject) DO UPDATE SET external_id=excluded.external_id,label=excluded.label,credentials=excluded.credentials,expires_at=excluded.expires_at,status='connected',refresh_until=0,generation=connections.generation+1,updated_at=excluded.updated_at",
        )
        .bind(
          id,
          saved.organization_id,
          providerId,
          saved.subject,
          identity.id,
          identity.label,
          credentials,
          expires,
          this.now(),
          saved.organization_id,
          providerId,
          saved.subject,
          saved.epoch,
        ),
    ];
    if (saved.subject)
      statements.push(
        this.db
          .prepare(
            "INSERT INTO connection_identities SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM connections WHERE id=? AND credentials=?) ON CONFLICT(connection_id) DO UPDATE SET external_user_id=excluded.external_user_id",
          )
          .bind(
            id,
            saved.organization_id,
            user,
            identity.userId ?? identity.id,
            id,
            credentials,
          ),
      );
    const result = await this.db.batch(statements);
    if (!result[0]?.meta.changes)
      throw new ConnectionError("This connection changed; connect again.", 409);
    await this.changed(saved.organization_id);
    return saved.organization_id;
  }
  private async exchange(
    provider: ConnectionProvider,
    values: Record<string, string>,
  ): Promise<ConnectionTokens> {
    const response = await this.send(provider.tokenUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        ...values,
        client_id: provider.clientId!,
        client_secret: await provider.clientSecret!(),
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new ConnectionError(
        "Your account could not connect; reconnect it.",
        409,
      );
    const result = (await response.json()) as ConnectionTokens;
    if (
      typeof result.access_token !== "string" ||
      !result.access_token ||
      (result.expires_in !== undefined &&
        (!Number.isFinite(result.expires_in) || result.expires_in <= 0))
    )
      throw new ConnectionError(
        "Your account could not connect; reconnect it.",
        409,
      );
    return {
      access_token: result.access_token,
      ...(typeof result.refresh_token === "string"
        ? { refresh_token: result.refresh_token }
        : {}),
      ...(result.expires_in ? { expires_in: result.expires_in } : {}),
    };
  }
  async token(org: string, providerId: string, subject = "") {
    if (subject) await this.organizations.member(org, subject);
    const row = await this.get(org, providerId, subject);
    if (!row || row.status !== "connected")
      throw new ConnectionError("Reconnect your account to continue.", 409);
    const context = `${org}:${providerId}:${row.id}`,
      tokens = await this.vault.open<ConnectionTokens>(
        row.credentials,
        context,
      );
    if (!row.expires_at || row.expires_at > this.now() + 60_000)
      return tokens.access_token;
    const lease = this.now() + 60_000;
    const lock = await this.db
      .prepare(
        "UPDATE connections SET refresh_until=? WHERE id=? AND generation=? AND refresh_until<? AND status='connected' RETURNING id",
      )
      .bind(lease, row.id, row.generation, this.now())
      .first();
    if (!lock)
      throw new ConnectionError("Your account is refreshing; try again.", 503);
    try {
      if (!tokens.refresh_token)
        throw new ConnectionError("Reconnect your account to continue.", 409);
      const next = await this.exchange(this.provider(providerId), {
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      });
      next.refresh_token ??= tokens.refresh_token;
      const updated = await this.db
        .prepare(
          "UPDATE connections SET credentials=?,expires_at=?,refresh_until=0,generation=generation+1,updated_at=? WHERE id=? AND generation=? AND refresh_until=? RETURNING id",
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
      if (!updated)
        throw new ConnectionError("Your connection changed; try again.", 409);
      return next.access_token;
    } catch {
      await this.db
        .prepare(
          "UPDATE connections SET status='reauth',refresh_until=0,updated_at=? WHERE id=? AND generation=? AND refresh_until=?",
        )
        .bind(this.now(), row.id, row.generation, lease)
        .run();
      await this.changed(org);
      throw new ConnectionError("Reconnect your account to continue.", 409);
    }
  }
  async disconnect(
    org: string,
    user: string,
    provider: string,
    subject: string,
  ) {
    await this.authorize(org, user, subject);
    await this.epoch(org, provider, subject);
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE connection_epochs SET generation=generation+1 WHERE organization_id=? AND provider=? AND subject=?",
        )
        .bind(org, provider, subject),
      this.db
        .prepare(
          "DELETE FROM connections WHERE organization_id=? AND provider=? AND subject=?",
        )
        .bind(org, provider, subject),
      this.db
        .prepare(
          "DELETE FROM connection_oauth_states WHERE organization_id=? AND provider=? AND subject=?",
        )
        .bind(org, provider, subject),
    ]);
    await this.changed(org);
  }
}

export async function verifyConnectionSignature(
  raw: string,
  signature: string,
  secret: string,
) {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    Uint8Array.from(signature.match(/../g)!, (n) => parseInt(n, 16)),
    bytes(raw),
  );
}

export async function ingestConnectionWebhook(
  request: Request,
  provider: ConnectionProvider,
  db: D1Database,
  queue: Queue<ConnectionJob>,
  now = Date.now(),
) {
  if (!provider.webhookSecret)
    throw new ConnectionError("This connection is unavailable.", 404);
  const reader = request.body?.getReader();
  let size = 0,
    raw = "";
  const decoder = new TextDecoder();
  if (reader)
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1_000_000) {
        await reader.cancel();
        throw new ConnectionError("This update is too large.", 413);
      }
      raw += decoder.decode(value, { stream: true });
    }
  raw += decoder.decode();
  const verified = await provider.verifyWebhook(
    request,
    raw,
    await provider.webhookSecret(),
    now,
  );
  if (!verified.id || verified.id.length > 200 || verified.event.length > 120)
    throw new ConnectionError("This update could not be verified.", 401);
  const id = await connectionHash(`${provider.id}:${raw}`);
  await db
    .prepare(
      "INSERT OR IGNORE INTO connection_deliveries(id,provider,delivery_id,event,payload,received_at) VALUES(?,?,?,?,?,?)",
    )
    .bind(id, provider.id, verified.id, verified.event, raw, now)
    .run();
  const stored = await db
    .prepare("SELECT status FROM connection_deliveries WHERE id=?")
    .bind(id)
    .first<{ status: string }>();
  if (stored?.status !== "done")
    await queue.send({ kind: "connection.webhook", id });
  return Response.json({ accepted: true }, { status: 202 });
}
