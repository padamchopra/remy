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
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname,
      method = init?.method ?? "GET",
      actor = new Headers(init?.headers).get("authorization") ?? "",
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, actor, body });
    if (path === "/repos/release/remy/git/trees/HEAD") return Response.json({tree:[{path:"assets/logo.png",type:"blob",size:10},{path:"README.md",type:"blob",size:1},{path:"large.png",type:"blob",size:2000000}]});
    if (path === "/repos/release/remy/contents/assets/logo.png") return Response.json({type:"file",size:10,encoding:"base64",content:"aGVsbG8=\n"});
    if (path === "/repos/release/remy/contents/large.png") return Response.json({type:"file",size:2000000,encoding:"base64",content:""});
    if (path === "/graphql") {
      if (githubDelayMs) await new Promise((resolve) => setTimeout(resolve, githubDelayMs));
      const variables = (body?.variables ?? {}) as Record<string, string>;
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
