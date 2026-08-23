import { randomUUID } from "node:crypto";
import { append, applyFields, entityIds, eventsFor } from "./board-log.js";
import type { ChatPermissionMode } from "./chat.js";
import { config } from "./config.js";
import { db, runTransaction } from "./db.js";
import { providerEffort, providerId, providerModel, type ProviderId } from "./providers.js";
import {
  REMY_AGENT_HANDLE,
  REMY_AGENT_ID,
  REMY_AGENT_INSTRUCTIONS,
  REMY_AGENT_NAME,
  REMY_AGENT_PRESET,
  REMY_AGENT_ROLE,
} from "./remy-agent.js";

// An agent is a thread with a character on the front: the same Claude, the same
// worktree, the same feed, started with its instructions appended to the preset
// and its own name on the commits it makes.
//
// Note the type-only import above. `chat.ts` reads agents to build its options,
// so importing anything from it at runtime would close a cycle around a module
// that loads every chat at import time. Types are erased; the permission modes
// below are the one small duplication that buys that.

export const REMY_DEFAULT = "default";

export type AgentProvider = ProviderId | typeof REMY_DEFAULT;
export type GitIdentityMode = typeof REMY_DEFAULT | "off" | "author";

export interface Agent {
  id: string;
  name: string;
  /// Lowercase, unique. What `ticket_handoff` takes and what the CLI will.
  handle: string;
  role?: string;
  instructions: string;
  /// `default` follows this machine's thread default when a thread starts.
  provider: AgentProvider;
  /// In its provider's own naming. Absent leaves the choice to whatever that
  /// tool is configured with.
  model?: string;
  effort?: string;
  permissionMode: ChatPermissionMode;
  avatar?: string;
  tint?: string;
  autoStart: boolean;
  /// Handles this agent may pass a ticket to. Empty means it may not hand off.
  handoffTo: string[];
  gitIdentity: GitIdentityMode;
  gitName?: string;
  /// Read-only: `agentGitEmail` derives this from the handle and the GitHub
  /// account, so nothing sets it and no client can send it.
  gitEmail?: string;
  /// The preset this was seeded from, so seeding runs once and never again.
  preset?: string;
  /// Read-only: Remy's own agent. Its name, handle, role and instructions come
  /// from the running copy of Remy rather than from you, and it cannot be
  /// deleted — there would be nobody left to ask about Remy.
  builtIn?: boolean;
  createdAt: number;
  updatedAt: number;
}

const PERMISSION_MODES: ChatPermissionMode[] = [
  "default",
  "auto",
  "acceptEdits",
  "plan",
  "bypassPermissions",
];
const GIT_IDENTITIES: GitIdentityMode[] = [REMY_DEFAULT, "off", "author"];

const EDITABLE = [
  "name",
  "handle",
  "role",
  "instructions",
  "provider",
  "model",
  "effort",
  "permissionMode",
  "avatar",
  "tint",
  "autoStart",
  "handoffTo",
  "gitIdentity",
  "gitName",
] as const;

/// What a built-in agent will not take from a client. Everything left over —
/// its provider, its model, what it may do without asking, its face — is the
/// part that is a preference rather than an identity.
const LOCKED = ["name", "handle", "role", "instructions", "handoffTo", "gitIdentity", "gitName"] as const;

/// A handle lives in a tool call and a commit trailer, so it is held to
/// something short that needs no quoting.
export function agentHandle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return cleaned || undefined;
}

