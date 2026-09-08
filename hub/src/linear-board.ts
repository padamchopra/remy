import type {
  BoardLogEvent,
  BoardProjection,
  BoardVersionVector,
} from "@remy/contract";
import { OrganizationBoard, type BoardStorage } from "./organization-board.js";
import { LinearConnection, type LinearMapping } from "./linear-connection.js";
import { ConnectionError } from "./connections.js";
export type LinearIssue = {
  id: string;
  identifier: string;
  number: number;
  url: string;
  title: string;
  description: string | null;
  updatedAt: string;
  team: { id: string; key: string };
  project: { id: string } | null;
  state: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  labels: { nodes: { id: string; name: string }[] };
  parent: { id: string } | null;
};
export const ISSUE_FIELDS =
  "id identifier number url title description updatedAt team{id key} project{id} state{id name} assignee{id name} labels{nodes{id name}} parent{id}";
type Policy = {
  organization_id: string;
  workspace_id: string;
  external_id: string;
  enabled: number;
  bootstrap: number;
  agent_map: string;
  error: string | null;
  updated_at: number;
};
type Clock = { at: number; source: "linear" | "remy"; value: unknown };
type Binding = {
  ticketId: string;
  workspaceId: string;
  externalId: string;
  issueId: string;
  created: boolean;
  clocks: Record<string, Clock>;
};
type Start = (
  user: string,
  workspace: string,
  agent: string,
  prompt: string,
) => Promise<{ threadId: string; computerId: string }>;
export class LinearBoard {
  constructor(
    readonly org: string,
    readonly linear: LinearConnection,
    readonly board: OrganizationBoard,
    readonly storage: BoardStorage,
    readonly start: Start,
    readonly origin: string,
  ) {}
  private key(id: string) {
    return `linear:ticket:${id}`;
  }
  async policies() {
    return (
      await this.linear.db
        .prepare(
          "SELECT s.* FROM linear_board_settings s JOIN connections c ON c.organization_id=s.organization_id AND c.external_id=s.external_id AND c.provider='linear' AND c.subject='' WHERE s.organization_id=?",
        )
        .bind(this.org)
        .all<Policy>()
    ).results;
  }
  async mapping(workspace: string) {
    const external = await this.linear.externalId(this.org);
    return this.linear.db
      .prepare(
        "SELECT * FROM linear_workspace_mappings WHERE organization_id=? AND workspace_id=? AND external_id=?",
      )
      .bind(this.org, workspace, external)
      .first<LinearMapping>();
  }
  async configure(
    user: string,
    workspace: string,
    enabled: boolean,
    agentMap: Record<string, string>,
  ) {
    await this.linear.access(this.org, user, true);
    await this.linear.organizations.workspace(this.org, user, workspace);
    const mapping = await this.mapping(workspace);
    if (!mapping)
      throw new ConnectionError("Map this workspace to Linear first.");
    const catalog = await this.linear.catalog(this.org);
    if (
      Object.keys(agentMap).some(
        (id) => !catalog?.users.some((u) => u.id === id),
      )
    )
      throw new ConnectionError("Choose a Linear member for each agent.");
    await this.linear.db
      .prepare(
        "INSERT INTO linear_board_settings(organization_id,workspace_id,external_id,enabled,agent_map,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(organization_id,workspace_id) DO UPDATE SET external_id=excluded.external_id,enabled=excluded.enabled,agent_map=excluded.agent_map,bootstrap=CASE WHEN enabled=0 AND excluded.enabled=1 THEN 1 ELSE bootstrap END,error=NULL,updated_at=excluded.updated_at",
      )
      .bind(
        this.org,
        workspace,
        mapping.external_id,
        enabled ? 1 : 0,
        JSON.stringify(agentMap),
        Date.now(),
      )
      .run();
    await this.linear.changed(this.org);
  }
  async state(user: string) {
    const visible = new Set(
      (await this.linear.organizations.workspaces(this.org, user)).map(
        (w) => w.id,
      ),
    );
    const labels: Record<string, { id: string; name: string }[]> = {};
    for (const id of visible)
      labels[id] = (await this.storage.get(`linear:labels:${id}`)) ?? [];
    return {
      labels,
      settings: (await this.policies()).filter((p) =>
        visible.has(p.workspace_id),
      ),
      rule: "The latest timestamp wins for each field; comments are appended once.",
    };
  }
  private async stamp(key: string) {
    let id = await this.storage.get<string>(`linear:id:${key}`);
    if (!id) {
      id = crypto.randomUUID();
      await this.storage.put(`linear:id:${key}`, id);
    }
    return id;
  }
  private async append(
    ticket: string,
    kind: "create" | "field" | "comment" | "link",
    payload: Record<string, unknown>,
    key: string,
    at = Date.now(),
    label = "Linear",
  ) {
    const id = await this.stamp(`event:${key}`);
    await this.storage.put(`linear:own:${id}`, true);
    return this.board.append(
      {
        entity: "ticket",
        entityId: ticket,
        kind,
        payload: { ...payload, source: { provider: "linear", id: key } },
      },
      { kind: "agent", id: "linear", label },
      { id, at },
    );
  }
  async issue(id: string) {
    return (
      await this.linear.query<{ issue: LinearIssue }>(
        this.org,
        `query($id:String!){issue(id:$id){${ISSUE_FIELDS}}}`,
        { id },
      )
    ).issue;
  }
  private async matched(issue: LinearIssue) {
    const policies = (await this.policies()).filter((p) => p.enabled);
    const mappings: LinearMapping[] = [];
    for (const p of policies) {
      const map = await this.mapping(p.workspace_id);
      if (
        map &&
        map.linear_team_id === issue.team.id &&
        (!map.linear_project_id || map.linear_project_id === issue.project?.id)
      )
        mappings.push(map);
    }
    return mappings.sort(
      (a, b) => Number(!!b.linear_project_id) - Number(!!a.linear_project_id),
    )[0];
  }
  private async member(externalUser: string, externalId: string) {
    return this.linear.db
      .prepare(
        "SELECT member_id FROM linear_member_mappings WHERE organization_id=? AND external_id=? AND linear_user_id=?",
      )
      .bind(this.org, externalId, externalUser)
      .first<{ member_id: string }>();
  }
  private async inboundFields(
    issue: LinearIssue,
    map: LinearMapping,
    policy: Policy,
  ) {
    const status = JSON.parse(map.status_map)[issue.state.id];
    if (!status)
      throw new ConnectionError(
        "Map the new Linear state before syncing this ticket.",
      );
    const member = issue.assignee
        ? await this.member(issue.assignee.id, map.external_id)
        : null,
      agent = issue.assignee
        ? JSON.parse(policy.agent_map)[issue.assignee.id]
        : undefined;
    let parentId: null | string = null;
    if (issue.parent) {
      parentId =
        (await this.storage.get<string>(
          `linear:issue:${map.external_id}:${issue.parent.id}`,
        )) ?? null;
      if (!parentId) {
        parentId = await this.stamp(
          `ticket:${map.external_id}:${issue.parent.id}`,
        );
        await this.storage.put(
          `linear:issue:${map.external_id}:${issue.parent.id}`,
          parentId,
        );
      }
    }
    return {
      title: issue.title,
      body: issue.description ?? "",
      status,
      assigneeAgentId: agent ?? "you",
      assigneeMemberId: member?.member_id ?? null,
      assigneeName: issue.assignee?.name ?? null,
      labels: issue.labels.nodes,
      parentId,
      number: issue.number,
      keyPrefix: issue.team.key,
      linearIssueId: issue.id,
      externalUrl: issue.url,
    };
  }
  private wins(old: Clock | undefined, next: Clock) {
    return (
      !old ||
      next.at > old.at ||
      (next.at === old.at && next.source === "linear" && old.source === "remy")
    );
  }
  async importIssue(
    issue: LinearIssue,
    key: string,
    changed?: string[],
    ancestors = new Set<string>(),
  ): Promise<string | undefined> {
    if (ancestors.has(issue.id))
      throw new ConnectionError(
        "This Linear ticket has a circular parent relationship.",
      );
    ancestors.add(issue.id);
    const map = await this.matched(issue);
    if (!map) return;
    const policy = (await this.policies()).find(
      (p) => p.workspace_id === map.workspace_id,
    )!;
    const reverse = `linear:issue:${map.external_id}:${issue.id}`;
    let ticket = await this.storage.get<string>(reverse);
    if (!ticket) {
      ticket = await this.stamp(`ticket:${map.external_id}:${issue.id}`);
      await this.storage.put(reverse, ticket);
    }
    const binding = (await this.storage.get<Binding>(this.key(ticket))) ?? {
      ticketId: ticket,
      workspaceId: map.workspace_id,
      externalId: map.external_id,
      issueId: issue.id,
      created: true,
      clocks: {},
    };
    if (issue.parent) {
      const parent = await this.issue(issue.parent.id);
      const parentMap = await this.matched(parent);
      if (parentMap?.workspace_id === map.workspace_id)
        await this.importIssue(
          parent,
          `parent:${key}:${parent.id}`,
          undefined,
          ancestors,
        );
      else issue = { ...issue, parent: null };
    }
    const fields = await this.inboundFields(issue, map, policy),
      at = Date.parse(issue.updatedAt);
    if (!Number.isFinite(at))
      throw new ConnectionError("This Linear update has no valid timestamp.");
    const existing = await this.board.detail("tickets", ticket),
      patch: Record<string, unknown> = {},
      fieldFor: Record<string, string> = {
        description: "body",
        state: "status",
        stateId: "status",
        assignee: "assigneeAgentId",
        assigneeId: "assigneeAgentId",
        labelIds: "labels",
        parent: "parentId",
      };
    const selected = changed
      ? new Set(changed.map((k) => fieldFor[k] ?? k))
      : undefined;
    for (const [field, value] of Object.entries(fields)) {
      if (
        selected &&
        !selected.has(field) &&
        !["number", "keyPrefix", "linearIssueId", "externalUrl"].includes(
          field,
        ) &&
        !(
          ["assigneeMemberId", "assigneeName"].includes(field) &&
          selected.has("assigneeAgentId")
        )
      )
        continue;
      const clock: Clock = { at, source: "linear", value };
      if (!existing || this.wins(binding.clocks[field], clock)) {
        binding.clocks[field] = clock;
        patch[field] = value;
      }
    }
    if (!existing)
      await this.append(
        ticket,
        "create",
        { ...fields, projectId: map.workspace_id },
        `issue:${key}`,
        at,
      );
    else if (Object.keys(patch).length)
      await this.append(ticket, "field", patch, `issue:${key}`, at);
    await this.storage.put(this.key(ticket), binding);
    return ticket;
  }
  private async mappedAssignee(
    map: LinearMapping,
    policy: Policy,
    fields: Record<string, unknown>,
  ) {
    const agents = JSON.parse(policy.agent_map) as Record<string, string>,
      agent = String(fields.assigneeAgentId ?? "");
    if (agent && !["you", "workspace"].includes(agent)) {
      const matched = Object.entries(agents).find(([, id]) => id === agent);
      if (!matched)
        throw new ConnectionError("Map this agent to a Linear member.");
      return matched[0];
    }
    if (fields.assigneeMemberId) {
      const row = await this.linear.db
        .prepare(
          "SELECT linear_user_id FROM linear_member_mappings WHERE organization_id=? AND external_id=? AND member_id=?",
        )
        .bind(this.org, map.external_id, String(fields.assigneeMemberId))
        .first<{ linear_user_id: string }>();
      if (!row)
        throw new ConnectionError("Match this member with a Linear account.");
      return row.linear_user_id;
    }
    return null;
  }
  private async outboundFields(
    fields: Record<string, unknown>,
    map: LinearMapping,
    policy: Policy,
  ) {
    const states = JSON.parse(map.status_map) as Record<string, string>,
      input: Record<string, unknown> = {};
    if (fields.title !== undefined) input.title = fields.title;
    if (fields.body !== undefined) input.description = fields.body;
    if (fields.status !== undefined) {
      const state = Object.entries(states).find(
        ([, status]) => status === fields.status,
      )?.[0];
      if (!state)
        throw new ConnectionError("Map this ticket column to a Linear state.");
      input.stateId = state;
    }
    if (
      fields.assigneeAgentId !== undefined ||
      fields.assigneeMemberId !== undefined
    )
      input.assigneeId = await this.mappedAssignee(map, policy, fields);
    if (Array.isArray(fields.labels))
      input.labelIds = fields.labels.map((l) =>
        typeof l === "string" ? l : (l as { id: string }).id,
      );
    if (fields.parentId !== undefined) {
      if (fields.parentId) {
        const parent = await this.board.detail(
          "tickets",
          String(fields.parentId),
        );
        if (!parent || parent.fields.projectId !== map.workspace_id)
          throw new ConnectionError(
            "Choose a parent ticket in this workspace.",
          );
        const linked = await this.ensureTicket(parent, map, policy, new Set());
        input.parentId = linked.issueId;
      } else input.parentId = null;
    }
    return input;
  }
  async ensureTicket(
    ticket: BoardProjection,
    map: LinearMapping,
    policy: Policy,
    seen = new Set<string>(),
  ): Promise<Binding> {
    if (seen.has(ticket.id))
      throw new ConnectionError(
        "Choose a parent without a circular relationship.",
      );
    seen.add(ticket.id);
    let binding = await this.storage.get<Binding>(this.key(ticket.id));
    if (binding && binding.externalId !== map.external_id)
      throw new ConnectionError(
        "This ticket belongs to the previous Linear account.",
      );
    if (!binding) {
      binding = {
        ticketId: ticket.id,
        workspaceId: map.workspace_id,
        externalId: map.external_id,
        issueId: await this.stamp(`issue:${ticket.id}:${map.external_id}`),
        created: false,
        clocks: {},
      };
      await this.storage.put(this.key(ticket.id), binding);
      await this.storage.put(
        `linear:issue:${map.external_id}:${binding.issueId}`,
        ticket.id,
      );
    }
    if (binding.created) return binding;
    let issue: LinearIssue | undefined;
    try {
      issue = await this.issue(binding.issueId);
    } catch {}
    if (!issue) {
      const fields = { ...ticket.fields };
      let parentId: string | undefined;
      if (fields.parentId) {
        const parent = await this.board.detail(
          "tickets",
          String(fields.parentId),
        );
        if (!parent || parent.fields.projectId !== map.workspace_id)
          throw new ConnectionError(
            "Choose a parent ticket in this workspace.",
          );
        parentId = (await this.ensureTicket(parent, map, policy, seen)).issueId;
      }
      delete fields.parentId;
      const data = await this.linear.query<{
        issueCreate: { success: boolean; issue: LinearIssue };
      }>(
        this.org,
        `mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{${ISSUE_FIELDS}}}}`,
        {
          input: {
            ...(await this.outboundFields(fields, map, policy)),
            id: binding.issueId,
            teamId: map.linear_team_id,
            ...(map.linear_project_id
              ? { projectId: map.linear_project_id }
              : {}),
            ...(parentId ? { parentId } : {}),
          },
        },
      );
      if (!data.issueCreate.success)
        throw new ConnectionError("Your Linear issue could not be created.");
      issue = data.issueCreate.issue;
    }
    binding.created = true;
    for (const [field, value] of Object.entries(ticket.fields))
      binding.clocks[field] = { at: ticket.updatedAt, source: "remy", value };
    await this.storage.put(this.key(ticket.id), binding);
    await this.append(
      ticket.id,
      "field",
      {
        number: issue.number,
        keyPrefix: issue.team.key,
        linearIssueId: issue.id,
        externalUrl: issue.url,
      },
      `identity:${issue.id}`,
    );
    return binding;
  }
  async comment(
    binding: Binding,
    key: string,
    text: string,
    label: string,
    at = Date.now(),
  ) {
    if (!text.trim()) return;
    const id = await this.stamp(`comment:${key}`);
    if (await this.storage.get(`linear:comment-sent:${id}`)) return;
    await this.storage.put(`linear:comment-owned:${id}`, true);
    let existing = false;
    try {
      existing = !!(
        await this.linear.query<{ comment: { id: string } | null }>(
          this.org,
          "query($id:String!){comment(id:$id){id}}",
          { id },
        )
      ).comment;
    } catch {}
    if (!existing) {
      const result = await this.linear.query<{
        commentCreate: { success: boolean };
      }>(
        this.org,
        "mutation($input:CommentCreateInput!){commentCreate(input:$input){success}}",
        {
          input: {
            id,
            issueId: binding.issueId,
            body: text,
            createAsUser: label,
            createdAt: new Date(Math.min(at, Date.now())).toISOString(),
          },
        },
      );
      if (!result.commentCreate.success)
        throw new ConnectionError("Your Linear comment could not be posted.");
    }
    await this.storage.put(`linear:comment-sent:${id}`, true);
  }
  async exportEvent(event: BoardLogEvent) {
    if (
      event.entity !== "ticket" ||
      (await this.storage.get(`linear:own:${event.id}`))
    )
      return;
    const ticket = await this.board.detail("tickets", event.entityId);
    if (!ticket) return;
    const workspace = String(ticket.fields.projectId),
      policy = (await this.policies()).find(
        (p) => p.enabled && p.workspace_id === workspace,
      );
    if (!policy) return;
    const map = await this.mapping(workspace);
    if (!map) return;
    const binding = await this.ensureTicket(ticket, map, policy);
    if (event.kind === "comment") {
      const text = String(event.payload.text ?? event.payload.body ?? ""),
        links =
          (ticket.fields.threads as
            { chatId?: string; computerId?: string }[] | undefined) ?? [],
        link = event.payload.threadId
          ? {
              chatId: String(event.payload.threadId),
              computerId: String(event.payload.computerId),
            }
          : links.at(-1);
      await this.comment(
        binding,
        event.id,
        `${text}${link?.chatId && link.computerId ? `\n\n[Open thread](${this.origin}/#/threads/${link.chatId}?organization=${this.org}&computer=${link.computerId})` : ""}`,
        event.actor.label,
        event.at,
      );
      return;
    }
    if (
      event.kind === "link" &&
      event.payload.chatId &&
      event.payload.computerId
    ) {
      await this.comment(
        binding,
        event.id,
        `[Open thread](${this.origin}/#/threads/${event.payload.chatId}?organization=${this.org}&computer=${event.payload.computerId}) — ${event.actor.label} started work.`,
        event.actor.label,
        event.at,
      );
      return;
    }
    if (!["create", "field", "status", "handoff"].includes(event.kind)) return;
    const input = { ...event.payload };
    if (event.kind === "handoff") input.assigneeAgentId = input.toAgentId;
    const accepted: Record<string, unknown> = {},
      restore: Record<string, unknown> = {};
    for (const field of [
      "title",
      "body",
      "status",
      "assigneeAgentId",
      "assigneeMemberId",
      "labels",
      "parentId",
    ]) {
      if (input[field] === undefined) continue;
      const clock: Clock = {
        at: event.at,
        source: "remy",
        value: input[field],
      };
      if (
        this.wins(binding.clocks[field], clock) ||
        (binding.clocks[field]?.at === event.at &&
          binding.clocks[field]?.source === "remy")
      ) {
        accepted[field] = input[field];
        binding.clocks[field] = clock;
      } else restore[field] = binding.clocks[field]!.value;
    }
    if (Object.keys(accepted).length) {
      if (
        accepted.assigneeAgentId !== undefined ||
        accepted.assigneeMemberId !== undefined
      ) {
        accepted.assigneeAgentId ??= ticket.fields.assigneeAgentId;
        accepted.assigneeMemberId ??= ticket.fields.assigneeMemberId;
      }
      const patch = await this.outboundFields(accepted, map, policy);
      if (Object.keys(patch).length) {
        const result = await this.linear.query<{
          issueUpdate: { success: boolean };
        }>(
          this.org,
          "mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success}}",
          { id: binding.issueId, input: patch },
        );
        if (!result.issueUpdate.success)
          throw new ConnectionError("Your Linear ticket could not be updated.");
      }
      await this.storage.put(this.key(ticket.id), binding);
    }
    if (Object.keys(restore).length)
      await this.append(ticket.id, "field", restore, `restore:${event.id}`);
  }
  async receive(payload: Record<string, any>, key: string) {
    if (payload.type === "Issue" && payload.action !== "remove") {
      const data = payload.data;
      const current = await this.issue(String(data.id));
      const issue = {
        ...current,
        ...(typeof data.title === "string" ? { title: data.title } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.updatedAt ? { updatedAt: data.updatedAt } : {}),
        ...(data.stateId
          ? { state: { id: data.stateId, name: current.state.name } }
          : {}),
        ...(data.state ? { state: data.state } : {}),
        ...(data.assignee !== undefined
          ? { assignee: data.assignee }
          : data.assigneeId === null
            ? { assignee: null }
            : {}),
        ...(data.labels
          ? {
              labels: Array.isArray(data.labels)
                ? { nodes: data.labels }
                : data.labels,
            }
          : {}),
        ...(data.parent !== undefined ? { parent: data.parent } : {}),
        ...(data.parentId !== undefined
          ? { parent: data.parentId ? { id: data.parentId } : null }
          : {}),
      } as LinearIssue;
      const ticketId = await this.importIssue(
        issue,
        key,
        payload.updatedFrom ? Object.keys(payload.updatedFrom) : undefined,
      );
      if (
        ticketId &&
        payload.updatedFrom &&
        ("assigneeId" in payload.updatedFrom ||
          "assignee" in payload.updatedFrom)
      )
        await this.handoff(issue, ticketId, payload, key);
    }
    if (payload.type === "Comment" && payload.action === "create") {
      const data = payload.data,
        issueId = String(data.issueId ?? data.issue?.id ?? "");
      if (!issueId) return;
      const id = String(data.id);
      if (await this.storage.get(`linear:comment-owned:${id}`)) return;
      const issue = await this.issue(issueId),
        ticket = await this.importIssue(issue, `comment-issue:${key}`);
      if (!ticket) return;
      const binding = (await this.storage.get<Binding>(this.key(ticket)))!;
      if (await this.storage.get(`linear:comment-owned:${id}`)) return;
      await this.append(
        ticket,
        "comment",
        { text: String(data.body ?? ""), commentId: id },
        `comment:${id}`,
        Date.parse(data.createdAt ?? payload.createdAt) || Date.now(),
        String(data.user?.name ?? payload.actor?.name ?? "Linear"),
      );
      await this.storage.put(
        `linear:comment-imported:${binding.externalId}:${id}`,
        true,
      );
    }
  }
  private async handoff(
    issue: LinearIssue,
    ticket: string,
    payload: Record<string, any>,
    key: string,
  ) {
    const map = await this.matched(issue);
    if (!map || !issue.assignee) return;
    const policy = (await this.policies()).find(
        (p) => p.workspace_id === map.workspace_id,
      )!,
      agent = JSON.parse(policy.agent_map)[issue.assignee.id];
    if (!agent) return;
    const actor = await this.member(
      String(payload.actor?.id ?? ""),
      map.external_id,
    );
    if (!actor) return;
    await this.linear.organizations.workspace(
      this.org,
      actor.member_id,
      map.workspace_id,
    );
    const claim = `linear:handoff:${key}`;
    if (await this.storage.get(claim)) return;
    await this.storage.put(claim, { phase: "starting" });
    try {
      const run = await this.start(
        actor.member_id,
        map.workspace_id,
        agent,
        `Work on ${issue.identifier}: ${issue.title}\n\n${issue.description ?? ""}`,
      );
      await this.storage.put(`linear:run:${run.threadId}`, {
        ...run,
        ticketId: ticket,
        userId: actor.member_id,
        workspaceId: map.workspace_id,
      });
      await this.append(
        ticket,
        "link",
        { chatId: run.threadId, computerId: run.computerId },
        `run:${key}`,
      );
      const binding = (await this.storage.get<Binding>(this.key(ticket)))!;
      await this.comment(
        binding,
        `started:${key}`,
        `[Open thread](${this.origin}/#/threads/${run.threadId}?organization=${this.org}&computer=${run.computerId}) — work started.`,
        "Remy",
      );
      await this.storage.put(claim, { phase: "started", ...run });
    } catch {
      await this.storage.put(claim, { phase: "unavailable" });
      throw new ConnectionError(
        "This assigned agent could not start; check its computer and access.",
      );
    }
  }
  async attachRun(
    ticket: string,
    computer: string,
    thread: string,
    user: string,
  ) {
    const binding = await this.storage.get<Binding>(this.key(ticket));
    if (!binding) return;
    await this.storage.put(`linear:run:${thread}`, {
      computerId: computer,
      ticketId: ticket,
      userId: user,
      workspaceId: binding.workspaceId,
    });
  }
  async artifacts(thread: string, values: Record<string, unknown>[]) {
    const run = await this.storage.get<{
      ticketId: string;
      workspaceId: string;
    }>(`linear:run:${thread}`);
    if (!run) return "";
    const links: string[] = [];
    for (const artifact of values) {
      if (artifact.organizationId && artifact.organizationId !== this.org)
        continue;
      const id = String(artifact.id ?? artifact.key ?? "");
      let href = "";
      if (artifact.kind === "ticket") {
        const ticket = await this.board.detail("tickets", id);
        if (ticket?.fields.projectId === run.workspaceId)
          href = `${this.origin}/#/tickets/${encodeURIComponent(id)}?organization=${this.org}`;
      } else if (artifact.kind === "thread" && id === thread)
        href = `${this.origin}/#/threads/${thread}?organization=${this.org}&computer=${String(artifact.computerId ?? "")}`;
      else if (artifact.kind === "workspace" && id === run.workspaceId)
        href = `${this.origin}/#/workspaces/${id}?organization=${this.org}`;
      if (href)
        links.push(
          `[${String(artifact.title ?? "Open work").replace(/[\[\]\n\r]/g, " ")}](${href})${artifact.detail ? ` — ${String(artifact.detail).replace(/[\n\r]/g, " ")}` : ""}`,
        );
    }
    return [...new Set(links)].join("\n");
  }
  async reply(computer: string, thread: string, text: string) {
    const run = await this.storage.get<{
      computerId: string;
      ticketId: string;
      userId: string;
      workspaceId: string;
    }>(`linear:run:${thread}`);
    if (!run || run.computerId !== computer) return;
    const policy = (await this.policies()).find(
      (p) => p.enabled && p.workspace_id === run.workspaceId,
    );
    if (!policy) return;
    await this.linear.organizations.workspace(
      this.org,
      run.userId,
      run.workspaceId,
    );
    const binding = await this.storage.get<Binding>(this.key(run.ticketId));
    if (!binding) return;
    await this.comment(
      binding,
      `reply:${thread}`,
      `${text}\n\n[Open thread](${this.origin}/#/threads/${thread}?organization=${this.org}&computer=${computer})`,
      "Remy",
    );
    await this.storage.put(`linear:run-done:${thread}`, true);
  }
  async resolve(user: string, workspace: string, key: string) {
    await this.linear.organizations.workspace(this.org, user, workspace);
    const issue = await this.issue(key),
      map = await this.matched(issue);
    if (map?.workspace_id !== workspace)
      throw new ConnectionError(
        "This Linear ticket belongs to another workspace.",
      );
    const ticketId = await this.importIssue(
      issue,
      `resolve:${issue.id}:${issue.updatedAt}`,
    );
    return { ticketId, issue };
  }
  async tick() {
    const policies = (await this.policies()).filter((p) => p.enabled);
    if (!policies.length) return;
    for (const policy of policies) {
      try {
        if (policy.bootstrap) {
          const map = await this.mapping(policy.workspace_id);
          if (!map) continue;
          const labels = await this.linear.pages<{
            id: string;
            name: string;
            team: { id: string } | null;
          }>(this.org, "issueLabels", "id name team{id}");
          await this.storage.put(
            `linear:labels:${policy.workspace_id}`,
            labels
              .filter((l) => !l.team || l.team.id === map.linear_team_id)
              .map((l) => ({ id: l.id, name: l.name })),
          );
          const issues = await this.linear.pages<LinearIssue>(
            this.org,
            "issues",
            ISSUE_FIELDS,
            `,filter:{team:{id:{eq:${JSON.stringify(map.linear_team_id)}}}${map.linear_project_id ? `,project:{id:{eq:${JSON.stringify(map.linear_project_id)}}}` : ""}}`,
          );
          for (const issue of issues)
            await this.importIssue(
              issue,
              `bootstrap:${issue.id}:${issue.updatedAt}`,
            );
          for (const ticket of (await this.board.list("tickets")).items.filter(
            (t) => t.fields.projectId === policy.workspace_id,
          ))
            await this.ensureTicket(ticket, map, policy);
          await this.linear.db
            .prepare(
              "UPDATE linear_board_settings SET bootstrap=0,error=NULL WHERE organization_id=? AND workspace_id=?",
            )
            .bind(this.org, policy.workspace_id)
            .run();
        }
      } catch (e) {
        await this.error(policy.workspace_id, e);
      }
    }
    const pending = (
      await this.linear.db
        .prepare(
          "SELECT id,payload FROM linear_updates WHERE organization_id=? AND processed=0 ORDER BY received_at,id LIMIT 100",
        )
        .bind(this.org)
        .all<{ id: string; payload: string }>()
    ).results;
    for (const update of pending) {
      try {
        await this.receive(JSON.parse(update.payload), update.id);
        await this.linear.db
          .prepare("UPDATE linear_updates SET processed=1 WHERE id=?")
          .bind(update.id)
          .run();
      } catch (e) {
        for (const policy of policies) await this.error(policy.workspace_id, e);
      }
    }
    for (const [key, event] of await this.storage.list<BoardLogEvent>({
      prefix: "linear:retry:",
    })) {
      try {
        await this.exportEvent(event);
        await this.storage.delete(key);
      } catch {}
    }
    let vector =
      (await this.storage.get<BoardVersionVector>("linear:vector")) ?? {};
    for (let page = 0; page < 20; page++) {
      const events = await this.board.eventsSince(vector, 100);
      if (!events.length) break;
      for (const event of events) {
        try {
          await this.exportEvent(event);
        } catch (e) {
          const ticket = await this.board.detail("tickets", event.entityId);
          if (ticket) await this.error(String(ticket.fields.projectId), e);
          await this.storage.put(`linear:retry:${event.id}`, event);
        }
        vector = {
          ...vector,
          [event.deviceId]: Math.max(
            vector[event.deviceId] ?? 0,
            event.lamport,
          ),
        };
        await this.storage.put("linear:vector", vector);
      }
    }
    await this.linear.changed(this.org);
  }
  private async error(workspace: string, error: unknown) {
    await this.linear.db
      .prepare(
        "UPDATE linear_board_settings SET error=? WHERE organization_id=? AND workspace_id=?",
      )
      .bind(
        error instanceof ConnectionError
          ? error.message
          : "Your Linear sync needs attention; reconnect or try again.",
        this.org,
        workspace,
      )
      .run();
    await this.linear.changed(this.org);
  }
}
