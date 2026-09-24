import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  absWorkingDir: root,
  entryPoints: ["src/lib/route.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  alias: { "@": resolve(root, "src") },
});
const { formatPathLocation, parseLocation, normalizeLocation } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

test("a hosted thread path names only the thread", () => {
  assert.equal(
    formatPathLocation({
      route: {
        name: "threads",
        threadId: "5af62860-6918-457e-a4ce-3a7ec0f6612c",
        computerId: "pending",
        organizationId: "all",
        ownerOrganizationId: "1ff59e34-6ef6-4bba-96b1-06c1b8bb900d",
      },
    }),
    "/threads/5af62860-6918-457e-a4ce-3a7ec0f6612c",
  );
  assert.equal(
    formatPathLocation({
      route: {
        name: "threads",
        threadId: "thread-1",
        computerId: "studio",
        organizationId: "release",
      },
    }),
    "/threads/thread-1",
  );
});

test("thread lists still narrow with an organization query", () => {
  assert.equal(
    formatPathLocation({ route: { name: "threads", organizationId: "release" } }),
    "/threads?organization=release",
  );
  assert.equal(
    formatPathLocation({ route: { name: "threads", organizationId: "all" } }),
    "/threads",
  );
});

test("a hosted thread can keep a workbench focus without other query", () => {
  assert.equal(
    formatPathLocation({
      route: {
        name: "threads",
        threadId: "thread-1",
        focus: "sub-1",
        organizationId: "all",
      },
    }),
    "/threads/thread-1?focus=sub-1",
  );
});

test("old thread query links still parse, then format clean", () => {
  const parsed = parseLocation(
    "/threads/thread-1?computer=pending&owner=team&organization=all",
  );
  assert.equal(parsed.route.name, "threads");
  assert.equal(parsed.route.threadId, "thread-1");
  assert.equal(parsed.route.computerId, "pending");
  assert.equal(parsed.route.ownerOrganizationId, "team");
  assert.equal(formatPathLocation(parsed), "/threads/thread-1");
});

test("old Inbox links open Settings → Agents", () => {
  const list = parseLocation("/inbox");
  assert.equal(list.route.name, "settings");
  assert.equal(list.route.tab, "agents");
  assert.equal(formatPathLocation(list), "/settings/agents");
  const named = parseLocation("/inbox/remy");
  assert.equal(named.route.name, "settings");
  assert.equal(named.route.tab, "agents");
  assert.equal(named.route.agent, "remy");
  assert.equal(formatPathLocation(named), "/settings/agents?agent=remy");
  const app = parseLocation("/app/inbox");
  assert.equal(app.route.name, "settings");
  assert.equal(app.route.tab, "agents");
  assert.equal(formatPathLocation(app), "/settings/agents");
  const appNamed = parseLocation("/app/inbox/remy");
  assert.equal(appNamed.route.agent, "remy");
  assert.equal(formatPathLocation(appNamed), "/settings/agents?agent=remy");
});

test("a hosted /app/inbox path rewrites before runtime is known", () => {
  const href = { current: "https://app.tryremy.dev/app/inbox" };
  globalThis.window = {
    location: {
      get href() { return href.current; },
      get pathname() { return new URL(href.current).pathname; },
      get search() { return new URL(href.current).search; },
      get hash() { return new URL(href.current).hash; },
    },
    history: {
      replaceState(_state, _title, next) {
        href.current = new URL(next, href.current).href;
      },
    },
  };
  const location = normalizeLocation();
  assert.equal(location.route.name, "settings");
  assert.equal(location.route.tab, "agents");
  assert.equal(new URL(href.current).pathname, "/app/settings/agents");
});
