import {
  ConnectionError,
  type Connections,
  type ConnectionDelivery,
} from "./connections.js";
import { D1OrganizationStore } from "./organization-store.js";
import { OrganizationService } from "./organizations.js";
import { repositoryOrigin } from "./organizations.js";
import {
  lineCommentTarget,
  REVIEW_EVENTS,
  REVIEW_FILES_MAX_PAGES,
  REVIEW_FILES_PAGE,
  REVIEW_THREADS_MAX_PAGES,
  REVIEW_THREADS_PAGE,
  reviewAuthor,
  reviewBody,
  reviewThreads,
  viewedStates,
} from "./github-review.js";
import {
  ACTIVITY_TIMELINE_ITEMS,
  activityItems,
  checkState,
  markFromThread,
  readThreadMarker,
} from "./github-activity.js";

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
  created_at: number;
};
/// A thread a member's action came from, when a thread posts through the hub.
export type FromThread = { computerId: string; threadId: string };
export class GitHubConnection {
  readonly store: D1OrganizationStore;
  readonly organizations: OrganizationService;
  constructor(
    readonly db: D1Database,
    readonly connections: Connections,
    readonly appId: string,
    readonly changed: (org: string) => Promise<void>,
    readonly send: typeof fetch = (input, init) => fetch(input, init),
    readonly options: {
      /// Signs the marker on what a thread posts.
      secret?: () => Promise<string>;
      now?: () => number;
    } = {},
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
    /// What a refusal means for this call, when GitHub's status says more
    /// than "it failed": a merge that is blocked, a reviewer who cannot review.
    refusals: Record<number, [message: string, status: number]> = {},
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
    const refusal = refusals[response.status];
    if (!response.ok && refusal) throw new ConnectionError(refusal[0], refusal[1]);
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
          "DELETE FROM github_repositories WHERE organization_id=? AND workspace_id NOT IN (SELECT workspace_id FROM organization_workspaces WHERE organization_id=?)",
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
    const activity = (
      await this.db
        .prepare(
          "SELECT * FROM github_activity WHERE organization_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(org)
        .all<GitHubActivity>()
    ).results.filter((r) => ids.has(r.workspace_id));
    return { repositories, activity };
  }
  /// The repository a workspace's pull request actions go to. A repository
  /// selected through the GitHub App wins; otherwise the workspace's own
  /// origin, which the member's own connection is what reaches.
  async repository(org: string, user: string, workspace: string) {
    const found = await this.organizations.workspace(org, user, workspace);
    const row = await this.db
      .prepare(
        "SELECT full_name FROM github_repositories WHERE organization_id=? AND workspace_id=?",
      )
      .bind(org, workspace)
      .first<{ full_name: string }>();
    const repository = row?.full_name ?? githubRepositoryFromOrigin(found.origin);
    if (!repository)
      throw new ConnectionError("Connect this workspace to GitHub.", 404);
    return repository;
  }
  async action(
    org: string,
    user: string,
    workspace: string,
    action: string,
    input: Record<string, unknown>,
    /// A thread posting through the hub: what it writes carries a signed
    /// marker naming that thread, so the pull request's Activity can say so.
    from?: FromThread,
  ) {
    const repo = await this.repository(org, user, workspace),
      prefix = `/repos/${repo}`;
    const raw = typeof input.body === "string" ? input.body : "";
    if (raw.length > 60000)
      throw new ConnectionError("Write a shorter message.");
    const secret = from && this.options.secret ? await this.options.secret() : "";
    const mark = (text: string) => (from && secret ? markFromThread(text, secret, org, from) : Promise.resolve(text));
    const body = await mark(raw);
    if (from && secret) input = { ...input, ...(typeof input.body === "string" && input.body.trim() ? { body: await mark(input.body.trim()) } : {}) };
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
    const pull = await this.api<{ node_id?: string; state?: string; draft?: boolean; head?: { sha?: string } }>(org, user, `${prefix}/pulls/${number}`);
    if (REVIEW_ACTIONS.has(action)) return this.reviewAction(org, user, repo, number, pull, action, input);
    if (action === "merge") {
      const title = typeof input.title === "string" ? input.title.trim() : "";
      if (!title || title.length > 256) throw new ConnectionError("Enter a commit title.");
      if (typeof input.sha !== "undefined" && (typeof input.sha !== "string" || !/^[0-9a-f]{40}$/i.test(input.sha)))
        throw new ConnectionError("Refresh the pull request and try again.");
      const merged = await this.api<{ merged?: boolean; sha?: string }>(org, user, `${prefix}/pulls/${number}/merge`, "PUT", {
        merge_method: "squash",
        commit_title: title,
        commit_message: body,
        ...(typeof input.sha === "string" ? { sha: input.sha } : {}),
      }, {
        405: ["GitHub can't merge this pull request yet.", 409],
        409: ["The pull request changed since you opened it. Refresh and try again.", 409],
        403: ["You can't merge pull requests in this repository.", 403],
      });
      this.forget(org, user);
      return { merged: merged?.merged === true, sha: merged?.sha ?? null };
    }
    if (action === "request-reviewers") {
      const reviewers = Array.isArray(input.reviewers) ? input.reviewers.map(String) : [];
      if (!reviewers.length || reviewers.length > 15 || reviewers.some((login) => !githubLogin(login)))
        throw new ConnectionError("Choose who should review.");
      await this.api(org, user, `${prefix}/pulls/${number}/requested_reviewers`, "POST", { reviewers }, {
        422: ["Choose someone who can review this repository.", 400],
        403: ["You can't request reviewers in this repository.", 403],
      });
      this.forget(org, user);
      return { requested: reviewers };
    }
    if (action === "ready" || action === "draft") {
      if (pull?.state !== "open" || !pull.node_id) throw new ConnectionError("This pull request is closed.", 409);
      const mutation = action === "ready" ? "markPullRequestReadyForReview" : "convertPullRequestToDraft";
      const data = await this.graphql(org, user, {
        query: `mutation Change($id: ID!) { ${mutation}(input: { pullRequestId: $id }) { pullRequest { isDraft } } }`,
        variables: { id: pull.node_id },
      });
      if (data.errors?.length) throw new ConnectionError(action === "ready" ? "GitHub couldn't mark this ready for review." : "GitHub couldn't convert this to a draft.", 502);
      this.forget(org, user);
      return { isDraft: action === "draft" };
    }
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
  async receive(delivery: ConnectionDelivery) {
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
        await this.db
          .prepare(
            "DELETE FROM github_repositories WHERE organization_id=? AND repository_id=?",
          )
          .bind(org, r.id)
          .run();
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
    const workspace = repository.workspace_id;
    const summary = (
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
    if (inserted.meta.changes) await this.changed(org);
  }

  private now() {
    return (this.options.now ?? Date.now)();
  }

  /// The pull request's timeline for its Activity tab, read with your own
  /// connection: comments, reviews and each head commit's check result, which
  /// thread wrote what Remy posted for one, and when you last opened
  /// Activity. Opening a pull request
  /// for the first time counts as having seen what came before.
  async pullRequestActivity(org: string, user: string, repository: string, number: number) {
    const { owner, name, workspaceId } = await this.workspacePullRequest(org, user, repository, number);
    const data = await this.graphql(org, user, {
      query: `query PullRequestActivity($owner: String!, $name: String!, $number: Int!) {
        viewer { login name avatarUrl }
        repository(owner: $owner, name: $name) { pullRequest(number: $number) {
          timelineItems(last: ${ACTIVITY_TIMELINE_ITEMS}, itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW, PULL_REQUEST_COMMIT]) { nodes {
            __typename
            ... on IssueComment { id body createdAt url author { login avatarUrl ... on User { name } } }
            ... on PullRequestReview { id state body submittedAt createdAt url comments { totalCount } author { login avatarUrl ... on User { name } } }
            ... on PullRequestCommit { commit { oid committedDate statusCheckRollup { contexts(first: 40) { nodes {
              __typename
              ... on CheckRun { name conclusion status completedAt }
              ... on StatusContext { context state createdAt }
            } } } } }
          } }
        } }
      }`,
      variables: { owner, name, number },
    });
    const pr = (data.data?.repository as { pullRequest?: { timelineItems?: { nodes?: unknown[] } } | null } | undefined)?.pullRequest;
    if (!pr) throw new ConnectionError(data.errors?.[0]?.message || "GitHub could not read this pull request's activity.", 404);
    const secret = this.options.secret ? await this.options.secret().catch(() => "") : "";
    const items = await activityItems(
      nodesOf(pr.timelineItems),
      (body) => readThreadMarker(body, secret || undefined, org),
      async (computerId) => (await this.db
        // The marker is signed for this account, so the id is one its thread ran on.
        .prepare("SELECT name FROM organization_computers WHERE id=?")
        .bind(computerId)
        .first<{ name: string }>())?.name ?? null,
    );
    const seen = await this.db
      .prepare("SELECT seen_at FROM pull_request_seen WHERE organization_id=? AND user_id=? AND workspace_id=? AND pull_number=?")
      .bind(org, user, workspaceId, number)
      .first<{ seen_at: number }>();
    let seenAt = seen?.seen_at ?? null;
    if (seenAt === null) seenAt = await this.markActivitySeen(org, user, repository, number, workspaceId);
    return {
      userId: user,
      viewer: githubLogin(loginOf(data.data?.viewer)),
      /// Who is writing in the composer, drawn as its avatar.
      viewerAuthor: reviewAuthor(data.data?.viewer),
      seenAt,
      items,
    };
  }

  /// You opened Activity: what is there now is no longer new to you.
  async markActivitySeen(org: string, user: string, repository: string, number: number, known?: string) {
    const workspaceId = known ?? (await this.workspacePullRequest(org, user, repository, number)).workspaceId;
    const at = this.now();
    await this.db
      .prepare(
        "INSERT INTO pull_request_seen(organization_id,user_id,workspace_id,pull_number,seen_at) VALUES(?,?,?,?,?) ON CONFLICT(organization_id,user_id,workspace_id,pull_number) DO UPDATE SET seen_at=MAX(seen_at,excluded.seen_at)",
      )
      .bind(org, user, workspaceId, number, at)
      .run();
    return at;
  }

  /// The branch, title and link a linked ticket is found by, read from GitHub
  /// with your own connection rather than taken from the browser.
  async pullRequestReference(org: string, user: string, repository: string, number: number) {
    const { owner, name } = await this.workspacePullRequest(org, user, repository, number);
    const pull = await this.api<{ html_url?: unknown; title?: unknown; head?: { ref?: unknown } }>(org, user, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}`);
    return {
      url: typeof pull.html_url === "string" ? pull.html_url : `https://github.com/${owner}/${name}/pull/${number}`,
      title: typeof pull.title === "string" ? pull.title.slice(0, 500) : "",
      branch: typeof pull.head?.ref === "string" ? pull.head.ref.slice(0, 255) : "",
    };
  }

  /// What a review of this pull request starts from, read with your own
  /// connection: it must be open and belong to the workspace's repository.
  /// The stack, when GitHub has one, is in merge order.
  async reviewTarget(org: string, user: string, workspaceId: string, repository: string, number: number) {
    const { owner, name } = await this.workspacePullRequest(org, user, repository, number);
    const workspace = await this.organizations.workspace(org, user, workspaceId);
    if (githubRepositoryFromOrigin(workspace.origin).toLowerCase() !== `${owner}/${name}`.toLowerCase())
      throw new ConnectionError("Choose a pull request in this workspace's repository.", 404);
    const pull = await this.api<{ state?: unknown; title?: unknown; head?: { ref?: unknown; sha?: unknown }; base?: { ref?: unknown } }>(org, user, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}`);
    const headSha = typeof pull.head?.sha === "string" ? pull.head.sha.toLowerCase() : "";
    const headRef = typeof pull.head?.ref === "string" ? pull.head.ref.slice(0, 255) : "";
    const baseRef = typeof pull.base?.ref === "string" ? pull.base.ref.slice(0, 255) : "";
    if (!/^[0-9a-f]{40}$/.test(headSha) || !headRef || !baseRef) throw new ConnectionError("GitHub could not read this pull request.", 502);
    if (pull.state !== "open") throw new ConnectionError("Choose an open pull request to review.", 409);
    let stack: { number: number; title: string; headRef: string; baseRef: string }[] = [];
    try {
      const data = await this.graphql(org, user, {
        query: `query ReviewStack($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) { pullRequest(number: $number) {
            stack { entries(first: 20) { nodes { pullRequest { number title headRefName baseRefName } } } }
          } }
        }`,
        variables: { owner, name, number },
      });
      const entries = ((data.data?.repository as { pullRequest?: { stack?: { entries?: { nodes?: unknown[] } } } } | undefined)?.pullRequest?.stack?.entries?.nodes ?? []);
      stack = entries.flatMap((entry) => {
        const item = (entry as { pullRequest?: { number?: unknown; title?: unknown; headRefName?: unknown; baseRefName?: unknown } } | null)?.pullRequest;
        return item && Number.isSafeInteger(item.number) && (item.number as number) > 0
          ? [{ number: item.number as number, title: String(item.title ?? "").slice(0, 500), headRef: String(item.headRefName ?? "").slice(0, 255), baseRef: String(item.baseRefName ?? "").slice(0, 255) }]
          : [];
      });
      if (!stack.some((item) => item.number === number)) stack = [];
    } catch {
      // A pull request without a stack, or a GitHub without stacks, reviews alone.
      stack = [];
    }
    return {
      repository: `${owner}/${name}`.toLowerCase(),
      number,
      title: typeof pull.title === "string" ? pull.title.slice(0, 500) : "",
      baseRef,
      headRef,
      headSha,
      stack,
    };
  }

  /// The pull request's head commit now, to tell a review whether it moved on.
  async pullRequestHead(org: string, user: string, repository: string, number: number) {
    const { owner, name } = await this.workspacePullRequest(org, user, repository, number);
    const pull = await this.api<{ head?: { sha?: unknown } }>(org, user, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}`);
    const sha = typeof pull.head?.sha === "string" ? pull.head.sha.toLowerCase() : "";
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new ConnectionError("GitHub could not read this pull request.", 502);
    return sha;
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

  /// A write changes what the list says, so the next read asks GitHub again.
  private forget(org: string, user: string) {
    hostedPullRequestCache.delete(`${org}:${user}`);
  }

  /// What the list leaves out because GitHub computes it per pull request:
  /// whether it can merge, how long each check took and why it failed, who
  /// the reviewers are by name, and which stack members conflict. Read when
  /// one pull request opens.
  async pullRequestDetail(org: string, user: string, repository: string, number: number) {
    const { owner, name } = await this.workspacePullRequest(org, user, repository, number);
    const data = await this.graphql(org, user, {
      query: `query PullRequestDetail($owner: String!, $name: String!, $number: Int!) {
        viewer { login }
        repository(owner: $owner, name: $name) {
          squashMergeAllowed
          pullRequest(number: $number) {
            number state isDraft createdAt mergeable mergeStateStatus headRefOid
            author { login ... on User { name } }
            latestReviews(first: 20) { nodes { author { login ... on User { name } } state } }
            reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login name } } } }
            stack { entries(first: 20) { nodes { pullRequest { number state mergeable } } } }
            recentCommits: commits(last: 30) { nodes { commit { oid messageHeadline } } }
            commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 50) { nodes {
              ... on CheckRun { name conclusion status startedAt completedAt detailsUrl title summary }
              ... on StatusContext { context state createdAt description targetUrl }
            } } } } } }
          }
        }
      }`,
      variables: { owner, name, number },
    });
    const repo = data.data?.repository as { squashMergeAllowed?: unknown; pullRequest?: Record<string, unknown> | null } | undefined;
    const pr = repo?.pullRequest;
    if (!pr) throw new ConnectionError(data.errors?.[0]?.message || "GitHub could not read this pull request.", 404);
    const names = new Map<string, string>();
    const remember = (actor: unknown) => {
      const login = githubLogin(loginOf(actor));
      const display = (actor as { name?: unknown } | null)?.name;
      if (login && typeof display === "string" && display.trim()) names.set(login.toLowerCase(), display.trim().slice(0, 120));
    };
    remember(pr.author);
    for (const node of nodesOf(pr.latestReviews as { nodes?: unknown[] } | undefined)) remember((node as { author?: unknown } | null)?.author);
    for (const node of nodesOf(pr.reviewRequests as { nodes?: unknown[] } | undefined)) remember((node as { requestedReviewer?: unknown } | null)?.requestedReviewer);
    const stack = pr.stack as { entries?: { nodes?: unknown[] } } | null | undefined;
    return {
      viewer: githubLogin(loginOf(data.data?.viewer)),
      number,
      state: typeof pr.state === "string" ? pr.state : "OPEN",
      isDraft: pr.isDraft === true,
      createdAt: typeof pr.createdAt === "string" ? pr.createdAt : "",
      mergeable: typeof pr.mergeable === "string" ? pr.mergeable : "UNKNOWN",
      mergeStateStatus: typeof pr.mergeStateStatus === "string" ? pr.mergeStateStatus : "UNKNOWN",
      headRefOid: typeof pr.headRefOid === "string" && /^[0-9a-f]{40}$/i.test(pr.headRefOid) ? pr.headRefOid : null,
      squashMergeAllowed: repo?.squashMergeAllowed !== false,
      authorName: names.get(loginOf(pr.author).toLowerCase()) ?? null,
      reviewers: pullRequestReviewers(pr).map((reviewer) => ({ ...reviewer, name: names.get(reviewer.login.toLowerCase()) ?? null })),
      checks: pullRequestCheckDetails(pr),
      // The latest commits, oldest first, so the review agent can list what
      // arrived after the commit it reviewed.
      commits: nodesOf(pr.recentCommits as { nodes?: unknown[] } | undefined).flatMap((node) => {
        const commit = (node as { commit?: { oid?: unknown; messageHeadline?: unknown } } | null)?.commit;
        if (typeof commit?.oid !== "string" || !/^[0-9a-f]{40}$/i.test(commit.oid)) return [];
        return [{ sha: commit.oid.toLowerCase(), title: typeof commit.messageHeadline === "string" ? commit.messageHeadline.slice(0, 300) : "" }];
      }),
      stack: nodesOf(stack?.entries).flatMap((node) => {
        const member = (node as { pullRequest?: { number?: unknown; state?: unknown; mergeable?: unknown } } | null)?.pullRequest;
        if (!member || !positive(member.number)) return [];
        return [{
          number: member.number,
          state: typeof member.state === "string" ? member.state : "",
          mergeable: typeof member.mergeable === "string" ? member.mergeable : "UNKNOWN",
        }];
      }),
    };
  }

  /// People who can be asked to review: GitHub's own suggestions first, then
  /// everyone who can be assigned in the repository, matching what was typed.
  /// The author cannot review their own pull request, so they are left out.
  async pullRequestReviewerCandidates(org: string, user: string, repository: string, number: number, query = "") {
    const { owner, name } = await this.workspacePullRequest(org, user, repository, number);
    const data = await this.graphql(org, user, {
      query: `query PullRequestReviewers($owner: String!, $name: String!, $number: Int!, $query: String!) {
        repository(owner: $owner, name: $name) {
          assignableUsers(first: 30, query: $query) { nodes { login name } }
          pullRequest(number: $number) { author { login } suggestedReviewers { reviewer { login name } } }
        }
      }`,
      variables: { owner, name, number, query: query.trim().slice(0, 100) },
    });
    const repo = data.data?.repository as {
      assignableUsers?: { nodes?: unknown[] };
      pullRequest?: { author?: unknown; suggestedReviewers?: { reviewer?: unknown }[] } | null;
    } | undefined;
    if (!repo) throw new ConnectionError(data.errors?.[0]?.message || "GitHub could not list reviewers.", 502);
    const author = loginOf(repo.pullRequest?.author).toLowerCase();
    const needle = query.trim().toLowerCase();
    const people = new Map<string, { login: string; name: string | null; suggested: boolean }>();
    const add = (value: unknown, suggested: boolean) => {
      const login = githubLogin(loginOf(value));
      if (!login || login.toLowerCase() === author || people.has(login.toLowerCase())) return;
      const display = (value as { name?: unknown } | null)?.name;
      const named = typeof display === "string" && display.trim() ? display.trim().slice(0, 120) : null;
      if (suggested && needle && !`${login} ${named ?? ""}`.toLowerCase().includes(needle)) return;
      people.set(login.toLowerCase(), { login, name: named, suggested });
    };
    for (const entry of repo.pullRequest?.suggestedReviewers ?? []) add(entry?.reviewer, true);
    for (const node of nodesOf(repo.assignableUsers)) add(node, false);
    return { reviewers: [...people.values()] };
  }

  /// A private repository's attachments load only from the signed addresses
  /// GitHub renders for a reader, and those expire within minutes, so they are
  /// read when a pull request opens rather than kept with the list.
  async pullRequestImages(org: string, user: string, repository: string, number: number) {
    const { owner, name } = await this.workspacePullRequest(org, user, repository, number);
    const data = await this.graphql(org, user, {
      query: `query PullRequestImages($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) { pullRequest(number: $number) { bodyHTML } }
      }`,
      variables: { owner, name, number },
    });
    const pullRequest = (data.data?.repository as { pullRequest?: { bodyHTML?: unknown } } | undefined)?.pullRequest;
    return { images: signedAttachmentImages(typeof pullRequest?.bodyHTML === "string" ? pullRequest.bodyHTML : "") };
  }

  /// The files a pull request changes, with GitHub's own patch for each, so a
  /// hosted reader can review the diff without a computer. The list is read
  /// with the member's credential, never an installation token. GitHub lists
  /// at most 3000 files and leaves `patch` off binary and very large files; the
  /// answer also stops carrying patches past a byte budget so one enormous pull
  /// request cannot become a response the browser has to swallow whole.
  async pullRequestFiles(org: string, user: string, repository: string, number: number, changedFiles?: number) {
    const { owner, name } = await this.workspacePullRequest(org, user, repository, number);
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/files?per_page=${PULL_REQUEST_FILES_PAGE}`;
    const read = async (page: number) => {
      const value = await this.api<unknown>(org, user, `${base}&page=${page}`);
      return Array.isArray(value) ? value : [];
    };
    const pages: unknown[][] = [await read(1)];
    // The count the list already knows says how many pages to ask for, so they
    // are read a few at a time rather than one after another. Without it, or
    // when it was stale, each full page asks for the next.
    const expected = changedFiles && Number.isSafeInteger(changedFiles) && changedFiles > 0
      ? Math.min(PULL_REQUEST_FILES_MAX_PAGES, Math.ceil(changedFiles / PULL_REQUEST_FILES_PAGE))
      : 1;
    for (let next = 2; next <= expected && pages.at(-1)!.length === PULL_REQUEST_FILES_PAGE; next += PULL_REQUEST_FILES_PARALLEL) {
      const count = Math.min(PULL_REQUEST_FILES_PARALLEL, expected - next + 1);
      pages.push(...await Promise.all(Array.from({ length: count }, (_, index) => read(next + index))));
    }
    while (pages.length < PULL_REQUEST_FILES_MAX_PAGES && pages.at(-1)!.length === PULL_REQUEST_FILES_PAGE) {
      pages.push(await read(pages.length + 1));
    }
    let budget = PULL_REQUEST_PATCH_BUDGET;
    let patchesOmitted = false;
    const files = pages.flat().flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const file = value as { filename?: unknown; previous_filename?: unknown; status?: unknown; additions?: unknown; deletions?: unknown; patch?: unknown };
      if (typeof file.filename !== "string" || !file.filename) return [];
      const patch = typeof file.patch === "string" ? file.patch : undefined;
      const keep = patch !== undefined && patch.length <= budget;
      if (patch !== undefined) {
        if (keep) budget -= patch.length;
        else patchesOmitted = true;
      }
      return [{
        path: file.filename,
        ...(typeof file.previous_filename === "string" && file.previous_filename ? { previousPath: file.previous_filename } : {}),
        status: PULL_REQUEST_FILE_STATUSES.has(String(file.status)) ? String(file.status) : "modified",
        additions: Number.isSafeInteger(file.additions) ? file.additions as number : 0,
        deletions: Number.isSafeInteger(file.deletions) ? file.deletions as number : 0,
        ...(keep ? { patch } : {}),
        ...(patch !== undefined && !keep ? { patchOmitted: true } : {}),
      }];
    });
    const lastPage = pages.at(-1)!;
    return {
      files,
      // GitHub stops at 3000 files; say so rather than pretend the list is whole.
      truncated: pages.length >= PULL_REQUEST_FILES_MAX_PAGES && lastPage.length === PULL_REQUEST_FILES_PAGE,
      patchesOmitted,
    };
  }

  /// What the Files tab needs beside the diff, read with the member's own
  /// connection: GitHub's viewed state for each file, every review
  /// conversation with its comments, which of those comments are still in
  /// your pending review, and who wrote the pull request, since GitHub does not
  /// let its author approve or request changes.
  async pullRequestReview(org: string, user: string, repository: string, number: number) {
    const { owner, name } = await this.workspacePullRequest(org, user, repository, number);
    const first = await this.graphql(org, user, {
      query: `query PullRequestReview($owner: String!, $name: String!, $number: Int!) {
        viewer { login name avatarUrl }
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            headRefOid
            author { login }
            files(first: ${REVIEW_FILES_PAGE}) { pageInfo { hasNextPage endCursor } nodes { path viewerViewedState } }
            reviewThreads(first: ${REVIEW_THREADS_PAGE}) { pageInfo { hasNextPage endCursor } nodes { ...ReviewThread } }
          }
        }
      }
      ${REVIEW_THREAD_FRAGMENT}`,
      variables: { owner, name, number },
    });
    const pr = (first.data?.repository as { pullRequest?: Record<string, unknown> | null } | undefined)?.pullRequest;
    if (!pr) throw new ConnectionError(first.errors?.[0]?.message || "GitHub could not read this pull request's review.", 404);
    type Page = { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: unknown[] };
    const files = [...nodesOf(pr.files as Page)];
    const threads = [...nodesOf(pr.reviewThreads as Page)];
    // Later pages ask for one connection at a time, so a pull request with
    // many files does not read its conversations again, or the other way round.
    const more = async (connection: "files" | "reviewThreads", page: Page | undefined, into: unknown[], size: number, max: number, selection: string) => {
      let cursor = page?.pageInfo?.hasNextPage ? page.pageInfo.endCursor : null;
      for (let read = 1; cursor && read < max; read++) {
        const next = await this.graphql(org, user, {
          query: `query PullRequestReviewPage($owner: String!, $name: String!, $number: Int!, $after: String!) {
            repository(owner: $owner, name: $name) { pullRequest(number: $number) {
              ${connection}(first: ${size}, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${selection} } }
            } }
          }
          ${connection === "reviewThreads" ? REVIEW_THREAD_FRAGMENT : ""}`,
          variables: { owner, name, number, after: cursor },
        });
        const value = ((next.data?.repository as { pullRequest?: Record<string, unknown> } | undefined)?.pullRequest?.[connection]) as Page | undefined;
        into.push(...nodesOf(value));
        cursor = value?.pageInfo?.hasNextPage ? value.pageInfo.endCursor : null;
      }
    };
    await Promise.all([
      more("files", pr.files as Page, files, REVIEW_FILES_PAGE, REVIEW_FILES_MAX_PAGES, "path viewerViewedState"),
      more("reviewThreads", pr.reviewThreads as Page, threads, REVIEW_THREADS_PAGE, REVIEW_THREADS_MAX_PAGES, "...ReviewThread"),
    ]);
    const viewer = reviewAuthor(first.data?.viewer);
    return {
      viewer,
      author: loginOf(pr.author),
      headRefOid: typeof pr.headRefOid === "string" && /^[0-9a-f]{40}$/i.test(pr.headRefOid) ? pr.headRefOid : null,
      viewed: viewedStates(files),
      threads: reviewThreads(threads),
    };
  }

  /// Line comments, replies, the pending review and viewed marks. Each one
  /// goes through the member's own token, and anything named by id is first
  /// read back to prove it belongs to this pull request.
  private async reviewAction(
    org: string,
    user: string,
    repository: string,
    number: number,
    pull: { node_id?: string; state?: string; head?: { sha?: string } },
    action: string,
    input: Record<string, unknown>,
  ) {
    const prefix = `/repos/${repository}`;
    const pullRequestId = pull.node_id;
    const sha = pull.head?.sha && /^[0-9a-f]{40}$/i.test(pull.head.sha) ? pull.head.sha : "";
    if (!pullRequestId || !sha) throw new ConnectionError("GitHub could not read this pull request.", 502);
    const mutate = async (query: string, variables: Record<string, unknown>, failure: string) => {
      const data = await this.graphql(org, user, { query, variables });
      if (data.errors?.length || !data.data) throw new ConnectionError(failure, 502);
      return data.data;
    };
    const done = <T>(value: T) => { this.forget(org, user); return value; };
    // GitHub refuses a comment posted now while your review is pending, with
    // the same 422 as a bad line. Say which one it was.
    const postNow = async <T>(post: () => Promise<T>) => {
      try {
        return await post();
      } catch (error) {
        if (error instanceof ConnectionError && error.status === 400 && (await this.pendingReview(org, user, pullRequestId, sha, false)).id)
          throw new ConnectionError("You have a pending review; add this to it or submit it first.", 409);
        throw error;
      }
    };

    if (action === "view-file") {
      const path = typeof input.path === "string" ? input.path : "";
      if (!path || path.length > 4_000) throw new ConnectionError("Choose a file.");
      const viewed = input.viewed === true;
      const mutation = viewed ? "markFileAsViewed" : "unmarkFileAsViewed";
      await mutate(
        `mutation ViewFile($id: ID!, $path: String!) { ${mutation}(input: { pullRequestId: $id, path: $path }) { clientMutationId } }`,
        { id: pullRequestId, path },
        viewed ? "GitHub couldn't mark that file read." : "GitHub couldn't mark that file unread.",
      );
      return { path, viewed };
    }

    if (action === "line-comment" || action === "pending-comment") {
      const target = lineCommentTarget(input);
      if (!target) throw new ConnectionError("Choose lines in this diff.");
      const body = reviewBody(input);
      if (body === undefined) throw new ConnectionError("Write a comment of up to 65,000 characters.");
      if (action === "line-comment") {
        const posted = await postNow(() => this.api<{ id?: number; node_id?: string }>(org, user, `${prefix}/pulls/${number}/comments`, "POST", {
          body,
          commit_id: sha,
          path: target.path,
          line: target.line,
          side: target.side,
          ...(target.startLine ? { start_line: target.startLine, start_side: target.side } : {}),
        }, {
          422: ["GitHub can't place a comment on those lines. Refresh the diff and try again.", 400],
          403: ["You can't comment on pull requests in this repository.", 403],
        }));
        return done({ id: posted?.node_id ?? null });
      }
      const reviewId = await this.pendingReview(org, user, pullRequestId, sha);
      const data = await mutate(
        `mutation AddReviewThread($review: ID!, $path: String!, $body: String!, $line: Int!, $side: DiffSide!, $startLine: Int, $startSide: DiffSide) {
          addPullRequestReviewThread(input: { pullRequestReviewId: $review, path: $path, body: $body, line: $line, side: $side, startLine: $startLine, startSide: $startSide }) { thread { id } }
        }`,
        { review: reviewId, path: target.path, body, line: target.line, side: target.side, startLine: target.startLine, startSide: target.startLine ? target.side : null },
        "GitHub couldn't add that to your review.",
      );
      return done({ id: (data.addPullRequestReviewThread as { thread?: { id?: string } } | undefined)?.thread?.id ?? null });
    }

    if (action === "reply") {
      const body = reviewBody(input);
      if (body === undefined) throw new ConnectionError("Write a reply of up to 65,000 characters.");
      const node = await this.reviewNode(org, user, repository, number, input.threadId);
      if (node.__typename !== "PullRequestReviewThread") throw new ConnectionError("Choose a conversation on this pull request.", 404);
      if (input.pending === true) {
        const reviewId = await this.pendingReview(org, user, pullRequestId, sha);
        await mutate(
          `mutation AddReviewReply($thread: ID!, $review: ID!, $body: String!) {
            addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, pullRequestReviewId: $review, body: $body }) { comment { id } }
          }`,
          { thread: String(input.threadId), review: reviewId, body },
          "GitHub couldn't add that reply to your review.",
        );
        return done({ pending: true });
      }
      const top = nodesOf(node.comments as { nodes?: unknown[] } | undefined)[0] as { databaseId?: unknown } | undefined;
      if (!positive(top?.databaseId)) throw new ConnectionError("Choose a conversation on this pull request.", 404);
      await postNow(() => this.api(org, user, `${prefix}/pulls/${number}/comments/${top!.databaseId}/replies`, "POST", { body }, {
        422: ["GitHub couldn't post that reply. Refresh the diff and try again.", 400],
        403: ["You can't comment on pull requests in this repository.", 403],
      }));
      return done({ pending: false });
    }

    if (action === "edit-comment" || action === "delete-comment") {
      const node = await this.reviewNode(org, user, repository, number, input.commentId);
      if (
        node.__typename !== "PullRequestReviewComment"
        || node.state !== "PENDING"
        || loginOf(node.author).toLowerCase() !== loginOf(node.viewer).toLowerCase()
      ) throw new ConnectionError("Choose a comment in your pending review.", 404);
      if (action === "delete-comment") {
        await mutate(
          `mutation DeleteReviewComment($id: ID!) { deletePullRequestReviewComment(input: { id: $id }) { clientMutationId } }`,
          { id: String(input.commentId) },
          "GitHub couldn't delete that comment.",
        );
        return done({ deleted: true });
      }
      const body = reviewBody(input);
      if (body === undefined) throw new ConnectionError("Write a comment of up to 65,000 characters.");
      await mutate(
        `mutation UpdateReviewComment($id: ID!, $body: String!) { updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $id, body: $body }) { pullRequestReviewComment { id } } }`,
        { id: String(input.commentId), body },
        "GitHub couldn't save that comment.",
      );
      return done({ edited: true });
    }

    // submit-review
    const event = String(input.event);
    if (!REVIEW_EVENTS.has(event)) throw new ConnectionError("Choose Comment, Approve or Request changes.");
    const body = reviewBody(input, false);
    if (body === undefined) throw new ConnectionError("Write a note of up to 65,000 characters.");
    const pending = await this.pendingReview(org, user, pullRequestId, sha, false);
    if (event !== "COMMENT" && pending.author && pending.author === pending.viewer)
      throw new ConnectionError("You can't approve or request changes on your own pull request.", 403);
    if (pending.id) {
      await mutate(
        `mutation SubmitReview($review: ID!, $event: PullRequestReviewEvent!, $body: String) {
          submitPullRequestReview(input: { pullRequestReviewId: $review, event: $event, body: $body }) { pullRequestReview { state } }
        }`,
        { review: pending.id, event, body: body || null },
        "GitHub couldn't send your review.",
      );
      return done({ submitted: event });
    }
    if (event === "COMMENT" && !body) throw new ConnectionError("Write a note or add a comment first.");
    await this.api(org, user, `${prefix}/pulls/${number}/reviews`, "POST", { event, body, commit_id: sha }, {
      422: ["GitHub couldn't send your review. Refresh and try again.", 400],
      403: ["You can't review pull requests in this repository.", 403],
    });
    return done({ submitted: event });
  }

  /// Your pending review on this pull request. GitHub keeps one per person;
  /// `create` starts it at the head the reader saw when there is none.
  private async pendingReview(org: string, user: string, pullRequestId: string, sha: string): Promise<string>;
  private async pendingReview(org: string, user: string, pullRequestId: string, sha: string, create: false): Promise<{ id: string | null; viewer: string; author: string }>;
  private async pendingReview(org: string, user: string, pullRequestId: string, sha: string, create = true) {
    const data = await this.graphql(org, user, {
      query: `query PendingReview($id: ID!) {
        viewer { login }
        node(id: $id) { ... on PullRequest { author { login } reviews(states: PENDING, first: 20) { nodes { id author { login } } } } }
      }`,
      variables: { id: pullRequestId },
    });
    const viewer = loginOf(data.data?.viewer).toLowerCase();
    const pr = data.data?.node as { author?: unknown; reviews?: { nodes?: unknown[] } } | undefined;
    if (!pr) throw new ConnectionError("GitHub could not read your review.", 502);
    const mine = nodesOf(pr.reviews).find((node) => loginOf((node as { author?: unknown }).author).toLowerCase() === viewer) as { id?: unknown } | undefined;
    const id = typeof mine?.id === "string" ? mine.id : null;
    if (!create) return { id, viewer, author: loginOf(pr.author).toLowerCase() };
    if (id) return id;
    const made = await this.graphql(org, user, {
      query: `mutation StartReview($id: ID!, $sha: GitObjectID!) { addPullRequestReview(input: { pullRequestId: $id, commitOID: $sha }) { pullRequestReview { id } } }`,
      variables: { id: pullRequestId, sha },
    });
    const review = (made.data?.addPullRequestReview as { pullRequestReview?: { id?: unknown } } | undefined)?.pullRequestReview?.id;
    if (made.errors?.length || typeof review !== "string") throw new ConnectionError("GitHub couldn't start your review.", 502);
    return review;
  }

  /// A review conversation or comment named by the browser, read back so an
  /// id from another pull request cannot be acted on through this one.
  private async reviewNode(org: string, user: string, repository: string, number: number, id: unknown) {
    if (typeof id !== "string" || !id || id.length > 200) throw new ConnectionError("Choose a conversation on this pull request.", 404);
    const data = await this.graphql(org, user, {
      query: `query ReviewNode($id: ID!) {
        viewer { login }
        node(id: $id) {
          __typename
          ... on PullRequestReviewThread { pullRequest { number repository { nameWithOwner } } comments(first: 1) { nodes { databaseId } } }
          ... on PullRequestReviewComment { state author { login } pullRequest { number repository { nameWithOwner } } }
        }
      }`,
      variables: { id },
    });
    const node = data.data?.node as { __typename?: string; pullRequest?: { number?: unknown; repository?: { nameWithOwner?: unknown } }; state?: unknown; author?: unknown; comments?: unknown } | null | undefined;
    const owner = node?.pullRequest;
    if (!node || owner?.number !== number || String(owner.repository?.nameWithOwner ?? "").toLowerCase() !== repository.toLowerCase())
      throw new ConnectionError("Choose a conversation on this pull request.", 404);
    return { ...node, viewer: data.data?.viewer };
  }

  /// A pull request a member may read here: its repository is one of their
  /// workspaces, whatever else their GitHub credential can see.
  private async workspacePullRequest(org: string, user: string, repository: string, number: number) {
    await this.access(org, user);
    const workspaces = await this.organizations.workspaces(org, user);
    const known = workspaces.find((workspace) =>
      githubRepositoryFromOrigin(workspace.origin).toLowerCase() === repository.toLowerCase());
    const [owner, name, extra] = repository.split("/");
    if (!known || !owner || !name || extra || !Number.isSafeInteger(number) || number < 1) {
      throw new ConnectionError("Choose a pull request in one of your workspaces.", 404);
    }
    return { owner, name, workspaceId: known.id };
  }

  private async graphql(
    org: string,
    user: string,
    input: { query: string; variables?: Record<string, unknown> },
  ) {
    return this.api<{
      data?: Record<string, unknown>;
      errors?: { message?: string; path?: unknown[] }[];
    }>(org, user, "/graphql", "POST", input);
  }
}

const REVIEW_ACTIONS = new Set(["view-file", "line-comment", "pending-comment", "reply", "edit-comment", "delete-comment", "submit-review"]);
const REVIEW_THREAD_FRAGMENT = `fragment ReviewThread on PullRequestReviewThread {
  id path line startLine originalLine originalStartLine diffSide startDiffSide isResolved isOutdated subjectType
  comments(first: 50) { nodes { id databaseId body createdAt url state author { login avatarUrl ... on User { name } } } }
}`;
const PULL_REQUEST_FILES_PAGE = 100;
/// 30 pages of 100 is GitHub's 3000-file ceiling for this list.
const PULL_REQUEST_FILES_MAX_PAGES = 30;
const PULL_REQUEST_FILES_PARALLEL = 5;
/// Patch text carried in one answer; files past it arrive without a patch.
const PULL_REQUEST_PATCH_BUDGET = 3_000_000;
const PULL_REQUEST_FILE_STATUSES = new Set(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"]);

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

// Mergeability is left out on purpose: GitHub computes it per pull request
// while answering, which roughly doubled how long this list took to arrive.
const HOSTED_PULL_REQUEST_FRAGMENT = `fragment HostedPullRequest on PullRequest {
  number title url body isDraft reviewDecision createdAt updatedAt additions deletions changedFiles
  headRefName baseRefName
  stackEntry { position }
  stack { number size baseRefName entries(first: 20) { nodes { position pullRequest { number title state isDraft } } } }
  author { login }
  repository { nameWithOwner }
  assignees(first: 10) { nodes { login } }
  reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } } } }
  latestReviews(first: 10) { nodes { author { login } state } }
  labels(first: 10) { nodes { name color } }
  comments(first: 20) { nodes { author { login } body createdAt url } }
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
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  checks: { name: string; state: "pass" | "fail" | "pending" | "skipping" }[];
  reviewers: HostedPullRequestReviewer[];
  labels: { name: string; color: string }[];
  comments: { author: string; body: string; createdAt: string; url: string }[];
  unreadComments: unknown[];
  hasUnreadActivity: boolean;
  workspaceId: string;
  workspaceName: string;
  workspaceIcon: string;
  workspaceTint: string;
  workspacePath: string;
  worktreePath: string | null;
  stack: HostedPullRequestStack | null;
  state: string;
};

