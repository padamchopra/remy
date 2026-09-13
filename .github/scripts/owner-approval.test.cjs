const assert = require("node:assert/strict");
const test = require("node:test");
const { OWNER_ID, CHECK_CONTEXT, approvalFor, publishApproval } = require("./owner-approval.cjs");

const pull = (number = 1, author = 42, sha = "latest") => ({
  number, user: { id: author }, state: "open", base: { ref: "main" }, head: { sha },
});
const review = (id, state, commit_id = "latest", userId = OWNER_ID) => ({
  id, state, commit_id, user: { id: userId },
});

test("the owner's own PR passes without a review", () => {
  assert.equal(approvalFor(pull(1, OWNER_ID), []).state, "success");
});

test("other authors need this owner's approval of the exact head", () => {
  for (const reviews of [[], [review(1, "APPROVED", "old")], [review(1, "APPROVED", "latest", 43)]]) {
    assert.equal(approvalFor(pull(), reviews).state, "failure");
  }
  assert.equal(approvalFor(pull(), [review(1, "APPROVED")]).state, "success");
  assert.equal(approvalFor(pull(1, 42, "new-push"), [review(1, "APPROVED")]).state, "failure");
});

test("comments do not revoke approval, but dismissal and changes requested do", () => {
  for (const state of ["DISMISSED", "CHANGES_REQUESTED"]) {
    assert.equal(approvalFor(pull(), [review(1, "APPROVED"), review(2, state)]).state, "failure");
  }
  assert.equal(approvalFor(pull(), [review(1, "APPROVED"), review(2, "COMMENTED")]).state, "success");
  assert.equal(approvalFor(pull(), [review(3, "APPROVED"), review(2, "CHANGES_REQUESTED"), review(1, "DISMISSED")]).state, "success");
});

test("submission time wins over the order review drafts were created", () => {
  const earlier = { ...review(20, "CHANGES_REQUESTED"), submitted_at: "2026-09-14T10:00:00Z" };
  const later = { ...review(10, "APPROVED"), submitted_at: "2026-09-14T11:00:00Z" };
  assert.equal(approvalFor(pull(), [earlier, later]).state, "success");
});

test("a reused login or PR author metadata cannot impersonate the owner", () => {
  const outsider = pull();
  outsider.user.login = "padamchopra";
  assert.equal(approvalFor(outsider, []).state, "failure");
  assert.equal(approvalFor(outsider, [{ ...review(1, "APPROVED", "latest", 43), user: { id: 43, login: "padamchopra" } }]).state, "failure");
});

function fixture(pulls, reviews = new Map(), fresh = (value) => value) {
  const writes = [], failures = [], reads = [];
  const rest = {
    pulls: {
      list: Symbol("list"),
      listReviews: Symbol("reviews"),
      get: async ({ pull_number }) => ({ data: fresh(pulls.find((p) => p.number === pull_number)) }),
    },
    repos: { createCommitStatus: async (value) => { writes.push(value); } },
  };
  const github = {
    rest,
    paginate: async (method, args) => {
      reads.push(args);
      if (method === rest.pulls.list) return pulls;
      assert.equal(method, rest.pulls.listReviews);
      const value = reviews.get(args.pull_number) ?? [];
      if (value instanceof Error) throw value;
      return value;
    },
  };
  return {
    writes, reads, failures,
    run: () => publishApproval({ github, context: { repo: { owner: "padamchopra", repo: "remy" }, runId: 100 }, core: { error() {}, setFailed: (message) => failures.push(message) } }),
  };
}

test("publishes pending then the live API decision on the PR head, not the workflow SHA", async () => {
  const f = fixture([pull()], new Map([[1, [review(1, "APPROVED")]]]));
  await f.run();
  assert.deepEqual(f.writes.map((w) => w.state), ["pending", "success"]);
  assert.ok(f.writes.every((w) => w.sha === "latest" && w.context === CHECK_CONTEXT));
  assert.equal(f.reads[0].state, "open");
  assert.equal(f.reads[0].base, "main");
});

test("approval cannot be borrowed from another PR sharing the same commit", async () => {
  for (const pulls of [[pull(1, OWNER_ID), pull(2)], [pull(2), pull(1, OWNER_ID)]]) {
    const f = fixture(pulls);
    await f.run();
    assert.deepEqual(f.writes.map((w) => w.state), ["pending", "failure"]);
  }
});

test("review API failure replaces a previous success with a blocking result", async () => {
  const f = fixture([pull()], new Map([[1, new Error("API unavailable")]]));
  await f.run();
  assert.deepEqual(f.writes.map((w) => w.state), ["pending", "error"]);
  assert.equal(f.failures.length, 1);
});

test("a head change or closed PR during evaluation cannot receive a passing status", async () => {
  for (const patch of [{ head: { sha: "new-head" } }, { state: "closed" }, { base: { ref: "other" } }]) {
    const f = fixture([pull(1, OWNER_ID)], new Map(), (p) => ({ ...p, ...patch }));
    await f.run();
    assert.deepEqual(f.writes.map((w) => w.state), ["pending", "pending"]);
  }
});

test("a new review triggers a fresh evaluation rather than trusting an earlier result", async () => {
  const reviews = new Map([[1, [review(1, "APPROVED")]]]);
  const f = fixture([pull()], reviews);
  await f.run();
  reviews.set(1, [review(1, "DISMISSED")]);
  await f.run();
  assert.deepEqual(f.writes.map((w) => w.state), ["pending", "success", "pending", "failure"]);
});
