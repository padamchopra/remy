// The rules the phone has to hold to on its own: a provider and a model are one
// choice, an effort belongs to that exact pair, and an agent's conversation
// lives on the device the preference order picks.
//
// The modules under test import nothing at runtime — every import in them is
// `import type` — so Node's own type stripping is enough to load them without a
// bundler. Skipped rather than failed on a Node that cannot strip types.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const load = (path) => import(pathToFileURL(join(src, path)).href);
const stripping = process.features.typescript !== false;
const options = stripping ? {} : { skip: "This Node cannot strip TypeScript types." };

test("pairing failures tell the phone how to recover", options, async () => {
  const { pairingError } = await load("lib/api-error.ts");
  assert.equal(pairingError(new Error("Network request failed")), "Open Tailscale on this iPhone and try again.");
  assert.equal(
    pairingError(Object.assign(new Error("unauthorized"), { status: 401 })),
    "Scan a new pairing QR and try again.",
  );
  assert.equal(pairingError(new Error("That Mac isn't running Remy.")), "That Mac isn't running Remy.");
});

test("a relayed device survives a phone restart when discovery is temporarily unavailable", options, async () => {
  const {
    parsePeerCatalogues,
    rememberPeerCatalogue,
    retainPeerCatalogues,
    serializePeerCatalogues,
  } = await load("lib/peer-catalogue.ts");
  const first = rememberPeerCatalogue({}, "https://home.tailnet/", [{
    id: "studio",
    name: "Studio",
    url: "https://studio.tailnet/",
    icon: "monitor",
    notify: false,
    online: true,
    lastSeen: 123,
  }]);
  assert.equal(first.changed, true);

  const restored = parsePeerCatalogues(serializePeerCatalogues(first.catalogues));
  assert.deepEqual(restored, {
    "https://home.tailnet": [{
      id: "studio",
      name: "Studio",
      url: "https://studio.tailnet",
      icon: "monitor",
      notify: false,
    }],
  });

  const removed = rememberPeerCatalogue(restored, "https://home.tailnet", []);
  assert.equal(removed.changed, true);
  assert.deepEqual(removed.catalogues, {});

  const unpaired = retainPeerCatalogues(restored, new Set());
  assert.equal(unpaired.changed, true);
  assert.deepEqual(unpaired.catalogues, {});
});

test("message images accept only formats the daemon validates", options, async () => {
  const { extensionFor, imageMimeType } = await load("lib/message-attachments.ts");
  assert.equal(imageMimeType("image/png"), "image/png");
  assert.equal(imageMimeType(undefined, "photo.JPEG"), "image/jpeg");
  assert.equal(imageMimeType("image/heic", "photo.heic"), undefined);
  assert.equal(extensionFor("image/jpeg"), "jpg");
  assert.equal(extensionFor("image/webp"), "webp");
});

test("phone board moves mint ranks between the same neighbours as desktop", options, async () => {
  const { neighboursAt } = await load("lib/tickets.ts");
  const tickets = [
    { id: "a", parentId: undefined, status: "todo", rank: "b", createdAt: 1 },
    { id: "b", parentId: undefined, status: "todo", rank: "m", createdAt: 2 },
    { id: "c", parentId: undefined, status: "todo", rank: "t", createdAt: 3 },
    { id: "child", parentId: "a", status: "todo", rank: "c", createdAt: 4 },
  ];
  assert.deepEqual(neighboursAt(tickets, "todo", 0, "c"), { before: undefined, after: "b" });
  assert.deepEqual(neighboursAt(tickets, "todo", 2, "b"), { before: "t", after: undefined });
});

