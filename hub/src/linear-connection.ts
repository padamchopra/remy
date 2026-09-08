import {
  ConnectionError,
  type Connections,
  type ConnectionDelivery,
} from "./connections.js";
import { D1OrganizationStore } from "./organization-store.js";
import { OrganizationService } from "./organizations.js";
export const REMY_COLUMNS = [
  "backlog",
  "todo",
  "in_progress",
  "needs_input",
  "pr_review",
  "done",
  "cancelled",
] as const;
export type LinearTeam = {
  id: string;
  name: string;
  key: string;
  states: { id: string; name: string; type: string }[];
};
export type LinearCatalog = {
  teams: LinearTeam[];
  projects: { id: string; name: string; teamIds: string[] }[];
  users: { id: string; name: string; email?: string }[];
};
export type LinearMapping = {
  organization_id: string;
  external_id: string;
  workspace_id: string;
  linear_team_id: string;
  linear_project_id: string;
  remy_team_id: string | null;
  status_map: string;
  updated_at: number;
};
export class LinearConnection {
  readonly store: D1OrganizationStore;
  readonly organizations: OrganizationService;
  constructor(
    readonly db: D1Database,
    readonly connections: Connections,
    readonly changed: (org: string) => Promise<void>,
    readonly send: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.store = new D1OrganizationStore(db);
    this.organizations = new OrganizationService(this.store);
  }
  async access(org: string, user: string, admin = false) {
    const member = await this.store.membership(org, user);
    if (!member || (admin && member.role === "member"))
      throw new ConnectionError("This connection action is unavailable.", 403);
    return member;
  }
  async query<T>(
    org: string,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const token = await this.connections.token(org, "linear");
    const response = await this.send("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new ConnectionError("Linear could not complete this action.", 502);
    const result = (await response.json()) as { data?: T; errors?: unknown[] };
    if (result.errors || !result.data)
      throw new ConnectionError("Linear could not complete this action.", 502);
    return result.data;
  }
  async pages<T>(org: string, field: string, selection: string, filter = "") {
    const rows: T[] = [];
    let after: string | null = null;
    for (let page = 0; page < 100; page++) {
      const data: Record<
        string,
        {
          nodes: T[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        }
      > = await this.query<
        Record<
          string,
          {
            nodes: T[];
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          }
        >
      >(
        org,
        `query($after:String){${field}(first:100,after:$after${filter}){nodes{${selection}} pageInfo{hasNextPage endCursor}}}`,
        { after },
      );
      const list = data[field];
      rows.push(...list.nodes);
      if (!list.pageInfo.hasNextPage) return rows;
      if (!list.pageInfo.endCursor || after === list.pageInfo.endCursor) break;
      after = list.pageInfo.endCursor;
    }
    throw new ConnectionError("Your Linear list is too large to refresh.");
  }
  async refresh(org: string, user: string) {
    await this.access(org, user, true);
    const connection = await this.db
      .prepare(
        "SELECT id,external_id FROM connections WHERE organization_id=? AND provider='linear' AND subject=''",
      )
      .bind(org)
      .first<{ id: string; external_id: string }>();
    if (!connection)
      throw new ConnectionError(
        "Connect Linear before mapping your workspaces.",
      );
    const [teams, projects, users] = await Promise.all([
      this.pages<{ id: string; name: string; key: string }>(
        org,
        "teams",
        "id name key",
      ),
      this.pages<{
        id: string;
        name: string;
        teams: { nodes: { id: string }[] };
      }>(org, "projects", "id name teams{nodes{id}}"),
      this.pages<{ id: string; name: string; email: string }>(
        org,
        "users",
        "id name email",
      ),
    ]);
    const complete: LinearTeam[] = [];
    for (const team of teams) {
      const states = await this.pages<{
        id: string;
        name: string;
        type: string;
      }>(
        org,
        "workflowStates",
        "id name type",
        `,filter:{team:{id:{eq:${JSON.stringify(team.id)}}}}`,
      );
      complete.push({ ...team, states });
    }
    const catalog: LinearCatalog = {
      teams: complete,
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        teamIds: p.teams.nodes.map((t) => t.id),
      })),
      users,
    };
    await this.access(org, user, true);
    await this.db
      .prepare(
        "INSERT INTO linear_catalog(organization_id,external_id,catalog,updated_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM connections WHERE id=? AND external_id=?) ON CONFLICT(organization_id) DO UPDATE SET external_id=excluded.external_id,catalog=excluded.catalog,updated_at=excluded.updated_at",
      )
      .bind(
        org,
        connection.external_id,
        JSON.stringify(catalog),
        Date.now(),
        connection.id,
        connection.external_id,
      )
      .run();
    await this.changed(org);
    return this.list(org, user);
  }
  async externalId(org: string) {
    const row = await this.db
      .prepare(
        "SELECT external_id FROM connections WHERE organization_id=? AND provider='linear' AND subject=''",
      )
      .bind(org)
      .first<{ external_id: string }>();
    if (!row)
      throw new ConnectionError(
        "Connect Linear before mapping your workspaces.",
      );
    return row.external_id;
  }
  async catalog(org: string) {
    const row = await this.db
      .prepare(
        "SELECT l.catalog FROM linear_catalog l JOIN connections c ON c.organization_id=l.organization_id AND c.external_id=l.external_id AND c.provider='linear' AND c.subject='' WHERE l.organization_id=?",
      )
      .bind(org)
      .first<{ catalog: string }>();
    return row ? (JSON.parse(row.catalog) as LinearCatalog) : undefined;
  }
  async list(org: string, user: string) {
    const member = await this.access(org, user),
      canManage = member.role !== "member",
      catalog = await this.catalog(org),
      workspaces = await this.organizations.workspaces(org, user),
      visible = new Set(workspaces.map((w) => w.id));
    const mappings = (
      await this.db
        .prepare(
          "SELECT * FROM linear_workspace_mappings WHERE organization_id=? AND external_id=(SELECT external_id FROM connections WHERE organization_id=linear_workspace_mappings.organization_id AND provider='linear' AND subject='')",
        )
        .bind(org)
        .all<LinearMapping>()
    ).results.filter((m) => visible.has(m.workspace_id));
    const matches = (
      await this.db
        .prepare(
          "SELECT linear_user_id,member_id FROM linear_member_mappings WHERE organization_id=? AND external_id=(SELECT external_id FROM connections WHERE organization_id=linear_member_mappings.organization_id AND provider='linear' AND subject='')",
        )
        .bind(org)
        .all<{ linear_user_id: string; member_id: string }>()
    ).results;
    const members = canManage
      ? (
          await this.db
            .prepare(
              "SELECT u.id,u.name,u.email FROM user u JOIN memberships m ON m.user_id=u.id WHERE m.organization_id=?",
            )
            .bind(org)
            .all<{ id: string; name: string; email: string }>()
        ).results
      : [];
    return {
      canManage,
      connected: !!catalog,
      catalog:
        canManage && catalog
          ? {
              ...catalog,
              users: catalog.users.map((u) => ({
                id: u.id,
                name: u.name,
                suggestedMemberId:
                  members.find(
                    (m) => m.email.toLowerCase() === u.email?.toLowerCase(),
                  )?.id ?? null,
              })),
            }
          : { teams: [], projects: [], users: [] },
      mappings,
      matches: canManage ? matches : [],
      members: members.map((m) => ({ id: m.id, name: m.name })),
      workspaces,
      teams: canManage ? await this.store.teams(org) : [],
      columns: REMY_COLUMNS,
    };
  }
  async mapWorkspace(
    org: string,
    user: string,
    workspace: string,
    input: {
      linearTeamId: string;
      linearProjectId?: string;
      remyTeamId?: string | null;
      statusMap: Record<string, string>;
    },
  ) {
    await this.access(org, user, true);
    await this.organizations.workspace(org, user, workspace);
    const catalog = await this.catalog(org),
      team = catalog?.teams.find((t) => t.id === input.linearTeamId),
      project = input.linearProjectId ?? "";
    if (
      !team ||
      (project &&
        !catalog?.projects.some(
          (p) => p.id === project && p.teamIds.includes(team.id),
        ))
    )
      throw new ConnectionError(
        "Choose a Linear team and an available grouping.",
      );
    if (input.remyTeamId && !(await this.store.team(org, input.remyTeamId)))
      throw new ConnectionError("Choose a team in your organization.");
    const map = input.statusMap;
    if (
      !map ||
      Array.isArray(map) ||
      Object.entries(map).some(
        ([id, status]) =>
          !team.states.some((s) => s.id === id) ||
          !REMY_COLUMNS.includes(status as (typeof REMY_COLUMNS)[number]),
      ) ||
      team.states.some((s) => !map[s.id])
    )
      throw new ConnectionError("Map every Linear state to a ticket column.");
    await this.db
      .prepare(
        "INSERT INTO linear_workspace_mappings(organization_id,workspace_id,external_id,linear_team_id,linear_project_id,remy_team_id,status_map,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,workspace_id) DO UPDATE SET external_id=excluded.external_id,linear_team_id=excluded.linear_team_id,linear_project_id=excluded.linear_project_id,remy_team_id=excluded.remy_team_id,status_map=excluded.status_map,updated_at=excluded.updated_at",
      )
      .bind(
        org,
        workspace,
        await this.externalId(org),
        team.id,
        project,
        input.remyTeamId ?? null,
        JSON.stringify(map),
        Date.now(),
      )
      .run();
    await this.changed(org);
  }
  async mapMember(
    org: string,
    user: string,
    linearUser: string,
    member: string | null,
  ) {
    await this.access(org, user, true);
    if (!(await this.catalog(org))?.users.some((u) => u.id === linearUser))
      throw new ConnectionError("Choose a Linear member.");
    if (member) {
      if (!(await this.store.membership(org, member)))
        throw new ConnectionError("Choose a member in your organization.");
      await this.db
        .prepare(
          "INSERT INTO linear_member_mappings(organization_id,external_id,linear_user_id,member_id) VALUES(?,?,?,?) ON CONFLICT(organization_id,external_id,linear_user_id) DO UPDATE SET external_id=excluded.external_id,member_id=excluded.member_id",
        )
        .bind(org, await this.externalId(org), linearUser, member)
        .run();
    } else
      await this.db
        .prepare(
          "DELETE FROM linear_member_mappings WHERE organization_id=? AND linear_user_id=?",
        )
        .bind(org, linearUser)
        .run();
    await this.changed(org);
  }
  async receive(delivery: ConnectionDelivery) {
    const payload = JSON.parse(delivery.payload),
      external = String(payload.organizationId ?? "");
    if (!external) return;
    const orgs = (
      await this.db
        .prepare(
          "SELECT organization_id FROM connections WHERE provider='linear' AND subject='' AND external_id=?",
        )
        .bind(external)
        .all<{ organization_id: string }>()
    ).results;
    for (const { organization_id: org } of orgs) {
      if (payload.type === "OAuthApp" && payload.action === "revoked") {
        await this.db
          .prepare(
            "UPDATE connections SET status='reauth' WHERE organization_id=? AND provider='linear' AND subject=''",
          )
          .bind(org)
          .run();
        await this.changed(org);
        continue;
      }
      if (
        ![
          "Issue",
          "Comment",
          "WorkflowState",
          "User",
          "Project",
          "IssueLabel",
        ].includes(payload.type)
      )
        continue;
      await this.db
        .prepare(
          "INSERT OR IGNORE INTO linear_updates(id,organization_id,type,payload,received_at) VALUES(?,?,?,?,?)",
        )
        .bind(
          `${delivery.id}:${org}`,
          org,
          payload.type,
          delivery.payload,
          delivery.received_at,
        )
        .run();
      await this.changed(org);
    }
  }
}
