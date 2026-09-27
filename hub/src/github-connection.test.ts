import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../test/sqlite-d1.js";
import { GitHubConnection, clearHostedPullRequestCache } from "./github-connection.js";
import type { Connections, ConnectionDelivery } from "./connections.js";
function fixture() {
  const folder = new URL("../migrations/", import.meta.url),
    { db, sqlite } = sqliteD1(
      readdirSync(folder)
        .filter((f) => f.endsWith(".sql"))
        .sort()
        .map((f) => readFileSync(new URL(f, folder), "utf8"))
        .join("\n"),
    );
  sqlite.exec(
    "INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('ada','Ada','ada@example.test',1,1),('grace','Grace','grace@example.test',1,1); INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('studio','Studio',1,1); INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('m1','studio','ada','owner',1,1),('m2','studio','grace','member',1,1);",
  );
  const calls: {
      path: string;
      method: string;
      actor: string;
      body: unknown;
    }[] = [],
    comments: { id: number; body: string }[] = [];
  let lostReply = false;
  let searchFails = false;
  let omitViewer = false;
  let githubDelayMs = 0;
  const reviewState = { pending: false, viewer: "grace" };
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname,
      method = init?.method ?? "GET",
      actor = new Headers(init?.headers).get("authorization") ?? "",
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, actor, body });
    if (path === "/repos/release/remy/pulls/7/files") {
      // 205 files: two full pages and a short third, the last one binary.
      const page = Number(new URL(String(input)).searchParams.get("page"));
      const start = (page - 1) * 100;
      const count = Math.max(0, Math.min(100, 205 - start));
      return Response.json(Array.from({ length: count }, (_, index) => {
        const n = start + index;
        return n === 204
          ? { filename: "assets/logo.png", status: "added", additions: 0, deletions: 0 }
          : n === 0
            ? { filename: "src/new.ts", previous_filename: "src/old.ts", status: "renamed", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-old\n+new" }
            : { filename: `src/file-${n}.ts`, status: "modified", additions: 2, deletions: 0, patch: "@@ -1,1 +1,3 @@\n a\n+b\n+c" };
      }));
    }
    if (path === "/repos/release/remy/git/trees/HEAD") return Response.json({tree:[{path:"assets/logo.png",type:"blob",size:10},{path:"README.md",type:"blob",size:1},{path:"large.png",type:"blob",size:2000000}]});
    if (path === "/repos/release/remy/contents/assets/logo.png") return Response.json({type:"file",size:10,encoding:"base64",content:"aGVsbG8=\n"});
    if (path === "/repos/release/remy/contents/large.png") return Response.json({type:"file",size:2000000,encoding:"base64",content:""});
    if (path === "/graphql") {
      if (githubDelayMs) await new Promise((resolve) => setTimeout(resolve, githubDelayMs));
      const variables = (body?.variables ?? {}) as Record<string, string>;
      if (String(body?.query ?? "").includes("PullRequestDetail")) {
        return Response.json({ data: { viewer: { login: "ada" }, repository: { squashMergeAllowed: true, pullRequest: {
          number: 7, state: "OPEN", isDraft: false, createdAt: "2026-09-23T08:00:00Z", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN",
          headRefOid: "a".repeat(40),
          author: { login: "ada", name: "Ada Lovelace" },
          latestReviews: { nodes: [{ author: { login: "linus", name: "Linus" }, state: "APPROVED" }] },
          reviewRequests: { nodes: [{ requestedReviewer: { login: "grace", name: "Grace Hopper" } }] },
          stack: { entries: { nodes: [{ pullRequest: { number: 5, state: "OPEN", mergeable: "CONFLICTING" } }, { pullRequest: { number: 7, state: "OPEN", mergeable: "MERGEABLE" } }] } },
          commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [
            { name: "typecheck", conclusion: "FAILURE", status: "COMPLETED", startedAt: "2026-09-23T09:00:00Z", completedAt: "2026-09-23T09:01:04Z", detailsUrl: "https://github.com/release/remy/actions/runs/1", title: "2 errors", summary: "src/a.ts: Type 'string' is not assignable" },
            { name: "bundle", conclusion: "SUCCESS", status: "COMPLETED", startedAt: "2026-09-23T09:00:00Z", completedAt: "2026-09-23T09:00:48Z", detailsUrl: "javascript:alert(1)" },
            { context: "deploy", state: "PENDING", createdAt: "2026-09-23T09:00:00Z", description: "Waiting", targetUrl: "https://ci.example.test/1" },
          ] } } } }] },
        } } } });
      }
      const query = String(body?.query ?? "");
      if (query.includes("query PullRequestReview(")) {
        return Response.json({ data: { viewer: { login: "grace", name: "Grace Hopper", avatarUrl: "https://avatars.githubusercontent.com/u/2" }, repository: { pullRequest: {
          headRefOid: "a".repeat(40),
          author: { login: "ada" },
          files: { pageInfo: { hasNextPage: true, endCursor: "files-1" }, nodes: [
            { path: "src/a.ts", viewerViewedState: "VIEWED" },
            { path: "src/b.ts", viewerViewedState: "DISMISSED" },
          ] },
          reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
            { id: "PRRT_1", path: "src/a.ts", line: 12, startLine: 10, originalLine: 12, originalStartLine: 10, diffSide: "RIGHT", startDiffSide: "RIGHT", isResolved: false, isOutdated: false, subjectType: "LINE",
              comments: { nodes: [
                { id: "PRRC_1", databaseId: 501, body: "Can this collapse?", createdAt: "2026-09-27T08:00:00Z", url: "https://github.com/release/remy/pull/7#discussion_r501", state: "SUBMITTED", author: { login: "linus", name: "Linus", avatarUrl: "javascript:alert(1)" } },
                { id: "PRRC_2", databaseId: 502, body: "Draft reply", createdAt: "2026-09-27T09:00:00Z", url: null, state: "PENDING", author: { login: "grace", name: "Grace Hopper", avatarUrl: "https://avatars.githubusercontent.com/u/2" } },
              ] } },
            { id: "PRRT_2", path: "src/b.ts", line: null, originalLine: 4, diffSide: "LEFT", isResolved: true, isOutdated: true, subjectType: "LINE",
              comments: { nodes: [{ id: "PRRC_3", databaseId: 503, body: "Old", createdAt: "2026-09-26T08:00:00Z", state: "SUBMITTED", author: { login: "github-actions[bot]" } }] } },
            { id: "PRRT_empty", path: "src/c.ts", comments: { nodes: [] } },
          ] },
        } } } });
      }
      if (query.includes("PullRequestReviewPage")) {
        return Response.json({ data: { repository: { pullRequest: { files: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ path: "src/c.ts", viewerViewedState: "UNVIEWED" }] } } } } });
      }
      if (query.includes("query PendingReview")) {
        return Response.json({ data: { viewer: { login: reviewState.viewer }, node: { author: { login: "ada" }, reviews: { nodes: reviewState.pending ? [{ id: "PRR_pending", author: { login: reviewState.viewer } }] : [] } } } });
      }
      if (query.includes("mutation StartReview")) { reviewState.pending = true; return Response.json({ data: { addPullRequestReview: { pullRequestReview: { id: "PRR_pending" } } } }); }
      if (query.includes("query ReviewNode")) {
        const nodes: Record<string, unknown> = {
          PRRT_1: { __typename: "PullRequestReviewThread", pullRequest: { number: 7, repository: { nameWithOwner: "Release/Remy" } }, comments: { nodes: [{ databaseId: 501 }] } },
          PRRT_elsewhere: { __typename: "PullRequestReviewThread", pullRequest: { number: 7, repository: { nameWithOwner: "someone/else" } }, comments: { nodes: [{ databaseId: 900 }] } },
          PRRC_2: { __typename: "PullRequestReviewComment", state: "PENDING", author: { login: "grace" }, pullRequest: { number: 7, repository: { nameWithOwner: "release/remy" } } },
          PRRC_1: { __typename: "PullRequestReviewComment", state: "SUBMITTED", author: { login: "linus" }, pullRequest: { number: 7, repository: { nameWithOwner: "release/remy" } } },
        };
        return Response.json({ data: { viewer: { login: "grace" }, node: nodes[variables.id] ?? null } });
      }
      if (/mutation (ViewFile|AddReviewThread|AddReviewReply|UpdateReviewComment|DeleteReviewComment|SubmitReview)/.test(query)) {
        if (query.includes("SubmitReview")) reviewState.pending = false;
        return Response.json({ data: { ok: {} } });
      }
      if (String(body?.query ?? "").includes("PullRequestReviewers")) {
        return Response.json({ data: { repository: {
          assignableUsers: { nodes: [{ login: "ada", name: "Ada Lovelace" }, { login: "grace", name: "Grace Hopper" }, { login: "linus", name: null }, { login: "bad login!", name: "x" }] },
          pullRequest: { author: { login: "ada" }, suggestedReviewers: [{ reviewer: { login: "linus", name: "Linus" } }] },
        } } });
      }
      if (String(body?.query ?? "").includes("markPullRequestReadyForReview") || String(body?.query ?? "").includes("convertPullRequestToDraft")) {
        return Response.json({ data: { pr: { pullRequest: { isDraft: false } } } });
      }
      if (String(body?.query ?? "").includes("PullRequestImages")) {
        return Response.json({ data: { repository: { pullRequest: { bodyHTML: '<table><tr><td><a href="x"><img width="190" alt="Buy sheet" src="https://private-user-images.githubusercontent.com/19776024/659476008-5C22357B-a164-4e88-9294-4c12eee8542d.png?jwt=signed&amp;v=1" style="max-width: 100%;"></a></td></tr></table><img src="https://camo.githubusercontent.com/abc" data-canonical-src="https://example.com/a.png">' } } } });
      }
      const viewerPullRequests = [
        {
          number: 11,
          title: "Ship the mobile home",
          url: "https://github.com/jup-ag/mobile/pull/11",
          body: "",
          isDraft: false,
          reviewDecision: "",
          updatedAt: "2026-09-24T12:00:00Z",
          additions: 12,
          deletions: 1,
          changedFiles: 2,
          headRefName: "feature/home",
          baseRefName: "main",
          mergeable: "MERGEABLE",
          mergeStateStatus: "CLEAN",
          author: { login: "ada" },
          repository: { nameWithOwner: "jup-ag/mobile" },
          assignees: { nodes: [] },
          reviewRequests: { nodes: [] },
          commits: { nodes: [] },
        },
        {
          number: 3,
          title: "Tidy notes",
          url: "https://github.com/ada/notes/pull/3",
          body: "",
          isDraft: false,
          reviewDecision: "",
          updatedAt: "2026-09-24T10:00:00Z",
          additions: 2,
          deletions: 0,
          changedFiles: 1,
          headRefName: "chore/notes",
          baseRefName: "main",
          mergeable: "MERGEABLE",
          mergeStateStatus: "CLEAN",
          author: { login: "ada" },
          repository: { nameWithOwner: "ada/notes" },
          assignees: { nodes: [] },
          reviewRequests: { nodes: [] },
          commits: { nodes: [] },
        },
      ];
      const searchPullRequests = [
        {
          number: 7,
          title: "Ready to review",
          url: "https://github.com/release/remy/pull/7",
          body: "",
          isDraft: false,
          reviewDecision: "REVIEW_REQUIRED",
          updatedAt: "2026-09-23T12:00:00Z",
          additions: 4,
          deletions: 0,
          changedFiles: 1,
          headRefName: "feature/next",
          baseRefName: "main",
          mergeable: "MERGEABLE",
          mergeStateStatus: "CLEAN",
          author: { login: "ada" },
          repository: { nameWithOwner: "release/remy" },
          assignees: { nodes: [] },
          reviewRequests: { nodes: [] },
          commits: { nodes: [] },
        },
      ];
      const workspacePullRequests: Record<string, unknown[]> = {
        "release/remy": [
          {
            number: 7,
            title: "Ready to review",
            url: "https://github.com/release/remy/pull/7",
            body: "",
            isDraft: false,
            reviewDecision: "REVIEW_REQUIRED",
            updatedAt: "2026-09-23T12:00:00Z",
            additions: 4,
            deletions: 0,
            changedFiles: 1,
            headRefName: "feature/next",
            baseRefName: "main",
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
            stackEntry: { position: 2 },
            stack: { number: 6, size: 2, baseRefName: "main", entries: { nodes: [
              { position: 2, pullRequest: { number: 7, title: "Ready to review", state: "OPEN", isDraft: false } },
              { position: 1, pullRequest: { number: 5, title: "Lay the groundwork", state: "OPEN", isDraft: true } },
            ] } },
            author: { login: "ada" },
            repository: { nameWithOwner: "release/remy" },
            assignees: { nodes: [] },
            reviewRequests: { nodes: [] },
            commits: { nodes: [] },
          },
        ],
        "jup-ag/mobile": [
          {
            number: 12,
            title: "Review the wallet sheet",
            url: "https://github.com/jup-ag/mobile/pull/12",
            body: "",
            isDraft: false,
            reviewDecision: "REVIEW_REQUIRED",
            updatedAt: "2026-09-24T11:00:00Z",
            additions: 8,
            deletions: 2,
            changedFiles: 3,
            headRefName: "feature/wallet",
            baseRefName: "main",
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
            author: { login: "grace" },
            repository: { nameWithOwner: "jup-ag/mobile" },
            assignees: { nodes: [] },
            reviewRequests: { nodes: [{ requestedReviewer: { login: "ada" } }] },
            latestReviews: { nodes: [
              { author: { login: "ada" }, state: "COMMENTED" },
              { author: { login: "linus" }, state: "APPROVED" },
              { author: { login: "bad login!" }, state: "APPROVED" },
            ] },
            labels: { nodes: [{ name: "android", color: "A2EEEF" }, { name: "no colour", color: "not-hex" }] },
            commits: { nodes: [] },
          },
        ],
      };
      const repos: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(variables)) {
        const index = /^o(\d+)$/.exec(key)?.[1];
        if (index === undefined) continue;
        const fullName = `${value}/${variables[`n${index}`]}`;
        repos[`repo${index}`] = { pullRequests: { nodes: workspacePullRequests[fullName] ?? [] } };
      }
      return Response.json({
        data: {
          viewer: { login: "ada", pullRequests: { nodes: omitViewer ? [] : viewerPullRequests } },
          search: { nodes: searchFails ? [] : searchPullRequests },
          ...repos,
        },
        ...(searchFails ? { errors: [{ message: "Search requires the repo scope.", path: ["search"] }] } : {}),
      });
    }
    if (path === "/repos/release/remy/pulls/7/merge") {
      if (body?.sha === "b".repeat(40)) return new Response("{}", { status: 409 });
      return Response.json({ merged: true, sha: "c".repeat(40) });
    }
    if (path === "/repos/release/remy/pulls/7/requested_reviewers") {
      if ((body?.reviewers ?? []).includes("stranger")) return new Response("{}", { status: 422 });
      return Response.json({ number: 7 });
    }
    if (path === "/repos/release/remy/pulls/7") return Response.json({ number: 7, state: "open", draft: false, node_id: "PR_node7", head: { sha: "a".repeat(40) } });
    if (path === "/user/repos") return Response.json([{id:101,name:"Remy",full_name:"release/remy",description:"A remote for coding agents.",language:"TypeScript",private:true,pushed_at:"2026-09-18T10:00:00Z"}]);
    if (path === "/repos/jup-ag/mobile") return Response.json({id:202,name:"mobile",full_name:"jup-ag/mobile",default_branch:"main"});
    if (path === "/repos/release/remy") return Response.json({id:101,name:"Remy",full_name:"release/remy",default_branch:"main"});
    if (path === "/repos/release/remy/branches") return Response.json([{name:"main"},{name:"feature/next"}]);
    if (path === "/user/installations")
      return Response.json({
        installations: [
          { id: 20, app_id: 12, account: { login: "release" } },
          { id: 21, app_id: 999, account: { login: "wrong" } },
        ],
      });
    if (path === "/user/installations/20/repositories")
      return Response.json({
        repositories: [
          {
            id: 101,
            full_name: "release/remy",
            name: "Remy",
            html_url: "https://github.com/release/remy",
          },
        ],
      });
    if (path.endsWith("/comments")) {
      if (method === "POST") {
        comments.push({ id: comments.length + 1, body: body.body });
        if (lostReply) {
          lostReply = false;
          throw Error("lost response");
        }
        return Response.json(comments.at(-1));
      }
      return Response.json(comments);
    }
    return Response.json({ id: 1, number: 7 });
  }) as typeof fetch;
  const service = new GitHubConnection(
    db,
    {
      token: async (_org: string, _provider: string, user: string) =>
        `member-${user}`,
    } as Connections,
    "12",
    async () => {},
    send,
  );
  return {
    db,
    sqlite,
    service,
    calls,
    comments,
    loseReply: () => {
      lostReply = true;
    },
    failSearch: () => {
      searchFails = true;
    },
    hideViewerPullRequests: () => {
      omitViewer = true;
    },
    delayGithub: (ms: number) => {
      githubDelayMs = ms;
    },
    reviewState,
  };
}
test("repository selection verifies the app and member access and reuses the canonical workspace", async () => {
  const { service, sqlite } = fixture();
  const existing = await service.organizations.createWorkspace(
    "studio",
    "ada",
    { name: "Existing", origin: "git@github.com:release/remy.git" },
  );
  await assert.rejects(service.select("studio", "grace", 20, [101]));
  await assert.rejects(service.select("studio", "ada", 21, [101]));
  await assert.rejects(service.select("studio", "ada", 20, [999]));
  const selected = await service.select("studio", "ada", 20, [101]);
  assert.equal(selected.repositories[0].workspace_id, existing.id);
  await service.select("studio", "ada", 20, []);
  assert.equal((await service.list("studio", "ada")).repositories.length, 0);
  assert.equal(
    sqlite.prepare("SELECT count(*) n FROM organization_workspaces").get()?.n,
    1,
  );
});
test("PR actions use the caller identity and reject inaccessible workspaces", async () => {
  const { service, calls } = fixture(),
    selected = await service.select("studio", "ada", 20, [101]),
    workspace = selected.repositories[0].workspace_id;
  await service.action("studio", "grace", workspace, "comment", {
    number: 7,
    body: "Ready to review",
  });
  assert.equal(calls.at(-1)?.actor, "Bearer member-grace");
  await service.organizations.updateWorkspace("studio", "ada", workspace, {
    access: { teamIds: [], userIds: ["ada"] },
  });
  await assert.rejects(
    service.action("studio", "grace", workspace, "review", {
      number: 7,
      event: "APPROVE",
    }),
  );
  await assert.rejects(
    service.action("studio", "ada", workspace, "comment", {
      number: -1,
      body: "bad",
    }),
  );
});
test("a delivery is recorded once and never starts work of its own", async () => {
  const {service, sqlite} = fixture();
  const selected = await service.select("studio", "ada", 20, [101]);
  assert.ok(selected.repositories[0].workspace_id);
  const delivery = (id: string): ConnectionDelivery => ({
    id,
    provider: "github",
    delivery_id: id,
    event: "issue_comment",
    payload: JSON.stringify({
      installation: { id: 20 },
      repository: { id: 101 },
      issue: { number: 7, pull_request: {} },
      comment: { body: "@remy please fix this" },
      sender: { id: 102 },
      action: "created",
    }),
    status: "pending",
    received_at: 1,
  });
  await service.receive(delivery("first"));
  await service.receive(delivery("first"));
  const listed = await service.list("studio", "ada");
  assert.equal(listed.activity.length, 1);
  assert.equal(listed.activity[0].pull_number, 7);
  // Nothing starts a thread from GitHub any more, so no activity is running.
  assert.equal(
    sqlite.prepare("SELECT count(*) AS n FROM github_activity WHERE phase='running'").get()?.n,
    0,
  );
});