test("pull requests from several computers collapse and keep desktop stack order", options, async () => {
  const { mergePullRequests, pullRequestAttention } = await load("lib/pull-requests.ts");
  const row = (url, serverId, extra = {}) => ({
    url, serverId, number: 1, title: "One", repository: "acme/repo", headRefName: "one",
    state: "OPEN", body: "", baseRefName: "main", isDraft: false, reviewDecision: "",
    authorLogin: "me", updatedAt: "2026-09-01T00:00:00Z", additions: 1, deletions: 0,
    changedFiles: 1, checks: [], comments: [], unreadComments: [], hasUnreadActivity: false,
    workspaceId: "workspace", workspaceName: "Repo", workspacePath: "/repo", worktreePath: null,
    ...extra,
  });
  const merged = mergePullRequests([
    row("https://github.com/acme/repo/pull/1", "laptop"),
    row("https://github.com/acme/repo/pull/1", "studio", { worktreePath: "/repo/one" }),
    row("https://github.com/acme/repo/pull/2", "laptop", { number: 2, title: "Two", updatedAt: "2026-09-02T00:00:00Z", stack: { number: 7, position: 1, size: 2, baseRefName: "main" } }),
    row("https://github.com/acme/repo/pull/3", "laptop", { number: 3, title: "Three", updatedAt: "2026-09-03T00:00:00Z", stack: { number: 7, position: 2, size: 2, baseRefName: "two" } }),
  ]);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.slice(0, 2).map((entry) => entry.number), [3, 2]);
  assert.equal(merged[2].serverId, "studio");
  assert.deepEqual(merged[2].sourceServerIds.sort(), ["laptop", "studio"]);
  assert.equal(pullRequestAttention(row("x", "laptop", { checks: [{ name: "CI", state: "fail" }] })), "failing");
});

test("deep links address every durable iPhone destination", options, async () => {
  const { navigationDestination, notificationDestination, storedDestination } = await load("lib/navigation-destination.ts");
  assert.deepEqual(navigationDestination("remy://thread/chat-1?server=studio"), { kind: "thread", id: "chat-1", serverId: "studio" });
  assert.deepEqual(navigationDestination("remy://agent/reviewer"), { kind: "agent", id: "reviewer" });
  assert.deepEqual(navigationDestination("remy://workspace/repo?server=laptop"), { kind: "workspace", id: "repo", serverId: "laptop" });
  assert.deepEqual(navigationDestination("remy://ticket/remy-27"), { kind: "ticket", key: "REMY-27" });
  assert.deepEqual(navigationDestination("remy://pull-request/acme/repo/42?server=studio"), { kind: "pull-request", repository: "acme/repo", number: 42, serverId: "studio" });
  assert.deepEqual(navigationDestination("remy://settings/studio"), { kind: "settings", serverId: "studio" });
  assert.deepEqual(navigationDestination("remy://prs"), { kind: "section", section: "prs" });
  assert.deepEqual(navigationDestination("remy://tasks"), { kind: "section", section: "board" });
  assert.equal(navigationDestination("https://example.com"), undefined);
  assert.deepEqual(notificationDestination({ session: "chat-1", deviceId: "studio" }), { kind: "thread", id: "chat-1", serverId: "studio" });
  assert.deepEqual(storedDestination({ kind: "ticket", key: "REMY-27", ignored: "value" }), { kind: "ticket", key: "REMY-27" });
  assert.equal(storedDestination({ kind: "thread" }), undefined);
});

test("a reachable relayed computer becomes an independent phone pairing", options, async () => {
  const { directPairingForPeer, pairingServerId, upsertFleetPairing } = await load("lib/fleet-pairing.ts");
  const learned = directPairingForPeer(
    { id: "studio", name: "Studio", url: "https://old-studio.tailnet" },
    { deviceId: "studio", name: "Studio Mac", url: "https://studio.tailnet/", token: "studio-token" },
  );
  assert.deepEqual(learned, {
    deviceId: "studio",
    name: "Studio Mac",
    url: "https://studio.tailnet",
    token: "studio-token",
  });
  assert.equal(pairingServerId(learned), "studio");

  const moved = upsertFleetPairing(
    [{ deviceId: "studio", name: "Old", url: "https://old-studio.tailnet", token: "old-token" }],
    learned,
  );
  assert.deepEqual(moved, [learned]);
  assert.equal(
    directPairingForPeer(
      { id: "studio", name: "Studio", url: "https://studio.tailnet" },
      { deviceId: "someone-else", url: "https://studio.tailnet", token: "token" },
    ),
    undefined,
  );
});

