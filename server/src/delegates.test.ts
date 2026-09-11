import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "remy-delegates-"));
const agents = await import("./agents.js");
const { threadDelegates } = await import("./chat.js");
const { claudeAgents } = await import("./provider-adapters/claude.js");

test("only agents marked available are offered as delegates", () => {
  agents.createAgent({ name: "Reviewer", handle: "reviewer", instructions: "Review carefully.", delegable: true });
  agents.createAgent({ name: "Quiet", handle: "quiet", instructions: "Never called." });

  const handles = threadDelegates("claude").map((delegate) => delegate.handle);
  assert.deepEqual(handles, ["reviewer"]);
});

test("a thread does not delegate to the agent already running it", () => {
  const self = agents.createAgent({ name: "Self", handle: "self", instructions: "Runs the turn.", delegable: true });

  assert.ok(threadDelegates("claude").some((delegate) => delegate.handle === "self"));
  assert.ok(!threadDelegates("claude", self.id).some((delegate) => delegate.handle === "self"));
});

test("a delegate carries no permission mode, so it cannot widen the thread's", () => {
  const bypass = agents.createAgent({
    name: "Bypass",
    handle: "bypass",
    instructions: "Works unattended.",
    permissionMode: "bypassPermissions",
    delegable: true,
  });
  assert.equal(agents.getAgent(bypass.id)?.permissionMode, "bypassPermissions");

  const delegate = threadDelegates("claude").find((row) => row.handle === "bypass")!;
  assert.ok(!Object.keys(delegate).includes("permissionMode"));

  const mapped = claudeAgents([delegate]);
  assert.ok(!Object.keys(mapped.bypass).includes("permissionMode"));
});

test("an agent on another provider lends its instructions, not a model this one would refuse", () => {
  agents.createAgent({
    name: "Codexy",
    handle: "codexy",
    instructions: "Thinks in Codex.",
    provider: "codex",
    model: "gpt-5.5",
    delegable: true,
  });

  const onClaude = threadDelegates("claude").find((row) => row.handle === "codexy")!;
  assert.equal(onClaude.prompt, "Thinks in Codex.");
  assert.equal(onClaude.model, undefined);

  const onCodex = threadDelegates("codex").find((row) => row.handle === "codexy")!;
  assert.equal(onCodex.model, "gpt-5.5");
});

test("a delegate with no instructions still describes itself", () => {
  agents.createAgent({ name: "Bare", handle: "bare", role: "Runs errands", delegable: true });

  const delegate = threadDelegates("claude").find((row) => row.handle === "bare")!;
  assert.equal(delegate.description, "Runs errands");
  assert.equal(delegate.prompt, "You are Bare. Runs errands");
});

test("the description prefers the delegate line over the role", () => {
  agents.createAgent({
    name: "Picky",
    handle: "picky",
    role: "QA engineer",
    delegateDescription: "Use for regression sweeps before a release",
    instructions: "Sweep.",
    delegable: true,
  });

  const delegate = threadDelegates("claude").find((row) => row.handle === "picky")!;
  assert.equal(delegate.description, "Use for regression sweeps before a release");
});

// The roster is built when a provider session starts, so this covers the
// builder and not a live thread: a thread already running keeps the delegates
// it opened with until its session is stopped.
test("a roster built after turning an agent off no longer offers it", () => {
  const reviewer = agents.agentByHandle("reviewer")!;
  agents.updateAgent(reviewer.id, { delegable: false });

  assert.ok(!threadDelegates("claude").some((row) => row.handle === "reviewer"));
});

test("the roster and subagent text reach the Claude SDK", async () => {
  const { createClaudeAdapter } = await import("./provider-adapters/claude.js");
  let captured: Record<string, any> | undefined;
  const adapter = createClaudeAdapter(((input: { options: Record<string, any> }) => {
    captured = input.options;
    return {
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
      interrupt: async () => {},
      close: () => {},
    };
  }) as never);

  const delegates = threadDelegates("claude");
  adapter.createSession(
    { command: "claude", cwd: process.cwd(), permissionMode: "auto", delegates },
    { event: () => {}, approve: async () => "deny" as never, answer: async () => ({}) },
  ).close();

  assert.equal(captured?.forwardSubagentText, true);
  assert.deepEqual(Object.keys(captured!.agents).sort(), delegates.map((row) => row.handle).sort());
  assert.equal(captured!.agents.picky.description, "Use for regression sweeps before a release");
  assert.equal(captured!.agents.picky.prompt, "Sweep.");
});

test("an agent handle does not quietly replace one of Claude's own subagents", () => {
  agents.createAgent({ name: "Explore", handle: "explore", instructions: "Mine.", delegable: true });

  const delegates = threadDelegates("claude");
  assert.ok(delegates.some((row) => row.handle === "explore"), "the roster still carries it");
  assert.equal(claudeAgents(delegates).explore, undefined, "but Claude keeps its own");
});
