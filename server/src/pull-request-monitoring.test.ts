import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "remy-pr-monitoring-"));
const chats = await import("./chat.js");
const monitoring = await import("./pull-request-monitoring.js");

const folder = mkdtempSync(join(tmpdir(), "remy-pr-workspace-"));

test("a pull request is followed by nobody until a thread asks for it", () => {
  assert.deepEqual(monitoring.pullRequestMonitoring("owner/repo", 42), {
    enabled: false,
    chatId: null,
    source: "pull-request",
    explicit: false,
  });
  assert.equal(monitoring.hasPullRequestMonitoring(), false);
});

test("one pull request is followed inside the thread that chose it", () => {
  const thread = chats.createChat({ cwd: folder, title: "Review this pull request" });
  assert.deepEqual(
    monitoring.setPullRequestMonitoring("owner/repo", 17, { enabled: true, chatId: thread.id }),
    { enabled: true, chatId: thread.id, source: "pull-request", explicit: true },
  );
  assert.equal(monitoring.hasPullRequestMonitoring(), true);
  // The key is case-insensitive, so the same pull request is one policy.
  assert.equal(monitoring.pullRequestMonitoring("OWNER/REPO", 17).chatId, thread.id);

  monitoring.clearThreadPullRequestMonitoring(thread.id);
  assert.deepEqual(monitoring.pullRequestMonitoring("owner/repo", 17), {
    enabled: false,
    chatId: null,
    source: "pull-request",
    explicit: true,
  });
});

test("monitoring needs a thread that exists, and returning to the default forgets it", () => {
  assert.throws(() => monitoring.setPullRequestMonitoring("owner/repo", 9, { enabled: true, chatId: null }));
  assert.throws(() => monitoring.setPullRequestMonitoring("owner/repo", 9, { enabled: true, chatId: "missing" }));

  const thread = chats.createChat({ cwd: folder, title: "Follow this one" });
  monitoring.setPullRequestMonitoring("owner/repo", 9, { enabled: true, chatId: thread.id });
  assert.equal(monitoring.resetPullRequestMonitoring("owner/repo", 9).explicit, false);
});
