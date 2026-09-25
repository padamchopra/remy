import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  absWorkingDir: root,
  entryPoints: ["src/lib/pull-request-workspace.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  alias: { "@": resolve(root, "src") },
});
const { hostedOrganizationId, pullRequestTileWorkspace } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const pullRequest = {
  serverId: "github:studio",
  workspaceId: "jupiter",
  workspaceName: "Jupiter",
  workspaceIcon: "globe",
  workspaceTint: "orange",
};

test("a hosted pull request tile uses the live workspace mark when this window has it", () => {
  const tile = pullRequestTileWorkspace(pullRequest, [], [{
    id: "jupiter",
    organizationId: "studio",
    name: "Jupiter iOS",
    icon: "sparkles",
    tint: "violet",
  }]);
  assert.deepEqual(tile, {
    workspace: {
      id: "jupiter",
      organizationId: "studio",
      name: "Jupiter iOS",
      icon: "sparkles",
      tint: "violet",
    },
    name: "Jupiter iOS",
    organizationId: "studio",
  });
});

test("a Mac pull request tile uses the workspace on that computer", () => {
  const tile = pullRequestTileWorkspace(
    { ...pullRequest, serverId: "mac" },
    [{ serverId: "mac", id: "jupiter", name: "Jupiter", icon: "code", tint: "teal" }],
  );
  assert.equal(tile.workspace.icon, "code");
  assert.equal(tile.name, "Jupiter");
  assert.equal(tile.organizationId, undefined);
});

test("the list snapshot is enough when no workspace row is loaded", () => {
  const tile = pullRequestTileWorkspace(pullRequest, [], []);
  assert.deepEqual(tile.workspace, { id: "jupiter", icon: "globe", tint: "orange" });
  assert.equal(tile.name, "Jupiter");
  assert.equal(tile.organizationId, "studio");
});

test("a hosted computer id is the account that listed the pull request", () => {
  assert.equal(hostedOrganizationId("github:studio"), "studio");
  assert.equal(hostedOrganizationId("mac"), undefined);
});
