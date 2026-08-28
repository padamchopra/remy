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
  preview?: string;
  updatedAt: number;
  workingSince?: number;
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
  /// the Mac. Null in both means it does.
  provider?: string | null;
  model?: string | null;
  worktrees: GitWorktree[];
  virtual?: boolean;
}

export interface PathSuggestion {
  path: string;
  name: string;
  repo: boolean;
}

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
}

export interface ServerSettings {
  preventSleep: "off" | "whileBusy" | "always";
  defaultCheckout: "main" | "worktree";
  worktreeBase: "remote" | "local";
  worktreeRoot: string;
  defaultModel: string;
  remyModel: string;
  favoriteModels: string[];
  repoUpdate: "off" | "hourly" | "sixHourly" | "daily";
  worktreeBranchPrefix: string;
  avatar: string;
  deviceName: string;
  deviceIcon: string;
  deviceTint: string;
  /// Absent from a Mac that predates automatic Tailnet repair.
  tailscaleServeEnabled?: boolean;
  defaultGitIdentity: "off" | "author";
  defaultProvider: string;
  /// Absent from a Mac on an older build, which started every thread on Ask.
  defaultPermissionMode?: string;
  notifySelf?: boolean;
}

export interface Agent {
  id: string;
  serverId: string;
  name: string;
  handle: string;
  role?: string;
  instructions: string;
  provider: string;
  model?: string;
  permissionMode: string;
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

export interface TicketActivity {
  id: string;
  at: number;
  actor: string;
  kind: string;
  body?: string;
  detail?: Record<string, unknown>;
}

export interface PushStatus {
  configured: boolean;
  devices: { token: string; name: string; registeredAt: number; lastSeen: number }[];
}
