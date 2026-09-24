import {
  ConnectionError,
  type Connections,
  type ConnectionDelivery,
} from "./connections.js";
import { D1OrganizationStore } from "./organization-store.js";
import { OrganizationService } from "./organizations.js";
import { repositoryOrigin } from "./organizations.js";

type Repository = {
  id: number;
  full_name: string;
  name: string;
  html_url: string;
  description?: string | null;
  language?: string | null;
  private?: boolean;
  pushed_at?: string | null;
};
type Installation = { id: number; app_id: number; account: { login: string } };
export type GitHubActivity = {
  id: string;
  organization_id: string;
  workspace_id: string;
  event: string;
  pull_number: number;
  summary: string;
  phase: string;
  thread_id: string | null;
  computer_id: string | null;
  member_id: string | null;
  reply_id: number | null;
};
export class GitHubConnection {
  readonly store: D1OrganizationStore;
  readonly organizations: OrganizationService;
  constructor(
    readonly db: D1Database,
    readonly connections: Connections,
    readonly appId: string,
    readonly changed: (org: string) => Promise<void>,
    readonly send: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.store = new D1OrganizationStore(db);
    this.organizations = new OrganizationService(this.store);
  }
  async access(org: string, user: string, roles?: string[]) {
    const member = await this.store.membership(org, user);
    if (!member || (roles && !roles.includes(member.role)))
      throw new ConnectionError("This action is unavailable.", 403);
    return member;
  }
  async api<T>(
    org: string,
    user: string,
    path: string,
    method = "GET",
    input?: unknown,
  ): Promise<T> {
    await this.access(org, user);
    const token = await this.connections.token(org, "github", user);
    const response = await this.send(`https://api.github.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "Remy",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new ConnectionError(
        response.status === 401
          ? "Reconnect your GitHub account."
          : "GitHub could not complete this action.",
        response.status === 401 ? 409 : 502,
      );
    return response.status === 204
      ? (undefined as T)
      : ((await response.json()) as T);
  }
  async accessibleRepositories(org: string, user: string, page: number) {
    await this.access(org, user, ["owner", "admin"]);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100)
      throw new ConnectionError("Choose a valid repository page.");
    const repositories = await this.api<Repository[]>(org, user, `/user/repos?per_page=100&sort=updated&page=${page}`);
    return {
      // The picker reads these to tell two similarly named repositories apart,
      // so a row carries what GitHub already knows rather than a slug alone.
      repositories: repositories.map(({ id, name, full_name, description, language, private: restricted, pushed_at }) => ({
        id,
        name,
        full_name,
        description: description ?? null,
        language: language ?? null,
        private: restricted === true,
        pushedAt: pushed_at ?? null,
      })),
      nextPage: repositories.length === 100 ? page + 1 : null,
    };
  }
  async importRepository(org: string, user: string, fullName: string) {
    await this.access(org, user, ["owner", "admin"]);
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) throw new ConnectionError("Choose a GitHub repository.");
    const repo = await this.api<Repository>(org, user, `/repos/${fullName}`);
    if (!repo.id || !repo.name || !/^[\w.-]+\/[\w.-]+$/.test(repo.full_name)) throw new ConnectionError("This repository is unavailable.");
    const origin = repositoryOrigin(`https://github.com/${repo.full_name}.git`)!;
    const existing = await this.store.workspaceByOrigin(org, origin);
    const workspace = existing ? await this.organizations.workspace(org, user, existing.id) : await this.organizations.createWorkspace(org, user, {name: repo.name, origin});
    await this.changed(org);
    return { workspace };
  }
  async workspaceGitToken(org: string, user: string, workspaceId: string) {
    const workspace = await this.organizations.workspace(org, user, workspaceId);
    if (!/^github\.com\/[\w.-]+\/[\w.-]+$/.test(workspace.origin))
      throw new ConnectionError("Choose a GitHub workspace.");
    return this.connections.token(org, "github", user);
  }
  async workspaceBranches(org: string, user: string, workspaceId: string) {
    const workspace = await this.organizations.workspace(org, user, workspaceId);
    const repository = /^github\.com\/([\w.-]+\/[\w.-]+)$/.exec(workspace.origin)?.[1];
    if (!repository) throw new ConnectionError("Choose a GitHub workspace.");
    const repo = await this.api<{ default_branch: string }>(org, user, `/repos/${repository}`);
    const branches: { name: string; current: boolean; checkout: null }[] = [];
    for (let page = 1; page <= 20; page++) {
      const rows = await this.api<{ name: string }[]>(org, user, `/repos/${repository}/branches?per_page=100&page=${page}`);
      branches.push(...rows.map(row => ({ name: row.name, current: row.name === repo.default_branch, checkout: null })));
      if (rows.length < 100) return { branches };
    }
    throw new ConnectionError("This repository has too many branches to list.");
  }
  async workspaceImage(org: string, user: string, workspaceId: string, path?: string, query = "") {
    const workspace = await this.organizations.workspace(org, user, workspaceId);
    const repository = /^github\.com\/([\w.-]+\/[\w.-]+)$/.exec(workspace.origin)?.[1];
    if (!repository) throw new ConnectionError("Choose a GitHub workspace.");
    const valid = (name: string) => !name.startsWith("/") && !name.includes("..") && !name.includes("\\") && /\.(png|jpe?g|svg|webp)$/i.test(name);
    if (path !== undefined) {
      if (!valid(path)) throw new ConnectionError("Choose an image in this repository.");
      const file = await this.api<{ type: string; size: number; encoding: string; content: string }>(org, user, `/repos/${repository}/contents/${path.split("/").map(encodeURIComponent).join("/")}`);
      if (file.type !== "file" || file.size > 1_000_000 || file.encoding !== "base64") throw new ConnectionError("Choose an image smaller than 1 MB.");
      const extension = path.split(".").pop()!.toLowerCase();
      const mime = extension === "svg" ? "image/svg+xml" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : `image/${extension}`;
      return { mime, data: file.content.replace(/\s/g, "") };
    }
    const tree = await this.api<{ tree: { path: string; type: string; size?: number }[]; truncated?: boolean }>(org, user, `/repos/${repository}/git/trees/HEAD?recursive=1`);
    const images = tree.tree.filter(file => file.type === "blob" && valid(file.path) && (file.size ?? 0) <= 1_000_000 && file.path.toLowerCase().includes(query.toLowerCase()));
    images.sort((a, b) => Number(/icon|logo/i.test(b.path)) - Number(/icon|logo/i.test(a.path)) || a.path.localeCompare(b.path));
    return { images: images.slice(0, 60).map(file => ({ path: file.path })), truncated: !!tree.truncated };
  }
  async installations(org: string, user: string) {
    await this.access(org, user, ["owner", "admin"]);
    const all: Installation[] = [];
    for (let page = 1; page <= 100; page++) {
      const value = await this.api<{ installations: Installation[] }>(
        org,
        user,
        `/user/installations?per_page=100&page=${page}`,
      );
      all.push(
        ...value.installations.filter((i) => String(i.app_id) === this.appId),
      );
      if (value.installations.length < 100) return all;
    }
    throw new ConnectionError("Your installation list is too large.");
  }
  async repositories(org: string, user: string, installation: number) {
    if (
      !(await this.installations(org, user)).some((i) => i.id === installation)
    )
      throw new ConnectionError(
        "Choose a GitHub installation you can access.",
        403,
      );
    const all: Repository[] = [];
    for (let page = 1; page <= 100; page++) {
      const value = await this.api<{ repositories: Repository[] }>(
        org,
        user,
        `/user/installations/${installation}/repositories?per_page=100&page=${page}`,
      );
      all.push(...value.repositories);
      if (value.repositories.length < 100) return all;
    }
    throw new ConnectionError("Your repository list is too large.");
  }
  async select(org: string, user: string, installation: number, ids: number[]) {
    const install = (await this.installations(org, user)).find(
      (i) => i.id === installation,
    );
    if (!install)
      throw new ConnectionError(
        "Choose a GitHub installation you can access.",
        403,
      );
    const repositories = await this.repositories(org, user, installation),
      selected = repositories.filter((r) => ids.includes(r.id));
    if (new Set(ids).size !== selected.length || selected.length > 100)
      throw new ConnectionError("Choose available repositories.");
    const rows = [];
    for (const repo of selected) {
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo.full_name))
        throw new ConnectionError("This repository is unavailable.");
      const origin = repositoryOrigin(
        `https://github.com/${repo.full_name}.git`,
      )!;
      let workspace = await this.store.workspaceByOrigin(org, origin);
      if (!workspace)
        workspace = await this.organizations.createWorkspace(org, user, {
          name: repo.name,
          origin,
        });
      rows.push({ repo, workspace });
    }
    await this.access(org, user, ["owner", "admin"]);
    await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO organization_git_installations(organization_id,installation_id,account) VALUES(?,?,?) ON CONFLICT(organization_id) DO UPDATE SET installation_id=excluded.installation_id,account=excluded.account",
        )
        .bind(org, installation, install.account.login),
      this.db
        .prepare("DELETE FROM github_repositories WHERE organization_id=?")
        .bind(org),
      ...rows.map(({ repo, workspace }) =>
        this.db
          .prepare(
            "INSERT INTO github_repositories(organization_id,workspace_id,repository_id,full_name,installation_id) VALUES(?,?,?,?,?)",
          )
          .bind(org, workspace.id, repo.id, repo.full_name, installation),
      ),
      this.db
        .prepare(
          "DELETE FROM github_monitoring WHERE organization_id=? AND workspace_id NOT IN (SELECT workspace_id FROM github_repositories WHERE organization_id=?)",
        )
        .bind(org, org),
    ]);
    await this.changed(org);
    return this.list(org, user);
  }
  async list(org: string, user: string) {
    const visible = await this.organizations.workspaces(org, user),
      ids = new Set(visible.map((w) => w.id));
    const repositories = (
      await this.db
        .prepare("SELECT * FROM github_repositories WHERE organization_id=?")
        .bind(org)
        .all<{
          workspace_id: string;
          full_name: string;
          repository_id: number;
          installation_id: number;
        }>()
    ).results.filter((r) => ids.has(r.workspace_id));
    const monitoring = (
      await this.db
        .prepare("SELECT * FROM github_monitoring WHERE organization_id=?")
        .bind(org)
        .all<{
          workspace_id: string;
          pull_number: number;
          enabled: number;
          agent_id: string | null;
        }>()
    ).results.filter((r) => ids.has(r.workspace_id));
    const activity = (
      await this.db
        .prepare(
          "SELECT * FROM github_activity WHERE organization_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(org)
        .all<GitHubActivity>()
    ).results.filter((r) => ids.has(r.workspace_id));
    return { repositories, monitoring, activity };
  }
  async repository(org: string, user: string, workspace: string) {
    await this.organizations.workspace(org, user, workspace);
    const row = await this.db
      .prepare(
        "SELECT full_name FROM github_repositories WHERE organization_id=? AND workspace_id=?",
      )
      .bind(org, workspace)
      .first<{ full_name: string }>();
    if (!row)
      throw new ConnectionError("Connect this workspace to GitHub.", 404);
    return row.full_name;
  }
  async inherit(org: string, user: string, workspace: string, pull: number) {
    await this.access(org, user, ["owner", "admin"]);
    await this.repository(org, user, workspace);
    if (!Number.isSafeInteger(pull) || pull <= 0)
      throw new ConnectionError("Choose a pull request.");
    await this.db
      .prepare(
        "DELETE FROM github_monitoring WHERE organization_id=? AND workspace_id=? AND pull_number=?",
      )
      .bind(org, workspace, pull)
      .run();
    await this.changed(org);
  }
  async configure(
    org: string,
    user: string,
    workspace: string,
    pull: number,
    enabled: boolean,
    agentId: string | null,
  ) {
    await this.access(org, user, ["owner", "admin"]);
    await this.repository(org, user, workspace);
    if (!Number.isSafeInteger(pull) || pull < 0 || (enabled && !agentId))
      throw new ConnectionError("Choose an agent for pull request monitoring.");
    await this.db
      .prepare(
        "INSERT INTO github_monitoring(organization_id,workspace_id,pull_number,enabled,agent_id) VALUES(?,?,?,?,?) ON CONFLICT(organization_id,workspace_id,pull_number) DO UPDATE SET enabled=excluded.enabled,agent_id=excluded.agent_id",
      )
      .bind(org, workspace, pull, enabled ? 1 : 0, agentId)
      .run();
    await this.changed(org);
  }
  async action(
    org: string,
    user: string,
    workspace: string,
    action: string,
    input: Record<string, unknown>,
  ) {
    const repo = await this.repository(org, user, workspace),
      prefix = `/repos/${repo}`;
    const body = typeof input.body === "string" ? input.body : "";
    if (body.length > 60000)
      throw new ConnectionError("Write a shorter message.");
    if (action === "create") {
      if (
        typeof input.title !== "string" ||
        !input.title.trim() ||
        typeof input.head !== "string" ||
        typeof input.base !== "string"
      )
        throw new ConnectionError("Enter a title and branches.");
      return this.api(org, user, `${prefix}/pulls`, "POST", {
        title: input.title,
        head: input.head,
        base: input.base,
        body,
      });
    }
    const number = Number(input.number);
    if (!Number.isSafeInteger(number) || number <= 0)
      throw new ConnectionError("Choose a pull request.");
    await this.api(org, user, `${prefix}/pulls/${number}`);
    if (action === "comment" && body.trim())
      return this.api(
        org,
        user,
        `${prefix}/issues/${number}/comments`,
        "POST",
        { body },
      );
    if (
      action === "review" &&
      ["APPROVE", "REQUEST_CHANGES", "COMMENT"].includes(String(input.event))
    )
      return this.api(org, user, `${prefix}/pulls/${number}/reviews`, "POST", {
        body,
        event: input.event,
      });
    throw new ConnectionError("Choose a GitHub action.");
  }
  async receive(
    delivery: ConnectionDelivery,
    start: (
      org: string,
      user: string,
      workspace: string,
      agent: string,
      prompt: string,
    ) => Promise<{ threadId: string; computerId: string }>,
  ) {
    const value = JSON.parse(delivery.payload),
      installation = Number(value.installation?.id);
    if (!Number.isSafeInteger(installation)) return;
    const owner = await this.db
      .prepare(
        "SELECT organization_id FROM organization_git_installations WHERE installation_id=?",
      )
      .bind(installation)
      .first<{ organization_id: string }>();
    if (!owner) return;
    const org = owner.organization_id;
    if (
      delivery.event === "installation" &&
      ["deleted", "suspend"].includes(value.action)
    ) {
      await this.db.batch([
        this.db
          .prepare("DELETE FROM github_monitoring WHERE organization_id=?")
          .bind(org),
        this.db
          .prepare("DELETE FROM github_repositories WHERE organization_id=?")
          .bind(org),
        this.db
          .prepare(
            "DELETE FROM organization_git_installations WHERE organization_id=?",
          )
          .bind(org),
      ]);
      await this.changed(org);
      return;
    }
    if (
      delivery.event === "installation_repositories" &&
      value.action === "removed"
    ) {
      for (const r of value.repositories_removed ?? [])
        await this.db.batch([
          this.db
            .prepare(
              "DELETE FROM github_monitoring WHERE organization_id=? AND workspace_id IN (SELECT workspace_id FROM github_repositories WHERE organization_id=? AND repository_id=?)",
            )
            .bind(org, org, r.id),
          this.db
            .prepare(
              "DELETE FROM github_repositories WHERE organization_id=? AND repository_id=?",
            )
            .bind(org, r.id),
        ]);
      await this.changed(org);
      return;
    }
    const repository = await this.db
      .prepare(
        "SELECT workspace_id FROM github_repositories WHERE organization_id=? AND repository_id=? AND installation_id=?",
      )
      .bind(org, Number(value.repository?.id ?? 0), installation)
      .first<{ workspace_id: string }>();
    if (!repository) return;
    const pull = Number(
      value.pull_request?.number ??
        (value.issue?.pull_request ? value.issue.number : undefined) ??
        value.check_run?.pull_requests?.[0]?.number ??
        value.check_suite?.pull_requests?.[0]?.number,
    );
    if (!Number.isSafeInteger(pull) || pull < 1) return;
    const workspace = repository.workspace_id,
      text = String(value.comment?.body ?? value.review?.body ?? ""),
      summary =
        (
          {
            issue_comment: "Comment updated",
            pull_request_review: "Review updated",
            pull_request_review_comment: "Review comment updated",
            check_run: "Check updated",
            check_suite: "Checks updated",
            pull_request: "Pull request updated",
          } as Record<string, string>
        )[delivery.event] ?? "GitHub updated";
    const inserted = await this.db
      .prepare(
        "INSERT OR IGNORE INTO github_activity(id,organization_id,workspace_id,event,pull_number,summary,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        delivery.id,
        org,
        workspace,
        delivery.event,
        pull,
        summary,
        delivery.received_at,
      )
      .run();
    if (!inserted.meta.changes) return;
    await this.changed(org);
    if (
      ![
        "issue_comment",
        "pull_request_review",
        "pull_request_review_comment",
      ].includes(delivery.event) ||
      !["created", "submitted"].includes(value.action) ||
      !/(^|\s)@remy\b/i.test(text) ||
      text.includes("<!-- remy-reply:")
    )
      return;
    const policy = await this.db
      .prepare(
        "SELECT enabled,agent_id FROM github_monitoring WHERE organization_id=? AND workspace_id=? AND pull_number IN (0,?) ORDER BY pull_number DESC LIMIT 1",
      )
      .bind(org, workspace, pull)
      .first<{ enabled: number; agent_id: string | null }>();
    if (!policy?.enabled || !policy.agent_id) return;
    const identity = await this.db
      .prepare(
        "SELECT i.user_id FROM connection_identities i JOIN connections c ON c.id=i.connection_id WHERE i.organization_id=? AND c.provider='github' AND i.external_user_id=?",
      )
      .bind(org, String(value.sender?.id ?? ""))
      .first<{ user_id: string }>();
    if (!identity) {
      await this.db
        .prepare("UPDATE github_activity SET phase='unmapped' WHERE id=?")
        .bind(delivery.id)
        .run();
      await this.changed(org);
      return;
    }
    try {
      await this.organizations.workspace(org, identity.user_id, workspace);
      await this.db
        .prepare(
          "UPDATE github_activity SET phase='starting',member_id=? WHERE id=?",
        )
        .bind(identity.user_id, delivery.id)
        .run();
      const run = await start(
        org,
        identity.user_id,
        workspace,
        policy.agent_id,
        `GitHub pull request #${pull}\n${text}\n\nTreat the GitHub message as a request from the linked member. Your final response will be posted to this pull request.`,
      );
      await this.db
        .prepare(
          "UPDATE github_activity SET phase='running',thread_id=?,computer_id=? WHERE id=?",
        )
        .bind(run.threadId, run.computerId, delivery.id)
        .run();
    } catch {
      await this.db
        .prepare("UPDATE github_activity SET phase='unavailable' WHERE id=?")
        .bind(delivery.id)
        .run();
    }
    await this.changed(org);
  }
  async reply(org: string, thread: string, text: string) {
    const activity = await this.db
      .prepare(
        "SELECT * FROM github_activity WHERE organization_id=? AND thread_id=? AND phase='running'",
      )
      .bind(org, thread)
      .first<GitHubActivity>();
    if (!activity?.member_id || !text.trim()) return;
    const repo = await this.repository(
        org,
        activity.member_id,
        activity.workspace_id,
      ),
      path = `/repos/${repo}/issues/${activity.pull_number}/comments`,
      marker = `<!-- remy-reply:${activity.id} -->`;
    let found: { id: number } | undefined;
    for (let page = 1; page <= 100; page++) {
      const comments = await this.api<{ id: number; body: string }[]>(
        org,
        activity.member_id,
        `${path}?per_page=100&page=${page}`,
      );
      found = comments.find((c) => c.body.includes(marker));
      if (found || comments.length < 100) break;
      if (page === 100)
        throw new ConnectionError(
          "This conversation is too large to verify a reply.",
        );
    }
    const posted =
      found ??
      (await this.api<{ id: number }>(org, activity.member_id, path, "POST", {
        body: `${text.slice(0, 59000)}\n\n${marker}`,
      }));
    await this.db
      .prepare(
        "UPDATE github_activity SET phase='replied',reply_id=? WHERE id=?",
      )
      .bind(posted.id, activity.id)
      .run();
    await this.changed(org);
  }

  /// Open pull requests that belong to a workspace. The saved credential is
  /// the GitHub sign-in or a personal access token; a repo that token can read
  /// still has to be a workspace.
  async openPullRequests(org: string, user: string, refresh = false) {
    const cacheKey = `${org}:${user}`;
    const cached = hostedPullRequestCache.get(cacheKey);
    if (!refresh && cached && Date.now() - cached.at < HOSTED_PULL_REQUEST_CACHE_FRESH_MS) {
      return cached.value;
    }
    const value = await this.readOpenPullRequests(org, user);
    // Skip caching the no-workspace empty list so adding a first workspace is
    // not stuck behind a PAT-wide miss for the rest of the fresh window.
    if (value.viewer || value.pullRequests.length) {
      hostedPullRequestCache.set(cacheKey, { at: Date.now(), value });
    }
    return value;
  }

  private async readOpenPullRequests(org: string, user: string) {
    await this.access(org, user);
    // The member subject is the PAT or GitHub sign-in for this account — never
    // an organization-wide installation token, which cannot see repositories
    // the GitHub App is not installed on.
    await this.connections.token(org, "github", user);
    const workspaces = await this.organizations.workspaces(org, user);
    const workspaceByRepo = new Map(
      workspaces.flatMap((workspace) => {
        const repository = githubRepositoryFromOrigin(workspace.origin);
        return repository ? [[repository.toLowerCase(), workspace] as const] : [];
      }),
    );
    if (!workspaceByRepo.size) return { viewer: "", pullRequests: [] as HostedListedPullRequest[] };
    const repositories = [...workspaceByRepo.keys()].slice(0, HOSTED_PULL_REQUEST_WORKSPACE_REPOS);
    const repoSelections = repositories.map((_, index) =>
      `repo${index}: repository(owner:$o${index}, name:$n${index}) { pullRequests(states: OPEN, first: 20, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ...HostedPullRequest } } }`);
    const variables: Record<string, string> = Object.fromEntries(repositories.flatMap((repository, index) => {
      const [owner, name] = repository.split("/");
      return [[`o${index}`, owner], [`n${index}`, name]];
    }));
    // Viewer and search catch involvement beyond the per-workspace page. Both
    // are filtered to workspace origins; a PAT-visible repo is not enough.
    const data = await this.graphql(org, user, {
      query: `query OpenPullRequests${repositories.length ? `(${repositories.flatMap((_, index) => [`$o${index}: String!`, `$n${index}: String!`]).join(", ")})` : ""} {
        viewer {
          login
          pullRequests(states: OPEN, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
            nodes { ...HostedPullRequest }
          }
        }
        search(query: "is:open is:pr involves:@me", type: ISSUE, first: 50) {
          nodes { ... on PullRequest { ...HostedPullRequest } }
        }
        ${repoSelections.join("\n")}
      }
      ${HOSTED_PULL_REQUEST_FRAGMENT}`,
      variables,
    });
    const payload = data.data ?? {};
    const viewer = githubLogin(loginOf(payload.viewer));
    const viewerNodes = nodesOf((payload.viewer as { pullRequests?: { nodes?: unknown[] } } | undefined)?.pullRequests);
    const searchFailed = (data.errors ?? []).some((error) => Array.isArray(error.path) && error.path[0] === "search");
    const searchNodes = searchFailed ? [] : nodesOf((payload.search as { nodes?: unknown[] } | undefined));
    const workspaceNodes = repositories.flatMap((_, index) =>
      nodesOf((payload[`repo${index}`] as { pullRequests?: { nodes?: unknown[] } } | undefined)?.pullRequests),
    );
    const byURL = new Map<string, HostedListedPullRequest>();
    for (const value of [...viewerNodes, ...searchNodes, ...workspaceNodes]) {
      const pullRequest = hostedPullRequest(value, viewer, workspaceByRepo);
      if (!pullRequest) continue;
      if (
        workspaceNodes.includes(value)
        && !viewerNodes.includes(value)
        && !searchNodes.includes(value)
        && !involvesGitHubUser(value, viewer)
      ) continue;
      const current = byURL.get(pullRequest.url);
      if (!current || (!current.checks.length && pullRequest.checks.length)) byURL.set(pullRequest.url, pullRequest);
    }
    if (!byURL.size && (data.errors ?? []).some((error) => !(Array.isArray(error.path) && error.path[0] === "search")) && !viewerNodes.length) {
      throw new ConnectionError(data.errors?.[0]?.message || "GitHub could not list pull requests.");
    }
    const pullRequests: HostedListedPullRequest[] = [...byURL.values()].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    return { viewer, pullRequests };
  }

  private async graphql(
    org: string,
    user: string,
    input: { query: string; variables?: Record<string, string> },
  ) {
    return this.api<{
      data?: Record<string, unknown>;
      errors?: { message?: string; path?: unknown[] }[];
    }>(org, user, "/graphql", "POST", input);
  }
}

