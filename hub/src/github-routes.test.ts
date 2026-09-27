import test from "node:test";
import assert from "node:assert/strict";
import { githubRoute } from "./github-routes.js";
import type { Env } from "./worker.js";

test("a computer cannot change a pull request through a member's identity", async () => {
  const request = new Request("https://hub.test/api/organizations/studio/github/actions", {
    method: "POST",
    body: JSON.stringify({ workspaceId: "w1", action: "merge", number: 7, title: "Ship (#7)" }),
  });
  const response = await githubRoute(request, { DB: {} } as unknown as Env, "ada", "computer");
  assert.equal(response?.status, 403);
  assert.deepEqual(await response?.json(), { error: "Change pull requests in Remy." });
});

test("a computer cannot review, comment or mark files read through a member's identity", async () => {
  for (const action of ["view-file", "line-comment", "pending-comment", "reply", "submit-review"]) {
    const request = new Request("https://hub.test/api/organizations/studio/github/actions", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "w1", action, number: 7, body: "x" }),
    });
    const response = await githubRoute(request, { DB: {} } as unknown as Env, "ada", "computer");
    assert.equal(response?.status, 403, action);
  }
});

test("the review read is a GitHub route", async () => {
  const request = new Request("https://hub.test/api/organizations/studio/github/pull-request-review?repository=release/remy&number=7");
  const response = await githubRoute(request, { DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } } as unknown as Env, "ada");
  // No membership in the stub database: the route answers, and refuses.
  assert.equal(response?.status, 403);
});
