import type { DeviceIconId } from "../lib/devices";
import type { TintId } from "../lib/tints";

export type ChatState = "idle" | "working" | "needs_input" | "error";

export interface Server {
  id: string;
  name: string;
  url: string;
  code: string;
  online: boolean;
  icon: DeviceIconId;
  tint?: TintId;
  /// A Mac this phone is paired with directly. Peers of those Macs are reached through them.
  home?: boolean;
  peer?: boolean;
  notify?: boolean;
  lastSeen?: number;
  cloud?: boolean;
  workspaceOnly?: boolean;
  cloudConnected?: boolean;
}

export interface PairRequest {
  id: string;
  serverId: string;
  code: string;
  fromDeviceId: string;
  fromName: string;
  fromUrl: string;
  at: number;
}

export interface Chat {
  id: string;
  serverId: string;
  title: string;
  cwd: string;
  state: ChatState;
  provider?: string;
  model?: string;
  /// How much reasoning this thread asks its model for. Empty leaves the
  /// choice to whatever that provider is configured with.
  effort?: string;
  permissionMode?: string;
  preview?: string;
  createdAt?: number;
  updatedAt: number;
  workingSince?: number;
  /// What the thread is doing right now, when it is doing something.
  action?: string;
  /// Pinned threads lead the list on every client of that Mac.
  pinned?: boolean;
  /// The parent thread this parallel session belongs to.
  parentChatId?: string;
  turns?: number;
  costUsd?: number;
  context?: ContextUsage;
  /// True while the Mac is holding a live agent process for this thread.
  live?: boolean;
  error?: string;
  /// True when this is an agent's inbox conversation rather than work in a
  /// repository. One per agent, and never listed with the threads.
  dm?: boolean;
  /// The agent has said something since you last opened this.
  unread?: boolean;
  /// The named persona running this conversation, when it has one.
  agentId?: string;
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
  /// the Mac. Null in all three means it does.
  provider?: string | null;
  model?: string | null;
  effort?: string | null;
  worktrees: GitWorktree[];
  virtual?: boolean;
}

export interface PathSuggestion {
  path: string;
  name: string;
  repo: boolean;
}

export interface ConvEntry {
  /// Work the provider is running beside the turn — a subagent, or a shell
  /// command. Carried on its own entry so it survives a reconnect.
  activity?: ThreadActivity;
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
  /// What a Remy tool made on this call, shown as a card that opens it.
  artifacts?: ConvArtifact[];
  /// Images sent with a message.
  attachments?: ChatImageAttachment[];
  /// Review comments attached from the thread's Changes tool.
  codeReferences?: ChatCodeReference[];
}

/// Mirrors `ThreadActivity` in `server/src/thread-activity.ts`.
export interface ThreadActivity {
  id: string;
  kind: "subagent" | "shell";
  provider: string;
  title: string;
  status: "running" | "waiting" | "idle" | "completed" | "failed" | "stopped" | "unknown";
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  parentId?: string;
  taskId?: string;
  toolUseId?: string;
  model?: string;
  background?: boolean;
  command?: string;
  progress?: string;
  output?: string;
  tokens?: number;
  toolCount?: number;
}

/// Mirrors `ConvArtifact` in `server/src/remy-artifacts.ts`. A ticket is
/// addressed by key, a thread and a workspace by id.
export interface ConvArtifact {
  kind: "ticket" | "thread" | "workspace" | "routine";
  key?: string;
  id?: string;
  title: string;
  detail?: string;
}

export interface ChatImageAttachment {
  /// Minted by the Mac that owns the thread. The phone never sends a path.
  id: string;
  name: string;
  mimeType: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
}

