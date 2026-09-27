import {
  ENVIRONMENT_VALUE_LIMIT,
  isEnvironmentKey,
  workspaceEnvironmentWriteSchema,
  type WorkspaceEnvironmentValue,
} from "@remy/contract";
import { HostedSettingsStore } from "./hosted-settings.js";

/// Values per workspace, and Personal values per person.
const COUNT_LIMIT = 200;
/// Keys and values together, per scope, so one thread's environment stays
/// well inside a computer message.
const SIZE_LIMIT = 131_072;

type Row = { id: string; key: string; kind: "variable" | "secret"; ciphertext: string; created_by: string; created_at: number };

export class EnvironmentError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/// A workspace's one environment: its Workspace values, which every thread in
/// it receives, and each person's Personal values, which follow that person
/// into every thread they start. Values are sealed with a scope bound into the
/// ciphertext, so a row copied to another workspace or person cannot open.
export class EnvironmentStore {
  constructor(
    private readonly db: D1Database,
    private readonly secret: () => Promise<string>,
  ) {}
  private crypto() {
    return new HostedSettingsStore(this.db, this.secret);
  }
  private workspaceScope(org: string, workspace: string, id: string) {
    return `${org}:workspace-env:${workspace}:${id}`;
  }
  private personalScope(user: string, id: string) {
    return `user-env:${user}:${id}`;
  }
  private async workspaceRows(org: string, workspace: string) {
    return (await this.db
      .prepare("SELECT id,key,kind,ciphertext,created_by,created_at FROM workspace_environment_values WHERE organization_id=? AND workspace_id=? ORDER BY created_at,id")
      .bind(org, workspace)
      .all<Row>()).results;
  }
  private async personalRows(user: string) {
    return (await this.db
      .prepare("SELECT id,key,kind,ciphertext,user_id AS created_by,created_at FROM personal_environment_values WHERE user_id=? ORDER BY created_at,id")
      .bind(user)
      .all<Row>()).results;
  }