type HostedPullRequestReviewer = {
  login: string;
  state: "REQUESTED" | "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";
};

type HostedPullRequestStack = {
  number: number;
  position: number;
  size: number;
  baseRefName: string;
  entries: { position: number; number: number; title: string; state: string; isDraft: boolean }[];
};

function hostedPullRequest(
  value: unknown,
  viewer: string,
  workspaceByRepo: Map<string, { id: string; name: string; icon?: string; tint?: string }>,
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
    createdAt: typeof pr.createdAt === "string" ? pr.createdAt : "",
    updatedAt: String(pr.updatedAt ?? new Date(0).toISOString()),
    additions: Number(pr.additions ?? 0),
    deletions: Number(pr.deletions ?? 0),
    changedFiles: Number(pr.changedFiles ?? 0),
    checks: pullRequestChecks(pr),
    reviewers: pullRequestReviewers(pr),
    labels: pullRequestLabels(pr),
    comments: pullRequestComments(pr),
    unreadComments: [] as unknown[],
    hasUnreadActivity: false,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaceIcon: workspace.icon ?? "folder",
    workspaceTint: workspace.tint ?? "zinc",
    workspacePath: "",
    worktreePath: viewer && author.toLowerCase() === viewer.toLowerCase() ? "hosted" : null,
    stack: pullRequestStack(pr),
    state: "OPEN",
  };
}