test("a model that belongs to another provider becomes that provider's default", options, async () => {
  const { PROVIDERS, pairChoice } = await load("lib/providers.ts");
  assert.deepEqual(
    pairChoice(PROVIDERS, { provider: "codex", model: "sonnet", effort: "high" }),
    { provider: "codex", model: "", effort: "high" },
  );
});

test("an effort the pair does not offer is dropped", options, async () => {
  const { PROVIDERS, pairChoice } = await load("lib/providers.ts");
  // `ultra` is Codex's alone.
  assert.deepEqual(
    pairChoice(PROVIDERS, { provider: "claude", model: "opus", effort: "ultra" }),
    { provider: "claude", model: "opus", effort: "" },
  );
  assert.deepEqual(
    pairChoice(PROVIDERS, { provider: "codex", model: "gpt-5.5", effort: "ultra" }),
    { provider: "codex", model: "gpt-5.5", effort: "ultra" },
  );
});

test("a Cursor alias from the installed CLI survives a catalogue that never saw it", options, async () => {
  const { PROVIDERS, pairChoice } = await load("lib/providers.ts");
  assert.equal(pairChoice(PROVIDERS, { provider: "cursor", model: "sonnet-4.5-thinking" }).model, "sonnet-4.5-thinking");
  assert.equal(pairChoice(PROVIDERS, { provider: "claude", model: "sonnet-4.5-thinking" }).model, "");
});

test("an unknown provider keeps its id and loses the pair", options, async () => {
  const { PROVIDERS, pairChoice, providerOf } = await load("lib/providers.ts");
  // `providerOf` falls back to the first provider for a picker that has to
  // paint something; `pairChoice` must not silently move a thread's provider.
  assert.equal(providerOf(PROVIDERS, "nope")?.id, "claude");
  assert.deepEqual(
    pairChoice([], { provider: "nope", model: "x", effort: "high" }),
    { provider: "nope", model: "", effort: "" },
  );
});

test("a label says the provider when the model is that provider's default", options, async () => {
  const { PROVIDERS, effortLabel, modelLabel } = await load("lib/providers.ts");
  assert.equal(modelLabel(PROVIDERS, { provider: "codex", model: "" }), "Codex default");
  assert.equal(modelLabel(PROVIDERS, { provider: "claude", model: "sonnet" }), "Sonnet 5 (200K)");
  assert.equal(effortLabel(PROVIDERS, { provider: "claude", model: "opus" }), "Default effort");
  assert.equal(effortLabel(PROVIDERS, { provider: "claude", model: "opus", effort: "xhigh" }), "Extra high");
});

test("a Mac that never said which providers it offers offers all of them", options, async () => {
  const { PROVIDERS, offeredProviders } = await load("lib/providers.ts");
  assert.equal(offeredProviders(PROVIDERS).length, PROVIDERS.length);
  const answered = PROVIDERS.map((entry) => ({ ...entry, enabled: entry.id === "codex", available: true }));
  assert.deepEqual(offeredProviders(answered).map((entry) => entry.id), ["codex"]);
  // Nothing left is not an answer anybody can use, so the whole list stands.
  const none = PROVIDERS.map((entry) => ({ ...entry, available: false }));
  assert.equal(offeredProviders(none).length, PROVIDERS.length);
});

const server = (id, extra = {}) => ({
  id,
  name: id,
  url: `http://${id}`,
  code: id.slice(0, 2).toUpperCase(),
  online: true,
  icon: "laptop",
  ...extra,
});