/// Fresh enough that a reopen of Pull requests does not wait on GitHub again.
export const HOSTED_PULL_REQUEST_CACHE_FRESH_MS = 60_000;
const HOSTED_PULL_REQUEST_WORKSPACE_REPOS = 12;
const hostedPullRequestCache = new Map<string, {
  at: number;
  value: { viewer: string; pullRequests: HostedListedPullRequest[] };
}>();
export function clearHostedPullRequestCache() {
  hostedPullRequestCache.clear();
}

const HOSTED_PULL_REQUEST_FRAGMENT = `fragment HostedPullRequest on PullRequest {
  number title url body isDraft reviewDecision updatedAt additions deletions changedFiles
  headRefName baseRefName mergeable mergeStateStatus
  author { login }
  repository { nameWithOwner }
  assignees(first: 10) { nodes { login } }
  reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } } } }
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 20) { nodes {
    ... on CheckRun { name conclusion status }
    ... on StatusContext { context state }
  } } } } } }
}`;

function githubRepositoryFromOrigin(origin: string) {
  return /^github\.com\/([\w.-]+\/[\w.-]+)$/i.exec(origin)?.[1] ?? "";
}

function githubLogin(value: string) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value) ? value : "";
}

function nodesOf(value: { nodes?: unknown[] } | undefined) {
  return Array.isArray(value?.nodes) ? value.nodes : [];
}

