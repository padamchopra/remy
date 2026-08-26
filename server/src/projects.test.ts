import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const stateDir = mkdtempSync(join(tmpdir(), "remy-projects-test-"));
process.env.MC_CONFIG_DIR = stateDir;
process.env.HOME = stateDir;

const {
  adoptWorkspace,
  listProjects,
  projectForWorkspace,
  unbindWorkspace,
} = await import("./projects.js");

function workspace(id: string, origin: string | null) {
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
