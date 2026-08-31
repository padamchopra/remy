import assert from "node:assert/strict";
import test from "node:test";
import { groupPullRequests, orderPullRequests } from "../src/lib/pull-request-order.ts";

function pr(number, day, position, stackNumber = 100, repository = "owner/repo") {
  return {
    number, repository, url: `https://github.com/${repository}/pull/${number}`,
    updatedAt: `2026-08-${String(day).padStart(2, "0")}T00:00:00Z`,
    ...(position ? { stack: { number: stackNumber, position } } : {}),
  };
}
const numbers = (prs) => prs.map((item) => item.number);

test("groups stack members tip first even when the base was updated last", () => {
  const input = [pr(1, 30, 1), pr(4, 29), pr(2, 28, 2), pr(3, 27, 3), pr(5, 26)];
  const original = structuredClone(input);
  assert.deepEqual(numbers(orderPullRequests(input)), [3, 2, 1, 4, 5]);
  assert.deepEqual(input, original);
});

test("orders stacks and standalone PRs by their newest activity", () => {
  const input = [pr(1, 25, 1), pr(4, 30), pr(2, 28, 2), pr(6, 29, 1, 200), pr(7, 24, 2, 200), pr(5, 26)];
  assert.deepEqual(numbers(orderPullRequests(input)), [4, 7, 6, 2, 1, 5]);
});

test("stack numbers never group unrelated repositories", () => {
  const input = [pr(1, 30, 1), pr(2, 29, 2), pr(9, 28, 1, 100, "other/repo"), pr(10, 27, 2, 100, "other/repo")];
  assert.deepEqual(numbers(orderPullRequests(input)), [2, 1, 10, 9]);
});

test("partial stacks keep descending positions and filtering preserves order", () => {
  const ordered = orderPullRequests([pr(1, 30, 1), pr(3, 26, 3), pr(5, 29)]);
  assert.deepEqual(numbers(ordered), [3, 1, 5]);
  assert.deepEqual(numbers(ordered.filter((item) => item.stack)), [3, 1]);
});

test("ties are deterministic across devices and empty or unknown dates are safe", () => {
  const input = [pr(2, 30), pr(1, 30, 1), pr(3, 30, 2), { ...pr(4, 1), updatedAt: "" }];
  assert.deepEqual(numbers(orderPullRequests(input)), numbers(orderPullRequests([...input].reverse())));
  assert.equal(orderPullRequests(input).at(-1).number, 4);
  assert.deepEqual(orderPullRequests([]), []);
});

test("visual groups share one boundary per stack without grouping standalone PRs", () => {
  const input = orderPullRequests([pr(1, 30, 1), pr(4, 29), pr(2, 28, 2), pr(3, 27, 3), pr(5, 26)]);
  const original = structuredClone(input);
  assert.deepEqual(groupPullRequests(input).map((group) => numbers(group.members)), [[3, 2, 1], [4], [5]]);
  assert.deepEqual(input, original);
  assert.deepEqual(groupPullRequests([]), []);
});

test("filtered groups retain their anchor order and single-member stack identity", () => {
  const input = orderPullRequests([pr(1, 30, 1), pr(4, 29), pr(2, 28, 2), pr(3, 27, 3)]);
  const groups = groupPullRequests(input.filter((item) => item.number >= 3));
  assert.deepEqual(groups.map((group) => numbers(group.members)), [[3], [4]]);
  assert.equal(groups[0].key, "stack:owner/repo:100");
});

test("visual groups scope stack identifiers to a case-insensitive repository", () => {
  const groups = groupPullRequests([
    pr(1, 30, 1), pr(2, 29, 2, 100, "OWNER/REPO"),
    pr(3, 28, 1, 100, "other/repo"), pr(4, 27, 2, 200),
  ]);
  assert.deepEqual(groups.map((group) => numbers(group.members)), [[1, 2], [3], [4]]);
});
