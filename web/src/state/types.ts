import type { DeviceIconId } from "~/lib/devices";
import type { TintId } from "~/lib/tints";

/// Shapes mirroring what `server/src` already returns. Kept deliberately narrow:
/// only the fields the desktop UI reads, so a server change that adds a field
/// doesn't ripple through here.

export type ChatState = "idle" | "working" | "needs_input" | "error";

export interface Server {
  id: string;
  name: string;
  url: string;
  code: string;
  online: boolean;
  icon: DeviceIconId;
  tint?: TintId;
  /// This machine's own daemon, started with the app. It cannot be unpaired.
  local?: boolean;
  /// A machine paired with this one, reached through the daemon here.
  peer?: boolean;
  /// Whether notifications raised on this machine are shown on that one.
  notify?: boolean;
  /// When that machine last answered.
  lastSeen?: number;
  /// A hosted runtime presented beside physical devices.
  cloud?: boolean;
  /// Cloud runtimes need a repository rather than a home directory.
  workspaceOnly?: boolean;
  cloudConnected?: boolean;
}

/// A machine asking to pair with this one. It is waiting on a person here, so
/// the code is what they compare before allowing it.
export interface PairRequest {
  id: string;
  code: string;
  fromDeviceId: string;
  fromName: string;
  fromUrl: string;
  at: number;
}

/// One of your machines on the tailnet, and whether Remy answered on it.
export interface TailnetDevice {
  host: string;
  name: string;
  os: string;
  online: boolean;
  /// Remy answered here, so it can be paired with.
  remy: boolean;
  url?: string;
  paired: boolean;
}

export interface Chat {
  id: string;
  serverId: string;
  title: string;
  cwd: string;
  state: ChatState;
  /// Which agent this thread thinks with.
  provider?: string;
  /// The named persona running this thread, when it has one.
  agentId?: string;
  model?: string;
  effort?: string;
  preview?: string;
  updatedAt: number;
  /// When the current run of work began. Absent once the chat settles, so a
  /// row only shows a clock while there is something to time.
  workingSince?: number;
  /// True when this is an agent's inbox conversation rather than work in a
  /// repository. These live in Inbox and never in the thread list.
  dm?: boolean;
  /// The agent has said something since you last opened this.
  unread?: boolean;
  /// Pinned threads lead the active thread list.
  pinned?: boolean;
}

export interface ArchivedThread {
  id: string;
  serverId: string;
  title: string;
  cwd: string;
  provider?: string;
  agentId?: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  preview?: string;
  archivedAt: number;
  entries: ConvEntry[];
  todos: ConvTodo[];
  context?: ContextUsage;
}

export interface GitWorktree {
  path: string;
  branch: string | null;
  isMain: boolean;
  dirty: boolean;
}

export interface GitBranch {
  name: string;
  current: boolean;
  checkout: "main" | "worktree" | null;
}

export interface Workspace {
  id: string;
  serverId: string;
  name: string;
  path: string;
  origin?: string | null;
  icon?: string | null;
  tint?: string | null;
  /// What a thread started here runs on, when this workspace does not follow
  /// the machine. Null in both means it does.
  provider?: string | null;
  model?: string | null;
  effort?: string | null;
  worktrees: GitWorktree[];
  /// A device projection used for routing, hidden from the workspace list.
  virtual?: boolean;
}

export interface PathSuggestion {
  path: string;
  name: string;
  repo: boolean;
}

export interface WorkspaceIconMatch {
  path: string;
  name: string;
  preview?: string;
}

/// One rendered item in a chat's feed. `kind` picks the renderer; the rest are
/// populated per kind. Mirrors `ConvEntry` in `server/src/transcript.ts`.
export interface ConvEntry {
  id: string;
  kind: "user" | "assistant" | "thinking" | "tool";
  at?: number;
  completedAt?: number;
  text?: string;
  tool?: string;
  verb?: string;
  arg?: string;
  status?: "ok" | "error" | "stopped";
  output?: string;
  file?: string;
  skill?: string;
  diff?: ConvDiffLine[];
  adds?: number;
  dels?: number;
  questions?: ConvQuestion[];
  /// What a Remy tool made on this call, drawn as a card under the tool row.
  artifacts?: ConvArtifact[];
  attachments?: ChatImageAttachment[];
}