test("repository picker uses member credentials and imports without deleting existing selections", async () => {
  const {service, calls} = fixture();
  const initial = await service.select("studio", "ada", 20, [101]);
  const listed = await service.accessibleRepositories("studio", "ada", 1);
  assert.equal(listed.repositories[0].full_name, "release/remy");
  assert.deepEqual(listed.repositories[0], {id:101,name:"Remy",full_name:"release/remy",description:"A remote for coding agents.",language:"TypeScript",private:true,pushedAt:"2026-09-18T10:00:00Z"});
  assert.equal(calls.at(-1)?.actor, "Bearer member-ada");
  assert.equal(listed.nextPage, null);
  await assert.rejects(service.accessibleRepositories("studio", "grace", 1));
  await assert.rejects(service.accessibleRepositories("studio", "ada", 0));
  await assert.rejects(service.importRepository("studio", "grace", "release/remy"));
  await assert.rejects(service.importRepository("studio", "ada", "../user"));
  const added = await service.importRepository("studio", "ada", "release/remy");
  assert.equal(added.workspace.id, initial.repositories[0].workspace_id);
  assert.equal((await service.list("studio", "ada")).repositories.length, 1);
});

test("workspace images use member credentials and reject unauthorized, oversized and non-image reads", async () => {
  const {service, calls, sqlite} = fixture();
  const {workspace} = await service.importRepository("studio", "ada", "release/remy");
  assert.deepEqual(await service.workspaceImage("studio", "ada", workspace.id), {images:[{path:"assets/logo.png"}],truncated:false});
  assert.deepEqual(await service.workspaceImage("studio", "ada", workspace.id, "assets/logo.png"), {mime:"image/png",data:"aGVsbG8="});
  assert.equal(calls.at(-1)?.actor, "Bearer member-ada");
  for (const path of ["../logo.png", "/logo.png", "README.md", "large.png"]) await assert.rejects(service.workspaceImage("studio", "ada", workspace.id, path));
  await service.organizations.updateWorkspace("studio", "ada", workspace.id, {access:{userIds:[],teamIds:[]},icon:"assets/logo.png"});
  const count = calls.length;
  await assert.rejects(service.workspaceImage("studio", "grace", workspace.id));
  await assert.rejects(service.workspaceImage("other", "ada", workspace.id));
  assert.equal(calls.length, count);
  assert.equal((await service.organizations.workspace("studio", "ada", workspace.id)).icon, "assets/logo.png");
  sqlite.close();
});

 test("branch listing uses member credentials and enforces workspace access", async () => {
  const {service, calls, sqlite} = fixture();
  const {workspace} = await service.importRepository("studio", "ada", "release/remy");
  assert.deepEqual(await service.workspaceBranches("studio", "ada", workspace.id), {branches:[{name:"main",current:true,checkout:null},{name:"feature/next",current:false,checkout:null}]});
  assert.equal(calls.at(-1)?.actor, "Bearer member-ada");
  await service.organizations.updateWorkspace("studio", "ada", workspace.id, {access:{userIds:[],teamIds:[]}});
  const count = calls.length;
  await assert.rejects(service.workspaceBranches("studio", "grace", workspace.id));
  await assert.rejects(service.workspaceBranches("other", "ada", workspace.id));
  assert.equal(calls.length, count);
  sqlite.close();
});

