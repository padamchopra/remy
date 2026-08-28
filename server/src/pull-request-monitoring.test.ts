import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "remy-pr-monitoring-"));
const agents = await import("./agents.js");
const config = await import("./config.js");
const monitoring = await import("./pull-request-monitoring.js");
const workspaces = await import("./workspaces.js");

const folder = mkdtempSync(join(tmpdir(), "remy-pr-workspace-"));
const workspace = await workspaces.addWorkspace("Example", folder);
const first = agents.createAgent({ name: "Builder", handle: "builder" });
const second = agents.createAgent({ name: "QA", handle: "qa" });

test("monitoring inherits from Remy through workspace and pull request scopes", async () => {
  config.patchSettings({ pullRequestMonitoringEnabled: true, pullRequestMonitoringAgentId: first.id });
  assert.deepEqual(monitoring.workspacePullRequestMonitoring(workspace.id), {
    enabled: true,
    agentId: first.id,
    source: "default",
    explicit: false,
  });

  await monitoring.setWorkspacePullRequestMonitoring(workspace.id, { enabled: true, agentId: second.id });
  assert.equal(monitoring.pullRequestMonitoring(workspace.id, "owner/repo", 42).agentId, second.id);
  assert.equal(monitoring.pullRequestMonitoring(workspace.id, "owner/repo", 42).explicit, false);

  monitoring.setPullRequestMonitoring(workspace.id, "owner/repo", 42, { enabled: false, agentId: first.id });
  assert.deepEqual(monitoring.pullRequestMonitoring(workspace.id, "OWNER/REPO", 42), {
    enabled: false,
    agentId: first.id,
    source: "pull-request",
    explicit: true,
  });

  monitoring.resetPullRequestMonitoring(workspace.id, "owner/repo", 42);
  assert.equal(monitoring.pullRequestMonitoring(workspace.id, "owner/repo", 42).agentId, second.id);
  await monitoring.resetWorkspacePullRequestMonitoring(workspace.id);
  assert.equal(monitoring.pullRequestMonitoring(workspace.id, "owner/repo", 42).agentId, first.id);
});

test("deleting a selected agent turns every matching policy off", async () => {
  config.patchSettings({ pullRequestMonitoringEnabled: true, pullRequestMonitoringAgentId: first.id });
  await monitoring.setWorkspacePullRequestMonitoring(workspace.id, { enabled: true, agentId: first.id });
  monitoring.setPullRequestMonitoring(workspace.id, "owner/repo", 9, { enabled: true, agentId: first.id });

  agents.deleteAgent(first.id);
  monitoring.clearAgentPullRequestMonitoring(first.id);

  assert.equal(config.config.pullRequestMonitoringEnabled, false);
  assert.deepEqual(workspaces.workspaceMonitoringOverride(workspace.id), { enabled: false, agentId: null });
  assert.deepEqual(monitoring.pullRequestMonitoring(workspace.id, "owner/repo", 9), {
    enabled: false,
    agentId: null,
    source: "pull-request",
    explicit: true,
  });
});