export interface ChatCodeReference {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  comment: string;
  lines: { kind: "add" | "del" | "ctx"; oldLine: number | null; newLine: number | null; text: string }[];
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

export interface ContextUsage {
  tokens: number;
  peakTokens?: number;
  limit: number;
  limitEstimated: boolean;
  model?: string;
  compactions: number;
  droppedTokens: number;
}

export interface ChatDetail {
  id: string;
  serverId: string;
  title: string;
  cwd: string;
  provider?: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  state: ChatState;
  action?: string;
  entries: ConvEntry[];
  todos: ConvTodo[];
  approval?: ChatApproval;
  question?: ChatQuestionRequest;
  context?: ContextUsage;
  live?: boolean;
  error?: string;
  /// The agent whose inbox conversation this is, when it is one.
  dm?: boolean;
  agentId?: string;
  pinned?: boolean;
  parentChatId?: string;
  turns?: number;
  costUsd?: number;
}

/// The pull request on a thread's branch. Mirrors `PullRequestSummary` in
/// `server/src/git.ts`.
export interface PullRequestSummary {
  url: string;
  number: number;
  title: string;
  headRefName: string;
  state: string;
}

/// What one paired Mac answers with at `GET /server/settings`. Every field an
/// older Mac may not have is optional, so a missing one reads as "it never
/// said" rather than as a value the phone then writes back.
export interface ServerSettings {
  preventSleep: "off" | "whileBusy" | "always";
  preventSleepSupported?: boolean;
  defaultCheckout: "main" | "worktree";
  worktreeBase: "remote" | "local";
  worktreeRoot: string;
  defaultProvider: string;
  defaultModel: string;
  /// Absent from a Mac from before reasoning effort was a choice.
  defaultEffort?: string;
  /// Providers that Mac offers for new work. Absent means it offers all of them.
  enabledProviders?: string[];
  remyProvider?: string;
  remyModel: string;
  remyEffort?: string;
  /// Starred models, as `provider:model`.
  favoriteModels: string[];
  repoUpdate: "off" | "hourly" | "sixHourly" | "daily";
  worktreeBranchPrefix: string;
  avatar: string;
  deviceName: string;
  deviceIcon: string;
  deviceTint: string;
  /// The order this Mac tries paired devices for work with no workspace.
  devicePreferenceOrder?: string[];
  /// Absent from a Mac that predates automatic Tailnet repair.
  tailscaleServeEnabled?: boolean;
  defaultGitIdentity: "off" | "author";
  /// Absent from a Mac on an older build, which started every thread on Ask.
  defaultPermissionMode?: string;
  pullRequestMonitoringEnabled?: boolean;
  pullRequestMonitoringAgentId?: string;
  notifySelf?: boolean;
}

export interface Agent {
  id: string;
  serverId: string;
  name: string;
  handle: string;
  role?: string;
  instructions: string;
  /// `default` follows the Mac's own thread default.
  provider: string;
  model?: string;
  effort?: string;
  permissionMode: string;
  avatar?: string;
  tint?: string;
  autoStart: boolean;
  handoffTo: string[];
  gitIdentity: "default" | "off" | "author";
  gitName?: string;
  gitEmail?: string;
  preset?: string;
  /// Remy's own agent. Its name, role and instructions come from the copy of
  /// Remy that is running, and it cannot be deleted.
  builtIn?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export type Cadence = "daily" | "weekdays" | "weekly" | "monthly";

/// Repeated work an agent sends itself. It belongs to the agent, writes no
/// ticket, and needs no workspace. Mirrors `RoutineView` in
/// `server/src/routines.ts`.
export interface Routine {
  id: string;
  serverId: string;
  agentId: string;
  name: string;
  prompt: string;
  cadence: Cadence;
  hour: number;
  minute: number;
  weekday?: number;
  day?: number;
  enabled: boolean;
  /// The machine that owns the clock, so two paired Macs do not fire it twice.
  schedulerDeviceId: string;
  runs: number;
  lastRunAt?: number;
  lastError?: string;
  nextRunAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  serverId: string;
  name: string;
  keyPrefix: string;
  origin?: string;
  icon?: string | null;
  tint?: string | null;
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
  linkedBy: "runner" | "you";
  createdAt: number;
}

export interface Ticket {
  id: string;
  serverId: string;
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
  deviceId?: string;
  branch?: string;
  handoffs: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  closedAt?: number;
  threads: TicketThread[];
}

export interface TicketMention {
  id: string;
  handle: string;
}

export interface TicketActivity {
  id: string;
  at: number;
  /// `you`, `remy`, or an agent's handle.
  actor: string;
  kind: string;
  body?: string;
  editedAt?: number;
  mentions?: TicketMention[];
  detail?: Record<string, unknown>;
}

export interface PushStatus {
  configured: boolean;
  devices: { token: string; name: string; registeredAt: number; lastSeen: number }[];
}
