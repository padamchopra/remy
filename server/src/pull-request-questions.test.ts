import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "remy-review-questions-"));
const { askPullRequestQuestion, readPullRequestQuestions, discoverPullRequestQuestions, validQuestionSource } = await import("./pull-request-questions.js");
const { readSavedPullRequestGuide } = await import("./pull-request-guides.js");
const { acceptAnnouncement } = await import("./peers.js");
const { db } = await import("./db.js");
const source = { path: "src/file.ts", head: "a".repeat(40), header: "@@ -1 +1 @@", lines: [
  { kind: "del" as const, text: "old", oldLine: 1, newLine: null },
  { kind: "add" as const, text: "new", oldLine: null, newLine: 1 },
] };
const input = { repository: "example/repo", number: 1, source, start: 1, end: 1, question: "Why this change?" };
const answer = async () => ({ answer: "It changes the value.", choice: { provider: "codex" as const, model: "gpt-5.4", effort: "low" } });

test("answers and saves independently of guide generation", async () => {
  let calls = 0;
  const question = await askPullRequestQuestion(input, async (request) => {
    calls++;
    assert.deepEqual(request.hunk.lines, source.lines);
    assert.equal(request.start, 1);
    return answer();
  });
  assert.equal(calls, 1);
  assert.equal(readSavedPullRequestGuide(input.repository, input.number), undefined);
  assert.deepEqual(readPullRequestQuestions(input.repository, input.number), [question]);
  assert.deepEqual(readPullRequestQuestions(input.repository, 999), []);
});

test("parallel answers append without losing one another", async () => {
  const results = await Promise.all([2, 3].map((number) => askPullRequestQuestion({ ...input, number: 2, question: `Question ${number}` }, answer)));
  assert.equal(new Set(results.map((question) => question.id)).size, 2);
  assert.equal(readPullRequestQuestions(input.repository, 2).length, 2);
});

test("rejects invalid references and ranges before invoking a model", async () => {
  assert.equal(validQuestionSource({ ...source, path: "../file" }), false);
  assert.equal(validQuestionSource({ ...source, head: "main" }), false);
  assert.equal(validQuestionSource({ ...source, lines: [{ kind: "add", text: "a", oldLine: null, newLine: -1 }] }), false);
  let calls = 0;
  const fail = async () => { calls++; return answer(); };
  for (const patch of [{ question: " " }, { start: -1 }, { end: 20 }, { start: 1, end: 0 }, { source: null }]) {
    await assert.rejects(askPullRequestQuestion({ ...input, ...patch }, fail));
  }
  assert.equal(calls, 0);
});

test("failed answers do not create durable or partial questions", async () => {
  await assert.rejects(askPullRequestQuestion({ ...input, number: 3 }, async () => { throw new Error("Offline"); }), /Offline/);
  assert.deepEqual(readPullRequestQuestions(input.repository, 3), []);
});

test("paired discovery authenticates, merges duplicates, rejects wrong PRs, and marks offline results", async (t) => {
  const question = readPullRequestQuestions(input.repository, 1)[0];
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    assert.equal(req.headers.authorization, "Bearer test-token");
    assert.equal(req.url, "/pull-requests/questions?repository=example%2Frepo&number=1");
    res.end(JSON.stringify({ questions: [question, { ...question, id: "wrong", number: 9 }, { id: "malformed" }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  acceptAnnouncement({ deviceId: "question-peer", name: "Question peer", token: "test-token", url: `http://127.0.0.1:${address.port}` });
  t.after(() => { db.prepare("delete from peers where id = ?").run("question-peer"); server.closeAllConnections(); server.close(); });
  const [first, second] = await Promise.all([discoverPullRequestQuestions(input.repository, 1), discoverPullRequestQuestions(input.repository, 1)]);
  assert.equal(requests, 1);
  assert.deepEqual(first, { questions: [question], unavailable: false });
  assert.deepEqual(first, second);
  db.prepare("update peers set last_seen = ? where id = ?").run(0, "question-peer");
  assert.deepEqual(await discoverPullRequestQuestions(input.repository, 1), { questions: [question], unavailable: true });
});