test("cloud Git uses the initiating member's connection for imported workspaces", async () => {
  const {service, sqlite} = fixture();
  const {workspace} = await service.importRepository("studio", "ada", "release/remy");
  assert.equal(await service.workspaceGitToken("studio", "ada", workspace.id), "member-ada");
  await service.organizations.updateWorkspace("studio", "ada", workspace.id, {access:{userIds:[],teamIds:[]}});
  await assert.rejects(service.workspaceGitToken("studio", "grace", workspace.id));
  await assert.rejects(service.workspaceGitToken("other", "ada", workspace.id));
  sqlite.exec("DELETE FROM memberships WHERE user_id='ada'");
  await assert.rejects(service.workspaceGitToken("studio", "ada", workspace.id));
  sqlite.close();
});

test("hosted pull requests stay on workspace origins, keep PAT-backed workspaces when search omits them, and cache the list", async () => {
  clearHostedPullRequestCache();
  const { service, calls, failSearch, sqlite } = fixture();
  const empty = await service.openPullRequests("studio", "ada");
  assert.deepEqual(empty.pullRequests, []);
  assert.equal(calls.filter((call) => call.path === "/graphql").length, 0);
  await service.importRepository("studio", "ada", "release/remy");
  clearHostedPullRequestCache();
  const listed = await service.openPullRequests("studio", "ada");
  assert.equal(calls.filter((call) => call.path === "/graphql").at(-1)?.actor, "Bearer member-ada");
  assert.deepEqual(
    listed.pullRequests.map((pullRequest) => `${pullRequest.repository}#${pullRequest.number}`).sort(),
    ["release/remy#7"],
  );
  assert.ok(!listed.pullRequests.some((pullRequest) => pullRequest.repository === "jup-ag/mobile"));
  assert.ok(!listed.pullRequests.some((pullRequest) => pullRequest.repository === "ada/notes"));
  const graphqlCalls = calls.filter((call) => call.path === "/graphql").length;
  assert.equal((await service.openPullRequests("studio", "ada")).pullRequests.length, 1);
  assert.deepEqual(listed.pullRequests[0]?.comments, []);
  assert.equal(calls.filter((call) => call.path === "/graphql").length, graphqlCalls);
  await service.openPullRequests("studio", "ada", true);
  assert.equal(calls.filter((call) => call.path === "/graphql").length, graphqlCalls + 1);
  failSearch();
  clearHostedPullRequestCache();
  const afterSearchFailure = await service.openPullRequests("studio", "ada", true);
  assert.deepEqual(
    afterSearchFailure.pullRequests.map((pullRequest) => `${pullRequest.repository}#${pullRequest.number}`),
    ["release/remy#7"],
  );
  sqlite.close();
});

