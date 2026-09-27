import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertNoSecrets,
  configureCredentialHelper,
  loadQaEnv,
  parseQaEnv,
  qaRealInputs,
  sampleEdit,
  seedPullRequest,
  writeGitCredentialHelper,
} from "./qa-github.mjs";

const secret = "ghp_disposable0123456789abcdefghijklmnop";

test("reads KEY=VALUE lines and leaves process values in charge", () => {
  assert.deepEqual(
    parseQaEnv(`# comment\n\nQA_GITHUB_REPOSITORY=ada/sandbox\nexport QA_GITHUB_TOKEN="${secret}"\nQA_GITHUB_SEED='0'\nQA_REAL_PROVIDERS=1 # real\nnot a line\n`),
    { QA_GITHUB_REPOSITORY: "ada/sandbox", QA_GITHUB_TOKEN: secret, QA_GITHUB_SEED: "0", QA_REAL_PROVIDERS: "1" },
  );
  const dir = mkdtempSync(join(tmpdir(), "qa-env-"));
  try {
    const file = join(dir, ".qa.env");
    writeFileSync(file, "QA_GITHUB_REPOSITORY=ada/sandbox\nQA_GITHUB_TOKEN=from-file\n");
    const env = { QA_GITHUB_TOKEN: "from-process" };
    assert.deepEqual(loadQaEnv(file, env), ["QA_GITHUB_REPOSITORY"]);
    assert.equal(env.QA_GITHUB_TOKEN, "from-process");
    assert.deepEqual(loadQaEnv(join(dir, "missing"), env), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("asks for complete real inputs and changes nothing without them", () => {
  assert.deepEqual(qaRealInputs({}).secrets, []);
  assert.equal(qaRealInputs({}).repository, undefined);
  assert.throws(() => qaRealInputs({ QA_GITHUB_REPOSITORY: "ada/sandbox", QA_HUB_WEB: "1" }), /QA_GITHUB_TOKEN/);
  assert.throws(() => qaRealInputs({ QA_GITHUB_TOKEN: secret, QA_HUB_WEB: "1" }), /QA_GITHUB_REPOSITORY/);
  assert.throws(() => qaRealInputs({ QA_GITHUB_REPOSITORY: "https://github.com/ada/sandbox", QA_GITHUB_TOKEN: secret, QA_HUB_WEB: "1" }), /owner\/name/);
  assert.throws(() => qaRealInputs({ QA_GITHUB_REPOSITORY: "ada/sandbox", QA_GITHUB_TOKEN: secret }), /QA_HUB_WEB/);
  const inputs = qaRealInputs({ QA_GITHUB_REPOSITORY: "ada/sandbox", QA_GITHUB_TOKEN: secret, QA_GITHUB_SEED: "0", QA_HUB_WEB: "1", QA_REAL_PROVIDERS: "1" });
  assert.equal(inputs.seed, false);
  assert.equal(inputs.realProviders, true);
  assert.deepEqual(inputs.secrets, [secret]);
});

test("the credential helper answers github.com from a private file and stores nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-git-"));
  try {
    const helper = writeGitCredentialHelper(dir, secret);
    assert.ok(!readFileSync(helper, "utf8").includes(secret));
    assert.equal(statSync(join(dir, "github-token")).mode & 0o777, 0o600);
    assert.match(execFileSync(helper, ["get"], { input: "", encoding: "utf8" }), new RegExp(`password=${secret}`));
    assert.equal(execFileSync(helper, ["store"], { input: "", encoding: "utf8" }), "");
    const repo = join(dir, "repo");
    execFileSync("git", ["init", "-q", repo]);
    await configureCredentialHelper(repo, helper);
    {
      const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "" };
      const filled = execFileSync("git", ["-C", repo, "credential", "fill"], { input: "protocol=https\nhost=github.com\n\n", encoding: "utf8", env });
      assert.match(filled, /username=x-access-token/);
      assert.match(filled, new RegExp(`password=${secret}`));
      assert.throws(() => execFileSync("git", ["-C", repo, "credential", "fill"], { input: "protocol=https\nhost=example.test\n\n", encoding: "utf8", env, stdio: ["pipe", "pipe", "ignore"] }));
      assert.ok(!readFileSync(join(repo, ".git/config"), "utf8").includes(secret));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const fakeGitHub = (openPulls) => {
  const calls = [];
  const files = new Map();
  const send = async (url, init = {}) => {
    const { pathname, search } = new URL(url);
    const method = init.method ?? "GET";
    calls.push({ method, path: pathname + search, authorization: init.headers.authorization });
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
    if (pathname === "/repos/ada/sandbox" && method === "GET") return json({ default_branch: "main" });
    if (pathname === "/repos/ada/sandbox/pulls" && method === "GET") return json(openPulls);
    if (pathname.startsWith("/repos/ada/sandbox/contents/") && method === "GET") {
      const ref = new URLSearchParams(search).get("ref");
      const text = files.get(ref);
      return text === undefined ? json({}, 404) : json({ sha: `sha-${ref}`, content: Buffer.from(text).toString("base64") });
    }
    if (pathname.startsWith("/repos/ada/sandbox/contents/") && method === "PUT") {
      const body = JSON.parse(init.body);
      files.set(body.branch, Buffer.from(body.content, "base64").toString("utf8"));
      return json({}, 201);
    }
    if (pathname.startsWith("/repos/ada/sandbox/git/ref/heads/")) return json({ object: { sha: "base-sha" } });
    if (pathname === "/repos/ada/sandbox/git/refs" && method === "POST") {
      const body = JSON.parse(init.body);
      files.set(body.ref.replace("refs/heads/", ""), files.get("main"));
      return json({}, 201);
    }
    if (pathname === "/repos/ada/sandbox/pulls" && method === "POST") return json({ html_url: "https://github.com/ada/sandbox/pull/7" }, 201);
    return json({}, 500);
  };
  return { send, calls, files };
};

test("leaves an open pull request alone", async () => {
  const github = fakeGitHub([{ html_url: "https://github.com/ada/sandbox/pull/3" }]);
  assert.deepEqual(await seedPullRequest("ada/sandbox", secret, { send: github.send }), { created: false, urls: ["https://github.com/ada/sandbox/pull/3"] });
  assert.ok(github.calls.every((call) => call.method === "GET"));
});

test("opens a pull request with a one-word edit and a few new lines", async () => {
  const github = fakeGitHub([]);
  const result = await seedPullRequest("ada/sandbox", secret, { send: github.send, now: 42 });
  assert.deepEqual(result, { created: true, urls: ["https://github.com/ada/sandbox/pull/7"] });
  assert.match(github.files.get("main"), /The quick check/);
  const changed = github.files.get("qa/42");
  assert.match(changed, /The careful check/);
  assert.match(changed, /- Third item\n- Fourth item/);
  for (const call of github.calls) {
    assert.ok(!call.path.includes(secret));
    assert.equal(call.authorization, `Bearer ${secret}`);
  }
  assert.match(sampleEdit(changed), /The quick check/);
});

test("refuses to write a token out", () => {
  assert.throws(() => assertNoSecrets(JSON.stringify({ tokens: { ada: secret } }), [secret]), /refusing/);
  assert.doesNotThrow(() => assertNoSecrets("{}", [secret]));
});

test("the review fixture anchors on the first added line and reads each kind of turn", async () => {
  const { firstAddedLine, reviewTurn } = await import("./qa-review-fixture.mjs");
  const diff = "diff --git a/gone.md b/gone.md\n--- a/gone.md\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\ndiff --git a/qa/review-sample.md b/qa/review-sample.md\n--- a/qa/review-sample.md\n+++ b/qa/review-sample.md\n@@ -4 +3,0 @@\n-x\n@@ -4 +4 @@\n-The quick check\n+The careful check\n@@ -8,0 +9,2 @@\n+- Third item\n";
  assert.deepEqual(firstAddedLine(diff), { path: "qa/review-sample.md", line: 4 });
  assert.equal(firstAddedLine(""), undefined);
  assert.deepEqual(reviewTurn("Review pull request #7 Tighten the QA review sample (qa/1 → main)"), { kind: "report" });
  assert.deepEqual(reviewTurn("Review the commits after abc1234 up to def5678. Report again."), { kind: "report" });
  assert.deepEqual(reviewTurn('I flagged your finding "Check this" at qa/review-sample.md:4 (finding f-12). Too picky. If this is how I want reviews done, propose a rule.'), { kind: "flag", findingId: "f-12" });
  assert.deepEqual(reviewTurn("Thanks"), { kind: "reply" });
});
