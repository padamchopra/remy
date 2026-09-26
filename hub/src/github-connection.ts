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

  /// A private repository's attachments load only from the signed addresses
  /// GitHub renders for a reader, and those expire within minutes, so they are
  /// read when a pull request opens rather than kept with the list.
  async pullRequestImages(org: string, user: string, repository: string, number: number) {
    await this.access(org, user);
    const workspaces = await this.organizations.workspaces(org, user);
    const known = workspaces.some((workspace) =>
      githubRepositoryFromOrigin(workspace.origin).toLowerCase() === repository.toLowerCase());
    const [owner, name, extra] = repository.split("/");
    if (!known || !owner || !name || extra || !Number.isSafeInteger(number) || number < 1) {
      throw new ConnectionError("Choose a pull request in one of your workspaces.", 404);
    }
    const data = await this.graphql(org, user, {
      query: `query PullRequestImages($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) { pullRequest(number: $number) { bodyHTML } }
      }`,
      variables: { owner, name, number },
    });
    const pullRequest = (data.data?.repository as { pullRequest?: { bodyHTML?: unknown } } | undefined)?.pullRequest;
    return { images: signedAttachmentImages(typeof pullRequest?.bodyHTML === "string" ? pullRequest.bodyHTML : "") };
  }

  private async graphql(
    org: string,
    user: string,
    input: { query: string; variables?: Record<string, string | number> },
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

// Mergeability is left out on purpose: GitHub computes it per pull request
// while answering, which roughly doubled how long this list took to arrive.
const HOSTED_PULL_REQUEST_FRAGMENT = `fragment HostedPullRequest on PullRequest {
  number title url body isDraft reviewDecision updatedAt additions deletions changedFiles
  headRefName baseRefName
  stackEntry { position }
  stack { number size baseRefName entries(first: 20) { nodes { position pullRequest { number title state isDraft } } } }
  author { login }
  repository { nameWithOwner }
  assignees(first: 10) { nodes { login } }
  reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } } } }
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
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  checks: { name: string; state: "pass" | "fail" | "pending" | "skipping" }[];
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
    updatedAt: String(pr.updatedAt ?? new Date(0).toISOString()),
    additions: Number(pr.additions ?? 0),
    deletions: Number(pr.deletions ?? 0),
    changedFiles: Number(pr.changedFiles ?? 0),
    checks: pullRequestChecks(pr),
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