test("hosted pull requests carry their GitHub stack and skip mergeability", async () => {
  clearHostedPullRequestCache();
  const { service, calls, hideViewerPullRequests, failSearch, sqlite } = fixture();
  hideViewerPullRequests();
  failSearch();
  await service.importRepository("studio", "ada", "release/remy");
  const listed = await service.openPullRequests("studio", "ada");
  assert.deepEqual(listed.pullRequests[0]?.stack, {
    number: 6, position: 2, size: 2, baseRefName: "main",
    entries: [
      { position: 1, number: 5, title: "Lay the groundwork", state: "OPEN", isDraft: true },
      { position: 2, number: 7, title: "Ready to review", state: "OPEN", isDraft: false },
    ],
  });
  const query = String((calls.filter((call) => call.path === "/graphql").at(-1)?.body as { query?: string } | undefined)?.query ?? "");
  assert.ok(query.includes("stackEntry"));
  assert.ok(!query.includes("mergeable"));
  sqlite.close();
});

test("pull request images map private attachments to the signed copies for a workspace repository", async () => {
  clearHostedPullRequestCache();
  const { service, calls, sqlite } = fixture();
  await service.importRepository("studio", "ada", "release/remy");
  assert.deepEqual(await service.pullRequestImages("studio", "ada", "release/remy", 7), {
    images: {
      "https://github.com/user-attachments/assets/5c22357b-a164-4e88-9294-4c12eee8542d":
        "https://private-user-images.githubusercontent.com/19776024/659476008-5C22357B-a164-4e88-9294-4c12eee8542d.png?jwt=signed&v=1",
    },
  });
  assert.equal(calls.at(-1)?.actor, "Bearer member-ada");
  assert.deepEqual((calls.at(-1)?.body as { variables?: unknown } | undefined)?.variables, { owner: "release", name: "remy", number: 7 });
  const count = calls.length;
  await assert.rejects(service.pullRequestImages("studio", "ada", "ada/notes", 7));
  await assert.rejects(service.pullRequestImages("studio", "ada", "release/remy", 0));
  await assert.rejects(service.pullRequestImages("other", "ada", "release/remy", 7));
  assert.equal(calls.length, count);
  sqlite.close();
});

