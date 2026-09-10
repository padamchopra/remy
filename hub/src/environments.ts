import { HostedSettingsStore } from "./hosted-settings.js";

export type EnvironmentView = {
  id: string;
  name: string;
  updatedAt: number;
  variables: { name: string; configured: true }[];
};
const validName = (name: string) =>
  /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) &&
  !/^(?:__proto__$|constructor$|prototype$|MC_|REMY_|NODE_OPTIONS$|CODEX_HOME$|CLAUDE_CONFIG_DIR$)/.test(
    name,
  );
export class EnvironmentStore {
  constructor(
    private readonly db: D1Database,
    private readonly secret: () => Promise<string>,
  ) {}
  private crypto() {
    return new HostedSettingsStore(this.db, this.secret);
  }
  async values(org: string, id: string): Promise<Record<string, string>> {
    const row = await this.db
      .prepare(
        "SELECT ciphertext FROM reusable_environments WHERE organization_id=? AND id=?",
      )
      .bind(org, id)
      .first<{ ciphertext: string }>();
    if (!row) throw Error("Choose an available environment.");
    return JSON.parse(
      await this.crypto().unseal(`${org}:environment:${id}`, row.ciphertext),
    );
  }
  async list(org: string): Promise<EnvironmentView[]> {
    const rows = (
      await this.db
        .prepare(
          "SELECT id,name,updated_at FROM reusable_environments WHERE organization_id=? ORDER BY name,id",
        )
        .bind(org)
        .all<{ id: string; name: string; updated_at: number }>()
    ).results;
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        name: r.name,
        updatedAt: r.updated_at,
        variables: Object.keys(await this.values(org, r.id)).map((name) => ({
          name,
          configured: true as const,
        })),
      })),
    );
  }
  async create(org: string, name: unknown) {
    if (typeof name !== "string" || !name.trim() || name.length > 60)
      throw Error("Name your environment.");
    const id = crypto.randomUUID();
    await this.db
      .prepare("INSERT INTO reusable_environments VALUES(?,?,?,?,?)")
      .bind(
        org,
        id,
        name.trim(),
        await this.crypto().seal(`${org}:environment:${id}`, "{}"),
        Date.now(),
      )
      .run();
    return (await this.list(org)).find((e) => e.id === id)!;
  }
  async update(
    org: string,
    id: string,
    input: { name?: unknown; values?: unknown; remove?: unknown },
  ) {
    const values = await this.values(org, id);
    if (input.name !== undefined) {
      if (
        typeof input.name !== "string" ||
        !input.name.trim() ||
        input.name.length > 60
      )
        throw Error("Name your environment.");
    }
    if (input.values !== undefined) {
      if (
        !input.values ||
        typeof input.values !== "object" ||
        Array.isArray(input.values)
      )
        throw Error("Add named environment values.");
      for (const [name, value] of Object.entries(input.values)) {
        if (
          !validName(name) ||
          typeof value !== "string" ||
          value.length > 32768
        )
          throw Error("Use a valid variable name and a value under 32 KB.");
        values[name] = value;
      }
    }
    if (typeof input.remove === "string") delete values[input.remove];
    if (
      Object.keys(values).length > 200 ||
      JSON.stringify(values).length > 64000
    )
      throw Error("Use fewer environment values.");
    await this.db
      .prepare(
        "UPDATE reusable_environments SET name=COALESCE(?,name),ciphertext=?,updated_at=? WHERE organization_id=? AND id=?",
      )
      .bind(
        typeof input.name === "string" ? input.name.trim() : null,
        await this.crypto().seal(
          `${org}:environment:${id}`,
          JSON.stringify(values),
        ),
        Date.now(),
        org,
        id,
      )
      .run();
    return (await this.list(org)).find((e) => e.id === id)!;
  }
  async remove(org: string, id: string) {
    await this.db
      .prepare(
        "DELETE FROM reusable_environments WHERE organization_id=? AND id=?",
      )
      .bind(org, id)
      .run();
  }
  async assignments(org: string) {
    return (
      await this.db
        .prepare(
          "SELECT workspace_id AS projectId,environment_id AS environmentId FROM workspace_environment_bindings WHERE organization_id=?",
        )
        .bind(org)
        .all<{ projectId: string; environmentId: string }>()
    ).results;
  }
  async assign(org: string, workspace: string, id: string) {
    if (!id) {
      await this.db
        .prepare(
          "DELETE FROM workspace_environment_bindings WHERE organization_id=? AND workspace_id=?",
        )
        .bind(org, workspace)
        .run();
      return;
    }
    await this.values(org, id);
    await this.db
      .prepare(
        "INSERT INTO workspace_environment_bindings VALUES(?,?,?) ON CONFLICT(organization_id,workspace_id) DO UPDATE SET environment_id=excluded.environment_id",
      )
      .bind(org, workspace, id)
      .run();
  }
  async forWorkspace(org: string, workspace: string) {
    const assignment = (await this.assignments(org)).find(
      (a) => a.projectId === workspace,
    );
    if (!assignment) return null;
    const view = (await this.list(org)).find(
      (e) => e.id === assignment.environmentId,
    )!;
    return { ...view, values: await this.values(org, view.id) };
  }
}
