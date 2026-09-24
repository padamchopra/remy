import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  absWorkingDir: root,
  entryPoints: ["src/lib/hub-workspace-cache.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  alias: { "@": resolve(root, "src") },
});
const {
  HUB_WORKSPACE_CACHE_BOUNDS,
  HUB_WORKSPACE_CACHE_KEY,
  cacheHubWorkspaces,
  cachedHubWorkspaces,
  clearHubWorkspaceCache,
  hasCachedHubWorkspaces,
  hasCachedHubWorkspacesFor,
} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function storage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

function workspace(id, patch = {}) {
  return { id, organizationId: "personal", name: `Workspace ${id}`, origin: `https://github.com/example/${id}`, ...patch };
}

test.beforeEach(() => {
  clearHubWorkspaceCache(storage());
});

test("remembers a successful list and treats an empty save as known", () => {
  const kept = storage();
  clearHubWorkspaceCache(kept);
  assert.equal(hasCachedHubWorkspaces("personal", kept), false);
  assert.deepEqual(cachedHubWorkspaces("personal", kept), []);

  cacheHubWorkspaces("personal", [workspace("repo")], kept);
  assert.equal(hasCachedHubWorkspaces("personal", kept), true);
  assert.deepEqual(cachedHubWorkspaces("personal", kept).map((row) => row.id), ["repo"]);
  assert.equal(hasCachedHubWorkspacesFor(["team", "personal"], kept), true);

  cacheHubWorkspaces("personal", [], kept);
  assert.equal(hasCachedHubWorkspaces("personal", kept), true);
  assert.deepEqual(cachedHubWorkspaces("personal", kept), []);
});

test("opens from the stored copy and drops another schema or a bad row", () => {
  const kept = storage({
    [HUB_WORKSPACE_CACHE_KEY]: JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      byOrganization: {
        personal: [workspace("repo"), { id: "gone" }, null],
        team: [workspace("studio", { organizationId: "team" })],
      },
    }),
  });
  clearHubWorkspaceCache(storage());
  assert.deepEqual(cachedHubWorkspaces("personal", kept).map((row) => row.id), ["repo"]);
  assert.equal(hasCachedHubWorkspaces("team", kept), true);

  const stale = storage({
    [HUB_WORKSPACE_CACHE_KEY]: JSON.stringify({
      version: 0,
      savedAt: Date.now(),
      byOrganization: { personal: [workspace("repo")] },
    }),
  });
  clearHubWorkspaceCache(storage());
  assert.equal(hasCachedHubWorkspaces("personal", stale), false);
});

test("bounds the stored list and keeps an in-memory copy when storage fails", () => {
  const kept = storage();
  clearHubWorkspaceCache(kept);
  const many = Array.from({ length: HUB_WORKSPACE_CACHE_BOUNDS.workspaces + 8 }, (_, index) => workspace(`w${index}`));
  cacheHubWorkspaces("personal", many, kept);
  assert.equal(cachedHubWorkspaces("personal", kept).length, HUB_WORKSPACE_CACHE_BOUNDS.workspaces);

  const failing = {
    getItem: () => null,
    setItem: () => { throw new Error("quota"); },
    removeItem: () => {},
  };
  cacheHubWorkspaces("team", [workspace("studio", { organizationId: "team" })], failing);
  assert.equal(hasCachedHubWorkspaces("team", failing), true);
});
