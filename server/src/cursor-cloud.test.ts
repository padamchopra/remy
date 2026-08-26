import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Run, SDKAgent, SDKMessage } from "@cursor/sdk";

const stateDir = mkdtempSync(join(tmpdir(), "remy-cursor-cloud-"));
process.env.MC_CONFIG_DIR = stateDir;
process.env.HOME = stateDir;

const cloud = await import("./cursor-cloud.js");
const { setProviderEnabled } = await import("./config.js");

function fakeRun(messages: SDKMessage[]): Run {
  return {
    id: "run-1",
    agentId: "bc-agent-1",
    status: "finished",
    supports: () => true,
    unsupportedReason: () => undefined,
    async *stream() {
      for (const message of messages) yield message;
    },
    conversation: async () => [],
    wait: async () => ({
      id: "run-1",
      status: "finished",
      result: "Finished the requested change.",
      git: { branches: [{ repoUrl: "github.com/example/repo", branch: "cursor/change", prUrl: "https://github.com/example/repo/pull/1" }] },
    }),
    cancel: async () => {},
    onDidChangeStatus: () => () => {},
  };
}

test("streams a Cursor Cloud run into Remy's transcript without exposing its API key", async () => {
  const messages: SDKMessage[] = [
    {
      type: "thinking",
      agent_id: "bc-agent-1",
      run_id: "run-1",
      text: "Checking the repository.",
    },
    {
      type: "tool_call",
      agent_id: "bc-agent-1",
      run_id: "run-1",
      call_id: "call-1",
      name: "read",
      status: "completed",
      args: { path: "README.md" },
      result: { lines: 10 },
    },
    {
      type: "assistant",
      agent_id: "bc-agent-1",
      run_id: "run-1",
      message: { role: "assistant", content: [{ type: "text", text: "Finished the requested change." }] },
    },
  ];
  const run = fakeRun(messages);
  let createOptions: Record<string, unknown> | undefined;
  let sentText: string | undefined;
  const agent = {
    agentId: "bc-agent-1",
    send: async (text: string) => {
      sentText = text;
      return run;
    },
    close: () => {},
  } as unknown as SDKAgent;
  cloud.setCursorCloudSdkForTest({
    me: async () => ({ apiKeyName: "Remy test key", userEmail: "dev@example.com" }),
    create: async (options) => {
      createOptions = options as unknown as Record<string, unknown>;
      return agent;
    },
    resume: async () => agent,
    getRun: async () => run,
    cancel: async () => {},
    archive: async () => {},
  });

  setProviderEnabled("cursor", false);
  await assert.rejects(
    cloud.connectCursorCloud("cursor-cloud-secret"),
    /turn on Cursor in Providers first/,
  );
  setProviderEnabled("cursor", true);
  const status = await cloud.connectCursorCloud("cursor-cloud-secret");
  assert.equal(status.configured, true);
  assert.equal(JSON.stringify(status).includes("cursor-cloud-secret"), false);

  const created = await cloud.createCursorCloudChat({
    cwd: "/workspace",
    origin: "https://github.com/example/repo",
    startingRef: "main",
    title: "Update cursor-cloud-secret",
  }) as { id: string };
  await cloud.sendCursorCloudMessage(created.id, "Update the README with cursor-cloud-secret");

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const detail = cloud.getCursorCloudChat(created.id) as { state: string };
    if (detail.state !== "working") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const detail = cloud.getCursorCloudChat(created.id) as {
    state: string;
    title: string;
    entries: Array<{ kind: string; text?: string; tool?: string }>;
  };
  assert.equal(detail.state, "idle");
  assert.ok(detail.entries.some((entry) => entry.kind === "thinking"));
  assert.ok(detail.entries.some((entry) => entry.tool === "read"));
  assert.ok(detail.entries.some((entry) => entry.text === "Finished the requested change."));
  assert.equal(JSON.stringify(detail).includes("cursor-cloud-secret"), false);
  assert.equal(detail.title, "Update [REDACTED]");
  assert.equal(sentText, "Update the README with [REDACTED]");
  assert.equal(JSON.stringify(createOptions).includes("envVars"), false);
  assert.equal((createOptions?.cloud as { metadata?: Record<string, string> }).metadata?.remy_chat_id, created.id);

  assert.equal(cloud.disconnectCursorCloud().configured, false);
});
