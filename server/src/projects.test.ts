import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Workspace } from "./workspaces.js";

const stateDir = mkdtempSync(join(tmpdir(), "remy-projects-test-"));
process.env.MC_CONFIG_DIR = stateDir;
process.env.HOME = stateDir;

const {
  adoptWorkspace,
  listProjects,
  projectForWorkspace,
  unbindWorkspace,
  updateProject,
} = await import("./projects.js");

function workspace(id: string, origin: string | null): Workspace {
  return {
    id,
    name: "Remy",
    path: `/code/${id}`,
    origin,
    icon: null,
    tint: null,
    provider: null,
    model: null,
    effort: null,
    worktrees: [],
  };
}

test("links checkouts with the same Git origin to one project", () => {
  const first = adoptWorkspace(workspace("macbook", "github.com/padam/remy"));
  const second = adoptWorkspace(workspace("studio", "github.com/padam/remy"));

  assert.equal(second.id, first.id);
  assert.deepEqual(listProjects()[0]?.workspaceIds.sort(), ["macbook", "studio"]);
});

test("keeps a repository icon and tint on the shared project", () => {
  const first = workspace("icon-macbook", "github.com/padam/icons");
  first.icon = "sparkles";
  first.tint = "violet";
  const project = adoptWorkspace(first);
  const second = adoptWorkspace(workspace("icon-studio", "github.com/padam/icons"));

  assert.equal(second.id, project.id);
  assert.equal(second.icon, "sparkles");
  assert.equal(second.tint, "violet");

  const updated = updateProject(project.id, { icon: "code", tint: "blue" });
  assert.equal(updated.icon, "code");
  assert.equal(updated.tint, "blue");
});

test("does not resurrect a local icon after the shared icon is cleared", () => {
  const local = workspace("cleared-icon", "github.com/padam/cleared-icon");
  local.icon = "sparkles";
  const project = adoptWorkspace(local);
  updateProject(project.id, { icon: null });

  assert.equal(adoptWorkspace(local).icon, null);
});

test("keeps ordinary folders device-local", () => {
  const first = adoptWorkspace(workspace("folder-one", null));
  const second = adoptWorkspace(workspace("folder-two", null));

  assert.notEqual(second.id, first.id);
});

test("removing a checkout leaves the repository project intact", () => {
  const project = adoptWorkspace(workspace("temporary", "github.com/padam/other"));
  unbindWorkspace("temporary");

  assert.equal(projectForWorkspace("temporary"), undefined);
  assert.equal(listProjects().some((entry) => entry.id === project.id), true);
});
