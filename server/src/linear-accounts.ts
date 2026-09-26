import { createHash, randomUUID } from "node:crypto";
import { db, getKv, setKv } from "./db.js";
import { openSecret, rememberSecrets, sealSecret } from "./environments.js";

const LINK_KEY = "linearPersonalLink";

type StoredAccount = {
  id: string;
  external_id: string;
  label: string;
  ciphertext: string;
  iv: string;
  tag: string;
  status: string;
  updated_at: number;
};

export type LocalLinearAccount = {
  id: string;
  externalId: string;
  label: string;
  status: string;
  updatedAt: number;
};

export type LocalLinearLink = { externalId: string; label: string } | null;

export type LocalLinearAccess =
  | { kind: "off" }
  | { kind: "notice"; notice: string }
  | { kind: "ready"; token: string; url: string; fingerprint: string };

export const LOCAL_LINEAR_MISSING = "Connect your Linear account in Connections.";
export const LOCAL_LINEAR_REAUTH = "Reconnect your account in Connections.";
const MCP_URL = "https://mcp.linear.app/mcp";

db.exec(`CREATE TABLE IF NOT EXISTS linear_accounts (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected',
  updated_at INTEGER NOT NULL
)`);

function fingerprint(token: string) {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function view(row: StoredAccount): LocalLinearAccount {
  return {
    id: row.id,
    externalId: row.external_id,
    label: row.label,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export function listLinearAccounts(): LocalLinearAccount[] {
  return (db.prepare("SELECT id,external_id,label,status,updated_at FROM linear_accounts ORDER BY updated_at,external_id").all() as StoredAccount[]).map(view);
}

export function linearLink(): LocalLinearLink {
  const link = getKv<LocalLinearLink>(LINK_KEY);
  return link?.externalId ? link : null;
}

export function linearView() {
  return { accounts: listLinearAccounts(), link: linearLink() };
}

export async function connectLinearAccount(
  token: string,
  accountId: string | undefined,
  verify: (token: string) => Promise<{ id: string; label: string }>,
) {
  if (!token || token.length > 4096 || /\s/.test(token)) throw Error("Enter a Linear API key.");
  const identity = await verify(token);
  if (accountId) {
    const current = db.prepare("SELECT external_id FROM linear_accounts WHERE id=?").get(accountId) as { external_id: string } | undefined;
    if (!current) throw Error("Choose a Linear account.");
    if (current.external_id !== identity.id) throw Error("That key is for a different Linear workspace.");
  }
  const existing = db.prepare("SELECT id FROM linear_accounts WHERE external_id=?").get(identity.id) as { id: string } | undefined;
  const id = existing?.id ?? randomUUID();
  const sealed = sealSecret(token);
  db.prepare(
    "INSERT INTO linear_accounts(id,external_id,label,ciphertext,iv,tag,status,updated_at) VALUES(?,?,?,?,?,?,'connected',?) ON CONFLICT(external_id) DO UPDATE SET label=excluded.label,ciphertext=excluded.ciphertext,iv=excluded.iv,tag=excluded.tag,status='connected',updated_at=excluded.updated_at",
  ).run(id, identity.id, identity.label, sealed.ciphertext, sealed.iv, sealed.tag, Date.now());
  rememberSecrets(`linear:${id}`, [token]);
  return linearView();
}

export function disconnectLinearAccount(accountId: string) {
  const row = db.prepare("SELECT external_id FROM linear_accounts WHERE id=?").get(accountId) as { external_id: string } | undefined;
  if (!row) throw Error("Choose a Linear account.");
  db.prepare("DELETE FROM linear_accounts WHERE id=?").run(accountId);
  rememberSecrets(`linear:${accountId}`, []);
  const link = linearLink();
  if (link?.externalId === row.external_id) setKv(LINK_KEY, null);
  return linearView();
}

export function setLinearLink(accountId: string | null) {
  if (!accountId) {
    setKv(LINK_KEY, null);
    return linearView();
  }
  const row = db.prepare("SELECT external_id,label FROM linear_accounts WHERE id=?").get(accountId) as { external_id: string; label: string } | undefined;
  if (!row) throw Error("Choose one of your Linear accounts.");
  setKv(LINK_KEY, { externalId: row.external_id, label: row.label });
  return linearView();
}

/// Personal threads on this computer. A hub thread never falls through to this key.
export function localLinearAccess(): LocalLinearAccess {
  const link = linearLink();
  if (!link) return { kind: "off" };
  const row = db.prepare("SELECT * FROM linear_accounts WHERE external_id=?").get(link.externalId) as StoredAccount | undefined;
  if (!row) return { kind: "notice", notice: LOCAL_LINEAR_MISSING };
  if (row.status !== "connected") return { kind: "notice", notice: LOCAL_LINEAR_REAUTH };
  const token = openSecret(row);
  if (!token) return { kind: "notice", notice: LOCAL_LINEAR_REAUTH };
  rememberSecrets(`linear:${row.id}`, [token]);
  return { kind: "ready", token, url: MCP_URL, fingerprint: fingerprint(token) };
}

export async function linearHttp(method: string, pathname: string, body: Record<string, unknown> | undefined) {
  if (!pathname.startsWith("/server/linear")) return undefined;
  try {
    if (pathname === "/server/linear" && method === "GET") return { status: 200, body: linearView() };
    if (pathname === "/server/linear/accounts" && method === "POST") {
      const token = typeof body?.token === "string" ? body.token : "";
      const accountId = typeof body?.accountId === "string" ? body.accountId : undefined;
      return { status: 200, body: await connectLinearAccount(token, accountId, verifyLinearKey) };
    }
    const remove = /^\/server\/linear\/accounts\/([^/]+)$/.exec(pathname);
    if (remove && method === "DELETE")
      return { status: 200, body: disconnectLinearAccount(decodeURIComponent(remove[1])) };
    if (pathname === "/server/linear/link" && method === "PUT") {
      const accountId = body?.accountId === null ? null : body?.accountId;
      if (accountId !== null && typeof accountId !== "string")
        return { status: 400, body: { error: "Choose one of your Linear accounts." } };
      return { status: 200, body: setLinearLink(accountId) };
    }
    return { status: 404, body: { error: "Choose a Linear connection action." } };
  } catch (error) {
    return {
      status: 400,
      body: { error: error instanceof Error ? error.message : "Your Linear account could not be saved." },
    };
  }
}

export async function verifyLinearKey(token: string) {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: "query { organization { id name } viewer { id } }" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw Error("Your Linear account could not be verified.");
  const value = await response.json() as { data?: { organization?: { id?: string; name?: string } }; errors?: unknown[] };
  const organization = value.data?.organization;
  if (value.errors || !organization?.id || !organization.name) throw Error("Your Linear account could not be verified.");
  return { id: organization.id, label: organization.name };
}