/// The address on an agent's commits: its handle at whoever's machine it ran
/// on, so `git log` reads `planner@padamchopra.invalid` and says both which
/// agent wrote the commit and whose account stood behind it.
///
/// Derived rather than stored, so it follows a renamed handle and fills itself
/// in the moment `gh` can say who you are. `.invalid` is reserved by RFC 2606
/// and can never reach a mailbox or resolve, so no forge quietly maps an agent
/// onto somebody's real account — attribution, never an identity claim.
export function agentGitEmail(handle: string): string {
  return `${handle}@${config.githubLogin || "remy"}.invalid`;
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function gitIdentity(value: unknown, fallback: GitIdentityMode): GitIdentityMode {
  // `full` is the retired agent-as-committer mode. Treat old events and clients
  // as agent attribution so history converges without preserving that option.
  if (value === "full") return "author";
  return oneOf(GIT_IDENTITIES, value, fallback);
}

function agentProvider(value: unknown, fallback: AgentProvider = REMY_DEFAULT): AgentProvider {
  if (value === REMY_DEFAULT) return REMY_DEFAULT;
  if (value === "claude" || value === "codex" || value === "cursor") return value;
  return fallback;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

// ── projection ──────────────────────────────────────────────────────────────

function fold(id: string): Agent | undefined {
  const events = eventsFor("agent", id);
  if (events.length === 0) return undefined;
  let agent: Agent | undefined;
  for (const event of events) {
    if (event.kind === "tombstone") return undefined;
    if (event.kind === "create") {
      agent = {
        id,
        name: String(event.payload.name ?? "Agent"),
        handle: String(event.payload.handle ?? "agent"),
        instructions: String(event.payload.instructions ?? ""),
        provider: agentProvider(event.payload.provider),
        permissionMode: oneOf(PERMISSION_MODES, event.payload.permissionMode, "default"),
        autoStart: event.payload.autoStart !== false,
        handoffTo: Array.isArray(event.payload.handoffTo) ? (event.payload.handoffTo as string[]) : [],
        gitIdentity: gitIdentity(event.payload.gitIdentity, REMY_DEFAULT),
        // `preset` is not editable, so it is read from the create event rather
        // than folded — and without it `seedPresetAgents` would find nothing
        // and seed the built-ins again on every boot.
        ...(event.payload.preset ? { preset: String(event.payload.preset) } : {}),
        createdAt: event.at,
        updatedAt: event.at,
      };
      agent = applyFields(agent, event.payload, EDITABLE);
      continue;
    }
    if (!agent || event.kind !== "field") continue;
    agent = { ...applyFields(agent, event.payload, EDITABLE), updatedAt: event.at };
  }
  // Derived last, from the handle the fold settled on, so a renamed handle
  // takes its address with it.
  return agent && {
    ...agent,
    gitIdentity: gitIdentity(agent.gitIdentity, REMY_DEFAULT),
    gitEmail: agentGitEmail(agent.handle),
    ...(id === REMY_AGENT_ID ? { builtIn: true } : {}),
  };
}

function write(agent: Agent): void {
  db.prepare(
    `insert into agents (
       id, name, handle, role, instructions, provider, model, effort, permission_mode,
       avatar, tint, auto_start, handoff_to, git_identity, git_name, git_email,
       preset, created_at, updated_at, deleted
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     on conflict(id) do update set
       name = excluded.name, handle = excluded.handle, role = excluded.role,
       instructions = excluded.instructions, provider = excluded.provider,
       model = excluded.model, effort = excluded.effort, permission_mode = excluded.permission_mode,
       avatar = excluded.avatar, tint = excluded.tint, auto_start = excluded.auto_start,
       handoff_to = excluded.handoff_to, git_identity = excluded.git_identity,
       git_name = excluded.git_name, git_email = excluded.git_email,
       preset = excluded.preset, updated_at = excluded.updated_at, deleted = 0`,
  ).run(
    agent.id,
    agent.name,
    agent.handle,
    agent.role ?? null,
    agent.instructions,
    agent.provider,
    agent.model ?? null,
    agent.effort ?? null,
    agent.permissionMode,
    agent.avatar ?? null,
    agent.tint ?? null,
    agent.autoStart ? 1 : 0,
    JSON.stringify(agent.handoffTo),
    agent.gitIdentity,
    agent.gitName ?? null,
    agent.gitEmail ?? null,
    agent.preset ?? null,
    agent.createdAt,
    agent.updatedAt,
  );
}

/// Rebuilds one agent from its events. Called after every write, and by the
/// peer apply path once there is one.
export function reproject(id: string): Agent | undefined {
  const agent = fold(id);
  if (!agent) {
    db.prepare("update agents set deleted = 1 where id = ?").run(id);
    return undefined;
  }
  write(agent);
  return agent;
}

export function reprojectAll(): void {
  runTransaction(() => {
    for (const id of entityIds("agent")) reproject(id);
  });
}

function toAgent(row: Record<string, unknown>): Agent {
  let handoffTo: string[] = [];
  try {
    const parsed = JSON.parse(String(row.handoff_to ?? "[]")) as unknown;
    if (Array.isArray(parsed)) handoffTo = parsed.map(String);
  } catch {
    // An unreadable list means no handoffs, which fails closed.
  }
  return {
    id: String(row.id),
    name: String(row.name),
    handle: String(row.handle),
    ...(row.role ? { role: String(row.role) } : {}),
    instructions: String(row.instructions ?? ""),
    provider: agentProvider(row.provider),
    ...(row.model ? { model: String(row.model) } : {}),
    ...(row.effort ? { effort: String(row.effort) } : {}),
    permissionMode: String(row.permission_mode) as ChatPermissionMode,
    ...(row.avatar ? { avatar: String(row.avatar) } : {}),
    ...(row.tint ? { tint: String(row.tint) } : {}),
    autoStart: Number(row.auto_start) === 1,
    handoffTo,
    gitIdentity: gitIdentity(row.git_identity, REMY_DEFAULT),
    ...(row.git_name ? { gitName: String(row.git_name) } : {}),
    // Derived rather than read back, so an address stored before you signed in
    // to `gh` does not outlive the fact.
    gitEmail: agentGitEmail(String(row.handle)),
    ...(row.preset ? { preset: String(row.preset) } : {}),
    ...(String(row.id) === REMY_AGENT_ID ? { builtIn: true } : {}),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

// ── reading ─────────────────────────────────────────────────────────────────

export function listAgents(): Agent[] {
  const rows = db
    .prepare("select * from agents where deleted = 0 order by created_at asc")
    .all() as Record<string, unknown>[];
  return rows.map(toAgent);
}

export function getAgent(id: string): Agent | undefined {
  const row = db.prepare("select * from agents where id = ? and deleted = 0").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? toAgent(row) : undefined;
}

export function agentByHandle(handle: string): Agent | undefined {
  const row = db.prepare("select * from agents where handle = ? and deleted = 0").get(handle) as
    | Record<string, unknown>
    | undefined;
  return row ? toAgent(row) : undefined;
}

// ── the workspace agent ─────────────────────────────────────────────────────

/// The assignee that is not an agent.
///
/// A ticket handed to the workspace is handed to the workspace's own default
/// model with no persona in front of it — what a thread you started yourself
/// would run as. It exists because most work wants doing, not characterising,
/// and writing an agent first is a step in the way.
export const WORKSPACE_AGENT = "workspace";

/// The workspace agent as an `Agent`, so anything that runs a turn takes one
/// shape. Not a row: it cannot be renamed, edited or deleted.
///
/// Its provider and model are this machine's own, which is the whole idea — the
/// workspace agent is the absence of a persona, not a provider of its own, so it
/// runs on exactly what a thread you started yourself would.
export function workspaceAgent(): Agent {
  return {
    id: WORKSPACE_AGENT,
    name: "Workspace agent",
    handle: WORKSPACE_AGENT,
    role: "The workspace's own default model, with no instructions in front of it",
    instructions: "",
    provider: config.defaultProvider,
    ...(config.defaultModel ? { model: config.defaultModel } : {}),
    ...(config.defaultEffort ? { effort: config.defaultEffort } : {}),
    permissionMode: "auto",
    autoStart: true,
    handoffTo: [],
    // Its commits are yours: there is no persona here to credit.
    gitIdentity: "off",
    createdAt: 0,
    updatedAt: 0,
  };
}

/// Whoever an assignee names: an agent on this machine, or the workspace agent.
/// `you` is not one of these — a ticket you keep has nobody to run it.
export function assignedAgent(id: string | undefined): Agent | undefined {
  if (!id) return undefined;
  return id === WORKSPACE_AGENT ? workspaceAgent() : getAgent(id);
}

/// The concrete provider and model an inherited agent uses right now.
///
/// Kept out of the stored row so changing the machine default changes every
/// agent that still follows it, including agents made before that change.
export function resolvedAgentModel(agent: Agent): { provider: ProviderId; model: string; effort: string } {
  const inherited = agent.provider === REMY_DEFAULT || !config.enabledProviders.includes(agent.provider);
  const provider = inherited ? config.defaultProvider : providerId(agent.provider);
  const asked = inherited ? config.defaultModel : agent.model;
  const model = providerModel(provider, asked);
  const effort = inherited ? config.defaultEffort : agent.effort;
  return { provider, model, effort: providerEffort(provider, model, effort) };
}

// ── writing ─────────────────────────────────────────────────────────────────

/// Everything a caller may set, cleaned. Keys the caller left out stay out, so
/// a client that knows about one field cannot reset the others.
function validate(input: Record<string, unknown>, existing?: Agent): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const name = text(input.name, 40);
    if (!name) throw new Error("an agent needs a name");
    patch.name = name;
  }
  if (input.handle !== undefined || (!existing && patch.name)) {
    const asked = agentHandle(input.handle);
    const handle = asked ?? agentHandle(patch.name);
    if (!handle) throw new Error("that handle has no usable characters");
    const free = (candidate: string) => {
      // The workspace agent answers to `@workspace` everywhere an agent does,
      // so no row may take that name out from under it.
      if (candidate === WORKSPACE_AGENT) return false;
      const clash = agentByHandle(candidate);
      return !clash || clash.id === existing?.id;
    };
    // A handle you typed has to be the one you get, so a clash is an error. One
    // derived from a name is only a default, so it gets out of the way instead
    // — which is what lets "New agent" be pressed twice.
    if (asked) {
      if (asked === WORKSPACE_AGENT) throw new Error("@workspace is the workspace agent — pick another handle");
      if (!free(handle)) throw new Error(`another agent already uses @${handle}`);
      patch.handle = handle;
    } else {
      let candidate = handle;
      for (let n = 2; !free(candidate) && n < 100; n += 1) candidate = `${handle}-${n}`;
      patch.handle = candidate;
    }
  }
  if (input.role !== undefined) patch.role = text(input.role, 80) ?? "";
  if (input.instructions !== undefined) patch.instructions = text(input.instructions, 8000) ?? "";
  // Provider and model are one choice: moving an agent to Codex takes its model
  // with it, to Codex's default rather than to a Claude alias Codex would refuse.
  if (input.provider !== undefined || input.model !== undefined || input.effort !== undefined) {
    if (input.provider === REMY_DEFAULT) {
      patch.provider = REMY_DEFAULT;
      patch.model = "";
      patch.effort = "";
    } else {
      const current = existing?.provider === REMY_DEFAULT
        ? config.defaultProvider
        : existing?.provider ?? config.defaultProvider;
      const provider = input.provider === undefined ? current : providerId(input.provider, current);
      if (!config.enabledProviders.includes(provider)) throw new Error("that provider is turned off");
      const model = input.model === undefined ? (existing?.model ?? "") : input.model;
      if (input.provider !== undefined || (input.model !== undefined && input.model !== "")) {
        patch.provider = provider;
      }
      patch.model = providerModel(provider, model);
      patch.effort = providerEffort(provider, patch.model, input.effort === undefined ? existing?.effort : input.effort);
    }
  }
  if (input.permissionMode !== undefined) {
    patch.permissionMode = oneOf(PERMISSION_MODES, input.permissionMode, existing?.permissionMode ?? "default");
  }
  if (input.avatar !== undefined) patch.avatar = text(input.avatar, 200) ?? "";
  if (input.tint !== undefined) patch.tint = text(input.tint, 24) ?? "";
  if (input.autoStart !== undefined) patch.autoStart = input.autoStart !== false;
  if (input.handoffTo !== undefined) {
    const list = Array.isArray(input.handoffTo) ? input.handoffTo : [];
    patch.handoffTo = [...new Set(list.map(agentHandle).filter((h): h is string => Boolean(h)))]
      // Remy is not a step in a chain of work; it is the app.
      .filter((handle) => handle !== REMY_AGENT_HANDLE);
  }
  if (input.gitIdentity !== undefined) {
    patch.gitIdentity = gitIdentity(input.gitIdentity, existing?.gitIdentity ?? REMY_DEFAULT);
  }
  if (input.gitName !== undefined) patch.gitName = text(input.gitName, 60) ?? "";
  // `gitEmail` is deliberately not settable: it is derived from the handle and
  // the GitHub account, so there is nothing here for a client to disagree with.
  return patch;
}

export function createAgent(input: Record<string, unknown>): Agent {
  return createAgentWithId(randomUUID(), input);
}

function createAgentWithId(id: string, input: Record<string, unknown>): Agent {
  const patch = validate(input);
  if (!patch.name) throw new Error("an agent needs a name");
  const created = {
    instructions: "",
    // Store inheritance rather than today's answer, so a later settings change
    // reaches this agent without rewriting it.
    provider: REMY_DEFAULT,
    permissionMode: "auto",
    autoStart: true,
    handoffTo: [],
    gitIdentity: REMY_DEFAULT,
    gitName: patch.name,
    ...patch,
    ...(input.preset ? { preset: String(input.preset) } : {}),
  };
  append("agent", id, "create", created);
  const agent = reproject(id);
  if (!agent) throw new Error("could not create that agent");
  return agent;
}

export function updateAgent(id: string, input: Record<string, unknown>): Agent {
  const existing = getAgent(id);
  if (!existing) throw new Error("no such agent");
  const patch = validate(input, existing);
  // Remy's own agent answers for the copy of Remy that is running, so who it is
  // comes from this build. What it thinks with is still yours to choose.
  if (existing.builtIn) for (const field of LOCKED) delete patch[field];
  if (Object.keys(patch).length === 0) return existing;
  append("agent", id, "field", patch);
  const agent = reproject(id);
  if (!agent) throw new Error("no such agent");
  return agent;
}

export function resetAgentsUsingProvider(provider: ProviderId): void {
  for (const agent of listAgents()) {
    if (agent.provider === provider) updateAgent(agent.id, { provider: REMY_DEFAULT });
  }
}

export function deleteAgent(id: string): void {
  const existing = getAgent(id);
  if (!existing) throw new Error("no such agent");
  if (existing.builtIn) throw new Error("Remy cannot be deleted");
  append("agent", id, "tombstone", {});
  reproject(id);
}

// ── git identity ────────────────────────────────────────────────────────────

/// The environment that makes an agent's commits its own.
///
/// Git reads these ahead of any config file, so nothing is written to
/// `~/.gitconfig` or to the repository and there is nothing to undo afterwards.
/// It is per thread rather than per checkout, so two agents committing in one
/// worktree stay distinct. `author` leaves the human as committer, which keeps
/// a person on every commit while still crediting the agent that wrote it.
///
/// This is attribution, not authentication: it records which agent wrote a
/// commit and proves nothing about who ran it.
export function gitIdentityEnv(agent: Agent | undefined): NodeJS.ProcessEnv {
  const identity = agent?.gitIdentity === REMY_DEFAULT ? config.defaultGitIdentity : agent?.gitIdentity;
  if (!agent || identity === "off") return {};
  const name = agent.gitName?.trim() || agent.name;
  const email = agentGitEmail(agent.handle);
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
  };
}

// ── Remy's own agent ────────────────────────────────────────────────────────

/// Who Remy is, as this build tells it. Held apart from the row so an upgrade
/// that teaches Remy something new reaches an install that already has it.
const REMY_IDENTITY = {
  name: REMY_AGENT_NAME,
  handle: REMY_AGENT_HANDLE,
  role: REMY_AGENT_ROLE,
  instructions: REMY_AGENT_INSTRUCTIONS,
} as const;

/// Seeds Remy's own agent, then keeps it in step on every boot.
///
/// The identity above is written straight to the log rather than through
/// `updateAgent`, which refuses these fields on a built-in agent: they come
/// from this build, not from a client. Only the fields that actually differ are
/// written, so a boot that changes nothing appends nothing.
///
/// Its provider stays `default`, which is what the person asked for: Remy
/// thinks with whatever Settings says until they pick something else for it.
export function seedRemyAgent(): Agent {
  const existing = getAgent(REMY_AGENT_ID);
  if (!existing) {
    return createAgentWithId(REMY_AGENT_ID, {
      ...REMY_IDENTITY,
      preset: REMY_AGENT_PRESET,
      // A colour so its mark reads as somebody rather than as a blank. Yours to
      // change: what Remy looks like is a preference, not an identity.
      tint: "green",
      // It edits Remy's own board rather than a repository, and being asked
      // before each ticket it was told to write is the wrong conversation.
      permissionMode: "auto",
      // There is no persona to credit on a commit it will never make.
      gitIdentity: "off",
      // Remy answers you; it is not something the board starts on a ticket.
      autoStart: false,
    });
  }
  const drifted = Object.entries(REMY_IDENTITY).filter(
    ([field, value]) => existing[field as keyof typeof REMY_IDENTITY] !== value,
  );
  if (drifted.length === 0) return existing;
  append("agent", REMY_AGENT_ID, "field", Object.fromEntries(drifted));
  return reproject(REMY_AGENT_ID) ?? existing;
}

// ── presets ─────────────────────────────────────────────────────────────────

interface Preset {
  preset: string;
  name: string;
  handle: string;
  role: string;
  tint: string;
  model: string;
  permissionMode: ChatPermissionMode;
  gitIdentity: GitIdentityMode;
  handoffTo: string[];
  instructions: string;
}

const PRESETS: Preset[] = [
  {
    preset: "scout",
    name: "PM",
    handle: "pm",
    role: "Turns a rough ticket into clear product scope",
    tint: "violet",
    model: "",
    permissionMode: "auto",
    gitIdentity: REMY_DEFAULT,
    handoffTo: ["builder"],
    instructions: [
      "You are the product manager. Turn a rough ticket into product scope before anyone writes code.",
      "",
      "Read the ticket and its discussion, then rewrite it with the Remy ticket tools. Cover the user problem, intended outcome, in-scope behavior, explicit non-goals, acceptance criteria, and any product decision that still needs the user.",
      "",
      "Stay at product level. Do not prescribe files, architecture, APIs, data models, libraries, or test implementation. Do not write code. Split the ticket only when the product outcomes can be delivered independently.",
      "",
      "When the scope is ready, hand the ticket to @builder. If product intent is unresolved, leave it in Needs input and ask one concrete question.",
    ].join("\n"),
  },
  {
    preset: "builder",
    name: "Builder",
    handle: "builder",
    role: "Implements the ticket in its own worktree",
    tint: "blue",
    model: "",
    permissionMode: "auto",
    gitIdentity: REMY_DEFAULT,
    handoffTo: ["qa"],
    instructions: [
      "You implement tickets. Read the ticket and every comment on it before you touch a file — the scope was decided before you arrived.",
      "",
      "Follow the conventions already in the repository rather than your own. Match the surrounding code.",
      "",
      "Commit as you go, in small commits with a sentence in the imperative for a subject. Run whatever checks the project has before you say you are finished, and say what you ran.",
      "",
      "If the ticket turns out to be wrong, stop and say so on the ticket. Do not quietly build something else.",
      "",
      "When the implementation and its checks are complete, leave the evidence on the ticket and hand it to @qa.",
    ].join("\n"),
  },
  {
    preset: "critic",
    name: "QA",
    handle: "qa",
    role: "Tests the finished behavior against the ticket",
    tint: "amber",
    model: "",
    permissionMode: "auto",
    gitIdentity: REMY_DEFAULT,
    handoffTo: ["builder"],
    instructions: [
      "You are QA. Test work that is already implemented against the ticket's acceptance criteria.",
      "",
      "Follow the repository's QA instructions. Run the relevant automated checks, then exercise the real behavior in the running app, browser, simulator, emulator, or device when the project supports it. Inspect persisted or API state when the screen alone cannot prove the result.",
      "",
      "Do not change product source code. Record exactly what you tested and the evidence in a ticket comment. For a reproducible failure, move the ticket to Needs input and hand it back to @builder. When every acceptance criterion passes, move it to Done.",
      "",
      "A finding needs a reproducible sequence, expected behavior, actual behavior, and the environment where it happened. Say what you could not test.",
    ].join("\n"),
  },
];

function presetAgentId(preset: string): string {
  return `remy-preset-${preset}`;
}

function presetPatch(preset: Preset): Record<string, unknown> {
  const { preset: _preset, ...patch } = preset;
  return { ...patch, gitName: preset.name };
}

/// Seeds the built-in agents once. An untouched legacy Scout or Critic is
/// upgraded to PM or QA; other edits stay in place apart from replacing a
/// retired Critic handoff with QA. Existing Triagers remain, but new boards do
/// not seed one.
export function seedPresetAgents(): void {
  // Two machines can each seed their roster before they pair. The oldest copy
  // wins everywhere, while fixed ids keep new machines from doing it again.
  const groups = new Map<string, Agent[]>();
  for (const agent of listAgents()) {
    if (!agent.preset) continue;
    groups.set(agent.preset, [...(groups.get(agent.preset) ?? []), agent]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    for (const duplicate of group.slice(1)) deleteAgent(duplicate.id);
  }

  const existing = listAgents().filter((agent) => agent.preset);
  const byPreset = new Map(existing.map((agent) => [agent.preset!, agent]));
  let criticMigrated = false;
  for (const preset of PRESETS) {
    const agent = byPreset.get(preset.preset);
    if (!agent || eventsFor("agent", agent.id).length !== 1) continue;
    if (preset.preset !== "scout" && preset.preset !== "critic") continue;
    if (preset.preset === "scout" && (agent.name !== "Scout" || agent.handle !== "scout")) continue;
    if (preset.preset === "critic" && (agent.name !== "Critic" || agent.handle !== "critic")) continue;
    try {
      updateAgent(agent.id, presetPatch(preset));
      if (preset.preset === "critic") criticMigrated = true;
    } catch (error) {
      console.error(`could not upgrade the ${agent.name} agent:`, error);
    }
  }
  if (criticMigrated) {
    const builder = byPreset.get("builder");
    if (builder?.handoffTo.includes("critic")) {
      const next = PRESETS.find((preset) => preset.preset === "builder")!;
      updateAgent(
        builder.id,
        eventsFor("agent", builder.id).length === 1
          ? presetPatch(next)
          : { handoffTo: builder.handoffTo.map((handle) => handle === "critic" ? "qa" : handle) },
      );
    }
  }
  const seen = new Set(existing.map((agent) => agent.preset!));
  for (const preset of PRESETS) {
    if (seen.has(preset.preset)) continue;
    try {
      createAgentWithId(presetAgentId(preset.preset), { ...preset, gitName: preset.name });
    } catch (error) {
      console.error(`could not seed the ${preset.name} agent:`, error);
    }
  }

  // Before inheritance existed, creation copied both machine defaults into
  // every row. A later field event means someone chose an override; without
  // one, replace that old copy with the live default exactly once.
  for (const agent of listAgents()) {
    const events = eventsFor("agent", agent.id);
    const fields = events.filter((event) => event.kind === "field");
    const createdWithAModel = events.some(
      (event) => event.kind === "create" && typeof event.payload.model === "string" && event.payload.model.length > 0,
    );
    const modelWasPicked = createdWithAModel || fields.some(
      (event) => event.payload.provider !== undefined || event.payload.model !== undefined,
    );
    const identityWasPicked = fields.some((event) => event.payload.gitIdentity !== undefined);
    const patch: Record<string, unknown> = {};
    if (!modelWasPicked && agent.provider !== REMY_DEFAULT) patch.provider = REMY_DEFAULT;
    if (!identityWasPicked && agent.gitIdentity !== REMY_DEFAULT) patch.gitIdentity = REMY_DEFAULT;
    if (Object.keys(patch).length > 0) updateAgent(agent.id, patch);
  }
}
