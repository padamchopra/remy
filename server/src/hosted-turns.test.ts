import test from "node:test";
import assert from "node:assert/strict";
import {
  checkpointTurns,
  resumeCheckpointTurns,
  type CheckpointTurn,
} from "./hosted-turns.js";

test("checkpoint quiesces active turns and asks again without granting pending permission", async () => {
  let saved: CheckpointTurn[] = [];
  const stopped: string[] = [];
  await checkpointTurns(
    [
      { id: "active", state: "working" },
      { id: "approval", state: "needs_input" },
      { id: "done", state: "idle" },
    ],
    (value) => {
      saved = value;
    },
    async (id) => {
      assert.equal(saved.length, 2);
      stopped.push(id);
    },
  );
  assert.deepEqual(stopped, ["active", "approval"]);
  const delivered: { id: string; prompt: string; messageId: string }[] = [];
  await resumeCheckpointTurns(
    saved,
    (value) => {
      saved = value;
    },
    async (id, prompt, messageId) => {
      delivered.push({ id, prompt, messageId });
    },
  );
  assert.equal(saved.length, 0);
  assert.match(delivered[0].prompt, /without repeating completed actions/);
  assert.match(delivered[1].prompt, /restart grants no approval/);
  assert.ok(delivered.every((t) => t.messageId.startsWith("u-")));
});

test("failed resume retains the same deduplication key for a restart retry", async () => {
  let saved: CheckpointTurn[] = [
    { id: "a", messageId: "u-stable", waiting: false },
  ];
  await assert.rejects(
    resumeCheckpointTurns(
      saved,
      (value) => {
        saved = value;
      },
      async () => {
        throw Error("offline");
      },
    ),
  );
  assert.equal(saved[0].messageId, "u-stable");
  await resumeCheckpointTurns(
    saved,
    (value) => {
      saved = value;
    },
    async (_id, _prompt, messageId) => {
      assert.equal(messageId, "u-stable");
    },
  );
  assert.deepEqual(saved, []);
});