  /// What `viewer` sees in a workspace: its Workspace values and their own
  /// Personal ones, oldest first. A secret's value never leaves the hub.
  async list(org: string, workspace: string, viewer: string, name: (userId: string) => Promise<string>): Promise<WorkspaceEnvironmentValue[]> {
    const shared = await this.workspaceRows(org, workspace);
    const personal = await this.personalRows(viewer);
    const keys = new Set(shared.map((row) => row.key));
    const names = new Map<string, string>();
    for (const id of new Set([...shared, ...personal].map((row) => row.created_by))) names.set(id, await name(id));
    const view = async (row: Row, scope: "workspace" | "personal"): Promise<WorkspaceEnvironmentValue> => ({
      id: row.id,
      key: row.key,
      kind: row.kind,
      scope,
      ...(row.kind === "variable"
        ? { value: await this.crypto().unseal(scope === "workspace" ? this.workspaceScope(org, workspace, row.id) : this.personalScope(viewer, row.id), row.ciphertext) }
        : {}),
      createdBy: { id: row.created_by, name: names.get(row.created_by) ?? "Former member" },
      createdAt: row.created_at,
      ...(scope === "personal" && keys.has(row.key) ? { overridden: true } : {}),
      removable: scope === "workspace" || row.created_by === viewer,
    });
    const values = [
      ...await Promise.all(shared.map((row) => view(row, "workspace"))),
      ...await Promise.all(personal.map((row) => view(row, "personal"))),
    ];
    return values.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  /// Adds a batch from one person. A key already set at that scope is
  /// replaced: the new value, kind, author and date take its place.
  async add(org: string, workspace: string, user: string, input: unknown) {
    const parsed = workspaceEnvironmentWriteSchema.safeParse(input);
    if (!parsed.success) {
      const values = (input as { values?: unknown } | null)?.values;
      if (Array.isArray(values) && values.some((entry) => typeof entry?.key === "string" && !isEnvironmentKey(entry.key)))
        throw new EnvironmentError("Use letters, digits and underscores for each key, not starting with a digit, MC_ or REMY_.");
      if (Array.isArray(values) && values.some((entry) => typeof entry?.value === "string" && entry.value.length > ENVIRONMENT_VALUE_LIMIT))
        throw new EnvironmentError("Keep each value under 32 KB.");
      throw new EnvironmentError("Add a key and a value for each row.");
    }
    const seen = new Set<string>();
    for (const entry of parsed.data.values) {
      const id = `${entry.scope}:${entry.key}`;
      if (seen.has(id)) throw new EnvironmentError(`${entry.key} is in this list twice.`);
      seen.add(id);
    }
    for (const scope of ["workspace", "personal"] as const) {
      const incoming = parsed.data.values.filter((entry) => entry.scope === scope);
      if (!incoming.length) continue;
      const existing = scope === "workspace" ? await this.workspaceRows(org, workspace) : await this.personalRows(user);
      const kept = existing.filter((row) => !incoming.some((entry) => entry.key === row.key));
      if (kept.length + incoming.length > COUNT_LIMIT)
        throw new EnvironmentError(scope === "workspace" ? "A workspace holds up to 200 values." : "You can keep up to 200 Personal values.");
      let size = incoming.reduce((total, entry) => total + entry.key.length + entry.value.length, 0);
      for (const row of kept) size += row.key.length + (await this.open(org, workspace, user, scope, row)).length;
      if (size > SIZE_LIMIT) throw new EnvironmentError("These values are too large together; keep them under 128 KB.");
    }
    const now = Date.now();
    const statements: D1PreparedStatement[] = [];
    for (const [index, entry] of parsed.data.values.entries()) {
      const id = crypto.randomUUID();
      // Rows in one batch keep the order they were entered in.
      const at = now + index;
      if (entry.scope === "workspace") {
        statements.push(
          this.db.prepare("DELETE FROM workspace_environment_values WHERE organization_id=? AND workspace_id=? AND key=?").bind(org, workspace, entry.key),
          this.db.prepare("INSERT INTO workspace_environment_values(organization_id,workspace_id,id,key,kind,ciphertext,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)")
            .bind(org, workspace, id, entry.key, entry.kind, await this.crypto().seal(this.workspaceScope(org, workspace, id), entry.value), user, at),
        );
      } else {
        statements.push(
          this.db.prepare("DELETE FROM personal_environment_values WHERE user_id=? AND key=?").bind(user, entry.key),
          this.db.prepare("INSERT INTO personal_environment_values(user_id,id,key,kind,ciphertext,created_at) VALUES(?,?,?,?,?,?)")
            .bind(user, id, entry.key, entry.kind, await this.crypto().seal(this.personalScope(user, id), entry.value), at),
        );
      }
    }
    await this.db.batch(statements);
    return { personal: parsed.data.values.some((entry) => entry.scope === "personal"), workspace: parsed.data.values.some((entry) => entry.scope === "workspace") };
  }

  /// Anyone who can use the workspace removes its values; a Personal value
  /// only its owner can. Someone else's Personal value is not found at all.
  async remove(org: string, workspace: string, user: string, id: string): Promise<"workspace" | "personal"> {
    const shared = await this.db.prepare("DELETE FROM workspace_environment_values WHERE organization_id=? AND workspace_id=? AND id=?").bind(org, workspace, id).run();
    if (shared.meta.changes) return "workspace";
    const personal = await this.db.prepare("DELETE FROM personal_environment_values WHERE user_id=? AND id=?").bind(user, id).run();
    if (personal.meta.changes) return "personal";
    throw new EnvironmentError("This value is already gone.", 404);
  }

  /// The environment one thread receives: its starter's Personal values, with
  /// the workspace's own values winning on the same key. `secrets` names the
  /// keys the computer keeps out of transcripts and output; a variable is
  /// ordinary text there.
  async forThread(org: string, workspace: string | undefined, starter: string): Promise<{ values: Record<string, string>; secrets: string[] }> {
    const values: Record<string, string> = {};
    const kinds = new Map<string, string>();
    for (const row of await this.personalRows(starter)) { values[row.key] = await this.open(org, workspace ?? "", starter, "personal", row); kinds.set(row.key, row.kind); }
    if (workspace) for (const row of await this.workspaceRows(org, workspace)) { values[row.key] = await this.open(org, workspace, starter, "workspace", row); kinds.set(row.key, row.kind); }
    return { values, secrets: [...kinds].filter(([, kind]) => kind === "secret").map(([key]) => key) };
  }

  private open(org: string, workspace: string, user: string, scope: "workspace" | "personal", row: Row) {
    return this.crypto().unseal(scope === "workspace" ? this.workspaceScope(org, workspace, row.id) : this.personalScope(user, row.id), row.ciphertext);
  }
}
