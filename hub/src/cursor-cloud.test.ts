import assert from "node:assert/strict";
import test from "node:test";
import { CURSOR_CLOUD_COMPUTER_ID } from "@remy/contract";
import type { BoardStorage } from "./organization-board.js";
import { ThreadStore } from "./thread-store.js";
import {
  CursorCloudThreads,
  cursorCloudRepoUrl,
  setCursorCloudApiForTest,
  verifyCursorCloudKey,
  type CursorCloudApi,
} from "./cursor-cloud.js";

class MemoryStorage implements BoardStorage {
  values = new Map<string, unknown>();
  async get<T>(key: string) {
    return structuredClone(this.values.get(key)) as T | undefined;
  }
  async put<T>(key: string, value: T) {
    this.values.set(key, structuredClone(value));
  }
  async delete(key: string) {
    return this.values.delete(key);
  }
  async list<T>({ prefix }: { prefix: string }) {
    return new Map(
      [...this.values]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key, structuredClone(value) as T]),
    );
  }
  async transaction<T>(fn: (storage: BoardStorage) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

const actor = { id: "ada", label: "Ada" };
const apiCalls: string[] = [];
const mockApi: CursorCloudApi = {
  async me() {
    apiCalls.push("me");
    return { apiKeyName: "test-key" };
  },
  async create(_apiKey, input) {
    apiCalls.push(`create:${input.origin}:${input.text}`);
    return { agentId: "agent-1", runId: "run-1" };
  },
  async followUp() {
    apiCalls.push("followUp");
    return { runId: "run-2" };
  },
  async *stream() {
    yield { type: "assistant", data: { text: "Working on it." } };
  },
  async getRun() {
    apiCalls.push("getRun");
    return { status: "FINISHED", result: "Opened the change." };
  },
  async cancel() {
    apiCalls.push("cancel");
  },
  async archive() {
    apiCalls.push("archive");
  },
};

test("cursor cloud creates a thread, streams a run, and refuses a missing key", async () => {
  setCursorCloudApiForTest(mockApi);
  apiCalls.length = 0;
  const storage = new MemoryStorage();
  const pending: Promise<unknown>[] = [];
  const threads = new CursorCloudThreads(new ThreadStore(storage), storage, work => { pending.push(work); });
  await assert.rejects(
    threads.create({
      organizationId: "org",
      actor,
      workspaceId: "repo",
      origin: "https://github.com/studio/android.git",
      apiKey: undefined,
    }),
    /Connect Cursor Cloud/,
  );
  const snapshot = await threads.create({
    organizationId: "org",
    actor,
    workspaceId: "repo",
    origin: "https://github.com/studio/android.git",
    title: "Fix the login",
    apiKey: "cursor-secret",
  });
  assert.equal(snapshot.detail.provider, "cursor");
  assert.equal(snapshot.detail.title, "Fix the login");
  const stored = await new ThreadStore(storage).get(CURSOR_CLOUD_COMPUTER_ID, snapshot.id);
  assert.equal(stored?.computerId, CURSOR_CLOUD_COMPUTER_ID);
  const sent = await threads.handle(snapshot.id, actor, "POST", "message", { text: "Ship the fix." }, "cursor-secret");
  assert.equal(sent.status, 202);
  await Promise.all(pending);
  const finished = await threads.get(snapshot.id);
  assert.equal(finished?.detail.state, "idle");
  assert.ok((finished?.detail.entries as { kind?: string; text?: string }[]).some(entry => entry.kind === "assistant" && entry.text?.includes("Opened the change.")));
  assert.ok(apiCalls.some(call => call.startsWith("create:https://github.com/studio/android:")));
  assert.equal(cursorCloudRepoUrl("github.com/studio/android"), "https://github.com/studio/android");
  await verifyCursorCloudKey("cursor-secret");
  await assert.rejects(verifyCursorCloudKey("   "), /Enter a Cursor API key/);
});