export interface ChatImageAttachment {
  id: string;
  name: string;
  mimeType: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
}

/// Something a Remy tool made — a ticket, a thread, a workspace — with enough
/// on it to draw a card and open the thing it names.
export interface ConvArtifact {
  kind: "ticket" | "thread" | "workspace";
  /// A ticket is addressed by key, a thread and a workspace by id.
  key?: string;
  id?: string;
  title: string;
  detail?: string;
}

export interface ConvDiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
}

export interface ConvQuestion {
  header?: string;
  question: string;
  multiSelect?: boolean;
  options: ConvQuestionOption[];
  answer?: string;
  notes?: string;
}

export interface ConvQuestionOption {
  label: string;
  description?: string;
  preview?: string;
  selected?: boolean;
}

export interface ConvTodo {
  content: string;
  status: string;
}

/// A tool call the chat is blocked on, waiting for you to allow or deny it.
export interface ChatApproval {
  requestId: string;
  tool: string;
  verb: string;
  arg: string;
  title?: string;
  reason?: string;
  file?: string;
  diff?: ConvDiffLine[];
  plan?: string;
  allowAlways: boolean;
}

export interface ChatQuestionRequest {
  requestId: string;
  questions: ConvQuestion[];
}

/// How full this session's context window is. Absent until a turn has finished
/// and reported token accounting.
export interface ContextUsage {
  tokens: number;
  peakTokens?: number;
  limit: number;
  /// True when `limit` is a guess rather than a number this session proved.
  limitEstimated: boolean;
  model?: string;
  compactions: number;
  droppedTokens: number;
}

/// One open chat, as `GET /chats/:id` returns it plus the server it came from.
export interface ChatDetail {
  id: string;
  serverId: string;
  title: string;
  cwd: string;
  /// Which agent this thread thinks with. Changeable, like the model: the feed
  /// stays, and the new one arrives knowing only what it is told next.
  provider?: string;
  agentId?: string;
  model?: string;
  effort?: string;
  /// How much this thread may do unasked. Changeable, unlike where it runs.
  permissionMode?: string;
  state: ChatState;
  action?: string;
  entries: ConvEntry[];
  todos: ConvTodo[];
  approval?: ChatApproval;
  question?: ChatQuestionRequest;
  context?: ContextUsage;
  workingSince?: number;
  /// True while the chat holds a live Claude process. A cold chat resumes on
  /// the next message, so this is a hint, not a blocker.
  live?: boolean;
  error?: string;
}

/// Settings that belong to a machine rather than a device or a chat. They live
/// in that server's `remy.db`, so every client attached to it sees the same
/// values. Mirrors `PublicSettings` in `server/src/config.ts`.
export interface ServerSettings {
  preventSleep: "off" | "whileBusy" | "always";
  defaultCheckout: "main" | "worktree";
  worktreeBase: "remote" | "local";
  worktreeRoot: string;
  defaultModel: string;
  defaultEffort: string;
  /// What Remy runs its own small jobs on, as opposed to what your chats think
  /// with. Kept cheap on purpose, and `off` declines them altogether.
  remyProvider: string;
  remyModel: string;
  remyEffort: string;
  favoriteModels: string[];
  repoUpdate: "off" | "hourly" | "sixHourly" | "daily";
  worktreeBranchPrefix: string;
  /// Your face: empty for the default, `preset:<id>`, or a `data:` URL.
  avatar: string;
  deviceName: string;
  deviceIcon: string;
  deviceTint: string;
  /// Preferred devices for work that is not tied to a workspace.
  devicePreferenceOrder: string[];
  tailscaleServeEnabled: boolean;
  /// What every agent set to Remy default signs with.
  defaultGitIdentity: "off" | "author";
  /// What a new thread and every inherited agent thinks with. It pairs with
  /// `defaultModel`: a provider only ever holds one of its own models.
  defaultProvider: string;
  enabledProviders: string[];
  /// What a new thread may do without being asked. A workspace, an agent or the
  /// thread itself can still say otherwise.
  defaultPermissionMode: string;
}

/// What one repository did the last time Remy refreshed them.
export interface RepoOutcome {
  workspace: string;
  path: string;
  result: "updated" | "current" | "dirty" | "no-upstream" | "diverged" | "detached" | "failed";
  detail?: string;
}

