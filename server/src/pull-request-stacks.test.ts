import assert from "node:assert/strict";
import test from "node:test";
import { parsePullRequestStacks, pullRequestStackQuery } from "./pull-request-stacks.js";

test("batches official stack membership without downloading members for list rows", () => {
  const query = pullRequestStackQuery("acme/repo", [42, 43, 42]);
  assert.equal(query.match(/pr42:/g)?.length, 1);
  assert.match(query, /pr43: pullRequest\(number: 43\)/);
  assert.match(query, /stackEntry \{ position \}/);
  assert.doesNotMatch(query, /entries\(/);
  assert.match(pullRequestStackQuery("acme/repo", [42], true), /entries\(first: 100\)/);
  assert.throws(() => pullRequestStackQuery("acme/repo", [NaN]));
  assert.throws(() => pullRequestStackQuery("acme/repo", [-1]));
  assert.throws(() => pullRequestStackQuery("acme/repo/extra", [42]));
});

test("maps stack identity and position and orders members bottom to top", () => {
  const parsed = parsePullRequestStacks(JSON.stringify({ data: { repository: { pr43: {
    stackEntry: { position: 2 },
    stack: { number: 50, size: 3, baseRefName: "main", entries: { nodes: [
      { position: 3, pullRequest: { number: 44, title: "Top layer", state: "OPEN", isDraft: true } },
      { position: 1, pullRequest: { number: 42, title: "Foundation", state: "MERGED", isDraft: false } },
      { position: 2, pullRequest: { number: 43, title: "Middle layer", state: "OPEN", isDraft: false } },
    ] } },
  } } } }), [43]);
  const stack = parsed.get(43)!;
  assert.equal(stack.number, 50);
  assert.equal(stack.position, 2);
  assert.equal(stack.size, 3);
  assert.equal(stack.baseRefName, "main");
  assert.deepEqual(stack.entries?.map((entry) => entry.number), [42, 43, 44]);
  assert.equal(stack.entries?.[0].state, "MERGED");
});

test("never infers membership from branch names or a PR title", () => {
  const parsed = parsePullRequestStacks(JSON.stringify({ data: { repository: {
    pr42: { title: "Part 1/3", baseRefName: "another-pr", stack: null, stackEntry: null },
    pr43: { stack: { number: 50, size: 3, baseRefName: "main" }, stackEntry: { position: 4 } },
    pr44: null,
  } } }), [42, 43, 44]);
  assert.equal(parsed.get(42), null);
  assert.equal(parsed.has(43), false);
  assert.equal(parsed.has(44), false);
});

test("does not mistake API errors for an unstacked PR", () => {
  assert.throws(() => parsePullRequestStacks(JSON.stringify({ errors: [{ message: "Unknown field stack" }] }), [42]));
});

test("keeps inaccessible members absent without inventing a complete chain", () => {
  const result = parsePullRequestStacks(JSON.stringify({ data: { repository: { pr42: {
    stackEntry: { position: 1 }, stack: { number: 50, size: 2, baseRefName: "main", entries: { nodes: [
      { position: 2, pullRequest: null },
      { position: 1, pullRequest: { number: 42, title: "Base", state: "OPEN" } },
    ] } },
  } } } }), [42]).get(42)!;
  assert.equal(result.size, 2);
  assert.equal(result.entries?.length, 1);
});