/// Stack membership comes only from GitHub, the same as a computer reads it.
function pullRequestStack(pr: Record<string, unknown>): HostedPullRequestStack | null {
  const stack = pr.stack as { number?: unknown; size?: unknown; baseRefName?: unknown; entries?: { nodes?: unknown[] } } | null | undefined;
  const position = (pr.stackEntry as { position?: unknown } | null | undefined)?.position;
  if (!stack || !positive(stack.number) || !positive(stack.size) || !positive(position) || position > stack.size) return null;
  const entries = nodesOf(stack.entries).flatMap((node) => {
    const entry = node as { position?: unknown; pullRequest?: { number?: unknown; title?: unknown; state?: unknown; isDraft?: unknown } } | null;
    const member = entry?.pullRequest;
    if (!entry || !positive(entry.position) || !member || !positive(member.number) || typeof member.title !== "string") return [];
    return [{
      position: entry.position,
      number: member.number,
      title: member.title,
      state: typeof member.state === "string" ? member.state : "",
      isDraft: member.isDraft === true,
    }];
  }).sort((left, right) => left.position - right.position);
  return {
    number: stack.number,
    position,
    size: stack.size,
    baseRefName: typeof stack.baseRefName === "string" ? stack.baseRefName : "",
    entries,
  };
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

const PRIVATE_ATTACHMENT = /<img\b[^>]*?\ssrc="(https:\/\/private-user-images\.githubusercontent\.com\/[^"]+)"/gi;
const ATTACHMENT_ID = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[a-z0-9]+$/i;

