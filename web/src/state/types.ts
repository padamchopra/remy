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
  /// Which provider this thread thinks with.
  provider?: string;
  model?: string;
  effort?: string;
  preview?: string;
  /// When the thread was started. What the thread list is ordered by, so a row
  /// keeps its place while the work in it moves on.
  createdAt?: number;
  updatedAt: number;
  /// When the current run of work began. Absent once the chat settles, so a
  /// row only shows a clock while there is something to time.
  workingSince?: number;
  /// Something was said here since you last opened it.
  unread?: boolean;
  /// Pinned threads lead the active thread list.
  pinned?: boolean;
  /// This parallel session shares its parent thread's checkout.
  parentChatId?: string;
}

export interface ArchivedThread {
  id: string;
  chatId?: string;
  serverId: string;
  title: string;
  cwd: string;
  provider?: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  parentChatId?: string;
  preview?: string;
  archivedAt: number;
  entries: ConvEntry[];
  todos: ConvTodo[];
  context?: ContextUsage;
  detailLoaded?: boolean;
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
  /// A device projection, hidden from the workspace list.
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
  member?: { id: string; label: string };
  response?: { kind: "approval" | "question"; requestId: string; value: unknown };
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
  /// What a Remy tool made on this call, drawn as a card under the tool row.
  artifacts?: ConvArtifact[];
  attachments?: ChatImageAttachment[];
  codeReferences?: ChatCodeReference[];
}

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

export interface ChatImageAttachment {
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
  lines: PullRequestDiffLine[];
}

export interface PullRequestDiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface PullRequestDiffHunk {
  header: string;
  lines: PullRequestDiffLine[];
}

export interface PullRequestDiffFile {
  path: string;
  previousPath?: string;
  deleted?: boolean;
  hunks: PullRequestDiffHunk[];
  viewed?: boolean;
}

export interface PullRequestStack {
  number: number;
  position: number;
  size: number;
  baseRefName: string;
  entries?: { position: number; number: number; title: string; state: string; isDraft: boolean }[];
}

export interface PullRequestDiff {
  nodeId?: string;
  headRefOid?: string;
  baseRefOid?: string;
  workspaceId?: string;
  url: string;
  repository: string;
  number: number;
  title: string;
  body: string;
  baseRefName: string;
  headRefName: string;
  state: string;
  isDraft: boolean;
  mergeable: string;
  mergeStateStatus: string;
  reviewDecision: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  checks: { name: string; state: "pass" | "fail" | "pending" | "skipping" }[];
  files: PullRequestDiffFile[];
}

export interface PullRequestGuideCommit {
  sha: string;
  title: string;
  author: string;
  committedAt: string;
}

export interface PullRequestGuideHunk {
  revision?: { head: string; base?: string; previousPath?: string; deleted?: boolean };
  id: string;
  path: string;
  header: string;
  lines: PullRequestDiffLine[];
}

export interface PullRequestQuestionSource {
  path: string;
  head?: string;
  header: string;
  lines: PullRequestDiffLine[];
}

export interface PullRequestQuestion {
  id: string;
  repository: string;
  number: number;
  source: PullRequestQuestionSource;
  start: number;
  end: number;
  question: string;
  answer: string;
  provider: string;
  model: string;
  createdAt: number;
}

export interface PullRequestGuideStep {
  id: string;
  title: string;
  summary: string;
  hunkIds: string[];
}

export interface PullRequestGuideQuestion {
  id: string;
  stepId: string;
  hunkId: string;
  start: number;
  end: number;
  question: string;
  answer: string;
  createdAt: number;
}

export interface PullRequestGuide {
  repository: string;
  number: number;
  provider: string;
  model: string;
  effort: string;
  commitShas: string[];
  commits: PullRequestGuideCommit[];
  hunks: PullRequestGuideHunk[];
  steps: PullRequestGuideStep[];
  uncoveredHunkIds?: string[];
  questions: PullRequestGuideQuestion[];
  createdAt: number;
}

export interface PullRequestTimelineItem {
  id: string;
  kind: "commit" | "comment" | "review" | "review_comment";
  author: string;
  body: string;
  createdAt: string;
  url: string;
  sha?: string | null;
  state?: string | null;
  path?: string | null;
  line?: number | null;
}

/// Something a Remy tool made — a ticket, thread, or workspace — with enough
/// on it to draw a card and open the thing it names.
export interface ConvArtifact {
  organizationId?: string;
  computerId?: string;
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
  parentChatId?: string;
  /// Which provider this thread thinks with. Changeable, like the model: the
  /// feed stays, and the new one arrives knowing only what it is told next.
  provider?: string;
  model?: string;
  effort?: string;
  /// How much this thread may do unasked. Changeable, unlike where it runs.
  permissionMode?: string;
  state: ChatState;
  action?: string;
  entries: ConvEntry[];
  history?: {
    hasEarlier: boolean;
    before?: string;
  };
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
  hubMode: boolean;
  automaticUpdates?: boolean;
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
  notifySelf?: boolean;
  preventSleepSupported?: boolean;
  worktreeBranchPrefix: string;
  /// Your face: empty for the default, `preset:<id>`, or a `data:` URL.
  avatar: string;
  deviceName: string;
  deviceIcon: string;
  deviceTint: string;
  /// Preferred devices for work that is not tied to a workspace.
  devicePreferenceOrder: string[];
  tailscaleServeEnabled: boolean;
  /// What a new thread thinks with. It pairs with `defaultModel`: a provider
  /// only ever holds one of its own models.
  defaultProvider: string;
  enabledProviders: string[];
  /// What a new thread may do without being asked. A workspace or the thread
  /// itself can still say otherwise.
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
  latestVersion?: string;
  updateAvailable?: boolean;
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
  icon?: string | null;
  tint?: string | null;
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
  parentId?: string;
  rank: string;
  /// The machine that runs this ticket's work.
  deviceId?: string;
  branch?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  closedAt?: number;
  threads: TicketThread[];
}

/// One line of a ticket's story. The feed and the log the board syncs are the
/// same record, so nothing here can drift from what actually happened.
export interface TicketActivity {
  id: string;
  at: number;
  actor: string;
  kind: string;
  body?: string;
  editedAt?: number;
  detail?: Record<string, unknown>;
}
