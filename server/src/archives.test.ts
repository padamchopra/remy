import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const stateDir = mkdtempSync(join(tmpdir(), "remy-archives-test-"));
process.env.MC_CONFIG_DIR = stateDir;
process.env.HOME = stateDir;

const { archiveChat, getArchivedChat, listArchivedChatSummaries } = await import("./archives.js");

test("archive summaries keep the latest prose without transferring the transcript", () => {
  const archived = archiveChat({
    session: "Finished work",
    agent: "claude",
    cwd: stateDir,
    conversation: {
      available: true,
      todos: [{ content: "Large todo", status: "completed" }],
      entries: [
        { id: "u-1", kind: "user", text: "Start" },
        { id: "tool-1", kind: "tool", output: "x".repeat(200_000) },
        { id: "a-1", kind: "assistant", text: "Finished" },
      ],
    },
  });

  const [summary] = listArchivedChatSummaries();
  assert.equal(summary?.summary, true);
  assert.deepEqual(summary?.conversation.entries, [{ id: "a-1", kind: "assistant", text: "Finished" }]);
  assert.deepEqual(summary?.conversation.todos, []);

  const detail = getArchivedChat(archived.id);
  assert.equal(detail?.summary, undefined);
  assert.equal(detail?.conversation.entries.length, 3);
  assert.equal(detail?.conversation.todos.length, 1);
});