test("hosted pull requests include review-requested PRs from PAT-imported workspaces search missed", async () => {
  clearHostedPullRequestCache();
  const { service, hideViewerPullRequests, failSearch, sqlite } = fixture();
  hideViewerPullRequests();
  failSearch();
  await service.importRepository("studio", "ada", "jup-ag/mobile");
  const listed = await service.openPullRequests("studio", "ada");
  assert.equal(listed.pullRequests[0]?.repository, "jup-ag/mobile");
  assert.equal(listed.pullRequests[0]?.number, 12);
  assert.equal(listed.pullRequests[0]?.workspaceName, "mobile");
  assert.equal(listed.pullRequests[0]?.workspaceIcon, "folder");
  assert.equal(listed.pullRequests[0]?.workspaceTint, "zinc");
  await service.organizations.updateWorkspace("studio", "ada", listed.pullRequests[0]!.workspaceId, {
    icon: "globe",
    tint: "orange",
  });
  clearHostedPullRequestCache();
  const branded = await service.openPullRequests("studio", "ada");
  assert.equal(branded.pullRequests[0]?.workspaceIcon, "globe");
  assert.equal(branded.pullRequests[0]?.workspaceTint, "orange");
  assert.ok(!listed.pullRequests.some((pullRequest) => pullRequest.repository === "ada/notes"));
  sqlite.close();
});