function loginOf(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const login = (value as { login?: unknown }).login;
  return typeof login === "string" ? login : "";
}

function involvesGitHubUser(value: unknown, viewer: string) {
  if (!viewer || !value || typeof value !== "object") return false;
  const pr = value as Record<string, unknown>;
  const needle = viewer.toLowerCase();
  if (loginOf(pr.author).toLowerCase() === needle) return true;
  const assignees = ((pr.assignees as { nodes?: unknown[] } | undefined)?.nodes ?? []).map(loginOf);
  if (assignees.some((login) => login.toLowerCase() === needle)) return true;
  return ((pr.reviewRequests as { nodes?: unknown[] } | undefined)?.nodes ?? []).some((node) => {
    if (!node || typeof node !== "object") return false;
    return loginOf((node as { requestedReviewer?: unknown }).requestedReviewer).toLowerCase() === needle;
  });
}

type HostedListedPullRequest = {
  url: string;
  number: number;
  title: string;
  body: string;
  repository: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  reviewDecision: string;
  authorLogin: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  checks: { name: string; state: "pass" | "fail" | "pending" | "skipping" }[];
  unreadComments: unknown[];
  hasUnreadActivity: boolean;
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
  worktreePath: string | null;
  mergeable: string;
  mergeStateStatus: string;
  state: string;
};