export interface UpdateRun {
  at: number;
  repos: RepoOutcome[];
}

/// What a command-line tool on the machine reports about itself.
export interface ToolStatus {
  available: boolean;
  version?: string;
  authenticated?: boolean;
  account?: string;
  plan?: string;
  organization?: string;
  error?: string;
}

export interface Tooling {
  git: ToolStatus;
  gh: ToolStatus;
  claude: ToolStatus;
  codex: ToolStatus;
  cursor: ToolStatus;
}

export interface ProviderMcpStatus {
  provider: string;
  installed: boolean;
  configured: boolean;
}

/// A named persona a thread can run as. Mirrors `Agent` in `server/src/agents.ts`.
export interface Agent {
  id: string;
  serverId: string;
  name: string;
  handle: string;
  role?: string;
  instructions: string;
  provider: string;
  model?: string;
  effort?: string;
  permissionMode: string;
  avatar?: string;
  tint?: string;
  autoStart: boolean;
  handoffTo: string[];
  /// Who this agent's commits credit: `default` follows the machine, `off`
  /// keeps your identity, and `author` credits the agent while you commit it.
  gitIdentity: "default" | "off" | "author";
  gitName?: string;
  gitEmail?: string;
  preset?: string;
  /// Remy's own agent. Its name, role and instructions come from the copy of
  /// Remy that is running, and it cannot be deleted.
  builtIn?: boolean;
}

/// A repository, as the board knows it — what a ticket belongs to, rather than
/// the folder holding it on any one machine.
export interface Project {
  id: string;
  serverId: string;
  name: string;
  /// The letters in front of a ticket key. Editable, and every ticket in the
  /// project follows it.
  keyPrefix: string;
  origin?: string;
  /// Workspaces on that machine which are this project. Empty means the repo is
  /// not cloned there.
  workspaceIds: string[];
}

export type TicketStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "needs_input"
  | "pr_review"
  | "done"
  | "cancelled";

export interface TicketThread {
  ticketId: string;
  deviceId: string;
  chatId: string;
  agentId?: string;
  stage?: string;
  /// `runner` when the board started it, `you` when you attached it by hand.
  linkedBy: "runner" | "you";
  createdAt: number;
}

export interface Ticket {
  id: string;
  serverId: string;
  /// Its own number. `key` is that behind the project's slug, so renaming the
  /// slug renames every key.
  number: number;
  key: string;
  projectId: string;
  title: string;
  body: string;
  status: TicketStatus;
  priority: number;
  assigneeAgentId?: string;
  parentId?: string;
  rank: string;
  /// The machine that runs this ticket's work.
  deviceId?: string;
  branch?: string;
  handoffs: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  closedAt?: number;
  threads: TicketThread[];
}

/// Work that comes back: a ticket Remy writes again on a cadence, already
/// handed to whoever is meant to do it. Mirrors `RecurrenceView` in
/// `server/src/recurring.ts`.
export type Cadence = "daily" | "weekdays" | "weekly" | "monthly";

export interface Recurrence {
  id: string;
  serverId: string;
  projectId: string;
  title: string;
  body: string;
  assigneeAgentId?: string;
  cadence: Cadence;
  /// Local time on the machine that writes the tickets.
  hour: number;
  minute: number;
  /// Sunday = 0, for a weekly cadence.
  weekday?: number;
  /// Day of the month, 1 to 28, for a monthly one.
  day?: number;
  enabled: boolean;
  /// The machine that writes the tickets.
  deviceId?: string;
  runs: number;
  lastRunAt?: number;
  lastError?: string;
  nextRunAt: number;
  createdAt: number;
  updatedAt: number;
}

/// One line of a ticket's story. The feed and the log the board syncs are the
/// same record, so nothing here can drift from what actually happened.
/// Who a comment named: the handle as it was typed, and who that turned out to
/// be. Rendering reads the id, so renaming an agent renames every mention of it
/// ever written.
export interface TicketMention {
  id: string;
  handle: string;
}

export interface TicketActivity {
  id: string;
  at: number;
  actor: string;
  kind: string;
  body?: string;
  editedAt?: number;
  mentions?: TicketMention[];
  detail?: Record<string, unknown>;
}
