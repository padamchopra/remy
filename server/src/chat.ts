import { getKv, setKv } from "./db.js";
import type { ThreadMember } from "@remy/contract";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { agentCommand } from "./agent.js";
import { getAgent, gitIdentityEnv, resolvedAgentModel, type Agent } from "./agents.js";
import { memoryPrompt } from "./agent-memories.js";
import { deviceId } from "./board-log.js";
import {
  redactForCwd,
  redactKnownSecrets,
  runWithEnvironment,
  type RuntimeCommandInput,
  type RuntimeCommandResult,
} from "./environments.js";
import { providerEffort, providerId, providerModel, provider as providerOf, type ProviderId } from "./providers.js";
import {
  providerAdapter,
  type ProviderApprovalDecision,
  type ProviderApprovalRequest,
  type ProviderEvent,
  type ProviderQuestionRequest,
  type ProviderRun,
  type ProviderSession,
} from "./provider-adapters/index.js";
import {
  assertChatStorage,
  chatStorageError,
  deleteEntries,
  loadChats,
  removeChat,
  saveChat,
  saveEntry,
  trimEntries,
} from "./chat-storage.js";
import { chatWindow, type ChatHistory } from "./chat-window.js";
import { config } from "./config.js";
import { suggestName } from "./namer.js";
import { remyMcpProcess } from "./mcp-process.js";
import { broadcast, sendNotification } from "./notify.js";
import { syncSleepAssertion } from "./sleep.js";
import {
  buildDiff,
  clip,
  describeTool,
  MAX_TEXT,
  type ContextUsage,
  type ConvDiffLine,
  type ConvEntry,
  type ConvQuestion,
  type ConvTodo,
  type Conversation,
  type ChatCodeReference,
  type ChatImageAttachment,
} from "./transcript.js";
import { codeReferencePrompt } from "./chat-references.js";
import { inProcessTicketMcpServer, ticketPromptContext } from "./ticket-tools.js";
import { remyToolToken } from "./ticket-tool-auth.js";
import { remyProviderInstructions } from "./ticket-tool-contract.js";
import { forgetChat, linkTicketFromWorkPrompt, syncTicketFromThread } from "./tickets.js";
import { readChatImage } from "./chat-attachments.js";
import { uploadRoot } from "./uploads.js";
import { nameDetachedWorktree } from "./workspaces.js";

// Chats are conversations Remy owns end to end: the server runs the coding
// agent, keeps the transcript itself, and streams it to every connected client.
// Unlike a tmux session there is no terminal behind this — the feed *is* the
// session, so approvals and questions have to be answered here rather than by
// driving a cursor.
//
// A thread runs through one adapter contract. Each adapter keeps its provider
// conversation alive across turns and emits the same feed vocabulary.

export type ChatState = "idle" | "working" | "needs_input" | "error";
export type { ProviderPermissionMode as ChatPermissionMode } from "./provider-adapters/index.js";
import type { ProviderPermissionMode as ChatPermissionMode } from "./provider-adapters/index.js";

const PERMISSION_MODES: ChatPermissionMode[] = [
  "default",
  "auto",
  "acceptEdits",
  "plan",
  "bypassPermissions",
];

/// A tool call the agent is blocked on. Mirrors the shape of a tool entry so the
/// client can render the pending card with the same vocabulary as the feed.
export interface ChatApproval {
  requestId: string;
  tool: string;
  verb: string;
  arg: string;
  /// The prompt sentence the CLI itself would have shown, when it supplies one.
  title?: string;
  reason?: string;
  file?: string;
  diff?: ConvDiffLine[];
  /// ExitPlanMode's proposed plan, so the card can show what is being approved.
  plan?: string;
  /// Whether "always allow" is on offer — it isn't for one-off shapes like a
  /// plan hand-off, where a blanket rule would mean nothing.
  allowAlways: boolean;
  at: number;
}

export interface ChatQuestionRequest {
  requestId: string;
  questions: ConvQuestion[];
}

/// What survives a server restart, held in SQLite (see chat-storage.ts). The
/// live query, its pending approvals, and the streaming block cursors are all
/// runtime-only: a restart resumes the Claude session by id and starts a fresh
/// process.
interface ChatRecord {
  id: string;
  title: string;
  cwd: string;
  /// Which agent this thread thinks with.
  provider: ProviderId;
  model?: string;
  effort?: string;
  permissionMode: ChatPermissionMode;
  /// True when this is an agent's inbox conversation rather than work in a
  /// repository. One per agent, and never listed among the threads.
  dm?: boolean;
  /// When you last had this conversation open. What makes an inbox row bold.
  readAt?: number;
  pinned?: boolean;
  /// A parallel session sharing its parent thread's checkout.
  parentChatId?: string;
  createdAt: number;
  updatedAt: number;
  claudeSessionId?: string;
  /// Codex's own id for this conversation, which is what resumes it. Kept
  /// alongside `claudeSessionId` rather than replacing it, so a thread moved to
  /// the other provider and back picks up where each of them left off.
  codexThreadId?: string;
  /// Cursor's ACP session id. It is separate for the same reason as Codex's:
  /// moving away and back resumes each provider's own conversation.
  cursorSessionId?: string;
  /// The persona this thread runs as, if it was started as one. Decides the
  /// instructions appended to the preset and the name on its commits.
  agentId?: string;
  entries: ConvEntry[];
  todos: ConvTodo[];
  context?: ContextUsage;
  turns: number;
  costUsd?: number;
  error?: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  cwd: string;
  provider: ProviderId;
  model?: string;
  effort?: string;
  permissionMode: ChatPermissionMode;
  agentId?: string;
  /// True when this is the conversation with an agent in the inbox. It has an
  /// agent, it has no work of its own, and there is exactly one per agent.
  dm?: boolean;
  /// The agent has spoken since you last opened this. Derived rather than
  /// stored, so it clears the moment you read it on any device.
  unread?: boolean;
  /// Pinned threads lead the thread list on every client of this machine.
  pinned?: boolean;
  /// The parent thread this parallel session belongs to.
  parentChatId?: string;
  createdAt: number;
  updatedAt: number;
  state: ChatState;
  action?: string;
  preview?: string;
  /// When the chat started the run it is in, if it is in one. Absent once it
  /// settles, so a client never shows a clock for a chat that is done.
  workingSince?: number;
  context?: ContextUsage;
  turns: number;
  costUsd?: number;
  error?: string;
  /// True while a chat is holding a live agent process, so the client can say
  /// which chats are warm and which will resume on the next message. A Codex
  /// thread is warm only while a turn is running: it holds nothing between them.
  live: boolean;
}

export interface ChatDetail extends ChatSummary {
  entries: ConvEntry[];
  todos: ConvTodo[];
  history?: ChatHistory;
  approval?: ChatApproval;
  question?: ChatQuestionRequest;
}

// The feed a client renders. Older turns stay in Claude's own transcript; this
// is the window Remy keeps.
const MAX_ENTRIES = 500;
const INITIAL_CHAT_WINDOW_BYTES = 96 * 1024;
// A chat with no live turn drops its Claude process after this, and resumes by
// session id on the next message. Long-lived chats would otherwise pin one
// `claude` process each for as long as the host is up.
const IDLE_SHUTDOWN_MS = 15 * 60_000;
// Text arrives token by token; repainting every client on every token would
// spend the whole tailnet budget on one paragraph.
const STREAM_FLUSH_MS = 120;

