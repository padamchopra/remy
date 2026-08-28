import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "remy-agent-presets-"));
const agents = await import("./agents.js");
const log = await import("./board-log.js");

test("untouched legacy defaults upgrade to the PM, Builder, and QA chain", () => {
  agents.createAgent({ name: "Scout", handle: "scout", preset: "scout", handoffTo: ["builder"] });
  agents.createAgent({ name: "Builder", handle: "builder", preset: "builder", handoffTo: ["critic"] });
  agents.createAgent({ name: "Critic", handle: "critic", preset: "critic", handoffTo: ["builder"] });
  agents.createAgent({ name: "Triager", handle: "triager", preset: "triager" });
  agents.createAgent({
    name: "GitHub",
    handle: "github",
    role: "Keeps your pull requests moving",
    preset: "github",
    autoStart: true,
  });

  agents.seedPresetAgents();

  assert.equal(agents.agentByHandle("scout"), undefined);
  assert.equal(agents.agentByHandle("critic"), undefined);
  assert.equal(agents.agentByHandle("pm")?.handoffTo[0], "builder");
  assert.equal(agents.agentByHandle("builder")?.handoffTo[0], "qa");
  assert.equal(agents.agentByHandle("qa")?.handoffTo[0], "builder");
  assert.equal(agents.agentByHandle("github")?.role, "Keeps your pull requests moving");
  assert.equal(agents.agentByHandle("github")?.autoStart, false);
  assert.equal(agents.agentByHandle("github")?.monitorPullRequests, false);
  assert.ok(agents.agentByHandle("triager"), "an existing Triager should not be deleted");
});

test("an explicit GitHub agent auto-start choice survives preset seeding", () => {
  const github = agents.agentByHandle("github")!;
  agents.updateAgent(github.id, { autoStart: true });

  agents.seedPresetAgents();

  assert.equal(agents.agentByHandle("github")?.autoStart, true);
});

test("pull request monitoring stays off until it is enabled", () => {
  const github = agents.agentByHandle("github")!;
  assert.equal(github.monitorPullRequests, false);

  agents.updateAgent(github.id, { monitorPullRequests: true });
  agents.seedPresetAgents();

  assert.equal(agents.agentByHandle("github")?.monitorPullRequests, true);
});

test("built-in agents seeded on two devices converge to one roster", () => {
  const duplicateId = "builder-from-another-device";
  log.append("agent", duplicateId, "create", {
    name: "Builder",
    handle: "builder",
    preset: "builder",
  });
  agents.reproject(duplicateId);

  agents.seedPresetAgents();

  assert.equal(agents.listAgents().filter((agent) => agent.preset === "builder").length, 1);
  assert.equal(agents.getAgent(duplicateId), undefined);
  assert.equal(log.eventsFor("agent", duplicateId).at(-1)?.kind, "tombstone");
});
