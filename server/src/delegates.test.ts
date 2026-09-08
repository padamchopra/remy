import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "remy-delegates-"));
const agents = await import("./agents.js");
const { threadDelegates } = await import("./chat.js");
const { claudeAgents } = await import("./provider-adapters/claude.js");

const memories = await import("./agent-memories.js");

const cwd = process.cwd();

test("only agents marked available are offered as delegates", async () => {
  agents.createAgent({ name: "Reviewer", handle: "reviewer", instructions: "Review carefully.", delegable: true });
  agents.createAgent({ name: "Quiet", handle: "quiet", instructions: "Never called." });

  const handles = (await threadDelegates("claude", cwd)).map((delegate) => delegate.handle);
  assert.deepEqual(handles, ["reviewer"]);
});

test("a thread does not delegate to the agent already running it", async () => {
  const self = agents.createAgent({ name: "Self", handle: "self", instructions: "Runs the turn.", delegable: true });

  assert.ok((await threadDelegates("claude", cwd)).some((delegate) => delegate.handle === "self"));
  assert.ok(!(await threadDelegates("claude", cwd, self.id)).some((delegate) => delegate.handle === "self"));
});

test("a delegate carries no permission mode, so it cannot widen the thread's", async () => {
  const bypass = agents.createAgent({
    name: "Bypass",
    handle: "bypass",
    instructions: "Works unattended.",
    permissionMode: "bypassPermissions",
    delegable: true,
  });
  assert.equal(agents.getAgent(bypass.id)?.permissionMode, "bypassPermissions");

  const delegate = (await threadDelegates("claude", cwd)).find((row) => row.handle === "bypass")!;
  assert.ok(!Object.keys(delegate).includes("permissionMode"));

  const mapped = claudeAgents([delegate]);
  assert.ok(!Object.keys(mapped.bypass).includes("permissionMode"));
});

test("an agent on another provider lends its instructions, not a model this one would refuse", async () => {
  agents.createAgent({
    name: "Codexy",
    handle: "codexy",
    instructions: "Thinks in Codex.",
    provider: "codex",
    model: "gpt-5.5",
    delegable: true,
  });

  const onClaude = (await threadDelegates("claude", cwd)).find((row) => row.handle === "codexy")!;
  assert.equal(onClaude.prompt, "Thinks in Codex.");
  assert.equal(onClaude.model, undefined);

  const onCodex = (await threadDelegates("codex", cwd)).find((row) => row.handle === "codexy")!;
  assert.equal(onCodex.model, "gpt-5.5");
});

test("a delegate with no instructions still describes itself", async () => {
  agents.createAgent({ name: "Bare", handle: "bare", role: "Runs errands", delegable: true });

  const delegate = (await threadDelegates("claude", cwd)).find((row) => row.handle === "bare")!;
  assert.equal(delegate.description, "Runs errands");
  assert.equal(delegate.prompt, "You are Bare. Runs errands");
});

test("the description prefers the delegate line over the role", async () => {
  agents.createAgent({
    name: "Picky",
    handle: "picky",
    role: "QA engineer",
    delegateDescription: "Use for regression sweeps before a release",
    instructions: "Sweep.",
    delegable: true,
  });

  const delegate = (await threadDelegates("claude", cwd)).find((row) => row.handle === "picky")!;
  assert.equal(delegate.description, "Use for regression sweeps before a release");
});

test("turning an agent off takes it back out of the roster", async () => {
  const reviewer = agents.agentByHandle("reviewer")!;
  agents.updateAgent(reviewer.id, { delegable: false });

  assert.ok(!(await threadDelegates("claude", cwd)).some((row) => row.handle === "reviewer"));
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

  const delegates = await threadDelegates("claude", cwd);
  adapter.createSession(
    { command: "claude", cwd: process.cwd(), permissionMode: "auto", delegates },
    { event: () => {}, approve: async () => "deny" as never, answer: async () => ({}) },
  ).close();

  assert.equal(captured?.forwardSubagentText, true);
  assert.deepEqual(Object.keys(captured!.agents).sort(), delegates.map((row) => row.handle).sort());
  assert.equal(captured!.agents.picky.description, "Use for regression sweeps before a release");
  assert.equal(captured!.agents.picky.prompt, "Sweep.");
});

test("an agent handle does not quietly replace one of Claude's own subagents", async () => {
  agents.createAgent({ name: "Explore", handle: "explore", instructions: "Mine.", delegable: true });

  const delegates = await threadDelegates("claude", cwd);
  assert.ok(delegates.some((row) => row.handle === "explore"), "the roster still carries it");
  assert.equal(claudeAgents(delegates).explore, undefined, "but Claude keeps its own");
});

test("a delegate brings the memories it saved in earlier runs", async () => {
  const scribe = agents.createAgent({
    name: "Scribe",
    handle: "scribe",
    instructions: "Write things down.",
    delegable: true,
  });
  memories.saveMemory({ agentId: scribe.id, content: "The release branch is cut on Fridays." });

  const delegate = (await threadDelegates("claude", cwd)).find((row) => row.handle === "scribe")!;
  assert.match(delegate.prompt, /Write things down\./);
  assert.match(delegate.prompt, /release branch is cut on Fridays/);
});
