// Real GitHub, Linear and provider inputs for the disposable QA hub
// (qa-threads.mjs). Every value here is opt-in; without them the hub keeps its
// fixtures. Tokens travel only through the environment, a 0600 file in the QA
// temp directory and loopback requests to the hub — never argv, a URL or a log.
import { execFile } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/// Reads KEY=VALUE lines. Blank lines and `#` comments are skipped, an
/// optional `export ` prefix and one pair of matching quotes are dropped.
export function parseQaEnv(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2];
    const quoted = /^(["'])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, "");
    values[match[1]] = value;
  }
  return values;
}

/// Loads an optional env file under process.env, which wins.
export function loadQaEnv(file, env = process.env) {
  if (!existsSync(file)) return [];
  const loaded = [];
  for (const [key, value] of Object.entries(parseQaEnv(readFileSync(file, "utf8"))))
    if (env[key] === undefined) { env[key] = value; loaded.push(key); }
  return loaded;
}

/// The real inputs this run asked for, validated before anything starts.
export function qaRealInputs(env = process.env) {
  const repository = env.QA_GITHUB_REPOSITORY?.trim() || undefined;
  const token = env.QA_GITHUB_TOKEN?.trim() || undefined;
  if (repository && !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repository))
    throw new Error("QA_GITHUB_REPOSITORY must be owner/name");
  if (repository && !token) throw new Error("set QA_GITHUB_TOKEN with QA_GITHUB_REPOSITORY");
  if (token && !repository) throw new Error("set QA_GITHUB_REPOSITORY with QA_GITHUB_TOKEN");
  const reviewerToken = env.QA_GITHUB_REVIEWER_TOKEN?.trim() || undefined;
  if (reviewerToken && !repository) throw new Error("set QA_GITHUB_REPOSITORY with QA_GITHUB_REVIEWER_TOKEN");
  const linearToken = env.QA_LINEAR_TOKEN?.trim() || undefined;
  const real = !!(repository || linearToken);
  if (real && env.QA_HUB_WEB !== "1") throw new Error("set QA_HUB_WEB=1 to use real GitHub or Linear tokens");
  return {
    repository,
    token,
    reviewerToken,
    linearToken,
    seed: env.QA_GITHUB_SEED !== "0",
    realProviders: env.QA_REAL_PROVIDERS === "1",
    secrets: [token, reviewerToken, linearToken].filter(Boolean),
  };
}

/// A credential helper for github.com that reads the token from a 0600 file
/// beside it. The helper holds a path, never the token, and answers only `get`,
/// so git never asks it to store anything.
export function writeGitCredentialHelper(dir, token) {
  const tokenFile = join(dir, "github-token");
  const helper = join(dir, "git-credential-qa");
  writeFileSync(tokenFile, token, { mode: 0o600 });
  writeFileSync(
    helper,
    `#!/bin/sh\ntest "$1" = get || exit 0\necho username=x-access-token\nprintf 'password=%s\\n' "$(cat '${tokenFile.replaceAll("'", "'\\''")}')"\n`,
    { mode: 0o700 },
  );
  chmodSync(helper, 0o700);
  return helper;
}

const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "" });

/// Clones the sandbox with only the QA helper: the empty `credential.helper`
/// resets any keychain or `gh` helper so the token is neither read from nor
/// written to the person's own store. The clone keeps the same helper in its
/// local config so the computer's later fetches (a review's pull request ref)
/// and a real provider's pushes use the sandbox token too.
export async function cloneWithToken(repository, destination, helper) {
  const scoped = "credential.https://github.com.helper";
  await run(
    "git",
    ["-c", "credential.helper=", "-c", `${scoped}=${helper}`, "clone", "-q", `https://github.com/${repository}.git`, destination],
    { env: gitEnv() },
  );
  await configureCredentialHelper(destination, helper);
}

/// Makes the QA helper the only one a repository uses for github.com. Order
/// matters: the empty value resets every helper configured before it.
export async function configureCredentialHelper(repository, helper) {
  await run("git", ["-C", repository, "config", "--local", "--add", "credential.helper", ""], { env: gitEnv() });
  await run("git", ["-C", repository, "config", "--local", "--add", "credential.https://github.com.helper", helper], { env: gitEnv() });
}

