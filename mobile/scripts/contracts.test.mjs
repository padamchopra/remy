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