const dm = (id, serverId, extra = {}) => ({
  id,
  serverId,
  title: "Remy",
  cwd: "~",
  state: "idle",
  updatedAt: 1,
  dm: true,
  agentId: "remy-agent",
  ...extra,
});

test("device preference order decides which Mac runs device-agnostic work", options, async () => {
  const { preferredServer } = await load("lib/inbox.ts");
  const servers = [server("laptop", { home: true }), server("studio", { peer: true })];
  assert.equal(preferredServer(servers)?.id, "laptop");
  assert.equal(preferredServer(servers, ["studio", "laptop"])?.id, "studio");
});

test("a workspace-only device never runs an agent's conversation", options, async () => {
  const { availableAgentServers, preferredServer } = await load("lib/inbox.ts");
  const servers = [server("cloud", { cloud: true, workspaceOnly: true }), server("laptop", { home: true })];
  assert.deepEqual(availableAgentServers(servers).map((entry) => entry.id), ["laptop"]);
  assert.equal(preferredServer(servers, ["cloud"])?.id, "laptop");
});

test("an agent replicated to two Macs still has one conversation", options, async () => {
  const { agentConversation } = await load("lib/inbox.ts");
  const servers = [server("laptop", { home: true }), server("studio", { peer: true })];
  const dms = [dm("a", "laptop"), dm("b", "studio")];
  assert.equal(agentConversation("remy-agent", dms, servers)?.id, "a");
  assert.equal(agentConversation("remy-agent", dms, servers, ["studio"])?.id, "b");
  // Something waiting on you outranks the preference order.
  assert.equal(agentConversation("remy-agent", [dm("a", "laptop"), dm("b", "studio", { unread: true })], servers)?.id, "b");
});

test("a conversation on an unreachable Mac loses to one that can answer", options, async () => {
  const { agentConversation } = await load("lib/inbox.ts");
  const servers = [server("laptop", { home: true }), server("studio", { peer: true, online: false })];
  const dms = [dm("stale", "studio", { unread: true }), dm("live", "laptop")];
  assert.equal(agentConversation("remy-agent", dms, servers)?.id, "live");
});

test("a routine's schedule reads as a sentence", options, async () => {
  const { cadenceSummary } = await load("lib/routines.ts");
  assert.match(cadenceSummary({ cadence: "weekdays", hour: 9, minute: 0 }), /^Every weekday at /);
  assert.match(cadenceSummary({ cadence: "weekly", hour: 9, minute: 0, weekday: 3 }), /^Every Wednesday at /);
  assert.match(cadenceSummary({ cadence: "monthly", hour: 9, minute: 0, day: 4 }), /^Day 4 of the month at /);
});

test("a routine's last attempt keeps its day and time", options, async () => {
  const { whenLast } = await load("lib/routines.ts");
  const now = new Date(2026, 8, 3, 18, 0).getTime();
  assert.match(whenLast(new Date(2026, 8, 3, 9, 5).getTime(), now), /^Today at /);
  assert.match(whenLast(new Date(2026, 8, 2, 9, 5).getTime(), now), /^Yesterday at /);
  assert.match(whenLast(new Date(2026, 7, 28, 9, 5).getTime(), now), /^(28 Aug|Aug 28) at /);
});

test("hub notification taps preserve organization ownership and never open a local thread", options, async () => {
  const { hubNotificationUrl, notificationDestination } = await load("lib/navigation-destination.ts");
  const data = { hubUrl: "https://teams.example.com", organizationId: "release", computerId: "studio", threadId: "thread-1" };
  assert.equal(hubNotificationUrl(data), "https://teams.example.com/#/threads/thread-1?organization=release&computer=studio");
  assert.equal(notificationDestination(data), undefined);
  assert.equal(hubNotificationUrl({ ...data, hubUrl: "http://unsafe.example.com" }), undefined);
  assert.equal(hubNotificationUrl({ ...data, hubUrl: "https://user:password@teams.example.com" }), undefined);
});
