import assert from "node:assert/strict";
import test from "node:test";
import { parsePullRequestFileContent, validPullRequestFileRequest } from "./pull-request-file.js";

const revision = "a".repeat(40);
const request = { repository: "owner/repo", head: revision, path: "src/nested/file.ts" };
const response = (blob: object) => JSON.stringify({ data: { repository: { object: { __typename: "Blob", byteSize: 4, isBinary: false, isTruncated: false, text: "one\n", ...blob } } } });

test("file reads require immutable revisions and safe repository-relative paths", () => {
  assert.equal(validPullRequestFileRequest(request), true);
  assert.equal(validPullRequestFileRequest({ ...request, base: "b".repeat(40) }), true);
  assert.equal(validPullRequestFileRequest({ ...request, path: "src/my file #1.ts" }), true);
  for (const path of ["", "/etc/passwd", "../secret", "src/../../secret", "src//file", "src/./file", "src/\u0000file", "src\\file"]) {
    assert.equal(validPullRequestFileRequest({ ...request, path }), false, path);
  }
  for (const head of ["main", "HEAD", "--help", "a".repeat(7), ""]) assert.equal(validPullRequestFileRequest({ ...request, head }), false);
  assert.equal(validPullRequestFileRequest({ ...request, repository: "owner/repo/../../other" }), false);
  assert.equal(validPullRequestFileRequest({ ...request, base: "main" }), false);
});

test("file preview preserves text and immutable revision, including empty files", () => {
  assert.deepEqual(parsePullRequestFileContent(response({}), revision), { text: "one\n", revision });
  assert.equal(parsePullRequestFileContent(response({ text: "", byteSize: 0 }), revision).text, "");
});

test("file preview rejects missing, binary, truncated, or oversized blobs", () => {
  assert.throws(() => parsePullRequestFileContent(JSON.stringify({ data: { repository: { object: null } } }), revision), /available/);
  assert.throws(() => parsePullRequestFileContent(response({ __typename: "Tree" }), revision), /available/);
  assert.throws(() => parsePullRequestFileContent(response({ isBinary: true, text: null }), revision), /binary/);
  assert.throws(() => parsePullRequestFileContent(response({ isTruncated: true }), revision), /too large/);
  assert.throws(() => parsePullRequestFileContent(response({ byteSize: 1_000_001 }), revision), /too large/);
  assert.throws(() => parsePullRequestFileContent(response({ text: "x\n".repeat(20_001) }), revision), /too large/);
  assert.throws(() => parsePullRequestFileContent(JSON.stringify({ errors: [{ message: "private detail" }] }), revision), /Try again/);
});
