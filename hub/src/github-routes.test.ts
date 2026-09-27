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