function hostedPullRequest(
  value: unknown,
  viewer: string,
  workspaceByRepo: Map<string, { id: string; name: string }>,
): HostedListedPullRequest | undefined {
  if (!value || typeof value !== "object") return;
  const pr = value as Record<string, unknown>;
  const repository = (pr.repository as { nameWithOwner?: string } | undefined)?.nameWithOwner;
  const number = pr.number;
  if (!repository || typeof number !== "number") return;
  const author = loginOf(pr.author);
  const workspace = workspaceByRepo.get(repository.toLowerCase());
  if (!workspace) return;
  return {
    url: String(pr.url ?? `https://github.com/${repository}/pull/${number}`),
    number,
    title: String(pr.title ?? "Untitled pull request"),
    body: String(pr.body ?? ""),
    repository,
    headRefName: String(pr.headRefName ?? ""),
    baseRefName: String(pr.baseRefName ?? ""),
    isDraft: pr.isDraft === true,
    reviewDecision: String(pr.reviewDecision ?? ""),
    authorLogin: author,
    updatedAt: String(pr.updatedAt ?? new Date(0).toISOString()),
    additions: Number(pr.additions ?? 0),
    deletions: Number(pr.deletions ?? 0),
    changedFiles: Number(pr.changedFiles ?? 0),
    checks: pullRequestChecks(pr),
    unreadComments: [] as unknown[],
    hasUnreadActivity: false,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspacePath: "",
    worktreePath: viewer && author.toLowerCase() === viewer.toLowerCase() ? "hosted" : null,
    mergeable: String(pr.mergeable ?? ""),
    mergeStateStatus: String(pr.mergeStateStatus ?? ""),
    state: "OPEN",
  };
}

function pullRequestChecks(pr: Record<string, unknown>) {
  const commits = pr.commits as { nodes?: { commit?: { statusCheckRollup?: { contexts?: { nodes?: Record<string, unknown>[] } } } }[] } | undefined;
  const nodes = commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  return nodes.flatMap((node) => {
    const name = String(node.name ?? node.context ?? "");
    if (!name) return [];
    const conclusion = String(node.conclusion ?? node.state ?? "").toUpperCase();
    const status = String(node.status ?? "").toUpperCase();
    let state: "pass" | "fail" | "pending" | "skipping" = "pending";
    if (["SUCCESS", "NEUTRAL"].includes(conclusion)) state = "pass";
    else if (["SKIPPED", "EXPECTED"].includes(conclusion)) state = "skipping";
    else if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(conclusion)) state = "fail";
    else if (status === "COMPLETED") state = "pass";
    return [{ name, state }];
  });
}
