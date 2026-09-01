import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const stateDir = mkdtempSync(join(tmpdir(), "remy-directives-"));
process.env.MC_CONFIG_DIR = stateDir;

const agents = await import("./agents.js");
const { REMY_AGENT_ID } = await import("./remy-agent.js");

test("an agent's directives become the block a task is prefixed with", async () => {
  const agent = agents.createAgent({ name: "Engineer", directives: "Build with npm run build." });
  const block = await agents.directivePrompt(agent.id);
  assert.match(block ?? "", /<remy_directive_context>/);
  assert.match(block ?? "", /Build with npm run build\./);
  assert.match(block ?? "", /<\/remy_directive_context>/);
});

test("an agent with nothing to say adds nothing to the turn", async () => {
  const agent = agents.createAgent({ name: "Quiet" });
  assert.equal(await agents.directivePrompt(agent.id), undefined);
  assert.equal(await agents.directivePrompt("nobody"), undefined);
});

test("a linked file is read on every turn, so editing it changes the next one", async () => {
  const path = join(stateDir, "directives.md");
  writeFileSync(path, "Test with npm test.");
  const agent = agents.createAgent({
    name: "Filed",
    directives: "ignored once a file is named",
    directivesPath: path,
  });

  assert.match((await agents.directivePrompt(agent.id)) ?? "", /Test with npm test\./);
  writeFileSync(path, "Test with npm run qa.");
  assert.match((await agents.directivePrompt(agent.id)) ?? "", /Test with npm run qa\./);
});

test("a file that cannot be read still lets the task run, and says so", async () => {
  const agent = agents.createAgent({ name: "Missing", directivesPath: join(stateDir, "gone.md") });
  const block = await agents.directivePrompt(agent.id);
  assert.match(block ?? "", /could not read the directives file/);
});

test("directives have to be a markdown file", () => {
  assert.throws(() => agents.createAgent({ name: "Wrong", directivesPath: "~/notes.txt" }), /markdown/);
});

test("the block is capped so a long file does not ride on every message", async () => {
  const agent = agents.createAgent({ name: "Verbose", directives: "x".repeat(20_000) });
  const block = await agents.directivePrompt(agent.id);
  assert.ok((block?.match(/x+/)?.[0].length ?? 0) <= 8000);
});

test("Remy's own agent takes no directives from a client", () => {
  agents.seedRemyAgent();
  const updated = agents.updateAgent(REMY_AGENT_ID, { directives: "Do as I say.", directivesPath: "~/x.md" });
  assert.equal(updated.directives, undefined);
  assert.equal(updated.directivesPath, undefined);
});

test("clearing directives reads back as unset rather than as an empty rule", () => {
  const agent = agents.createAgent({ name: "Cleared", directives: "Something." });
  assert.equal(agents.updateAgent(agent.id, { directives: "" }).directives, undefined);
});