/// Calls the GitHub REST API. A failure names the status and route only.
export function githubApi(token, send = fetch) {
  return async (path, method = "GET", body) => {
    const response = await send(`https://api.github.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "Remy QA hub",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 404 && method === "GET") return undefined;
    if (!response.ok) {
      // GitHub's message says why (archived, protected, missing scope) and
      // never echoes the credential.
      const reason = await response.json().then((value) => value?.message, () => undefined);
      throw new Error(`GitHub ${method} ${path.split("?")[0]} answered ${response.status}${reason ? `: ${reason}` : ""}`);
    }
    return response.status === 204 ? {} : response.json();
  };
}

const SAMPLE_PATH = "qa/review-sample.md";
const SAMPLE = `# Review sample

This file gives the Remy QA hub a pull request to review.
The quick check below should stay short.

- First item
- Second item
`;

/// The QA pull request's change: one word swapped and a few lines added.
export function sampleEdit(text) {
  const swapped = text.includes("quick check") ? text.replace("quick check", "careful check") : text.replace("careful check", "quick check");
  return `${swapped.trimEnd()}\n- Third item\n- Fourth item\n\nThe QA hub added the lines above at ${new Date().toISOString()}.\n`;
}

const b64 = (text) => Buffer.from(text, "utf8").toString("base64");

/// Opens a pull request in the sandbox unless one is already open, and returns
/// the open pull requests' links. The sample file lands on the default branch
/// the first time; when that branch refuses a direct commit, a long-lived
/// `qa/sample-base` branch holds it and the pull request targets that instead.
export async function seedPullRequest(repository, token, { send = fetch, now = Date.now() } = {}) {
  const api = githubApi(token, send);
  const repo = await api(`/repos/${repository}`);
  if (!repo) throw new Error(`QA_GITHUB_TOKEN cannot read ${repository}`);
  if (repo.archived) throw new Error(`${repository} is archived, so no pull request can be opened in it; unarchive it, choose another sandbox, or set QA_GITHUB_SEED=0`);
  const open = await api(`/repos/${repository}/pulls?state=open&per_page=10`);
  if (open?.length) return { created: false, urls: open.map((pull) => pull.html_url) };
  let base = repo.default_branch;
  const onBase = (branch) => api(`/repos/${repository}/contents/${SAMPLE_PATH}?ref=${encodeURIComponent(branch)}`);
  if (!(await onBase(base))) {
    try {
      await api(`/repos/${repository}/contents/${SAMPLE_PATH}`, "PUT", { message: "Add the Remy QA review sample", content: b64(SAMPLE), branch: base });
    } catch {
      base = "qa/sample-base";
      if (!(await api(`/repos/${repository}/git/ref/heads/${base}`))) {
        const head = await api(`/repos/${repository}/git/ref/heads/${encodeURIComponent(repo.default_branch)}`);
        await api(`/repos/${repository}/git/refs`, "POST", { ref: `refs/heads/${base}`, sha: head.object.sha });
      }
      if (!(await onBase(base)))
        await api(`/repos/${repository}/contents/${SAMPLE_PATH}`, "PUT", { message: "Add the Remy QA review sample", content: b64(SAMPLE), branch: base });
    }
  }
  const branch = `qa/${now}`;
  const baseRef = await api(`/repos/${repository}/git/ref/heads/${base.split("/").map(encodeURIComponent).join("/")}`);
  await api(`/repos/${repository}/git/refs`, "POST", { ref: `refs/heads/${branch}`, sha: baseRef.object.sha });
  const file = await onBase(branch);
  const current = Buffer.from(file.content, "base64").toString("utf8");
  await api(`/repos/${repository}/contents/${SAMPLE_PATH}`, "PUT", {
    message: "Tighten the QA review sample",
    content: b64(sampleEdit(current)),
    sha: file.sha,
    branch,
  });
  const pull = await api(`/repos/${repository}/pulls`, "POST", {
    title: "Tighten the QA review sample",
    head: branch,
    base,
    body: "Opened by the Remy QA hub (`hub/scripts/qa-threads.mjs`) so pull request and review features have something real to show. Close it when you are done.",
  });
  return { created: true, urls: [pull.html_url] };
}

/// Throws when a value that must stay local appears in text bound for a file
/// or a log.
export function assertNoSecrets(text, secrets) {
  for (const secret of secrets)
    if (secret && text.includes(secret)) throw new Error("A QA token would have been written out; refusing to continue");
}