function nowMs(): number {
  return Date.now();
}

function titleFrom(text: string): string {
  const line = text.trim().split("\n").find((l) => l.trim()) ?? text.trim();
  return clip(line, 60) || "New chat";
}

export function permissionMode(value: unknown, fallback: ChatPermissionMode = "default"): ChatPermissionMode {
  return PERMISSION_MODES.includes(value as ChatPermissionMode) ? (value as ChatPermissionMode) : fallback;
}

/// launchd hands the server a stripped PATH. Claude's own Bash tool inherits it,
/// so without this a chat would fail on `git`, `gh`, or `node` while the same
/// command works in a tmux session started from a login shell.
export function agentEnvironment(agent?: Agent): NodeJS.ProcessEnv {
  const extra = ["/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".local", "bin"), "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const current = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const merged = [...new Set([...current, ...extra])].join(delimiter);
  // Git reads its identity from the environment ahead of any config file, so an
  // agent signs its own commits without a line being written to ~/.gitconfig or
  // to the repository — and two agents committing in one worktree stay distinct.
  return { ...process.env, PATH: merged, ...gitIdentityEnv(agent) };
}

interface ChatPrompt {
  text: string;
  attachments: ChatImageAttachment[];
}

interface PendingResponse {
  decision: ProviderApprovalDecision;
  answers?: Record<string, unknown>;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export class Chat {
  record: ChatRecord;
  private currentState: ChatState = "idle";
  /// When the current run of work began, so a client can say how long a chat
  /// has been at it. A turn that stops to ask you something is still the same
  /// run, so this survives `needs_input` and clears only when the chat settles.
  workingSince?: number;
  action?: string;
  approval?: ChatApproval;
  question?: ChatQuestionRequest;

  private providerSession?: ProviderSession;
  private providerRun?: ProviderRun;
  private providerDrain?: Promise<void>;
  private providerQueue: ChatPrompt[] = [];
  private restartAfterTurn = false;
  private activePermissionMode?: ChatPermissionMode;
  private pending = new Map<string, (result: PendingResponse) => void>();
  private byId = new Map<string, ConvEntry>();
  private flushTimer?: NodeJS.Timeout;
  private dirtyEntries = new Set<string>();
  private lastActivity = nowMs();
  private lastPersist = 0;
  private deleted = false;
  private peakTokens = 0;
  private compactions = 0;
  constructor(record: ChatRecord) {
    this.record = record;
    this.peakTokens = Math.max(record.context?.peakTokens ?? 0, record.context?.tokens ?? 0);
    for (const entry of record.entries) this.byId.set(entry.id, entry);
  }

  get id(): string {
    return this.record.id;
  }

  get isLive(): boolean {
    return this.providerSession !== undefined || this.providerDrain !== undefined;
  }

  get state(): ChatState {
    return this.currentState;
  }

  /// Every transition runs through here so the "how long" clock is kept by the
  /// one place that knows a run started, rather than by each of the dozen
  /// callers that move the state.
  set state(next: ChatState) {
    if (next === this.currentState) return;
    const busy = next === "working" || next === "needs_input";
    this.workingSince = busy ? (this.workingSince ?? nowMs()) : undefined;
    this.currentState = next;
    // A ticket following this thread starts from Todo, then moves between In
    // progress and Needs input — see `syncTicketFromThread`.
    try {
      syncTicketFromThread(this.record.id, next);
    } catch (error) {
      console.error(`chat ${this.record.id} could not update its ticket:`, error);
    }
  }

  summary(): ChatSummary {
    const lastText = [...this.record.entries]
      .reverse()
      .find((e) => (e.kind === "assistant" || e.kind === "user") && e.text?.trim());
    return {
      id: this.record.id,
      title: this.record.title,
      cwd: this.record.cwd,
      provider: this.record.provider,
      model: this.record.model,
      effort: this.record.effort,
      permissionMode: this.record.permissionMode,
      ...(this.record.agentId ? { agentId: this.record.agentId } : {}),
      ...(this.record.dm ? { dm: true } : {}),
      ...(this.unread() ? { unread: true } : {}),
      ...(this.record.pinned ? { pinned: true } : {}),
      ...(this.record.parentChatId ? { parentChatId: this.record.parentChatId } : {}),
      createdAt: this.record.createdAt,
      updatedAt: this.record.updatedAt,
      state: this.state,
      action: this.action,
      preview: lastText?.text ? clip(lastText.text, 140) : undefined,
      workingSince: this.workingSince,
      context: this.record.context,
      turns: this.record.turns,
      costUsd: this.record.costUsd,
      error: this.record.error,
      live: this.isLive,
    };
  }

  /// Whether the last thing said here was the agent's, and said after you last
  /// looked. A turn still running is not unread: you have not been left
  /// anything to read yet.
  private unread(): boolean {
    const last = [...this.record.entries]
      .reverse()
      .find((entry) => entry.kind === "assistant" || entry.kind === "user");
    if (last?.kind !== "assistant") return false;
    return this.record.updatedAt > (this.record.readAt ?? 0);
  }

  markRead(): void {
    if (this.record.readAt === this.record.updatedAt) return;
    this.record.readAt = this.record.updatedAt;
    this.persist();
    this.push();
  }

  /// Says something in this conversation as Remy rather than as the agent.
  ///
  /// Nothing reaches a provider: no turn runs, no token is spent, and the agent
  /// does not read it back on its next turn. It is Remy talking in the agent's
  /// conversation, which is what an announcement is.
  post(text: string): void {
    if (!text.trim()) return;
    this.record.updatedAt = nowMs();
    this.append({ id: `n-${randomUUID()}`, kind: "assistant", text: clip(text, MAX_TEXT) });
    this.persist();
    this.push();
  }

  detail(): ChatDetail {
    return {
      ...this.summary(),
      entries: this.record.entries,
      todos: this.record.todos,
      approval: this.approval,
      question: this.question,
    };
  }

  detailWindow(turns: number, before?: string): ChatDetail {
    const page = chatWindow(this.record.entries, turns, before, INITIAL_CHAT_WINDOW_BYTES);
    return { ...this.detail(), ...page };
  }

  // ── sending ──────────────────────────────────────────────────────────────

  async send(
    text: string,
    attachments: ChatImageAttachment[] = [],
    codeReferences: ChatCodeReference[] = [],
    agentContext?: string,
    messageId?: string,
    member?: ThreadMember,
  ): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed && codeReferences.length === 0) return;
    const entryId = messageId ?? `u-${randomUUID()}`;
    if (this.record.entries.some((entry) => entry.id === entryId)) return;
    const safeText = await redactForCwd(this.record.cwd, trimmed || "Review these comments.");
    const safeReferences = await Promise.all(codeReferences.map(async (reference) => ({
      ...reference,
      comment: await redactForCwd(this.record.cwd, reference.comment),
      lines: await Promise.all(reference.lines.map(async (line) => ({
        ...line,
        text: await redactForCwd(this.record.cwd, line.text),
      }))),
    })));
    const first = this.record.entries.length === 0;
    // A DM is called after the agent you are talking to, and stays called that
    // however the conversation opens.
    if (first && !this.record.dm && this.record.title === "New chat") {
      this.record.title = titleFrom(safeText);
    }
    // A better name is worth having but not worth waiting for, so it runs
    // alongside the turn and lands whenever it lands.
    if (first && !this.record.dm) void this.rename(safeText);
    const ticketOwnerId = this.record.parentChatId ?? this.record.id;
    linkTicketFromWorkPrompt(ticketOwnerId, safeText, this.record.agentId);
    const ticketContext = ticketPromptContext(ticketOwnerId);
    const routineContext = this.record.dm
      ? `<remy_routine_context>
This is the agent's Inbox conversation. When the person signals that something should happen repeatedly, routinely, or on a cadence, use Remy's create_routine tool directly. Do not use a scheduling skill, shell command, cron, or an outside automation. The routine belongs to this agent and Remy runs it on the preferred available device.
</remy_routine_context>`
      : undefined;
    const referenceContext = codeReferencePrompt(safeReferences);
    const remembered = this.record.agentId ? await memoryPrompt(this.record.agentId, this.record.cwd) : undefined;
    const agentText = [remembered, ticketContext, routineContext, referenceContext, agentContext, safeText]
      .filter(Boolean)
      .join("\n\n");
    const agentPrompt: ChatPrompt = { text: agentText, attachments };
    this.append({
      id: entryId,
      kind: "user",
      ...(member ? { member } : {}),
      text: clip(safeText, MAX_TEXT),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(safeReferences.length > 0 ? { codeReferences: safeReferences } : {}),
    });
    this.record.error = undefined;
    // A prompt typed while the provider is blocked on a permission is queued behind
    // it, so the chat is still waiting on the human, not working.
    this.state = this.pending.size > 0 ? "needs_input" : "working";
    this.action = undefined;
    this.lastActivity = nowMs();
    this.providerQueue.push(agentPrompt);
    if (!this.providerDrain) {
      const drain = this.drainProvider().finally(() => {
        if (this.providerDrain === drain) this.providerDrain = undefined;
      });
      this.providerDrain = drain;
    }
    this.push();
    this.persist();
  }

  /// Interrupts the running turn. Anything the agent is blocked on is denied
  /// first — a permission request that outlives its turn would block the next.
  async interrupt(): Promise<void> {
    this.settlePending("User stopped the turn.");
    // Anything typed while it was working was never sent, so it goes too.
    this.providerQueue = [];
    this.providerRun?.interrupt();
    this.state = "idle";
    this.action = undefined;
    this.push();
  }

  respondApproval(requestId: string, decision: "allow" | "allowAlways" | "deny", member?: ThreadMember): void {
    // `settle` owns removing the request — deleting it here first would make it
    // a no-op and leave Claude parked on a permission it thinks is unanswered.
    const settle = this.pending.get(requestId);
    if (!settle) throw new Error("that request is no longer waiting");
    if (member) this.recordResponse(member, "approval", requestId, decision);
    const approval = this.approval?.requestId === requestId ? this.approval : undefined;
    this.state = "working";
    if (decision === "deny") {
      settle({ decision: "deny" });
    } else {
      settle({ decision: decision === "allowAlways" ? "allowAlways" : "allow" });
      if (approval?.tool === "ExitPlanMode" && this.record.permissionMode === "plan") {
        this.record.permissionMode = "default";
        this.persist();
      }
    }
    this.push();
  }

  respondQuestion(requestId: string, answers: Record<string, unknown>, member?: ThreadMember): void {
    const settle = this.pending.get(requestId);
    if (!settle) throw new Error("that question is no longer waiting");
    if (member) this.recordResponse(member, "question", requestId, answers);
    this.state = "working";
    settle({ decision: "allow", answers });
    this.push();
  }

  private recordResponse(member: ThreadMember, kind: "approval" | "question", requestId: string, value: unknown): void {
    this.append({ id: `response-${requestId}`, kind: "user", member, response: { kind, requestId, value: JSON.parse(redactKnownSecrets(JSON.stringify(value))) }, text: kind === "approval" ? (value === "deny" ? "Declined permission." : value === "allowAlways" ? "Always allowed permission." : "Allowed permission.") : clip(redactKnownSecrets(Object.entries(value as Record<string, unknown>).map(([question, answer]) => `${question}\n${typeof answer === "string" ? answer : JSON.stringify(answer)}`).join("\n\n")), MAX_TEXT) });
    this.persist();
  }

  /// Ends the agent's process but keeps the chat: the next message resumes the
  /// same conversation through its recorded session id.
  stop(): void {
    this.settlePending("Session stopped.");
    this.providerQueue = [];
    this.providerRun?.interrupt();
    this.providerRun = undefined;
    this.providerSession?.close();
    this.providerSession = undefined;
    this.restartAfterTurn = false;
    this.activePermissionMode = undefined;
    if (this.state === "working") this.state = "idle";
    this.push();
  }

  /// Retires a provider session without interrupting the turn it is running.
  /// The changed settings are already stored, so the next turn starts with them.
  reconfigure(): void {
    if (!this.isLive) return;
    if (this.state === "idle" || this.state === "error") {
      this.stop();
      return;
    }
    this.restartAfterTurn = true;
  }

  maybeReap(): void {
    if (!this.providerSession || this.state !== "idle") return;
    if (nowMs() - this.lastActivity < IDLE_SHUTDOWN_MS) return;
    this.stop();
  }

  /// Replaces the first-line title with one the naming model wrote, and puts a
  /// branch on the worktree if this thread is running in one Remy left
  /// detached. Only ever touches a title nobody has changed in the meantime —
  /// yours wins.
  private async rename(request: string): Promise<void> {
    const before = this.record.title;
    const suggested = await suggestName(request, config.remyProvider, config.remyModel, config.remyEffort);
    if (!suggested || this.deleted) return;

    // The branch is claimed even when the title has since been changed by hand:
    // one is about the work, the other is about the list.
    let branched = false;
    if (suggested.branch) {
      const prefix = config.worktreeBranchPrefix;
      branched = await nameDetachedWorktree(
        this.record.cwd,
        prefix ? `${prefix}/${suggested.branch}` : suggested.branch,
      );
    }

    const renamed = this.record.title === before && suggested.title !== before;
    if (renamed) {
      this.record.title = suggested.title;
      this.record.updatedAt = nowMs();
      this.persist();
    }
    if (!renamed && !branched) return;
    // stateFields carries the title, so an open thread renames itself without
    // refetching; `chats` is what makes a client re-read the worktrees.
    this.push();
    broadcast({ type: "chat-list", operation: "upsert", chat: this.summary() });
    broadcast({ type: "chats" });
  }

  // ── provider session ─────────────────────────────────────────────────────

  private async drainProvider(): Promise<void> {
    while (this.providerQueue.length > 0 && !this.deleted) {
      const prompt = this.providerQueue.shift()!;
      await this.providerTurn(prompt);
    }
  }

  private async providerTurn(prompt: ChatPrompt): Promise<void> {
    const agent = this.record.agentId ? getAgent(this.record.agentId) : undefined;
    this.activePermissionMode = this.record.permissionMode;
    let run: ProviderRun;
    try {
      if (!this.providerSession) {
        const adapter = providerAdapter(this.record.provider);
        let session!: ProviderSession;
        session = adapter.createSession(
          {
            command: agentCommand(this.record.provider)!,
            cwd: this.record.cwd,
            ...(this.record.model ? { model: this.record.model } : {}),
            ...(this.record.effort ? { effort: this.record.effort } : {}),
            permissionMode: this.record.permissionMode,
            ...(providerSessionId(this.record, this.record.provider)
              ? { sessionId: providerSessionId(this.record, this.record.provider) }
              : {}),
            additionalDirectories: [uploadRoot],
            developerInstructions: remyProviderInstructions(getKv<string>(`hubPersona:${this.record.id}`) ?? agent?.instructions),
            inProcessMcp: inProcessTicketMcpServer(this.record.id, this.record.agentId, this.record.dm === true, {
              currentCwd: this.record.cwd,
              list: listChats,
              read: getChat,
              start: async (input) => {
                const created = createChat({
                  cwd: input.cwd,
                  title: input.title?.trim() || input.prompt.split("\n")[0]?.trim().slice(0, 120),
                  provider: input.provider,
                  model: input.model,
                  agentId: input.agentId,
                });
                await sendChatMessage(created.id, input.prompt);
                return getChat(created.id)!;
              },
              send: sendChatMessage,
              stop: stopChat,
              runEnvironment: (input) => this.runEnvironmentCommand(input),
            }),
            mcpProcess: remyMcpProcess({
              apiUrl: `http://127.0.0.1:${config.port}`,
              token: remyToolToken(this.record.id),
              chatId: this.record.id,
              hubInbox: getKv<boolean>(`hubInbox:${this.record.id}`)===true,
              deviceId,
              agentId: this.record.agentId,
              dm: this.record.dm,
            }),
            env: agentEnvironment(agent),
            entries: this.record.entries,
          },
          {
            event: (event) => {
              try {
                this.handleProviderEvent(session, event);
              } catch (error) {
                console.error(`${this.record.provider} event handling failed:`, error);
              }
            },
            approve: (request) => this.providerApproval(request),
            answer: (request) => this.providerQuestion(request),
          },
        );
        this.providerSession = session;
      }
      run = this.providerSession.turn({
        prompt: prompt.text,
        images: prompt.attachments.map((attachment) => {
          const image = readChatImage(this.record.id, attachment);
          return { dataUrl: image.dataUrl, base64: image.base64, mimeType: attachment.mimeType };
        }),
        ...(this.record.model ? { model: this.record.model } : {}),
        ...(this.record.effort ? { effort: this.record.effort } : {}),
        permissionMode: this.record.permissionMode,
      });
    } catch (error) {
      this.failTurn(error);
      return;
    }
    this.providerRun = run;
    this.state = "working";
    this.push();
    try {
      await run.done;
    } catch (error) {
      this.failTurn(error);
      return;
    } finally {
      if (this.providerRun === run) this.providerRun = undefined;
      if (this.restartAfterTurn) {
        this.providerSession?.close();
        this.providerSession = undefined;
        this.restartAfterTurn = false;
      }
      this.activePermissionMode = undefined;
      this.record.updatedAt = nowMs();
      this.flush();
      this.persist();
    }
    if (this.providerQueue.length > 0) {
      this.push();
      return;
    }
    this.state = "idle";
    this.action = undefined;
    this.push();
    this.notifyTurnEnd().catch(() => {});
  }

  private handleProviderEvent(session: ProviderSession, event: ProviderEvent): void {
    if (this.providerSession !== session) return;
    this.lastActivity = nowMs();
    switch (event.type) {
      case "session.closed":
        if (this.providerSession === session) this.providerSession = undefined;
        return;
      case "session.started":
        if (event.sessionId !== providerSessionId(this.record, this.record.provider)) {
          setProviderSessionId(this.record, this.record.provider, event.sessionId);
          this.persist();
        }
        return;
      case "turn.started":
        this.state = "working";
        this.record.turns += 1;
        this.push();
        return;
      case "turn.completed":
        if (event.turns !== undefined) this.record.turns = event.turns;
        if (event.costUsd !== undefined) this.record.costUsd = event.costUsd;
        this.completeLatestMessage();
        if (!this.providerRun) {
          this.state = this.pending.size > 0 ? "needs_input" : "idle";
          this.action = undefined;
          this.record.updatedAt = nowMs();
          this.flush();
          this.persist();
          this.push();
          if (this.state === "idle") this.notifyTurnEnd().catch(() => {});
        }
        return;
      case "turn.failed":
        this.recordFailure(event.error);
        return;
      case "usage.updated":
        this.noteTokens(event.tokens, event.model ?? this.record.model, event.limit);
        if (event.costUsd !== undefined) this.record.costUsd = event.costUsd;
        this.push();
        if (nowMs() - this.lastPersist > 5_000) this.persist();
        return;
      case "compacted":
        this.compactions += 1;
        return;
      case "todos.updated":
        this.record.todos = event.todos;
        this.push();
        return;
      case "entry.updated":
        this.upsert(event.entry);
        if (event.entry.kind === "tool") {
          this.action = `${event.entry.verb ?? ""} ${event.entry.arg ?? ""}`.trim();
          this.push();
        }
        return;
    }
  }

  private completeLatestMessage(): void {
    const entry = [...this.record.entries]
      .reverse()
      .find((item) => item.kind === "assistant" || item.kind === "thinking");
    if (!entry || entry.completedAt) return;
    entry.completedAt = nowMs();
    this.markDirty(entry.id);
  }

  private failTurn(error: unknown): void {
    this.providerRun = undefined;
    this.providerSession?.close();
    this.providerSession = undefined;
    const message = redactKnownSecrets(error instanceof Error ? error.message : String(error));
    this.recordFailure(message);
    this.state = "error";
    this.providerQueue = [];
    this.flush();
    this.push();
    this.persist();
    void sendNotification({
      session: this.record.id,
      click: `remy://chat/${this.record.id}`,
      title: `${this.record.title} failed`,
      message: clip(this.record.error ?? message, 200),
      highPriority: true,
    });
  }

  private recordFailure(detail: string): void {
    if (/abort|interrupt|cancel|SIGTERM/i.test(detail)) return;
    const safe = redactKnownSecrets(detail);
    this.record.error = providerAdapter(this.record.provider).errorMessage?.(safe) ?? safe;
  }

  switchProvider(next: ProviderId): void {
    if (next === this.record.provider) return;
    this.providerRun?.interrupt();
    this.providerSession?.close();
    this.providerRun = undefined;
    this.providerSession = undefined;
    this.providerQueue = [];
    this.record.provider = next;
    this.record.model = undefined;
    this.record.effort = undefined;
    this.append({
      id: `p-${randomUUID()}`,
      kind: "assistant",
      text: `— moved to ${providerOf(next)?.label ?? next} —`,
    });
  }

  // ── permissions ──────────────────────────────────────────────────────────

  private async providerApproval(request: ProviderApprovalRequest): Promise<ProviderApprovalDecision> {
    if (request.trusted) return "allow";
    const permission = this.activePermissionMode ?? this.record.permissionMode;
    if (permission === "bypassPermissions") return "allowAlways";
    if (permission === "acceptEdits" && request.edit) return "allowAlways";
    if (permission === "plan" && request.tool !== "ExitPlanMode") return "deny";
    return this.requestToolApproval(request.tool, request.input, {
      signal: request.signal,
      title: request.title,
      reason: request.reason,
      allowAlways: request.allowAlways,
    });
  }

  private requestToolApproval(
    tool: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal; title?: string; reason?: string; allowAlways?: boolean },
  ): Promise<ProviderApprovalDecision> {
    const requestId = randomUUID();
    const described = describeTool(tool, input);
    const diff = buildDiff(tool, input);
    const plan = tool === "ExitPlanMode" ? str(input.plan) : undefined;
    this.approval = {
      requestId,
      tool,
      verb: described.verb,
      arg: described.arg,
      ...(options.title ? { title: options.title } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
      ...(described.file ? { file: described.file } : {}),
      ...(diff.length ? { diff } : {}),
      ...(plan ? { plan: clip(plan, 4000) } : {}),
      allowAlways: options.allowAlways ?? tool !== "ExitPlanMode",
      at: nowMs(),
    };
    this.state = "needs_input";
    this.push();
    void sendNotification({
      session: this.record.id,
      click: `remy://chat/${this.record.id}`,
      title: `${this.record.title} needs approval`,
      message: options.title ?? `${described.verb} ${described.arg}`.trim(),
      highPriority: true,
    });
    return this.park(requestId, options.signal, () => {
      if (this.approval?.requestId === requestId) this.approval = undefined;
    }).then((result) => result.decision);
  }

  private async providerQuestion(request: ProviderQuestionRequest): Promise<Record<string, unknown>> {
    const result = await this.askUserQuestion(request.questions, request.signal);
    return result.decision === "deny" ? {} : result.answers ?? {};
  }

  private askUserQuestion(questions: ConvQuestion[], signal: AbortSignal): Promise<PendingResponse> {
    const requestId = randomUUID();
    this.question = { requestId, questions };
    this.state = "needs_input";
    this.push();
    void sendNotification({
      session: this.record.id,
      click: `remy://chat/${this.record.id}`,
      title: `${this.record.title} needs input`,
      message: questions[0]?.question ? clip(questions[0].question, 200) : "The agent asked you a question.",
      highPriority: true,
    });
    return this.park(requestId, signal, () => {
      if (this.question?.requestId === requestId) this.question = undefined;
    });
  }

  private park(requestId: string, signal: AbortSignal, cleanup: () => void): Promise<PendingResponse> {
    return new Promise((resolve) => {
      const settle = (result: PendingResponse) => {
        if (!this.pending.has(requestId)) return;
        this.pending.delete(requestId);
        cleanup();
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = () => {
        settle({ decision: "deny" });
        this.state = this.pending.size > 0 ? "needs_input" : "idle";
        this.push();
      };
      this.pending.set(requestId, settle);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private settlePending(_message: string): void {
    for (const settle of [...this.pending.values()]) settle({ decision: "deny" });
    this.pending.clear();
    this.approval = undefined;
    this.question = undefined;
  }

  async runEnvironmentCommand(input: RuntimeCommandInput): Promise<RuntimeCommandResult> {
    const permission = this.activePermissionMode ?? this.record.permissionMode;
    if (permission === "plan") throw new Error("runtime commands are unavailable in plan mode");
    if (permission === "default" || permission === "acceptEdits") {
      const decision = await this.requestToolApproval("Bash", {
        command: [input.program, ...(input.args ?? [])].join(" "),
      }, {
        signal: new AbortController().signal,
        title: "Run with the workspace environment?",
        reason: "The command receives configured values, and exact matches are removed from its output.",
        allowAlways: false,
      });
      if (decision === "deny") throw new Error("the runtime command was denied");
    }
    return runWithEnvironment(this.record.cwd, input);
  }

  private upsert(entry: ConvEntry): void {
    if (entry.kind === "tool" && entry.status) entry.completedAt ??= nowMs();
    const existing = this.byId.get(entry.id);
    if (!existing) {
      this.append(entry);
      return;
    }
    Object.assign(existing, entry);
    if (entry.kind === "tool" && entry.status) existing.completedAt ??= nowMs();
    this.markDirty(entry.id);
  }

  private async notifyTurnEnd(): Promise<void> {
    const last = [...this.record.entries].reverse().find((entry) => entry.kind === "assistant" && entry.text?.trim());
    await sendNotification({
      session: this.record.id,
      click: `remy://chat/${this.record.id}`,
      title: `${this.record.title} finished`,
      message: last?.text ? clip(last.text, 200) : "The turn is done.",
      highPriority: false,
    });
  }

  private noteTokens(tokens: number, model?: string, exactLimit?: number): void {
    if (tokens <= 0) return;
    if (tokens > this.peakTokens) this.peakTokens = tokens;
    const limit = exactLimit && exactLimit > 0
      ? exactLimit
      : this.peakTokens > config.contextLimit ? 1_000_000 : config.contextLimit;
    this.record.context = {
      tokens,
      peakTokens: this.peakTokens,
      limit,
      limitEstimated: !exactLimit,
      model: model ?? this.record.context?.model,
      compactions: this.compactions,
      droppedTokens: this.record.context?.droppedTokens ?? 0,
    };
  }

  // ── feed bookkeeping ─────────────────────────────────────────────────────

  private append(entry: ConvEntry, options: { defer?: boolean } = {}): void {
    entry.at ??= nowMs();
    redactEntry(entry);
    this.record.entries.push(entry);
    this.byId.set(entry.id, entry);
    if (!this.deleted) saveEntry(this.record.id, entry);
    if (this.record.entries.length > MAX_ENTRIES) {
      const dropped = this.record.entries.splice(0, this.record.entries.length - MAX_ENTRIES);
      for (const old of dropped) this.byId.delete(old.id);
      if (!this.deleted) trimEntries(this.record.id, MAX_ENTRIES);
    }
    this.record.updatedAt = nowMs();
    this.markDirty(entry.id);
    if (!options.defer) this.flush();
  }

  private remove(id: string): void {
    const index = this.record.entries.findIndex((e) => e.id === id);
    if (index < 0) return;
    this.record.entries.splice(index, 1);
    this.byId.delete(id);
    this.dirtyEntries.delete(id);
    if (!this.deleted) deleteEntries(this.record.id, [id]);
    // Carries the scalar state too, so a client can always tell "cleared" from
    // "unchanged" by whether a push mentions state at all.
    broadcast({ type: "chat", chatId: this.record.id, removed: [id], ...this.stateFields() });
  }

  private markDirty(id: string): void {
    this.dirtyEntries.add(id);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, STREAM_FLUSH_MS);
    this.flushTimer.unref?.();
  }

  /// Send whatever changed since the last flush. Text deltas coalesce here, so
  /// a streaming paragraph costs a handful of messages rather than hundreds.
  private flush(): void {
    if (this.dirtyEntries.size === 0) return;
    const entries = [...this.dirtyEntries]
      .map((id) => this.byId.get(id))
      .filter((e): e is ConvEntry => !!e)
      .map(redactEntry);
    this.dirtyEntries.clear();
    if (entries.length === 0 || this.deleted) return;
    for (const entry of entries) saveEntry(this.record.id, entry);
    broadcast({ type: "chat", chatId: this.record.id, entries, ...this.stateFields() });
    // The feed is durable as it streams now, so this only keeps the chat row's
    // own columns — updatedAt, usage, the live action — roughly current.
    if (nowMs() - this.lastPersist > 5_000) this.persist();
  }

  /// The scalar state, always sent whole so a client never has to work out
  /// whether a missing field means "unchanged" or "cleared".
  private stateFields(): Record<string, unknown> {
    return {
      state: this.state,
      action: this.action ?? null,
      workingSince: this.workingSince ?? null,
      approval: this.approval ?? null,
      question: this.question ?? null,
      todos: this.record.todos,
      context: this.record.context ?? null,
      title: this.record.title,
      live: this.isLive,
      error: this.record.error ?? null,
      updatedAt: this.record.updatedAt,
      // Carried on every frame so an inbox row goes bold the moment the agent
      // stops talking, rather than on the next poll.
      unread: this.unread(),
    };
  }

  push(): void {
    if (this.deleted) return;
    broadcast({ type: "chat", chatId: this.record.id, ...this.stateFields() });
    syncSleepAssertion();
  }

  persist(): void {
    if (this.deleted) return;
    this.lastPersist = nowMs();
    saveChat(this.record);
  }

  /// Called once the chat is gone from the store. A turn already in flight keeps
  /// draining into a record nobody reads, but it must not write it back to disk
  /// or push it at clients that have dropped it.
  markDeleted(): void {
    this.deleted = true;
  }
}

function providerSessionId(record: ChatRecord, provider: ProviderId): string | undefined {
  if (provider === "claude") return record.claudeSessionId;
  if (provider === "codex") return record.codexThreadId;
  return record.cursorSessionId;
}

function setProviderSessionId(record: ChatRecord, provider: ProviderId, sessionId: string): void {
  if (provider === "claude") record.claudeSessionId = sessionId;
  else if (provider === "codex") record.codexThreadId = sessionId;
  else record.cursorSessionId = sessionId;
}

/// Takes a workspace's environment values out of a feed entry, in place.
///
/// In place, and returning the entry it was given, on purpose. A streaming text
/// Adapters can keep streaming into an entry while the feed, database and socket
/// all read it through `byId`. Mutating in place keeps those references aligned.
export function redactEntry(entry: ConvEntry): ConvEntry {
  if (entry.activity) {
    for (const key of ["title", "command", "progress", "output", "model"] as const) {
      if (entry.activity[key] !== undefined) entry.activity[key] = redactKnownSecrets(entry.activity[key]!);
    }
  }
  if (entry.text !== undefined) entry.text = redactKnownSecrets(entry.text);
  if (entry.arg !== undefined) entry.arg = redactKnownSecrets(entry.arg);
  if (entry.output !== undefined) entry.output = redactKnownSecrets(entry.output);
  for (const line of entry.diff ?? []) line.text = redactKnownSecrets(line.text);
  for (const reference of entry.codeReferences ?? []) {
    reference.comment = redactKnownSecrets(reference.comment);
    for (const line of reference.lines) line.text = redactKnownSecrets(line.text);
  }
  for (const question of entry.questions ?? []) {
    question.question = redactKnownSecrets(question.question);
    if (question.answer !== undefined) question.answer = redactKnownSecrets(question.answer);
    if (question.notes !== undefined) question.notes = redactKnownSecrets(question.notes);
    for (const option of question.options) {
      option.label = redactKnownSecrets(option.label);
      if (option.description !== undefined) option.description = redactKnownSecrets(option.description);
      if (option.preview !== undefined) option.preview = redactKnownSecrets(option.preview);
    }
  }
  return entry;
}

// ── store ──────────────────────────────────────────────────────────────────

const chats = new Map<string, Chat>();

for (const stored of loadChats(MAX_ENTRIES)) {
  chats.set(
    stored.id,
    new Chat({ ...stored, provider: providerId(stored.provider), permissionMode: permissionMode(stored.permissionMode) }),
  );
}

/// Why chats cannot be used on this server, if they can't. Surfaced by the API
/// so the app explains itself instead of showing an empty list.
export function chatsUnavailable(): string | undefined {
  return chatStorageError();
}

function summaries(): ChatSummary[] {
  return [...chats.values()].map((chat) => chat.summary()).sort((a, b) => b.updatedAt - a.updatedAt);
}

/// The threads: work in a repository. An agent's inbox conversation is not one
/// of these, so it never appears in the thread list or in a thread count.
export function listChats(): ChatSummary[] {
  return summaries().filter((chat) => !chat.dm);
}

/// Everything an archived thread needs to resume as the same conversation.
/// Older archives only have the base `Conversation` fields; every extension is
/// optional so they can still be restored as a fresh provider session.
export interface ArchivedConversation extends Conversation {
  effort?: string;
  permissionMode?: ChatPermissionMode;
  createdAt?: number;
  claudeSessionId?: string;
  codexThreadId?: string;
  cursorSessionId?: string;
  turns?: number;
  costUsd?: number;
  agentId?: string;
  parentChatId?: string;
}

export function archiveConversation(id: string): ArchivedConversation {
  const record = mustGet(id).record;
  return {
    available: true,
    agent: record.provider,
    title: record.title,
    model: record.model,
    effort: record.effort,
    permissionMode: record.permissionMode,
    createdAt: record.createdAt,
    claudeSessionId: record.claudeSessionId,
    codexThreadId: record.codexThreadId,
    cursorSessionId: record.cursorSessionId,
    turns: record.turns,
    costUsd: record.costUsd,
    agentId: record.agentId,
    parentChatId: record.parentChatId,
    context: record.context,
    todos: record.todos,
    entries: record.entries,
  };
}

export function restoreArchivedChat(input: {
  chatId?: string;
  session: string;
  cwd: string | null;
  conversation: ArchivedConversation;
}): ChatSummary {
  const cwd = expandChatCwd(input.cwd ?? "~");
  if (!existsSync(cwd)) throw new Error("that thread's folder is no longer on this machine");
  const id = input.chatId && !chats.has(input.chatId) ? input.chatId : randomUUID();
  const conversation = input.conversation;
  const provider = providerId(conversation.agent, config.defaultProvider);
  const record: ChatRecord = {
    id,
    title: conversation.title?.trim() || input.session || "Archived thread",
    cwd,
    provider,
    ...(conversation.model ? { model: conversation.model } : {}),
    ...(conversation.effort ? { effort: conversation.effort } : {}),
    permissionMode: permissionMode(conversation.permissionMode, config.defaultPermissionMode),
    ...(conversation.agentId ? { agentId: conversation.agentId } : {}),
    ...(conversation.parentChatId ? { parentChatId: conversation.parentChatId } : {}),
    createdAt: conversation.createdAt ?? nowMs(),
    updatedAt: nowMs(),
    ...(conversation.claudeSessionId ? { claudeSessionId: conversation.claudeSessionId } : {}),
    ...(conversation.codexThreadId ? { codexThreadId: conversation.codexThreadId } : {}),
    ...(conversation.cursorSessionId ? { cursorSessionId: conversation.cursorSessionId } : {}),
    entries: conversation.entries,
    todos: conversation.todos,
    ...(conversation.context ? { context: conversation.context } : {}),
    turns: conversation.turns ?? conversation.entries.filter((entry) => entry.kind === "user").length,
    ...(typeof conversation.costUsd === "number" ? { costUsd: conversation.costUsd } : {}),
  };
  const chat = new Chat(record);
  chats.set(id, chat);
  chat.persist();
  for (const entry of record.entries) saveEntry(id, entry);
  broadcast({ type: "chat-list", operation: "upsert", chat: chat.summary() });
  broadcast({ type: "chats" });
  return chat.summary();
}

/// The inbox: one conversation per agent, most recently spoken to first.
///
/// An agent's conversation belongs to the agent, so a row whose agent is gone
/// is not in the inbox — deleted here, deleted on the machine you paired with,
/// or a tombstone that arrived before its conversation was cleaned up.
export function listDms(): ChatSummary[] {
  return summaries().filter((chat) => chat.dm && chat.agentId && getAgent(chat.agentId));
}

/// Clears out conversations whose agent is gone, once, at boot.
///
/// `listDms` already hides them, so this is about the rows rather than the
/// screen: an agent deleted while this machine was shut leaves a conversation
/// behind that nothing will ever ask for again.
export function pruneOrphanDms(): void {
  for (const chat of summaries()) {
    if (chat.dm && (!chat.agentId || !getAgent(chat.agentId))) deleteChat(chat.id);
  }
}

/// Both, for the few callers that mean every conversation this machine is
/// holding — keeping the machine awake while one is working, and shutting them
/// all down. A DM runs a real turn like any other thread.
export function listAllChats(): ChatSummary[] {
  return summaries();
}

/// The one conversation you have with an agent, made the first time you open it.
///
/// It opens in your home folder rather than a repository: work that needs a
/// repository open in front of it is a thread the agent starts, not this. Found
/// by its agent rather than by id, so opening the inbox twice never leaves two
/// conversations behind.
export function dmChatFor(agentId: string): ChatSummary {
  const existing = listDms()
    .filter((chat) => chat.agentId === agentId)
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (existing) return existing;
  const agent = getAgent(agentId);
  if (!agent) throw new Error("no such agent");
  return createChat({ cwd: homedir(), title: agent.name, agentId: agent.id, dm: true });
}

export function getChat(id: string): ChatDetail | undefined {
  return chats.get(id)?.detail();
}

export function getChatWindow(id: string, turns: number, before?: string): ChatDetail | undefined {
  return chats.get(id)?.detailWindow(turns, before);
}

/// Moves an agent's inbox conversation onto what that agent now thinks with.
///
/// A thread keeps the provider it was started on: its transcript is only
/// readable by the tool that wrote it, and the thread is a piece of work with
/// its own history. An inbox conversation is not that — it is the agent, so
/// picking a model for the agent picks it here too, whether that choice was
/// made on the agent or on the machine default it follows.
///
/// A conversation mid-turn is left alone; the next change catches it.
export function syncAgentDm(agentId: string): void {
  const agent = getAgent(agentId);
  if (!agent) {
    // The agent is gone, so the conversation goes with it: it was the agent,
    // and there is nobody left in it to answer.
    for (const chat of summaries()) {
      if (chat.dm && chat.agentId === agentId) deleteChat(chat.id);
    }
    return;
  }
  const dm = listDms().find((chat) => chat.agentId === agentId);
  if (!dm || dm.state === "working" || dm.state === "needs_input") return;
  const { provider, model, effort } = resolvedAgentModel(agent);
  if (dm.provider === provider && (dm.model ?? "") === model && (dm.effort ?? "") === effort) return;
  try {
    updateChat(dm.id, { provider, model: model || null, effort: effort || null }, { allowProviderChange: true });
  } catch (error) {
    // A provider that is off, or a tool that is not installed. The conversation
    // keeps what it had rather than being left pointing at nothing.
    console.error(`could not move @${agent.handle}'s conversation:`, error);
  }
}

/// Every inbox conversation at once, for a change to the machine default that
/// each inherited agent follows.
export function syncAgentDms(): void {
  for (const dm of listDms()) if (dm.agentId) syncAgentDm(dm.agentId);
}

/// Says something in a conversation as Remy. See `Chat.post`.
export function postToChat(id: string, text: string): void {
  chats.get(id)?.post(text);
}

/// Clears an inbox conversation's unread mark. Opening it is what calls this,
/// from whichever device you opened it on.
export function markChatRead(id: string): void {
  chats.get(id)?.markRead();
}

function expandChatCwd(raw: string): string {
  const trimmed = raw.trim() || "~";
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  return trimmed;
}

export function createChat(input: {
  cwd?: string;
  title?: string;
  provider?: unknown;
  model?: string;
  effort?: string;
  permissionMode?: unknown;
  agentId?: string;
  /// Marks this as an agent's inbox conversation. `dmChatFor` is the only
  /// caller that sets it, so there stays one per agent.
  dm?: boolean;
  /// Makes this a parallel session in an existing thread's exact checkout.
  /// The parent owns every execution choice; callers cannot override them.
  parentChatId?: string;
  /// What the workspace this thread opens in runs on, when it does not follow
  /// the machine. The caller resolves it: which workspace holds a directory
  /// takes the worktree list, and this does not wait on git.
  workspaceDefault?: { provider?: string | null; model?: string | null; effort?: string | null };
}): ChatSummary {
  // Refuse loudly rather than running a conversation this server cannot keep.
  assertChatStorage();
  const parent = input.parentChatId ? mustGet(input.parentChatId).record : undefined;
  if (parent?.parentChatId) throw new Error("a subthread cannot start another subthread");
  if (parent?.dm) throw new Error("an inbox conversation cannot have subthreads");
  const cwd = parent?.cwd ?? expandChatCwd(input.cwd ?? "~");
  if (!existsSync(cwd)) throw new Error("that directory does not exist on this machine");
  // An agent brings its own provider, model and permission mode, and anything
  // the caller asked for explicitly still wins over them.
  const inheritedAgentId = parent?.agentId ?? input.agentId;
  const agent = inheritedAgentId ? getAgent(inheritedAgentId) : undefined;
  if (inheritedAgentId && !agent) throw new Error("no such agent");
  // A workspace that runs on something of its own stands where the machine's
  // default would. An agent still outranks it, including one that follows the
  // machine default rather than naming a model of its own.
  const workspace = input.workspaceDefault?.provider
    ? {
        provider: input.workspaceDefault.provider,
        model: input.workspaceDefault.model ?? "",
        effort: input.workspaceDefault.effort ?? "",
      }
    : { provider: config.defaultProvider, model: config.defaultModel, effort: config.defaultEffort };
  const inherited = agent ? resolvedAgentModel(agent) : workspace;
  const askedProvider = providerId(parent?.provider ?? input.provider ?? inherited.provider);
  if (input.provider !== undefined && !config.enabledProviders.includes(askedProvider)) {
    throw new Error("that provider is turned off");
  }
  const provider = config.enabledProviders.includes(askedProvider) ? askedProvider : config.defaultProvider;
  // Fail here rather than on the first message, so a host without the tool says
  // so while the thread is still being created.
  agentCommand(provider);
  // A model belongs to the provider that answers to it, so one meant for the
  // other provider is dropped rather than passed to a CLI that would refuse it.
  // `??` rather than `||`, so asking for a provider's own Default is read as the
  // choice it is instead of a gap to fill with somebody else's model.
  const model = providerModel(provider, parent?.model ?? input.model ?? inherited.model);
  const effort = providerEffort(provider, model, parent?.effort ?? input.effort ?? inherited.effort);
  const record: ChatRecord = {
    id: randomUUID(),
    title: input.title?.trim() || "New chat",
    cwd,
    provider,
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(agent ? { agentId: agent.id } : {}),
    ...(input.dm ? { dm: true } : {}),
    ...(parent ? { parentChatId: parent.id } : {}),
    permissionMode: parent?.permissionMode
      ?? permissionMode(input.permissionMode, agent?.permissionMode ?? config.defaultPermissionMode),
    createdAt: nowMs(),
    updatedAt: nowMs(),
    entries: [],
    todos: [],
    turns: 0,
  };
  const chat = new Chat(record);
  chats.set(record.id, chat);
  chat.persist();
  broadcast({ type: "chat-list", operation: "upsert", chat: chat.summary() });
  broadcast({ type: "chats" });
  return chat.summary();
}

function visibleParentContext(parent: ChatDetail): string {
  const transcript = parent.entries
    .filter((entry) => (entry.kind === "user" || entry.kind === "assistant") && entry.text?.trim())
    .map((entry) => `${entry.kind === "user" ? "You" : "Agent"}: ${entry.text!.trim()}`)
    .join("\n\n");
  const bounded = transcript.slice(-48_000);
  return `<parent_thread_snapshot title=${JSON.stringify(parent.title)}>
This is an immutable snapshot of the parent thread from when this subthread started. Use it as context for the new task. The sessions do not share later messages.

${bounded}
</parent_thread_snapshot>`;
}

/// Starts one independent provider conversation in the parent's exact checkout.
/// The device, directory and execution settings come only from the parent.
export async function createSubthread(
  parentId: string,
  input: { text: string; includeParent?: boolean },
): Promise<ChatSummary> {
  const parent = getChat(parentId);
  if (!parent) throw new Error("no such parent thread");
  if (parent.parentChatId) throw new Error("a subthread cannot start another subthread");
  const text = input.text.trim();
  if (!text) throw new Error("write a task for the subthread");
  const child = createChat({
    parentChatId: parent.id,
    title: titleFrom(text),
  });
  try {
    await sendChatMessage(
      child.id,
      text,
      [],
      [],
      input.includeParent ? visibleParentContext(parent) : undefined,
    );
  } catch (error) {
    deleteChat(child.id);
    throw error;
  }
  return getChat(child.id) ?? child;
}

/// A parent and its direct parallel sessions. The one-level invariant means
/// this is the entire group and never needs recursive traversal.
export function chatGroup(parentId: string): ChatSummary[] {
  const parent = mustGet(parentId).summary();
  if (parent.parentChatId) throw new Error("a subthread does not own a thread group");
  return [parent, ...listChats().filter((chat) => chat.parentChatId === parent.id)];
}

/// Stops every running member before a parent lifecycle operation continues.
export async function stopChatGroup(parentId: string): Promise<ChatSummary[]> {
  const group = chatGroup(parentId);
  await Promise.all(group
    .filter((chat) => chat.state === "working" || chat.state === "needs_input")
    .map((chat) => interruptChat(chat.id)));
  const blocking = group
    .map((chat) => getChat(chat.id))
    .find((chat) => chat && (chat.state === "working" || chat.state === "needs_input"));
  if (blocking) throw new Error(`could not stop ${blocking.title}`);
  return group;
}

export function updateChat(
  id: string,
  patch: {
    title?: string;
    provider?: unknown;
    model?: string | null;
    effort?: string | null;
    permissionMode?: unknown;
    pinned?: boolean;
  },
  options: { allowProviderChange?: boolean } = {},
): ChatSummary {
  const chat = mustGet(id);
  let runtimeChanged = false;
  if (typeof patch.title === "string" && patch.title.trim()) chat.record.title = clip(patch.title, 120);
  if (patch.provider !== undefined) {
    const next = providerId(patch.provider, chat.record.provider);
    if (!config.enabledProviders.includes(next)) throw new Error("that provider is turned off");
    if (next !== chat.record.provider) {
      if (!options.allowProviderChange) throw new Error("This thread keeps the provider it started with.");
      agentCommand(next);
      chat.switchProvider(next);
      runtimeChanged = true;
    }
  }
  if (patch.model === null) {
    chat.record.model = undefined;
    runtimeChanged = true;
  }
  else if (typeof patch.model === "string") {
    // Held to the provider the thread now runs on, so a model picked for the
    // other one leaves the thread on this one's default.
    const model = providerModel(chat.record.provider, patch.model.trim());
    chat.record.model = model || undefined;
    runtimeChanged = true;
    if (patch.effort === undefined) {
      const effort = providerEffort(chat.record.provider, model, chat.record.effort);
      chat.record.effort = effort || undefined;
    }
  }
  if (patch.effort === null) {
    chat.record.effort = undefined;
    runtimeChanged = true;
  }
  else if (typeof patch.effort === "string") {
    const effort = providerEffort(chat.record.provider, chat.record.model ?? "", patch.effort.trim());
    chat.record.effort = effort || undefined;
    runtimeChanged = true;
  }
  if (patch.permissionMode !== undefined) {
    chat.record.permissionMode = permissionMode(patch.permissionMode, chat.record.permissionMode);
    runtimeChanged = true;
  }
  if (typeof patch.pinned === "boolean") chat.record.pinned = patch.pinned;
  if (runtimeChanged) chat.reconfigure();
  chat.record.updatedAt = nowMs();
  chat.persist();
  chat.push();
  broadcast({ type: "chat-list", operation: "upsert", chat: chat.summary() });
  broadcast({ type: "chats" });
  return chat.summary();
}

export async function sendChatMessage(
  id: string,
  text: string,
  attachments: ChatImageAttachment[] = [],
  codeReferences: ChatCodeReference[] = [],
  agentContext?: string,
  messageId?: string,
  member?: ThreadMember,
): Promise<void> {
  await mustGet(id).send(text, attachments, codeReferences, agentContext, messageId, member);
}

export async function runChatEnvironmentCommand(
  id: string,
  input: Record<string, unknown>,
): Promise<RuntimeCommandResult> {
  return mustGet(id).runEnvironmentCommand({
    program: typeof input.program === "string" ? input.program : "",
    args: Array.isArray(input.args) ? input.args.map(String) : undefined,
    timeoutSeconds: typeof input.timeoutSeconds === "number" ? input.timeoutSeconds : undefined,
  });
}

export async function interruptChat(id: string): Promise<void> {
  await mustGet(id).interrupt();
}

export function respondToApproval(
  id: string,
  requestId: string,
  decision: "allow" | "allowAlways" | "deny",
  member?: ThreadMember,
): void {
  mustGet(id).respondApproval(requestId, decision, member);
}

export function respondToQuestion(id: string, requestId: string, answers: Record<string, unknown>, member?: ThreadMember): void {
  mustGet(id).respondQuestion(requestId, answers, member);
}

export function chatCwd(id: string): string {
  return mustGet(id).record.cwd;
}

export function deleteChat(id: string): void {
  const chat = mustGet(id);
  forgetChat(id);
  chat.stop();
  chat.markDeleted();
  chats.delete(id);
  removeChat(id);
  setKv(`hubPersona:${id}`, null);
  setKv(`hubInbox:${id}`,null);
  broadcast({ type: "chat-list", operation: "remove", chatIds: [id] });
  broadcast({ type: "chats" });
  syncSleepAssertion();
}

/// Removes a parent and every child after the caller has stopped external work
/// surfaces. All members are validated before the first one is removed.
export function deleteChatGroup(parentId: string): void {
  const group = chatGroup(parentId);
  for (const child of group.slice(1)) deleteChat(child.id);
  deleteChat(parentId);
}

export function stopChat(id: string): void {
  mustGet(id).stop();
}

function mustGet(id: string): Chat {
  const chat = chats.get(id);
  if (!chat) throw new Error("no such chat");
  return chat;
}

setInterval(() => {
  for (const chat of chats.values()) chat.maybeReap();
}, 60_000).unref();