/// Each private attachment's `github.com/user-attachments` address, mapped to
/// the signed copy GitHub rendered for this reader.
export function signedAttachmentImages(bodyHTML: string): Record<string, string> {
  const images: Record<string, string> = {};
  for (const match of bodyHTML.matchAll(PRIVATE_ATTACHMENT)) {
    const signed = match[1]!.replaceAll("&amp;", "&");
    const id = ATTACHMENT_ID.exec(new URL(signed).pathname)?.[1];
    if (id) images[`https://github.com/user-attachments/assets/${id.toLowerCase()}`] = signed;
  }
  return images;
}

/// Who has reviewed, with their latest verdict, then who is still asked to.
/// Someone asked again after reviewing is waiting on, so the request wins.
function pullRequestReviewers(pr: Record<string, unknown>): HostedPullRequestReviewer[] {
  const reviewers = new Map<string, HostedPullRequestReviewer>();
  for (const node of nodesOf(pr.latestReviews as { nodes?: unknown[] } | undefined)) {
    const review = node as { author?: unknown; state?: unknown } | null;
    const login = githubLogin(loginOf(review?.author));
    const state = String(review?.state ?? "");
    if (!login || !["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"].includes(state)) continue;
    reviewers.set(login.toLowerCase(), { login, state: state as HostedPullRequestReviewer["state"] });
  }
  for (const node of nodesOf(pr.reviewRequests as { nodes?: unknown[] } | undefined)) {
    const login = githubLogin(loginOf((node as { requestedReviewer?: unknown } | null)?.requestedReviewer));
    if (login) reviewers.set(login.toLowerCase(), { login, state: "REQUESTED" });
  }
  return [...reviewers.values()];
}