test("hosted pull requests stay empty when a workspace has no matching GitHub pull requests", async () => {
  clearHostedPullRequestCache();
  const { service, hideViewerPullRequests, failSearch, sqlite } = fixture();
  hideViewerPullRequests();
  failSearch();
  await service.organizations.createWorkspace("studio", "ada", {
    name: "Notes",
    origin: "https://github.com/ada/notes.git",
  });
  const listed = await service.openPullRequests("studio", "ada");
  assert.deepEqual(listed.pullRequests, []);
  sqlite.close();
});

test("hosted pull request cache returns the previous list without waiting on GitHub", async () => {
  clearHostedPullRequestCache();
  const { service, delayGithub, sqlite } = fixture();
  await service.importRepository("studio", "ada", "release/remy");
  delayGithub(80);
  const coldStarted = Date.now();
  await service.openPullRequests("studio", "ada");
  const coldMs = Date.now() - coldStarted;
  const warmStarted = Date.now();
  await service.openPullRequests("studio", "ada");
  const warmMs = Date.now() - warmStarted;
  assert.ok(coldMs >= 80, `cold open waited on GitHub (${coldMs}ms)`);
  assert.ok(warmMs < 20, `warm open reused the cache (${warmMs}ms)`);
  sqlite.close();
});

test("hosted pull requests carry reviewers with their latest verdict and labels", async () => {
  clearHostedPullRequestCache();
  const { service, sqlite } = fixture();
  await service.importRepository("studio", "ada", "jup-ag/mobile");
  const listed = await service.openPullRequests("studio", "ada");
  const wallet = listed.pullRequests.find((pullRequest) => pullRequest.number === 12);
  assert.deepEqual(wallet?.reviewers, [
    { login: "ada", state: "REQUESTED" },
    { login: "linus", state: "APPROVED" },
  ]);
  assert.deepEqual(wallet?.labels, [{ name: "android", color: "a2eeef" }, { name: "no colour", color: "" }]);
  sqlite.close();
});

