import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "remy-agent-memories-"));

const agents = await import("./agents.js");
const memories = await import("./agent-memories.js");
const projects = await import("./projects.js");

const agent = agents.createAgent({ name: "Rememberer", handle: "rememberer" });

test("an agent saves, updates, searches, and forgets a durable memory", () => {
  const saved = memories.saveMemory({ agentId: agent.id, content: "  Prefer concise progress notes.  " });
  assert.equal(saved.content, "Prefer concise progress notes.");
  assert.deepEqual(memories.listMemories(agent.id).map((memory) => memory.id), [saved.id]);
  assert.equal(memories.listMemories(agent.id, { query: "CONCISE" })[0]?.id, saved.id);

  const updated = memories.saveMemory({ agentId: agent.id, id: saved.id, content: "Prefer one-line progress notes." });
  assert.equal(updated.id, saved.id);
  assert.equal(memories.getMemory(saved.id)?.content, "Prefer one-line progress notes.");

  memories.forgetMemory(agent.id, saved.id);
  assert.equal(memories.getMemory(saved.id), undefined);
});

test("workspace memories appear only beside global memories for that workspace", () => {
  const first = projects.createProject({ name: "First" });
  const second = projects.createProject({ name: "Second" });
  const global = memories.saveMemory({ agentId: agent.id, content: "Use Remy for durable state." });
  const scoped = memories.saveMemory({
    agentId: agent.id,
    scope: "workspace",
    projectId: first.id,
    content: "First uses a sidecar for QA.",
  });
  memories.saveMemory({
    agentId: agent.id,
    scope: "workspace",
    projectId: second.id,
    content: "Second uses an emulator.",
  });

  assert.deepEqual(
    new Set(memories.listMemories(agent.id, { projectId: first.id }).map((memory) => memory.id)),
    new Set([global.id, scoped.id]),
  );
  assert.equal(memories.listMemories(agent.id, { projectId: first.id }).some((memory) => /emulator/.test(memory.content)), false);
});

test("a new provider run receives synchronized global memories as prompt context", async () => {
  const prompt = await memories.memoryPrompt(agent.id, join(tmpdir(), "not-a-workspace"));
  assert.match(prompt ?? "", /Use Remy for durable state\./);
  assert.doesNotMatch(prompt ?? "", /uses an emulator/);
  assert.match(prompt ?? "", /never save credentials/i);
});