function pullRequestLabels(pr: Record<string, unknown>) {
  return nodesOf(pr.labels as { nodes?: unknown[] } | undefined).flatMap((node) => {
    const label = node as { name?: unknown; color?: unknown } | null;
    if (typeof label?.name !== "string" || !label.name) return [];
    const color = typeof label.color === "string" && /^[0-9a-f]{6}$/i.test(label.color) ? label.color.toLowerCase() : "";
    return [{ name: label.name.slice(0, 100), color }];
  });
}

function pullRequestComments(pr: Record<string, unknown>) {
  return nodesOf(pr.comments as { nodes?: unknown[] } | undefined).flatMap((node) => {
    if (!node || typeof node !== "object") return [];
    const comment = node as { author?: unknown; body?: unknown; createdAt?: unknown; url?: unknown };
    const body = String(comment.body ?? "");
    if (!body.trim()) return [];
    return [{
      author: loginOf(comment.author) || "Comment",
      body,
      createdAt: String(comment.createdAt ?? ""),
      url: String(comment.url ?? ""),
    }];
  });
}

function checkNodes(pr: Record<string, unknown>) {
  const commits = pr.commits as { nodes?: { commit?: { statusCheckRollup?: { contexts?: { nodes?: Record<string, unknown>[] } } } }[] } | undefined;
  return commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
}

function pullRequestChecks(pr: Record<string, unknown>) {
  return checkNodes(pr).flatMap((node) => {
    const name = String(node.name ?? node.context ?? "");
    if (!name) return [];
    return [{ name, state: checkState(node) }];
  });
}

function isoTime(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

/// A check as the detail draws it: when it ran, so its duration can be shown,
/// where GitHub shows it, and the line it failed with.
function pullRequestCheckDetails(pr: Record<string, unknown>) {
  return checkNodes(pr).flatMap((node) => {
    const name = String(node.name ?? node.context ?? "");
    if (!name) return [];
    const url = typeof node.detailsUrl === "string" ? node.detailsUrl : typeof node.targetUrl === "string" ? node.targetUrl : "";
    const summary = [node.title, node.summary, node.description]
      .find((value): value is string => typeof value === "string" && value.trim().length > 0);
    return [{
      name: name.slice(0, 200),
      state: checkState(node),
      startedAt: isoTime(node.startedAt ?? node.createdAt),
      completedAt: isoTime(node.completedAt),
      url: /^https:\/\//.test(url) ? url : null,
      summary: summary ? summary.trim().slice(0, 500) : null,
    }];
  });
}