test("pull request files page through GitHub with the member credential for a workspace repository", async () => {
  clearHostedPullRequestCache();
  const { service, calls, sqlite } = fixture();
  await service.importRepository("studio", "ada", "release/remy");
  const before = calls.length;
  const read = await service.pullRequestFiles("studio", "ada", "release/remy", 7, 205);
  const reads = calls.slice(before).filter((call) => call.path === "/repos/release/remy/pulls/7/files");
  assert.equal(reads.length, 3);
  assert.ok(reads.every((call) => call.actor === "Bearer member-ada"));
  assert.equal(read.files.length, 205);
  assert.equal(read.truncated, false);
  assert.equal(read.patchesOmitted, false);
  assert.deepEqual(read.files[0], { path: "src/new.ts", previousPath: "src/old.ts", status: "renamed", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-old\n+new" });
  assert.deepEqual(read.files.at(-1), { path: "assets/logo.png", status: "added", additions: 0, deletions: 0 });
  // Without the count it still reads every page, one after another.
  const sequential = await service.pullRequestFiles("studio", "ada", "release/remy", 7);
  assert.equal(sequential.files.length, 205);
  const count = calls.length;
  await assert.rejects(service.pullRequestFiles("studio", "ada", "ada/notes", 7));
  await assert.rejects(service.pullRequestFiles("studio", "ada", "release/remy", 0));
  await assert.rejects(service.pullRequestFiles("other", "ada", "release/remy", 7));
  assert.equal(calls.length, count);
  sqlite.close();
});

test("pull request detail reads mergeability, check durations and reviewer names for a workspace repository", async () => {
  const { service, calls } = fixture();
  await service.organizations.createWorkspace("studio", "ada", { name: "Remy", origin: "git@github.com:release/remy.git" });
  const detail = await service.pullRequestDetail("studio", "ada", "release/remy", 7);
  assert.equal(calls.at(-1)?.actor, "Bearer member-ada");
  assert.equal(detail.viewer, "ada");
  assert.equal(detail.mergeable, "MERGEABLE");
  assert.equal(detail.mergeStateStatus, "CLEAN");
  assert.equal(detail.headRefOid, "a".repeat(40));
  assert.equal(detail.createdAt, "2026-09-23T08:00:00Z");
  assert.equal(detail.authorName, "Ada Lovelace");
  assert.deepEqual(detail.reviewers, [
    { login: "linus", state: "APPROVED", name: "Linus" },
    { login: "grace", state: "REQUESTED", name: "Grace Hopper" },
  ]);
  assert.deepEqual(detail.checks.map((check) => [check.name, check.state, check.startedAt, check.completedAt, check.url]), [
    ["typecheck", "fail", "2026-09-23T09:00:00Z", "2026-09-23T09:01:04Z", "https://github.com/release/remy/actions/runs/1"],
    ["bundle", "pass", "2026-09-23T09:00:00Z", "2026-09-23T09:00:48Z", null],
    ["deploy", "pending", "2026-09-23T09:00:00Z", null, "https://ci.example.test/1"],
  ]);
  assert.equal(detail.checks[0].summary, "2 errors");
  assert.deepEqual(detail.stack, [
    { number: 5, state: "OPEN", mergeable: "CONFLICTING" },
    { number: 7, state: "OPEN", mergeable: "MERGEABLE" },
  ]);
  await assert.rejects(service.pullRequestDetail("studio", "ada", "someone/else", 7), /one of your workspaces/);
  await assert.rejects(service.pullRequestDetail("studio", "stranger", "release/remy", 7), /unavailable/);
});

test("reviewer candidates list suggestions first and never the author", async () => {
  const { service } = fixture();
  await service.organizations.createWorkspace("studio", "ada", { name: "Remy", origin: "git@github.com:release/remy.git" });
  const { reviewers } = await service.pullRequestReviewerCandidates("studio", "ada", "release/remy", 7);
  assert.deepEqual(reviewers, [
    { login: "linus", name: "Linus", suggested: true },
    { login: "grace", name: "Grace Hopper", suggested: false },
  ]);
});

test("squash merge, reviewer requests and draft changes go through the member's own connection on a workspace origin", async () => {
  const { service, calls } = fixture();
  const workspace = await service.organizations.createWorkspace("studio", "ada", { name: "Remy", origin: "git@github.com:release/remy.git" });
  const merged = await service.action("studio", "grace", workspace.id, "merge", { number: 7, title: "Ready to review (#7)", body: "Ship it", sha: "a".repeat(40) });
  assert.deepEqual(merged, { merged: true, sha: "c".repeat(40) });
  const merge = calls.find((call) => call.path.endsWith("/merge"))!;
  assert.equal(merge.method, "PUT");
  assert.equal(merge.actor, "Bearer member-grace");
  assert.deepEqual(merge.body, { merge_method: "squash", commit_title: "Ready to review (#7)", commit_message: "Ship it", sha: "a".repeat(40) });
  await assert.rejects(service.action("studio", "grace", workspace.id, "merge", { number: 7, title: "  " }), /commit title/);
  await assert.rejects(service.action("studio", "grace", workspace.id, "merge", { number: 7, title: "x", sha: "nope" }), /Refresh/);
  await assert.rejects(
    service.action("studio", "grace", workspace.id, "merge", { number: 7, title: "x", sha: "b".repeat(40) }),
    (error: Error & { status?: number }) => /changed since you opened it/.test(error.message) && error.status === 409,
  );

  await service.action("studio", "ada", workspace.id, "request-reviewers", { number: 7, reviewers: ["grace"] });
  const request = calls.find((call) => call.path.endsWith("/requested_reviewers"))!;
  assert.deepEqual([request.method, request.body], ["POST", { reviewers: ["grace"] }]);
  await assert.rejects(service.action("studio", "ada", workspace.id, "request-reviewers", { number: 7, reviewers: [] }), /who should review/);
  await assert.rejects(service.action("studio", "ada", workspace.id, "request-reviewers", { number: 7, reviewers: ["bad login!"] }), /who should review/);
  await assert.rejects(service.action("studio", "ada", workspace.id, "request-reviewers", { number: 7, reviewers: ["stranger"] }), /can review this repository/);

  assert.deepEqual(await service.action("studio", "ada", workspace.id, "draft", { number: 7 }), { isDraft: true });
  const mutation = calls.at(-1)!;
  assert.equal(mutation.path, "/graphql");
  assert.match(String((mutation.body as { query: string }).query), /convertPullRequestToDraft/);
  assert.deepEqual((mutation.body as { variables: unknown }).variables, { id: "PR_node7" });

  await service.organizations.updateWorkspace("studio", "ada", workspace.id, { access: { teamIds: [], userIds: ["ada"] } });
  await assert.rejects(service.action("studio", "grace", workspace.id, "merge", { number: 7, title: "x" }));
});

test("the review read carries viewed state, conversations and pending comments for a workspace repository", async () => {
  const { service, calls } = fixture();
  await service.organizations.createWorkspace("studio", "ada", { name: "Remy", origin: "git@github.com:release/remy.git" });
  const review = await service.pullRequestReview("studio", "grace", "release/remy", 7);
  const reads = calls.filter((call) => call.path === "/graphql");
  assert.ok(reads.every((call) => call.actor === "Bearer member-grace"));
  // The second page of files is its own read; conversations are not read twice.
  assert.equal(reads.filter((call) => String((call.body as { query: string }).query).includes("PullRequestReviewPage")).length, 1);
  assert.deepEqual(review.viewer, { login: "grace", name: "Grace Hopper", avatarUrl: "https://avatars.githubusercontent.com/u/2" });
  assert.equal(review.author, "ada");
  assert.equal(review.headRefOid, "a".repeat(40));
  assert.deepEqual(review.viewed, { "src/a.ts": "VIEWED", "src/b.ts": "DISMISSED", "src/c.ts": "UNVIEWED" });
  assert.equal(review.threads.length, 2);
  const [open, outdated] = review.threads;
  assert.deepEqual([open.line, open.startLine, open.side, open.isResolved, open.isOutdated, open.file], [12, 10, "RIGHT", false, false, false]);
  assert.deepEqual(open.comments.map((comment) => [comment.id, comment.databaseId, comment.pending, comment.author.login, comment.author.avatarUrl]), [
    ["PRRC_1", 501, false, "linus", null],
    ["PRRC_2", 502, true, "grace", "https://avatars.githubusercontent.com/u/2"],
  ]);
  assert.deepEqual([outdated.line, outdated.originalLine, outdated.side, outdated.isOutdated, outdated.comments[0].author.login], [null, 4, "LEFT", true, "github-actions[bot]"]);
  await assert.rejects(service.pullRequestReview("studio", "grace", "someone/else", 7), /one of your workspaces/);
  await assert.rejects(service.pullRequestReview("studio", "stranger", "release/remy", 7), /unavailable/);
});

test("line comments, replies, the pending review and viewed marks go through the member's own connection", async () => {
  const { service, calls, reviewState } = fixture();
  const workspace = await service.organizations.createWorkspace("studio", "ada", { name: "Remy", origin: "git@github.com:release/remy.git" });
  const graphql = (name: string) => calls.filter((call) => call.path === "/graphql" && String((call.body as { query: string }).query).includes(name));

  assert.deepEqual(await service.action("studio", "grace", workspace.id, "view-file", { number: 7, path: "src/a.ts", viewed: true }), { path: "src/a.ts", viewed: true });
  assert.match(String((graphql("ViewFile").at(-1)!.body as { query: string }).query), /markFileAsViewed/);
  assert.deepEqual((graphql("ViewFile").at(-1)!.body as { variables: unknown }).variables, { id: "PR_node7", path: "src/a.ts" });
  await service.action("studio", "grace", workspace.id, "view-file", { number: 7, path: "src/a.ts", viewed: false });
  assert.match(String((graphql("ViewFile").at(-1)!.body as { query: string }).query), /unmarkFileAsViewed/);

  // Comment posts one inline comment now, at the head the pull request is on.
  await service.action("studio", "grace", workspace.id, "line-comment", { number: 7, path: "src/a.ts", line: 12, side: "RIGHT", startLine: 10, body: "Collapse past ten." });
  const posted = calls.find((call) => call.path === "/repos/release/remy/pulls/7/comments" && call.method === "POST")!;
  assert.equal(posted.actor, "Bearer member-grace");
  assert.deepEqual(posted.body, { body: "Collapse past ten.", commit_id: "a".repeat(40), path: "src/a.ts", line: 12, side: "RIGHT", start_line: 10, start_side: "RIGHT" });
  await assert.rejects(service.action("studio", "grace", workspace.id, "line-comment", { number: 7, path: "src/a.ts", line: 12, side: "RIGHT", body: "  " }), /Write a comment/);
  await assert.rejects(service.action("studio", "grace", workspace.id, "line-comment", { number: 7, path: "../x", line: 12, side: "RIGHT", body: "x" }), /Choose lines/);
  await assert.rejects(service.action("studio", "grace", workspace.id, "line-comment", { number: 7, path: "src/a.ts", line: 12, side: "RIGHT", startLine: 14, body: "x" }), /Choose lines/);
  await assert.rejects(service.action("studio", "grace", workspace.id, "line-comment", { number: 7, path: "src/a.ts", line: 12, side: "RIGHT", startLine: 10, startSide: "LEFT", body: "x" }), /Choose lines/);

  // Add to review starts the pending review once, then adds threads to it.
  await service.action("studio", "grace", workspace.id, "pending-comment", { number: 7, path: "src/a.ts", line: 3, side: "LEFT", body: "Why?" });
  assert.equal(graphql("mutation StartReview").length, 1);
  assert.deepEqual((graphql("mutation StartReview")[0].body as { variables: unknown }).variables, { id: "PR_node7", sha: "a".repeat(40) });
  assert.deepEqual((graphql("AddReviewThread").at(-1)!.body as { variables: unknown }).variables, { review: "PRR_pending", path: "src/a.ts", body: "Why?", line: 3, side: "LEFT", startLine: null, startSide: null });
  await service.action("studio", "grace", workspace.id, "pending-comment", { number: 7, path: "src/a.ts", line: 5, side: "RIGHT", body: "And this." });
  assert.equal(graphql("mutation StartReview").length, 1);

  // Replies post now by the thread's first comment, or join the pending review.
  await service.action("studio", "grace", workspace.id, "reply", { number: 7, threadId: "PRRT_1", body: "Done." });
  const reply = calls.find((call) => call.path === "/repos/release/remy/pulls/7/comments/501/replies")!;
  assert.deepEqual([reply.method, reply.actor, reply.body], ["POST", "Bearer member-grace", { body: "Done." }]);
  await service.action("studio", "grace", workspace.id, "reply", { number: 7, threadId: "PRRT_1", body: "Later.", pending: true });
  assert.deepEqual((graphql("AddReviewReply").at(-1)!.body as { variables: unknown }).variables, { thread: "PRRT_1", review: "PRR_pending", body: "Later." });
  const before = calls.length;
  await assert.rejects(service.action("studio", "grace", workspace.id, "reply", { number: 7, threadId: "PRRT_elsewhere", body: "x" }), /conversation on this pull request/);
  assert.ok(!calls.slice(before).some((call) => call.path.includes("/replies")));

  // Only your own pending comments can be edited or deleted.
  await service.action("studio", "grace", workspace.id, "edit-comment", { number: 7, commentId: "PRRC_2", body: "Reworded" });
  assert.deepEqual((graphql("UpdateReviewComment").at(-1)!.body as { variables: unknown }).variables, { id: "PRRC_2", body: "Reworded" });
  await service.action("studio", "grace", workspace.id, "delete-comment", { number: 7, commentId: "PRRC_2" });
  assert.equal(graphql("DeleteReviewComment").length, 1);
  await assert.rejects(service.action("studio", "grace", workspace.id, "delete-comment", { number: 7, commentId: "PRRC_1" }), /pending review/);

  // Send review submits the pending review with its verdict and note.
  await service.action("studio", "grace", workspace.id, "submit-review", { number: 7, event: "APPROVE", body: "Looks good." });
  assert.deepEqual((graphql("SubmitReview").at(-1)!.body as { variables: unknown }).variables, { review: "PRR_pending", event: "APPROVE", body: "Looks good." });
  // Without one, a verdict is a new review at the head; a bare Comment needs words.
  await assert.rejects(service.action("studio", "grace", workspace.id, "submit-review", { number: 7, event: "COMMENT", body: "" }), /Write a note/);
  await service.action("studio", "grace", workspace.id, "submit-review", { number: 7, event: "REQUEST_CHANGES", body: "Not yet." });
  const review = calls.find((call) => call.path === "/repos/release/remy/pulls/7/reviews")!;
  assert.deepEqual(review.body, { event: "REQUEST_CHANGES", body: "Not yet.", commit_id: "a".repeat(40) });
  await assert.rejects(service.action("studio", "grace", workspace.id, "submit-review", { number: 7, event: "MERGE" }), /Choose Comment/);
  reviewState.viewer = "ada";
  await assert.rejects(
    service.action("studio", "ada", workspace.id, "submit-review", { number: 7, event: "APPROVE" }),
    (error: Error & { status?: number }) => /your own pull request/.test(error.message) && error.status === 403,
  );

  await service.organizations.updateWorkspace("studio", "ada", workspace.id, { access: { teamIds: [], userIds: ["ada"] } });
  await assert.rejects(service.action("studio", "grace", workspace.id, "view-file", { number: 7, path: "src/a.ts", viewed: true }));
});
