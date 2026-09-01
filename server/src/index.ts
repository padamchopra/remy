import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer } from "ws";
import { answerMentions } from "./mentions.js";
import { config, patchSettings, publicSettings } from "./config.js";
import { AgentStartupError, AgentUnavailableError, agentKind, inferAgent, type AgentKind } from "./agent.js";
import { createAgent, deleteAgent, getAgent, listAgents, seedPresetAgents, seedRemyAgent, updateAgent } from "./agents.js";
import { forgetMemory, listMemories, saveMemory } from "./agent-memories.js";
import { deliverAnnouncements } from "./announcements.js";
import { appUpdateStatus, reportAppUpdate, requestAppUpdate } from "./app-update.js";
import { localAnalytics } from "./analytics.js";
import { threadAnalytics, threadPerformance } from "./thread-metrics.js";
import {
  askPullRequestGuideQuestion,
  discoverPullRequestGuide,
  generatePullRequestGuide,
  pullRequestGuideContext,
  readSavedPullRequestGuide,
} from "./pull-request-guides.js";
import { archiveChat, deleteArchivedChat, getArchivedChat, listArchivedChats } from "./archives.js";
import { deviceId, onLocalAppend, onRemoteMerge, type LogEvent } from "./board-log.js";
import {
  adoptWorkspace,
  listProjects,
  projectForWorkspace,
  syncProjectBindings,
  unbindWorkspace,
  updateProject,
} from "./projects.js";
import {
  commentOnTicket,
  createTicket,
  deleteTicketComment,
  deleteTicket,
  editTicketComment,
  getTicket,
  handoffTicket,
  linkThread,
  listTickets,
  moveTicket,
  setTicketStatus,
  syncParentTicket,
  syncTicketFromThread,
  ticketActivity,
  ticketForChat,
  unlinkThread,
  updateTicket,
} from "./tickets.js";
import {
  reconcileAgentTickets,
  reconcileTicket,
  resumeTicketFromComment,
  startTicketThread,
} from "./ticket-runner.js";
import {
  chatsUnavailable,
  archiveConversation,
  createChat,
  createSubthread,
  deleteChat,
  deleteChatGroup,
  dmChatFor,
  getChat,
  getChatWindow,
  interruptChat,
  listAllChats,
  listChats,
  listDms,
  markChatRead,
  pruneOrphanDms,
  syncAgentDm,
  syncAgentDms,
  respondToApproval,
  respondToQuestion,
  restoreArchivedChat,
  runChatEnvironmentCommand,
  sendChatMessage,
  stopChat,
  stopChatGroup,
  chatCwd,
  updateChat,
} from "./chat.js";
import { findProjectFiles, findSkills } from "./discovery.js";
import { discoveredProviders } from "./provider-discovery.js";
import { setProviderEnabled } from "./provider-settings.js";
import { externalMcpProvider } from "./external-mcp-auth.js";
import { explicitlyRequestedTicketStatus } from "./ticket-tool-contract.js";
import { installProviderMcp, providerMcpStatuses, removeProviderMcp } from "./provider-mcp.js";
import {
  archiveCursorCloudChat,
  connectCursorCloud,
  createCursorCloudChat,
  cursorCloudStatus,
  deleteCursorCloudChat,
  disconnectCursorCloud,
  getCursorCloudChat,
  interruptCursorCloudChat,
  listCursorCloudArchives,
  listCursorCloudChats,
  sendCursorCloudMessage,
  updateCursorCloudChat,
} from "./cursor-cloud.js";
import { handleHookEvent } from "./events.js";
import { attachNotifyStream, broadcast, deliverFromPeer, pushSession, pushSessionList } from "./notify.js";
import { startPeerStreamRelay } from "./peer-stream.js";
import {
  browserSnapshotText,
  browserView,
  clickBrowser,
  closeBrowser,
  insertBrowser,
  navigateBrowser,
  openBrowser,
  pressBrowser,
  scrollBrowser,
  setBrowserViewport,
  type BrowserTarget,
  typeBrowser,
  waitInBrowser,
} from "./browser.js";
import { closeTerminal, openTerminal, resizeTerminal, writeTerminal } from "./terminal.js";
import { forgetPushDevice, pushStatus, registerPushDevice } from "./push.js";
import { discover, sameTailnetHost } from "./tailnet.js";
import {
  approvePair,
  askToPair,
  checkPairing,
  denyPair,
  forgetPairing,
  pairStatus,
  pendingPairRequests,
  startPairing,
} from "./pairing.js";
import {
  acceptAnnouncement,
  acceptEvents,
  completePair,
  identity,
  isAuthenticatedPeerRequest,
  listPeers,
  pairWith,
  peerViews,
  proxyToPeer,
  removePeer,
  startPeerSync,
  startTailnetExposureReconciler,
  syncAnswer,
  syncNow,
  thisMachineIcon,
  thisMachineName,
  thisMachineTint,
  updateIdentity,
  updatePeer,
} from "./peers.js";
import {
  createEnvironment,
  deleteEnvironment,
  deleteEnvironmentValue,
  exportEnvironmentSync,
  importEnvironmentFile,
  listEnvironmentFiles,
  listEnvironments,
  mergeEnvironmentSync,
  parseEnvironmentValues,
  selectEnvironment,
  setEnvironmentValues,
} from "./environments.js";
import {
  createPullRequest,
  diffStatFor,
  mergePullRequest,
  removeWorktree,
  resolveChecks,
  resolveLinks,
  reviewComments,
  worktreeInfo,
} from "./git.js";
import { buildInbox } from "./inbox.js";
import { listAuthoredPullRequests, markPullRequestFileViewed, markPullRequestRead, markPullRequestReady, pullRequestDiff, pullRequestDiffForCwd, pullRequestFileReviewState, pullRequestTimeline } from "./pull-requests.js";
import { pullRequestFileContent, validPullRequestFileRequest } from "./pull-request-file.js";
import { askPullRequestQuestion, discoverPullRequestQuestions, readPullRequestQuestions } from "./pull-request-questions.js";
import { validateChatCodeReferences } from "./chat-references.js";
import { startPullRequestMonitor } from "./pull-request-monitor.js";
import { startTicketPullRequestSync } from "./ticket-pull-requests.js";
import {
  clearAgentPullRequestMonitoring,
  clearThreadPullRequestMonitoring,
  pullRequestMonitoring,
  resetPullRequestMonitoring,
  resetWorkspacePullRequestMonitoring,
  setPullRequestMonitoring,
  setWorkspacePullRequestMonitoring,
  workspacePullRequestMonitoring,
} from "./pull-request-monitoring.js";
import { createRoutine, deleteRoutine, listRoutines, updateRoutine } from "./routines.js";
import { runRoutine, startRoutines } from "./routine-runner.js";
import { setSleepBusyCheck, sleepSupported, syncSleepAssertion } from "./sleep.js";
import { highlightedIndex, parsePanePrompt } from "./prompt.js";
import { questionBroker } from "./questions.js";
import { MAX_UPLOAD_BYTES, saveUpload } from "./uploads.js";
import {
  MAX_CHAT_IMAGE_BYTES,
  saveChatImage,
  validateChatImages,
} from "./chat-attachments.js";
import { registry, type PendingMessage } from "./registry.js";
import { getQuickReplies, setQuickReplies } from "./settings.js";
import { githubAvatar, githubLogin, tooling } from "./tooling.js";
import { isRemyToolRoute, remyToolChatId } from "./ticket-tool-auth.js";
import { pullRequestStacks } from "./pull-request-stacks.js";
import { lastUpdateRun, syncRepoUpdateSchedule, updateRepositories } from "./repo-update.js";
import { attachStream } from "./stream.js";
import { discoverClaudeTranscript, readContextUsage, readConversation, resolveTranscriptPath, type Conversation } from "./transcript.js";
import {
  addWorkspace,
  checkoutWorkspaceBranch,
  closeAllWorkspaceWorktrees,
  closeWorkspaceWorktree,
  createTaskSession,
  listWorkspaces,
  listWorkspaceBranches,
  openPullRequestSession,
  openSessionInWorkspace,
  readWorkspaceImage,
  removeWorkspace,
  suggestWorkspaceIcons,
  suggestWorkspacePaths,
  updateWorkspace,
  listWorkspaceWorktrees,
} from "./workspaces.js";
import { startServerUpdate, updateStatus } from "./update.js";
import {
  assertValidName,
  capturePane,
  killSession,
  listSessions,
  newShellSession,
  paneCurrentPath,
  paneInCopyMode,
  renameSession,
  scroll,
  sendKeys,
  sendText,
  type ScrollAction,
} from "./tmux.js";

// tmux only preserves the non-printable field separator we use in `-F` formats
// under a UTF-8 locale. launchd runs with a stripped environment (no LANG), so
// without this tmux would mangle the separator and every session's fields would
// collapse into one. Force a UTF-8 locale unless one is already set.
if (!process.env.LANG && !process.env.LC_ALL && !process.env.LC_CTYPE) {
  process.env.LANG = "en_US.UTF-8";
}

const MAX_BODY_BYTES = 256 * 1024;

// Bearer header only — never a query param, so the token can't leak into
// request logs (the WS upgrade carries it in the same header).
function authorized(req: IncomingMessage): boolean {
  const header = req.headers.authorization ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(config.token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("upload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// Which recorded prompts are still queued. A queued prompt counts as delivered
// only once it appears in the transcript as a real user turn — testing for that
// rather than trusting a hook means it doesn't matter whether UserPromptSubmit
// fires when a prompt is queued or when Claude finally picks it up.
function reconcilePending(name: string, conversation: Conversation): PendingMessage[] | undefined {
  const pending = registry.pending(name);
  if (pending.length === 0) return undefined;
  const delivered = new Set<string>();
  for (const p of pending) {
    if (conversation.entries.some((e) => e.kind === "user" && sameMessage(e.text, p.text))) {
      delivered.add(p.text);
    }
  }
  if (delivered.size > 0) registry.dropPending(name, [...delivered]);
  const remaining = pending.filter((p) => !delivered.has(p.text));
  return remaining.length > 0 ? remaining : undefined;
}

// A pane capture is padded to the terminal's width and height. Strip the trailing
// blank rows and per-line padding so the prompt renders as a card rather than a
// rectangle of whitespace, and drop the composer chrome at the foot of the pane.
function trimPane(text: string): string | undefined {
  const lines = text.split("\n").map((l) => l.replace(/\s+$/, ""));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  const trimmed = lines.join("\n");
  return trimmed.trim() ? trimmed : undefined;
}

// The transcript clips long messages and normalises nothing, so match on a
// whitespace-collapsed prefix rather than the whole string.
function sameMessage(transcriptText: string | undefined, queued: string): boolean {
  if (!transcriptText) return false;
  const key = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 160);
  return key(transcriptText) === key(queued);
}

// A link can arrive from another device just after its thread changed state.
// Replaying active local threads when peer events land closes that race; idle
// threads are skipped so restarting a daemon cannot clear Needs input.
function syncActiveTicketThreads(): void {
  for (const chat of listChats()) {
    if (chat.state !== "idle") syncTicketFromThread(chat.id, chat.state);
  }
}

function activeChatCount(): number {
  return listAllChats().filter((chat) => chat.state === "working" || chat.state === "needs_input").length;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    // The only two routes that answer without a token, because a machine that
    // has never paired holds no token to offer. Neither one changes anything a
    // person here has not approved, and neither discloses anything: asking gets
    // back an opaque id, and the id is the only way to collect the answer.
    // Reachable over your own tailnet alone — the daemon binds loopback.
    if (url.pathname === "/pair/request" && req.method === "POST") {
      const body = await readJson(req);
      try {
        const asked = askToPair(body);
        // Every window on this machine should raise the prompt at once.
        broadcast({ type: "pair-requests" });
        return json(res, 201, asked);
      } catch (error) {
        return json(res, 429, { error: (error as Error).message });
      }
    }
    if (url.pathname === "/pair/status" && req.method === "GET") {
      return json(res, 200, pairStatus(url.searchParams.get("id") ?? ""));
    }

    const fullAccess = authorized(req);
    const scopedChatId = fullAccess ? undefined : remyToolChatId(req.headers.authorization);
    const externalProvider = fullAccess || scopedChatId
      ? undefined
      : externalMcpProvider(req.headers.authorization);
    if (!fullAccess && !scopedChatId && !externalProvider) return json(res, 401, { error: "unauthorized" });
    const scopedChat = scopedChatId ? getChat(scopedChatId) : undefined;
    if (scopedChatId && !scopedChat) return json(res, 401, { error: "unauthorized" });
    if ((scopedChatId || externalProvider) && !isRemyToolRoute(req.method, url.pathname)) {
      return json(res, 403, { error: "that operation is not available to agents" });
    }
    const scopedAgentId = scopedChat?.agentId;
    const ticketActor = (asked: unknown): string => scopedChatId || externalProvider
      ? (scopedAgentId ? getAgent(scopedAgentId)?.handle : undefined) ?? "remy"
      : typeof asked === "string" ? getAgent(asked)?.handle ?? "you" : "you";

    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true });
    }

    // Claude's interactive PreToolUse hook waits on this response. The request
    // remains open while a client renders the exact structured question;
    // responding returns updatedInput to Claude, which continues inside the same
    // ordinary subscription-backed terminal session.
    if (req.method === "POST" && url.pathname === "/hooks/ask-user-question") {
      const session = url.searchParams.get("session") ?? "";
      assertValidName(session);
      const payload = await readJson(req);
      const pending = questionBroker.open(session, payload);
      await handleHookEvent(session, "PreToolUse", payload, "claude");
      const disconnect = () => {
        if (!res.writableEnded) questionBroker.cancel(session, pending.request.requestId);
      };
      res.once("close", disconnect);
      try {
        return json(res, 200, await pending.result);
      } finally {
        res.off("close", disconnect);
      }
    }

    if (url.pathname === "/server/update" && req.method === "GET") {
      return json(res, 200, updateStatus());
    }

    if (url.pathname === "/analytics" && req.method === "GET") {
      const days = Number(url.searchParams.get("days") ?? 30);
      const timeZone = url.searchParams.get("timeZone") ?? "UTC";
      return json(res, 200, await localAnalytics(days, timeZone));
    }
    if (url.pathname === "/server/update" && req.method === "POST") {
      return json(res, 202, startServerUpdate());
    }
    if (url.pathname === "/server/app-update" && req.method === "GET") {
      return json(res, 200, appUpdateStatus(activeChatCount()));
    }
    if (url.pathname === "/server/app-update" && req.method === "POST") {
      try {
        return json(res, 202, requestAppUpdate(activeChatCount()));
      } catch (error) {
        return json(res, 409, { error: (error as Error).message });
      }
    }
    if (url.pathname === "/server/app-update" && req.method === "PATCH") {
      try {
        return json(res, 200, reportAppUpdate(await readJson(req), activeChatCount()));
      } catch (error) {
        return json(res, 409, { error: (error as Error).message });
      }
    }

    // Your GitHub picture, stored the same way as one picked off a disk.
    if (url.pathname === "/server/avatar/github" && req.method === "POST") {
      try {
        const avatar = await githubAvatar();
        return json(res, 200, patchSettings({ avatar }));
      } catch (error) {
        return json(res, 502, { error: (error as Error).message || "could not read your GitHub picture" });
      }
    }
    // What git, gh, Claude Code and Codex report about themselves on this machine.
    if (url.pathname === "/server/tooling" && req.method === "GET") {
      return json(res, 200, await tooling());
    }
    // What a thread can run on here: the catalogue, and which of them this
    // machine actually has installed, so a picker can say what is missing
    // rather than offering something that fails at spawn time.
    if (url.pathname === "/server/providers" && req.method === "GET") {
      const status = await tooling({ providerUpdates: false });
      const providers = await discoveredProviders();
      return json(res, 200, {
        providers: providers.map((entry) => ({
          ...entry,
          available: status[entry.id]?.available === true,
          enabled: config.enabledProviders.includes(entry.id),
        })),
      });
    }
    if (url.pathname === "/server/mcp" && req.method === "GET") {
      return json(res, 200, { providers: await providerMcpStatuses() });
    }
    if (parts[0] === "server" && parts[1] === "mcp" && parts[2] && parts.length === 3) {
      const selected = decodeURIComponent(parts[2]);
      try {
        if (req.method === "POST") return json(res, 200, await installProviderMcp(selected));
        if (req.method === "DELETE") return json(res, 200, await removeProviderMcp(selected));
      } catch (error) {
        return json(res, 400, { error: (error as Error).message || "could not change Remy MCP" });
      }
    }
    if (parts[0] === "server" && parts[1] === "providers" && parts[2] && parts.length === 3 && req.method === "PATCH") {
      const body = await readJson(req);
      try {
        const settings = setProviderEnabled(decodeURIComponent(parts[2]), body.enabled);
        broadcast({ type: "board" });
        return json(res, 200, settings);
      } catch (error) {
        return json(res, 400, { error: (error as Error).message || "could not change that provider" });
      }
    }
    if (url.pathname === "/server/settings" && req.method === "GET") {
      return json(res, 200, { ...publicSettings(), preventSleepSupported: sleepSupported() });
    }
    if (url.pathname === "/server/settings" && req.method === "PATCH") {
      const body = await readJson(req);
      if (body.pullRequestMonitoringAgentId) {
        const agent = getAgent(String(body.pullRequestMonitoringAgentId));
        if (!agent) return json(res, 404, { error: "no such agent" });
      }
      const settings = patchSettings(body);
      syncSleepAssertion();
      // Turning the schedule off has to stop the timer now, not at its next tick.
      syncRepoUpdateSchedule();
      // Agents that follow the machine default follow it here too, so an inbox
      // conversation is never left on the model the machine used to be on.
      if (
        body.defaultProvider !== undefined
        || body.defaultModel !== undefined
        || body.defaultEffort !== undefined
      ) syncAgentDms();
      return json(res, 200, { ...settings, preventSleepSupported: sleepSupported() });
    }

    if (url.pathname === "/cursor-cloud/status" && req.method === "GET") {
      return json(res, 200, cursorCloudStatus());
    }

    if (parts[0] === "terminals" && parts[1] && parts.length === 3 && req.method === "POST") {
      const terminalId = decodeURIComponent(parts[1]);
      const action = parts[2];
      const body = await readJson(req);
      try {
        if (action === "open") {
          return json(res, 200, openTerminal(terminalId, {
            cwd: typeof body.cwd === "string" ? body.cwd : undefined,
            cols: typeof body.cols === "number" ? body.cols : undefined,
            rows: typeof body.rows === "number" ? body.rows : undefined,
          }));
        }
        if (action === "write") {
          writeTerminal(terminalId, typeof body.data === "string" ? body.data : "");
          return json(res, 200, { ok: true });
        }
        if (action === "resize") {
          resizeTerminal(terminalId, body.cols, body.rows);
          return json(res, 200, { ok: true });
        }
        if (action === "close") {
          closeTerminal(terminalId);
          return json(res, 200, { ok: true });
        }
      } catch (error) {
        return json(res, 409, { error: (error as Error).message || "the terminal action failed" });
      }
      return json(res, 404, { error: "no such terminal action" });
    }

    if (url.pathname === "/cursor-cloud/connect" && req.method === "POST") {
      const body = await readJson(req);
      try {
        const status = await connectCursorCloud(body.apiKey);
        broadcast({ type: "peers" });
        return json(res, 200, status);
      } catch (error) {
        return json(res, 400, { error: (error as Error).message || "could not connect Cursor Cloud" });
      }
    }
    if (url.pathname === "/cursor-cloud/connect" && req.method === "DELETE") {
      const status = disconnectCursorCloud();
      broadcast({ type: "peers" });
      return json(res, 200, status);
    }

    if (url.pathname === "/cursor-cloud/api/chats" && req.method === "GET") {
      return json(res, 200, { chats: listCursorCloudChats() });
    }
    if (url.pathname === "/cursor-cloud/api/workspaces" && req.method === "GET") {
      const workspaces = (await listWorkspaces()).flatMap((workspace) => {
        const origin = workspace.origin?.startsWith("github.com/") ? `https://${workspace.origin}` : workspace.origin;
        if (!origin || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(origin)) return [];
        return [{
          ...workspace,
          id: `cursor-cloud:${workspace.id}`,
          provider: "cursor",
          model: null,
          worktrees: [],
          virtual: true,
        }];
      });
      return json(res, 200, { workspaces });
    }
    if (url.pathname === "/cursor-cloud/api/archives" && req.method === "GET") {
      return json(res, 200, { archives: listCursorCloudArchives() });
    }
    if (url.pathname === "/cursor-cloud/api/chats" && req.method === "POST") {
      const body = await readJson(req);
      try {
        const cwd = String(body.cwd ?? "").trim();
        const workspaces = await listWorkspaces();
        const workspace = workspaces.find((entry) =>
          cwd === entry.path || entry.worktrees.some((worktree) => worktree.path === cwd));
        if (!workspace?.origin) throw new Error("choose a workspace connected to GitHub");
        const origin = workspace.origin.startsWith("github.com/")
          ? `https://${workspace.origin}`
          : workspace.origin;
        if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(origin)) {
          throw new Error("Cursor Cloud needs a GitHub workspace");
        }
        const startingRef = workspace.worktrees.find((worktree) => worktree.path === cwd)?.branch
          ?? workspace.worktrees.find((worktree) => worktree.isMain)?.branch
          ?? "main";
        return json(res, 200, { chat: await createCursorCloudChat({
          cwd,
          origin,
          startingRef,
          title: typeof body.title === "string" ? body.title : undefined,
          permissionMode: typeof body.permissionMode === "string" ? body.permissionMode : undefined,
        }) });
      } catch (error) {
        return json(res, 400, { error: (error as Error).message || "could not start that Cursor Cloud thread" });
      }
    }
    if (parts[0] === "cursor-cloud" && parts[1] === "api" && parts[2] === "chats" && parts[3]) {
      const id = decodeURIComponent(parts[3]);
      try {
        if (req.method === "GET" && parts.length === 4) return json(res, 200, getCursorCloudChat(id));
        if (req.method === "PATCH" && parts.length === 4) {
          const body = await readJson(req);
          return json(res, 200, { chat: await updateCursorCloudChat(id, body) });
        }
        if (req.method === "DELETE" && parts.length === 4) {
          deleteCursorCloudChat(id);
          return json(res, 204, undefined);
        }
        if (req.method === "POST" && parts[4] === "message") {
          const body = await readJson(req);
          await sendCursorCloudMessage(id, body.text);
          return json(res, 202, { ok: true });
        }
        if (req.method === "POST" && parts[4] === "interrupt") {
          await interruptCursorCloudChat(id);
          return json(res, 200, { ok: true });
        }
        if (req.method === "POST" && parts[4] === "archive") {
          await archiveCursorCloudChat(id);
          return json(res, 200, { ok: true });
        }
      } catch (error) {
        return json(res, 400, { error: (error as Error).message || "could not change that Cursor Cloud thread" });
      }
    }
    if (parts[0] === "cursor-cloud" && parts[1] === "api" && parts[2] === "archives" && parts[3]
      && req.method === "DELETE") {
      try {
        deleteCursorCloudChat(decodeURIComponent(parts[3]));
        return json(res, 204, undefined);
      } catch (error) {
        return json(res, 404, { error: (error as Error).message || "no such archive" });
      }
    }

    // Who this machine is, and the link another machine pairs with. The token
    // is in the answer because the caller already presented it to get here.
    if (url.pathname === "/server/identity" && req.method === "GET") {
      return json(res, 200, await identity());
    }
    // Whether anything off this machine can reach it. The daemon binds
    // loopback, so `tailscale serve` is the whole answer — and it is what the
    // phone and every paired machine come in through, not only pairing. Serve,
    // never funnel: the tailnet reaches it, the public internet cannot.
    if (url.pathname === "/server/identity" && req.method === "PATCH") {
      const body = await readJson(req);
      if (
        body.exposed === undefined &&
        body.name === undefined &&
        body.icon === undefined &&
        body.tint === undefined
      ) {
        return json(res, 400, { error: "say what should change about this machine" });
      }
      try {
        return json(res, 200, await updateIdentity(body));
      } catch (error) {
        return json(res, 409, { error: (error as Error).message });
      }
    }

    // iPhones that receive Apple Push from this machine when no window is open.
    if (url.pathname === "/push/devices" && req.method === "GET") {
      return json(res, 200, pushStatus());
    }
    if (url.pathname === "/push/register" && req.method === "POST") {
      try {
        return json(res, 200, { device: registerPushDevice(await readJson(req)) });
      } catch (error) {
        return json(res, 400, { error: (error as Error).message });
      }
    }
    if (parts[0] === "push" && parts[1] === "devices" && parts.length === 3 && req.method === "DELETE") {
      const token = decodeURIComponent(parts[2]);
      if (!forgetPushDevice(token)) return json(res, 404, { error: "no such phone" });
      return json(res, 200, { ok: true });
    }

    // Your machines on the tailnet, each marked with whether Remy answered and
    // whether it is already paired. Tailscale already knows your devices, so
    // nothing has to be typed or carried to get this list.
    if (url.pathname === "/tailnet" && req.method === "GET") {
      const found = await discover(url.searchParams.get("refresh") === "1");
      const paired = listPeers();
      const self = await identity();
      return json(res, 200, {
        devices: found
          .filter((device) => device.host !== self.tailnetHost)
          .map((device) => ({
            host: device.host,
            name: device.name,
            os: device.os,
            online: device.online,
            remy: Boolean(device.url),
            ...(device.url ? { url: device.url } : {}),
            paired: paired.some((peer) => sameTailnetHost(peer.url, device.host)),
          })),
      });
    }

    // Asking a discovered machine to pair. The code comes back so this machine
    // can show it beside the one shown over there.
    if (url.pathname === "/pair/start" && req.method === "POST") {
      const body = await readJson(req);
      try {
        const self = await identity();
        return json(res, 201, await startPairing({
          url: body.url,
          name: body.name,
          self: { url: self.url, name: self.name, icon: self.icon, tint: self.tint },
        }));
      } catch (error) {
        return json(res, 400, { error: (error as Error).message });
      }
    }
    // Where that ask has got to. Approval is also completion: the answer
    // carries their token, so the peer lands here in the same call.
    if (parts[0] === "pair" && parts[1] === "attempt" && parts.length === 3) {
      const attemptId = decodeURIComponent(parts[2]);
      if (req.method === "GET") {
        try {
          const attempt = await checkPairing(attemptId, completePair);
          if (attempt.state === "approved") broadcast({ type: "peers" });
          return json(res, 200, attempt);
        } catch (error) {
          return json(res, 404, { error: (error as Error).message });
        }
      }
      if (req.method === "DELETE") {
        forgetPairing(attemptId);
        return json(res, 200, { ok: true });
      }
    }

    // Requests from other machines, waiting on a person here.
    if (url.pathname === "/pair/pending" && req.method === "GET") {
      return json(res, 200, { requests: pendingPairRequests() });
    }
    if (parts[0] === "pair" && parts[1] === "pending" && parts.length === 4 && req.method === "POST") {
      const requestId = decodeURIComponent(parts[2]);
      const decision = parts[3];
      if (decision === "deny") {
        denyPair(requestId);
        broadcast({ type: "pair-requests" });
        return json(res, 200, { ok: true });
      }
      if (decision === "approve") {
        try {
          const self = await identity();
          const approved = approvePair(requestId, self.url);
          broadcast({ type: "pair-requests" });
          // They collect the token on their next poll; nothing is pushed.
          return json(res, 200, { request: { id: approved.id, state: approved.state } });
        } catch (error) {
          return json(res, 409, { error: (error as Error).message });
        }
      }
    }

    // The machines this one is paired with.
    if (url.pathname === "/peers" && req.method === "GET") {
      return json(res, 200, {
        deviceId,
        name: thisMachineName(),
        icon: thisMachineIcon(),
        tint: thisMachineTint(),
        configured: {
          name: Boolean(config.deviceName),
          icon: Boolean(config.deviceIcon),
          tint: Boolean(config.deviceTint),
        },
        peers: peerViews(),
      });
    }
    if (url.pathname === "/peers" && req.method === "POST") {
      const body = await readJson(req);
      try {
        const peer = await pairWith(body);
        broadcast({ type: "peers" });
        return json(res, 201, { peer });
      } catch (error) {
        return json(res, 400, { error: (error as Error).message });
      }
    }
    // A peer completing its half of the pair. Authorised by this machine's own
    // token, which it holds only because its link was pasted over there.
    if (url.pathname === "/peers/announce" && req.method === "POST") {
      const body = await readJson(req);
      try {
        const peer = acceptAnnouncement(body);
        broadcast({ type: "peers" });
        return json(res, 200, { peer });
      } catch (error) {
        return json(res, 400, { error: (error as Error).message });
      }
    }
    // Board sync: the caller's gaps out, this machine's cursor back.
    if (url.pathname === "/peers/sync" && req.method === "POST") {
      return json(res, 200, syncAnswer(await readJson(req)));
    }
    if (url.pathname === "/peers/events" && req.method === "POST") {
      const landed = acceptEvents(await readJson(req));
      if (landed > 0) {
        syncActiveTicketThreads();
        broadcast({ type: "board" });
      }
      return json(res, 200, { landed });
    }
    // Environment values use a second daemon-only proof. The ordinary bearer
    // token is also used by clients, so it is not enough for an endpoint that
    // carries decrypted values between paired machines.
    if (url.pathname === "/peers/environments/sync" && req.method === "POST") {
      if (!isAuthenticatedPeerRequest(req.headers, req.method, url.pathname)) {
        return json(res, 403, { error: "environment sync is available only to paired devices" });
      }
      const body = await readJson(req);
      const landed = mergeEnvironmentSync(body.records);
      if (landed > 0) broadcast({ type: "environments" });
      return json(res, 200, { records: exportEnvironmentSync() });
    }
    // A round now, rather than at the next tick.
    if (url.pathname === "/peers/sync-now" && req.method === "POST") {
      return json(res, 200, { landed: await syncNow() });
    }
    // A notification another machine routed here.
    if (url.pathname === "/peers/notify" && req.method === "POST") {
      const body = await readJson(req);
      await deliverFromPeer({
        session: typeof body.session === "string" ? body.session : "",
        title: typeof body.title === "string" ? body.title : "",
        message: typeof body.message === "string" ? body.message : "",
        highPriority: body.highPriority === true,
        ...(typeof body.click === "string" ? { click: body.click } : {}),
        ...(typeof body.device === "string" ? { device: body.device } : {}),
      });
      return json(res, 202, { ok: true });
    }
    if (parts[0] === "peers" && parts.length === 2 && req.method === "PATCH") {
      const body = await readJson(req);
      try {
        const peer = updatePeer(decodeURIComponent(parts[1]), body);
        broadcast({ type: "peers" });
        return json(res, 200, { peer });
      } catch (error) {
        return json(res, 404, { error: (error as Error).message });
      }
    }
    if (parts[0] === "peers" && parts.length === 2 && req.method === "DELETE") {
      removePeer(decodeURIComponent(parts[1]));
      broadcast({ type: "peers" });
      return json(res, 200, { ok: true });
    }
    // Everything a client wants from a paired machine goes out through here.
    // This daemon is the only side holding that machine's token, and a browser
    // could not call it directly anyway — no CORS headers over there.
    if (parts[0] === "peers" && parts[2] === "api" && parts.length >= 4) {
      const peerId = decodeURIComponent(parts[1]);
      const target = `/${parts.slice(3).join("/")}${url.search}`;
      const imageUpload = req.method === "POST" && /^\/chats\/[^/]+\/upload(?:\?|$)/.test(target);
      const rawBody = imageUpload ? await readRawBody(req, MAX_CHAT_IMAGE_BYTES) : undefined;
      const body = req.method === "GET" || req.method === "HEAD" || imageUpload ? undefined : await readJson(req);
      try {
        const data = await proxyToPeer(peerId, target, {
          method: req.method ?? "GET",
          ...(rawBody ? {
            rawBody,
            filename: String(req.headers["x-filename"] ?? "image"),
            contentType: String(req.headers["content-type"] ?? "application/octet-stream"),
          } : {}),
          ...(body && Object.keys(body).length > 0 ? { body } : {}),
        });
        return json(res, 200, data);
      } catch (error) {
        return json(res, 502, { error: (error as Error).message });
      }
    }

    // Refreshing repositories: what the schedule does, and what the button in
    // Settings does when you would rather not wait for it.
    if (url.pathname === "/server/repo-update" && req.method === "GET") {
      return json(res, 200, { run: lastUpdateRun() ?? null });
    }
    if (url.pathname === "/server/repo-update" && req.method === "POST") {
      return json(res, 200, { run: await updateRepositories() });
    }

    // Composer quick replies, shared across every client connected to this server.
    if (url.pathname === "/quick-replies" && req.method === "GET") {
      return json(res, 200, { replies: getQuickReplies() });
    }
    if (url.pathname === "/quick-replies" && req.method === "PUT") {
      const body = await readJson(req);
      const replies = setQuickReplies(body.replies);
      // Live-sync to any desktop client already open on this server.
      broadcast({ type: "quick-replies", replies });
      return json(res, 200, { replies });
    }

    // Every session that's waiting on a human decision, with the context needed
    // to make it — the fleet's to-do queue in one request.
    if (req.method === "GET" && url.pathname === "/inbox") {
      return json(res, 200, { items: await buildInbox() });
    }

    if (req.method === "GET" && url.pathname === "/pull-requests") {
      return json(res, 200, {
        pullRequests: await listAuthoredPullRequests(url.searchParams.get("refresh") === "1"),
      });
    }
    if (req.method === "POST" && url.pathname === "/pull-requests/read") {
      const body = await readJson(req);
      const repository = String(body.repository ?? "").trim();
      const number = Number(body.number);
      if (!repository || !Number.isInteger(number) || number <= 0) {
        return json(res, 400, { error: "repository and pull request number are required" });
      }
      return json(res, 200, { marked: await markPullRequestRead(repository, number) });
    }
    if (req.method === "POST" && url.pathname === "/pull-requests/ready") {
      const body = await readJson(req);
      const repository = String(body.repository ?? "").trim();
      const number = Number(body.number);
      if (!/^[^/\s]+\/[^/\s]+$/.test(repository) || !Number.isInteger(number) || number <= 0) {
        return json(res, 400, { error: "repository and pull request number are required" });
      }
      try {
        await markPullRequestReady(repository, number);
        return json(res, 200, { ready: true });
      } catch (error) {
        return json(res, 502, { error: (error as Error).message || "could not mark that pull request ready" });
      }
    }
    if (req.method === "POST" && url.pathname === "/pull-requests/file-viewed") {
      const body = await readJson(req);
      const pullRequestId = String(body.pullRequestId ?? "").trim();
      const path = String(body.path ?? "").trim();
      const viewed = body.viewed === true;
      if (!pullRequestId || pullRequestId.length > 200 || !path || path.length > 4_000 || typeof body.viewed !== "boolean") {
        return json(res, 400, { error: "pull request, file, and viewed state are required" });
      }
      try {
        await markPullRequestFileViewed(pullRequestId, path, viewed);
        return json(res, 200, { viewed });
      } catch (error) {
        return json(res, 502, { error: (error as Error).message || "could not update that file" });
      }
    }
    if (req.method === "GET" && url.pathname === "/pull-requests/file-views") {
      const repository = String(url.searchParams.get("repository") ?? "").trim();
      const number = Number(url.searchParams.get("number"));
      if (!/^[^/\s]+\/[^/\s]+$/.test(repository) || !Number.isInteger(number) || number <= 0) {
        return json(res, 400, { error: "repository and pull request number are required" });
      }
      try {
        return json(res, 200, { review: await pullRequestFileReviewState(repository, number) });
      } catch (error) {
        return json(res, 502, { error: (error as Error).message || "could not load file review state" });
      }
    }
    if (req.method === "GET" && url.pathname === "/pull-requests/stack") {
      const repository = String(url.searchParams.get("repository") ?? "").trim();
      const number = Number(url.searchParams.get("number"));
      if (!/^[^/\s]+\/[^/\s]+$/.test(repository) || !Number.isSafeInteger(number) || number <= 0) {
        return json(res, 400, { error: "repository and pull request number are required" });
      }
      try {
        const stacks = await pullRequestStacks(repository, [number], true);
        if (!stacks.has(number)) throw new Error("couldn't read stack information from GitHub");
        return json(res, 200, { stack: stacks.get(number) });
      } catch (error) {
        return json(res, 502, { error: (error as Error).message || "couldn't load stack information" });
      }
    }
    if (req.method === "GET" && url.pathname === "/pull-requests/timeline") {
      const repository = String(url.searchParams.get("repository") ?? "").trim();
      const number = Number(url.searchParams.get("number"));
      if (!/^[^/\s]+\/[^/\s]+$/.test(repository) || !Number.isInteger(number) || number <= 0) {
        return json(res, 400, { error: "repository and pull request number are required" });
      }
      return json(res, 200, { timeline: await pullRequestTimeline(repository, number) });
    }
    if (req.method === "GET" && url.pathname === "/pull-requests/file") {
      const request = {
        repository: url.searchParams.get("repository") ?? "",
        head: url.searchParams.get("head") ?? "",
        path: url.searchParams.get("path") ?? "",
        ...(url.searchParams.has("base") ? { base: url.searchParams.get("base")! } : {}),
      };
      if (!validPullRequestFileRequest(request)) return json(res, 400, { error: "A repository, commit, and relative file path are required." });
      try {
        return json(res, 200, await pullRequestFileContent(request));
      } catch (error) {
        return json(res, 502, { error: (error as Error).message || "Couldn't load this file. Try again." });
      }
    }
    if (req.method === "GET" && url.pathname === "/pull-requests/diff") {
      const repository = String(url.searchParams.get("repository") ?? "").trim();
      const number = Number(url.searchParams.get("number"));
      if (!/^[^/\s]+\/[^/\s]+$/.test(repository) || !Number.isInteger(number) || number <= 0) {
        return json(res, 400, { error: "repository and pull request number are required" });
      }
      try {
        return json(res, 200, { diff: await pullRequestDiff(repository, number) });
      } catch (error) {
        return json(res, 502, { error: (error as Error).message || "could not load those changes" });
      }
    }
    if (req.method === "GET" && ["/pull-requests/guide/saved", "/pull-requests/guide/discover"].includes(url.pathname)) {
      const repository = String(url.searchParams.get("repository") ?? "").trim();
      const number = Number(url.searchParams.get("number"));
      if (!/^[^/\s]+\/[^/\s]+$/.test(repository) || !Number.isInteger(number) || number <= 0) {
        return json(res, 400, { error: "repository and pull request number are required" });
      }
      return json(res, 200, url.pathname.endsWith("/saved")
        ? { guide: readSavedPullRequestGuide(repository, number) }
        : await discoverPullRequestGuide(repository, number));
    }
    if (req.method === "GET" && url.pathname === "/pull-requests/guide") {
      const repository = String(url.searchParams.get("repository") ?? "").trim();
      const number = Number(url.searchParams.get("number"));
      const chatId = String(url.searchParams.get("chatId") ?? "").trim() || undefined;
      if (!/^[^/\s]+\/[^/\s]+$/.test(repository) || !Number.isInteger(number) || number <= 0) {
        return json(res, 400, { error: "repository and pull request number are required" });
      }
      try {
        return json(res, 200, await pullRequestGuideContext(repository, number, chatId));
      } catch (error) {
        return json(res, 502, { error: (error as Error).message || "could not load the guided review" });
      }
    }
    if (req.method === "POST" && url.pathname === "/pull-requests/guide") {
      const body = await readJson(req);
      const repository = String(body.repository ?? "").trim();
      const number = Number(body.number);
      if (!/^[^/\s]+\/[^/\s]+$/.test(repository) || !Number.isInteger(number) || number <= 0) {
        return json(res, 400, { error: "repository and pull request number are required" });
      }
      try {
        const guide = await generatePullRequestGuide({ ...body, repository, number });
        broadcast({ type: "pull-request-guide", repository, number });
        return json(res, 200, { guide });
      } catch (error) {
        return json(res, 409, { error: (error as Error).message || "could not start the guided review" });
      }
    }
    if (req.method === "POST" && url.pathname === "/pull-requests/guide/question") {
      const body = await readJson(req);
      const repository = String(body.repository ?? "").trim();
      const number = Number(body.number);
      if (!/^[^/\s]+\/[^/\s]+$/.test(repository) || !Number.isInteger(number) || number <= 0) {
        return json(res, 400, { error: "repository and pull request number are required" });
      }
      try {
        const guide = await askPullRequestGuideQuestion({ ...body, repository, number });
        broadcast({ type: "pull-request-guide", repository, number });
        return json(res, 200, { guide });
      } catch (error) {
        return json(res, 409, { error: (error as Error).message || "could not answer that question" });
      }
    }

    if (["/pull-requests/questions", "/pull-requests/questions/discover"].includes(url.pathname)) {
      const body = req.method === "POST" ? await readJson(req) : {};
      const repository = String(body.repository ?? url.searchParams.get("repository") ?? "").trim();
      const number = Number(body.number ?? url.searchParams.get("number"));
      if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !Number.isInteger(number) || number <= 0) {
        return json(res, 400, { error: "A repository and pull request number are required." });
      }
      if (req.method === "GET") return json(res, 200, url.pathname.endsWith("/discover")
        ? await discoverPullRequestQuestions(repository, number) : { questions: readPullRequestQuestions(repository, number) });
      if (req.method === "POST" && url.pathname === "/pull-requests/questions") {
        try {
          const question = await askPullRequestQuestion({ ...body, repository, number });
          broadcast({ type: "pull-request-question", repository, number });
          return json(res, 200, { question });
        } catch (error) {
          return json(res, 409, { error: (error as Error).message || "Couldn't answer that question. Try again." });
        }
      }
    }

    // ── the board ───────────────────────────────────────────────────────────
    // Tickets, agents and projects are folds of `board_log`, so every write
    // here appends an event and reprojects rather than touching a row. The
    // reply is always the projected shape, which is what a peer would compute.

    if (req.method === "GET" && url.pathname === "/agents") {
      return json(res, 200, { agents: listAgents() });
    }
    if (req.method === "POST" && url.pathname === "/agents") {
      const body = await readJson(req);
      try {
        const agent = createAgent(body);
        broadcast({ type: "board" });
        return json(res, 200, { agent });
      } catch (error) {
        return json(res, 400, { error: (error as Error).message || "could not create that agent" });
      }
    }
    if (parts[0] === "agents" && parts[1] && parts[2] === "memories") {
      const agentId = decodeURIComponent(parts[1]);
      if (!fullAccess && scopedAgentId !== agentId) {
        return json(res, 403, { error: "an agent can change only its own memories" });
      }
      if (!getAgent(agentId)) return json(res, 404, { error: "no such agent" });
      try {
        if (parts.length === 3 && req.method === "GET") {
          return json(res, 200, {
            memories: listMemories(agentId, {
              projectId: url.searchParams.get("project") ?? undefined,
              query: url.searchParams.get("query") ?? undefined,
            }),
          });
        }
        if (parts.length === 3 && req.method === "POST") {
          const body = await readJson(req);
          const memory = saveMemory({
            agentId,
            content: body.content,
            scope: body.scope,
            projectId: body.projectId,
          });
          broadcast({ type: "board" });
          return json(res, 201, { memory });
        }
        if (parts[3] && parts.length === 4 && req.method === "PATCH") {
          const body = await readJson(req);
          const memory = saveMemory({
            agentId,
            id: decodeURIComponent(parts[3]),
            content: body.content,
          });
          broadcast({ type: "board" });
          return json(res, 200, { memory });
        }
        if (parts[3] && parts.length === 4 && req.method === "DELETE") {
          forgetMemory(agentId, decodeURIComponent(parts[3]));
          broadcast({ type: "board" });
          return json(res, 200, { ok: true });
        }
      } catch (error) {
        const message = (error as Error).message || "could not change that memory";
        return json(res, /no such/.test(message) ? 404 : 400, { error: message });
      }
    }
    if (parts[0] === "agents" && parts[1] && parts.length === 2) {
      const id = decodeURIComponent(parts[1]);
      if (req.method === "GET") {
        const agent = getAgent(id);
        return agent ? json(res, 200, { agent }) : json(res, 404, { error: "no such agent" });
      }
      if (req.method === "PATCH") {
        const body = await readJson(req);
        try {
          const agent = updateAgent(id, body);
          broadcast({ type: "board" });
          return json(res, 200, { agent });
        } catch (error) {
          const message = (error as Error).message || "could not save that agent";
          return json(res, /no such agent/.test(message) ? 404 : 400, { error: message });
        }
      }
      if (req.method === "DELETE") {
        try {
          deleteAgent(id);
          clearAgentPullRequestMonitoring(id);
          for (const routine of listRoutines(id)) deleteRoutine(routine.id);
          broadcast({ type: "board" });
          return json(res, 200, { ok: true });
        } catch (error) {
          const message = (error as Error).message || "no such agent";
          return json(res, /no such agent/.test(message) ? 404 : 400, { error: message });
        }
      }
    }
    // Opening an agent in the inbox. The conversation is made on the first
    // open rather than with the agent, so a roster nobody has spoken to holds
    // no empty threads.
    if (req.method === "POST" && parts[0] === "agents" && parts[1] && parts[2] === "dm" && parts.length === 3) {
      try {
        return json(res, 200, { chat: dmChatFor(decodeURIComponent(parts[1])) });
      } catch (error) {
        return json(res, 404, { error: (error as Error).message || "no such agent" });
      }
    }

    if (req.method === "GET" && url.pathname === "/projects") {
      // Binding is cheap and idempotent, so a repo added from Workspaces turns
      // up here without anyone having to think about projects at all.
      await syncProjectBindings();
      return json(res, 200, { projects: listProjects() });
    }
    if (parts[0] === "projects" && parts[1] && parts[2] === "environments") {
      const projectId = decodeURIComponent(parts[1]);
      try {
        if (parts.length === 3 && req.method === "GET") {
          return json(res, 200, { environments: listEnvironments(projectId) });
        }
        if (parts.length === 3 && req.method === "POST") {
          const body = await readJson(req);
          const environment = createEnvironment(projectId, body.name);
          broadcast({ type: "environments", projectId });
          return json(res, 201, { environment });
        }
        if (parts[3] === "files" && parts.length === 4 && req.method === "GET") {
          return json(res, 200, { files: await listEnvironmentFiles(projectId) });
        }
        if (parts[3] === "active" && parts.length === 4 && req.method === "PUT") {
          const body = await readJson(req);
          const environment = selectEnvironment(projectId, String(body.environmentId ?? ""));
          broadcast({ type: "environments", projectId });
          return json(res, 200, { environment });
        }
        const environmentId = parts[3] ? decodeURIComponent(parts[3]) : "";
        if (environmentId && parts.length === 4 && req.method === "DELETE") {
          deleteEnvironment(projectId, environmentId);
          broadcast({ type: "environments", projectId });
          return json(res, 200, { ok: true });
        }
        if (environmentId && parts[4] === "import" && parts.length === 5 && req.method === "POST") {
          const body = await readJson(req);
          const environment = body.file !== undefined
            ? await importEnvironmentFile(projectId, environmentId, body.file, body.remove === true)
            : setEnvironmentValues(projectId, environmentId, parseEnvironmentValues(String(body.text ?? "")));
          broadcast({ type: "environments", projectId });
          return json(res, 200, { environment });
        }
        if (environmentId && parts[4] === "variables" && parts[5] && parts.length === 6 && req.method === "DELETE") {
          deleteEnvironmentValue(projectId, environmentId, decodeURIComponent(parts[5]));
          broadcast({ type: "environments", projectId });
          return json(res, 200, { ok: true });
        }
      } catch (error) {
        return json(res, 400, { error: (error as Error).message || "could not change that environment" });
      }
    }
    if (parts[0] === "projects" && parts[1] && parts.length === 2 && req.method === "PATCH") {
      const body = await readJson(req);
      try {
        const project = updateProject(decodeURIComponent(parts[1]), body);
        broadcast({ type: "board" });
        return json(res, 200, { project });
      } catch (error) {
        return json(res, 404, { error: (error as Error).message || "no such workspace" });
      }
    }

    if (url.pathname === "/runtime/environment-command" && req.method === "POST") {
      if (!scopedChatId) return json(res, 403, { error: "that operation is available only inside a thread" });
      try {
        return json(res, 200, await runChatEnvironmentCommand(scopedChatId, await readJson(req)));
      } catch (error) {
        return json(res, 400, { error: (error as Error).message || "the runtime command failed" });
      }
    }

    // Everything the board pane paints, in one answer.
    if (req.method === "GET" && url.pathname === "/board") {
      await syncProjectBindings();
      const projectId = url.searchParams.get("project") ?? undefined;
      return json(res, 200, {
        deviceId,
        projects: listProjects(),
        agents: listAgents(),
        tickets: listTickets(projectId),
        routines: listRoutines(),
      });
    }

    // A routine can be created conversationally only by the agent whose Inbox
    // conversation is running. The full app token may manage existing routines
    // in agent settings, but cannot create one outside that conversation.
    if (req.method === "POST" && url.pathname === "/routines") {
      if (externalProvider || !scopedChatId || !scopedChat?.dm || !scopedAgentId) {
        return json(res, 403, { error: "routines can be created only in an agent conversation" });
      }
      const body = await readJson(req);
      try {
        const routine = createRoutine({
          ...body,
          ...(scopedAgentId ? { agentId: scopedAgentId } : {}),
        });
        broadcast({ type: "board" });
        return json(res, 200, { routine });
      } catch (error) {
        return json(res, 400, { error: (error as Error).message || "could not create that routine" });
      }
    }
    if (parts[0] === "routines" && parts[1]) {
      const id = decodeURIComponent(parts[1]);
      if (req.method === "PATCH" && parts.length === 2) {
        const body = await readJson(req);
        try {
          const routine = updateRoutine(id, body);
          broadcast({ type: "board" });
          return json(res, 200, { routine });
        } catch (error) {
          const message = (error as Error).message || "could not save that routine";
          return json(res, /no such/.test(message) ? 404 : 400, { error: message });
        }
      }
      if (req.method === "DELETE" && parts.length === 2) {
        try {
          deleteRoutine(id);
          broadcast({ type: "board" });
          return json(res, 200, { ok: true });
        } catch (error) {
          return json(res, 404, { error: (error as Error).message || "no such routine" });
        }
      }
      if (req.method === "POST" && parts[2] === "run") {
        try {
          const routine = await runRoutine(id);
          broadcast({ type: "board" });
          return json(res, 200, { routine });
        } catch (error) {
          const message = (error as Error).message || "could not run that routine";
          return json(res, /no such/.test(message) ? 404 : 400, { error: message });
        }
      }
    }

    if (req.method === "POST" && url.pathname === "/tickets") {
      const body = await readJson(req);
      try {
        const ticket = createTicket(body, ticketActor(body.actor));
        broadcast({ type: "board" });
        return json(res, 200, { ticket });
      } catch (error) {
        return json(res, 400, { error: (error as Error).message || "could not create that ticket" });
      }
    }
    if (parts[0] === "tickets" && parts[1]) {
      const id = decodeURIComponent(parts[1]);
      if (req.method === "GET" && parts.length === 2) {
        const ticket = getTicket(id);
        return ticket ? json(res, 200, { ticket }) : json(res, 404, { error: "no such ticket" });
      }
      if (req.method === "GET" && parts[2] === "activity") {
        if (!getTicket(id)) return json(res, 404, { error: "no such ticket" });
        return json(res, 200, { activity: ticketActivity(id) });
      }
      if (req.method === "POST" && parts[2] === "start") {
        const body = await readJson(req);
        try {
          const checkout = body.checkout === undefined
            ? undefined
            : body.checkout === "main" || body.checkout === "worktree"
              ? body.checkout
              : null;
          if (checkout === null) return json(res, 400, { error: "Pick Main checkout or New worktree." });
          const chat = await startTicketThread(id, {
            checkout,
            ...(typeof body.provider === "string" ? { provider: body.provider } : {}),
            ...(typeof body.model === "string" ? { model: body.model } : {}),
            ...(typeof body.effort === "string" ? { effort: body.effort } : {}),
          });
          if (!chat) return json(res, 409, { error: "Couldn't start that thread." });
          broadcast({ type: "board" });
          return json(res, 200, { chat });
        } catch (error) {
          const message = (error as Error).message || "Couldn't start that thread.";
          return json(res, /no such/.test(message) ? 404 : 409, { error: message });
        }
      }
      if (req.method === "PATCH" && parts.length === 2) {
        const body = await readJson(req);
        try {
          const ticket = updateTicket(id, body);
          broadcast({ type: "board" });
          return json(res, 200, { ticket });
        } catch (error) {
          const message = (error as Error).message || "could not save that ticket";
          return json(res, /no such/.test(message) ? 404 : 400, { error: message });
        }
      }
      if (req.method === "DELETE" && parts.length === 2) {
        try {
          deleteTicket(id);
          broadcast({ type: "board" });
          return json(res, 200, { ok: true });
        } catch (error) {
          return json(res, 404, { error: (error as Error).message || "no such ticket" });
        }
      }
      // A move carries the neighbours it landed between, so ordering is one
      // rank rather than a renumbered column.
      if (req.method === "POST" && parts[2] === "move") {
        const body = await readJson(req);
        try {
          const ticket = moveTicket(
            id,
            body.status,
            typeof body.before === "string" ? body.before : undefined,
            typeof body.after === "string" ? body.after : undefined,
          );
          broadcast({ type: "board" });
          return json(res, 200, { ticket });
        } catch (error) {
          return json(res, 404, { error: (error as Error).message || "no such ticket" });
        }
      }
      if (req.method === "POST" && parts[2] === "status") {
        const body = await readJson(req);
        if (scopedChatId) {
          const latest = [...(getChat(scopedChatId)?.entries ?? [])]
            .reverse()
            .find((entry) => entry.kind === "user")?.text;
          if (!explicitlyRequestedTicketStatus(latest, body.instruction, body.status)) {
            return json(res, 403, { error: "Change a ticket's status only when the person explicitly asks." });
          }
        }
        try {
          const ticket = setTicketStatus(id, body.status, {
            actor: ticketActor(body.actor),
            note: typeof body.note === "string" ? body.note : undefined,
          });
          broadcast({ type: "board" });
          return json(res, 200, { ticket });
        } catch (error) {
          return json(res, 404, { error: (error as Error).message || "no such ticket" });
        }
      }
      if (req.method === "POST" && parts[2] === "comment") {
        const body = await readJson(req);
        try {
          const actor = ticketActor(body.actor);
          const ticket = commentOnTicket(id, String(body.body ?? ""), actor);
          broadcast({ type: "board" });
          // Naming an agent asks it a question. The turn runs on its own and
          // posts its reply as another comment, so the request does not wait
          // on a model to think.
          const said = ticketActivity(id).at(-1);
          if (said?.mentions?.length) answerMentions(id, said.mentions, said.body ?? "", said.actor);
          // The comment is already durable board activity, so an unavailable
          // device cannot make posting it fail. A successful delivery appears
          // in the linked thread as the same user turn and resumes its agent.
          if (actor === "you" && said?.body) {
            void resumeTicketFromComment(id, said.body).catch((error) => {
              console.error(`could not continue ticket ${id} from its comment:`, error);
            });
          }
          return json(res, 200, { ticket });
        } catch (error) {
          const message = (error as Error).message || "could not add that comment";
          return json(res, /no such/.test(message) ? 404 : 400, { error: message });
        }
      }
      if (
        (req.method === "PATCH" || req.method === "DELETE")
        && parts[2] === "comments"
        && parts[3]
      ) {
        const commentId = decodeURIComponent(parts[3]);
        try {
          const before = ticketActivity(id).find((entry) => entry.id === commentId);
          const ticket = req.method === "PATCH"
            ? editTicketComment(id, commentId, String((await readJson(req)).body ?? ""))
            : deleteTicketComment(id, commentId);
          broadcast({ type: "board" });
          if (req.method === "PATCH") {
            const after = ticketActivity(id).find((entry) => entry.id === commentId);
            const known = new Set((before?.mentions ?? []).map((mention) => mention.id));
            const added = (after?.mentions ?? []).filter((mention) => !known.has(mention.id));
            if (after && added.length > 0) answerMentions(id, added, after.body ?? "", after.actor);
          }
          return json(res, 200, { ticket });
        } catch (error) {
          const message = (error as Error).message || "could not change that comment";
          return json(res, /no such|gone/.test(message) ? 404 : 400, { error: message });
        }
      }
      // Attaching an existing thread. Deliberately does not start or resume it:
      // linking is bookkeeping, and the runner tells the two apart by `linkedBy`.
      if (req.method === "POST" && parts[2] === "threads") {
        if (externalProvider) {
          return json(res, 403, { error: "that operation is available only inside a thread" });
        }
        const body = await readJson(req);
        try {
          const linkedChatId = scopedChatId ?? String(body.chatId ?? "");
          const linkedDeviceId = scopedChatId
            ? deviceId
            : typeof body.deviceId === "string" ? body.deviceId : undefined;
          const linkedState = scopedChatId ? getChat(scopedChatId)?.state : body.state;
          const ticket = linkThread(id, {
            chatId: linkedChatId,
            deviceId: linkedDeviceId,
            agentId: scopedChatId
              ? scopedAgentId
              : typeof body.agentId === "string" ? body.agentId : undefined,
            stage: typeof body.stage === "string" ? body.stage : undefined,
            linkedBy: scopedChatId || body.linkedBy === "runner" ? "runner" : "you",
          });
          if (typeof linkedState === "string") {
            syncTicketFromThread(
              linkedChatId,
              linkedState,
              linkedDeviceId,
            );
          }
          broadcast({ type: "board" });
          return json(res, 200, { ticket: getTicket(id) ?? ticket });
        } catch (error) {
          const message = (error as Error).message || "could not attach that thread";
          return json(res, /no such/.test(message) ? 404 : 409, { error: message });
        }
      }
      if (req.method === "POST" && parts[2] === "handoff") {
        const body = await readJson(req);
        try {
          const next = getAgent(String(body.agentId ?? ""));
          if (!next) return json(res, 404, { error: "no such agent" });
          if (scopedChatId) {
            const current = scopedAgentId ? getAgent(scopedAgentId) : undefined;
            if (!current?.handoffTo.includes(next.handle)) {
              return json(res, 403, { error: "that handoff is not configured" });
            }
          }
          const actor = ticketActor(body.actor);
          const ticket = handoffTicket(id, next.id, actor);
          broadcast({ type: "board" });
          return json(res, 200, { ticket });
        } catch (error) {
          return json(res, 404, { error: (error as Error).message || "could not hand off that ticket" });
        }
      }
      if (req.method === "DELETE" && parts[2] === "threads" && parts[3]) {
        try {
          const ticket = unlinkThread(
            id,
            decodeURIComponent(parts[3]),
            url.searchParams.get("device") ?? undefined,
          );
          broadcast({ type: "board" });
          return json(res, 200, { ticket });
        } catch (error) {
          return json(res, 404, { error: (error as Error).message || "no such ticket" });
        }
      }
    }

    // Chats are Remy's own Claude conversations: the server drives
    // the Agent SDK, so unlike a tmux session there is no terminal to fall back
    // to and every interaction — messages, approvals, questions — lands here.
    if (req.method === "GET" && url.pathname === "/chats") {
      // `unavailable` explains an empty list on a server that cannot store
      // chats — an older Node, or a database it could not open.
      const unavailable = chatsUnavailable();
      // The inbox rides along rather than taking a route of its own: a client
      // that shows both would otherwise ask twice on every refresh.
      return json(res, 200, { chats: listChats(), dms: listDms(), ...(unavailable ? { unavailable } : {}) });
    }
    if (req.method === "POST" && url.pathname === "/chats") {
      const body = await readJson(req);
      try {
        const cwd = String(body.cwd ?? "").trim();
        // The worktree list is what says which workspace a directory belongs
        // to, so it is read here rather than inside `createChat`.
        const workspaces = await listWorkspaces();
        const holder = workspaces.find((workspace) =>
          cwd === workspace.path || workspace.worktrees.some((worktree) => cwd === worktree.path));
        if (scopedChatId) {
          const current = getChat(scopedChatId);
          if (!current || (cwd !== current.cwd && !holder)) {
            return json(res, 403, { error: "register that workspace before starting a thread there" });
          }
        } else if (externalProvider && !holder) {
          return json(res, 403, { error: "register that workspace before starting a thread there" });
        }
        return json(res, 200, { chat: createChat({
          cwd: String(body.cwd ?? ""),
          title: typeof body.title === "string" ? body.title : undefined,
          provider: typeof body.provider === "string" && body.provider ? body.provider : undefined,
          // An empty model is a choice — that provider's own default — so it is
          // passed through rather than collapsed into "nothing was asked".
          model: typeof body.model === "string" ? body.model : undefined,
          effort: typeof body.effort === "string" ? body.effort : undefined,
          permissionMode: scopedChatId || externalProvider ? undefined : body.permissionMode,
          agentId: typeof body.agentId === "string" && body.agentId ? body.agentId : undefined,
          ...(holder?.provider
            ? { workspaceDefault: { provider: holder.provider, model: holder.model, effort: holder.effort } }
            : {}),
        }) });
      } catch (error) {
        return json(res, 400, { error: (error as Error).message || "could not create the chat" });
      }
    }
    if (parts[0] === "chats" && parts[1]) {
      const id = decodeURIComponent(parts[1]);
      if (req.method === "POST" && parts[2] === "subthreads" && parts.length === 3) {
        if (!fullAccess) return json(res, 403, { error: "only you can start a subthread" });
        const body = await readJson(req);
        try {
          const chat = await createSubthread(id, {
            text: typeof body.text === "string" ? body.text : "",
            includeParent: body.includeParent === true,
          });
          return json(res, 200, { chat });
        } catch (error) {
          const message = (error as Error).message || "could not start the subthread";
          return json(res, /no such/.test(message) ? 404 : 409, { error: message });
        }
      }
      if (req.method === "GET" && parts[2] === "analytics" && parts.length === 3) {
        const chat = getChat(id);
        if (!chat) return json(res, 404, { error: "no such chat" });
        const report = threadAnalytics(id, chat);
        return report ? json(res, 200, report) : json(res, 404, { error: "no such chat" });
      }
      if (req.method === "GET" && parts[2] === "performance" && parts.length === 3) {
        const chat = getChat(id);
        if (!chat) return json(res, 404, { error: "no such chat" });
        const report = threadPerformance(id, chat);
        return report ? json(res, 200, report) : json(res, 404, { error: "no such chat" });
      }
      if (parts[2] === "browser") {
        if (!fullAccess && (!scopedChatId || scopedChatId !== id)) {
          return json(res, 403, { error: "an agent can control only its own thread's browser" });
        }
        if (!getChat(id)) return json(res, 404, { error: "no such chat" });
        const browserId = url.searchParams.get("instance")?.trim() || "default";
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(browserId)) {
          return json(res, 400, { error: "that browser tab id is not valid" });
        }
        const controller = scopedChatId ? "agent" as const : "you" as const;
        if (req.method === "GET" && parts.length === 3) {
          return json(res, 200, await browserView(id, true, browserId));
        }
        if (req.method === "POST" && parts.length === 4) {
          const body = await readJson(req);
          const target: BrowserTarget = {
            selector: typeof body.selector === "string" ? body.selector : undefined,
            role: typeof body.role === "string" ? body.role : undefined,
            name: typeof body.name === "string" ? body.name : undefined,
            text: typeof body.text === "string" ? body.text : undefined,
            x: typeof body.x === "number" ? body.x : undefined,
            y: typeof body.y === "number" ? body.y : undefined,
          };
          try {
            if (parts[3] === "open") return json(res, 200, await openBrowser(id, String(body.url ?? ""), controller, browserId));
            if (parts[3] === "viewport") {
              if (body.viewport !== "fullscreen" && body.viewport !== "desktop" && body.viewport !== "mobile") {
                return json(res, 400, { error: "Choose Fullscreen, Desktop, or Mobile." });
              }
              return json(res, 200, await setBrowserViewport(
                id,
                body.viewport,
                controller,
                browserId,
                body.viewport === "fullscreen"
                  ? { width: Number(body.width), height: Number(body.height) }
                  : undefined,
              ));
            }
            if (parts[3] === "snapshot") return json(res, 200, { text: await browserSnapshotText(id, browserId) });
            if (parts[3] === "back" || parts[3] === "forward" || parts[3] === "reload") {
              return json(res, 200, await navigateBrowser(id, parts[3], controller, browserId));
            }
            if (parts[3] === "click") return json(res, 200, await clickBrowser(id, target, controller, browserId));
            if (parts[3] === "type") return json(res, 200, await typeBrowser(id, target, String(body.value ?? ""), controller, browserId));
            if (parts[3] === "insert") return json(res, 200, await insertBrowser(id, String(body.value ?? ""), controller, browserId));
            if (parts[3] === "press") return json(res, 200, await pressBrowser(id, String(body.key ?? ""), controller, browserId));
            if (parts[3] === "scroll") {
              return json(res, 200, await scrollBrowser(
                id,
                typeof body.deltaX === "number" ? body.deltaX : 0,
                typeof body.deltaY === "number" ? body.deltaY : 0,
                controller,
                browserId,
              ));
            }
            if (parts[3] === "wait") {
              return json(res, 200, await waitInBrowser(
                id,
                typeof body.milliseconds === "number" ? body.milliseconds : 500,
                controller,
                browserId,
              ));
            }
            if (parts[3] === "close") {
              await closeBrowser(id, browserId);
              return json(res, 200, { ok: true });
            }
          } catch (error) {
            return json(res, 409, { error: (error as Error).message || "the browser action failed" });
          }
          return json(res, 404, { error: "no such browser action" });
        }
      }
      if (req.method === "GET" && parts.length === 2) {
        const rawTurns = url.searchParams.get("turns");
        const turns = rawTurns === null ? undefined : Number(rawTurns);
        if (turns !== undefined && (!Number.isInteger(turns) || turns < 1 || turns > 50)) {
          return json(res, 400, { error: "history pages must contain between 1 and 50 turns" });
        }
        try {
          const chat = turns === undefined
            ? getChat(id)
            : getChatWindow(id, turns, url.searchParams.get("before") ?? undefined);
          return chat ? json(res, 200, chat) : json(res, 404, { error: "no such chat" });
        } catch (error) {
          return json(res, 409, { error: (error as Error).message || "could not load that history" });
        }
      }
      // Reading is a write, so it is a POST — and it is the client that knows
      // when a conversation is actually on screen.
      if (req.method === "POST" && parts[2] === "read" && parts.length === 3) {
        markChatRead(id);
        return json(res, 200, { ok: true });
      }
      if (req.method === "PATCH" && parts.length === 2) {
        const body = await readJson(req);
        try {
          return json(res, 200, { chat: updateChat(id, {
            title: typeof body.title === "string" ? body.title : undefined,
            provider: typeof body.provider === "string" && body.provider ? body.provider : undefined,
            model: body.model === null ? null : typeof body.model === "string" ? body.model : undefined,
            effort: body.effort === null ? null : typeof body.effort === "string" ? body.effort : undefined,
            permissionMode: body.permissionMode,
            pinned: typeof body.pinned === "boolean" ? body.pinned : undefined,
          }) });
        } catch (error) {
          const message = (error as Error).message || "could not update that thread";
          return json(res, /no such/.test(message) ? 404 : 409, { error: message });
        }
      }
      if (req.method === "DELETE" && parts.length === 2) {
        try {
          const chat = getChat(id);
          if (!chat) throw new Error("no such chat");
          if (chat.parentChatId) {
            void closeBrowser(id);
            closeTerminal(`thread-${id}`);
            clearThreadPullRequestMonitoring(id);
            deleteChat(id);
          } else {
            const group = await stopChatGroup(id);
            await Promise.all(group.map((member) => closeBrowser(member.id).catch(() => undefined)));
            for (const member of group) {
              closeTerminal(`thread-${member.id}`);
              clearThreadPullRequestMonitoring(member.id);
            }
            deleteChatGroup(id);
          }
          return json(res, 200, { ok: true });
        } catch (error) {
          const message = (error as Error).message || "no such chat";
          return json(res, /no such/.test(message) ? 404 : 409, { error: message });
        }
      }
      // Keeping the conversation and dropping the thread. A turn still running
      // would be archived half-written, so it is refused rather than caught.
      if (req.method === "POST" && parts[2] === "archive") {
        const chat = getChat(id);
        if (!chat) return json(res, 404, { error: "no such chat" });
        if (chat.parentChatId && (chat.state === "working" || chat.state === "needs_input")) {
          return json(res, 409, { error: "this thread is still running" });
        }
        try {
          if (chat.parentChatId) {
            const archive = archiveChat({
              chatId: chat.id,
              session: chat.title,
              agent: chat.provider,
              cwd: chat.cwd,
              conversation: archiveConversation(chat.id),
            });
            void closeBrowser(id);
            closeTerminal(`thread-${id}`);
            clearThreadPullRequestMonitoring(id);
            deleteChat(id);
            return json(res, 200, { archive });
          }
          const group = await stopChatGroup(id);
          await Promise.all(group.map((member) => closeBrowser(member.id).catch(() => undefined)));
          const archives = group.map((member) => archiveChat({
            chatId: member.id,
            session: member.title,
            agent: member.provider,
            cwd: member.cwd,
            conversation: archiveConversation(member.id),
          }));
          for (const member of group) {
            closeTerminal(`thread-${member.id}`);
            clearThreadPullRequestMonitoring(member.id);
          }
          deleteChatGroup(id);
          return json(res, 200, { archive: archives[0], archives });
        } catch (error) {
          return json(res, 409, { error: (error as Error).message || "could not archive that thread" });
        }
      }
      if (req.method === "POST" && parts[2] === "message") {
        if (scopedChatId === id) {
          return json(res, 403, { error: "an agent cannot message its own running thread" });
        }
        const body = await readJson(req);
        try {
          const attachments = validateChatImages(id, body.attachments);
          const codeReferences = validateChatCodeReferences(body.codeReferences);
          await sendChatMessage(id, String(body.text ?? ""), attachments, codeReferences);
          return json(res, 200, { ok: true });
        } catch (error) {
          return json(res, 409, { error: (error as Error).message || "could not send the message" });
        }
      }
      if (req.method === "GET" && parts[2] === "pull-request" && parts.length === 3) {
        try {
          const { pullRequest } = await resolveLinks(chatCwd(id), undefined);
          return json(res, 200, { pullRequest });
        } catch (error) {
          return json(res, 404, { error: (error as Error).message || "could not find that pull request" });
        }
      }
      if (req.method === "GET" && parts[2] === "pull-request-diff") {
        try {
          const cwd = chatCwd(id);
          const holder = (await listWorkspaces()).find((workspace) =>
            cwd === workspace.path || workspace.worktrees.some((worktree) => cwd === worktree.path));
          return json(res, 200, { diff: { ...await pullRequestDiffForCwd(cwd), workspaceId: holder?.id } });
        } catch (error) {
          return json(res, 404, { error: (error as Error).message || "this branch does not have a pull request" });
        }
      }
      if (req.method === "POST" && parts[2] === "interrupt") {
        try {
          await interruptChat(id);
          return json(res, 200, { ok: true });
        } catch (error) {
          return json(res, 404, { error: (error as Error).message || "no such chat" });
        }
      }
      if (req.method === "POST" && parts[2] === "stop") {
        if (scopedChatId === id) {
          return json(res, 403, { error: "an agent cannot stop its own running thread" });
        }
        try {
          stopChat(id);
          return json(res, 200, { ok: true });
        } catch (error) {
          return json(res, 404, { error: (error as Error).message || "no such chat" });
        }
      }
      // Approvals and questions are answered by request id, so a card left open
      // on a second device refuses instead of answering the next prompt.
      if (req.method === "POST" && parts[2] === "approval") {
        const body = await readJson(req);
        const decision = String(body.decision ?? "");
        if (decision !== "allow" && decision !== "allowAlways" && decision !== "deny") {
          return json(res, 400, { error: "decision must be allow, allowAlways, or deny" });
        }
        try {
          respondToApproval(id, String(body.requestId ?? ""), decision);
          return json(res, 200, { ok: true });
        } catch (error) {
          return json(res, 409, { error: (error as Error).message || "that request is no longer waiting" });
        }
      }
      if (req.method === "POST" && parts[2] === "question") {
        const body = await readJson(req);
        const answers = body.answers && typeof body.answers === "object" ? body.answers as Record<string, unknown> : {};
        try {
          respondToQuestion(id, String(body.requestId ?? ""), answers);
          return json(res, 200, { ok: true });
        } catch (error) {
          return json(res, 409, { error: (error as Error).message || "that question is no longer waiting" });
        }
      }
      if (req.method === "POST" && parts[2] === "upload") {
        const filename = String(req.headers["x-filename"] ?? "upload.bin");
        const mimeType = String(req.headers["content-type"] ?? "application/octet-stream");
        try {
          // Resolve the chat first, so an upload can only ever land under an id
          // the server itself minted.
          chatCwd(id);
        } catch (error) {
          return json(res, 404, { error: (error as Error).message || "no such chat" });
        }
        try {
          const data = await readRawBody(req, MAX_CHAT_IMAGE_BYTES);
          return json(res, 200, { attachment: saveChatImage(id, filename, mimeType, data) });
        } catch (error) {
          return json(res, 400, { error: (error as Error).message || "could not attach that image" });
        }
      }
      // Most work does not start on a board — it starts as a thread, and ten
      // minutes in it turns out to be worth tracking. The ticket adopts what
      // the thread already has rather than opening a second worktree.
      if (req.method === "POST" && parts[2] === "ticket") {
        const chat = getChat(id);
        if (!chat) return json(res, 404, { error: "no such chat" });
        const already = ticketForChat(id);
        if (already) return json(res, 409, { error: `that thread is already on ${already.key}` });
        const body = await readJson(req);
        try {
          const workspaces = await listWorkspaces();
          // The deepest matching workspace wins, so a worktree inside a
          // workspace resolves to that workspace rather than a shorter one.
          const workspace = workspaces
            .filter((candidate) => chat.cwd === candidate.path || chat.cwd.startsWith(`${candidate.path}/`))
            .sort((a, b) => b.path.length - a.path.length)[0];
          if (!workspace) {
            return json(res, 400, { error: "this thread is not running in a workspace on this machine" });
          }
          const project = adoptWorkspace(workspace);
          const info = await worktreeInfo(chat.cwd);
          let ticket = createTicket({
            projectId: project.id,
            title: typeof body.title === "string" && body.title.trim() ? body.title : chat.title,
            body: typeof body.body === "string" ? body.body : "",
            ...(info.branch ? { branch: info.branch } : {}),
            ...(chat.agentId ? { assigneeAgentId: chat.agentId } : {}),
          });
          // Link before status: a ticket that is already being worked on must
          // never be seen as one nobody has picked up.
          ticket = linkThread(ticket.id, { chatId: id, agentId: chat.agentId });
          const live = chat.state === "working" || chat.state === "needs_input";
          ticket = setTicketStatus(ticket.id, live ? "in_progress" : "todo");
          broadcast({ type: "board" });
          return json(res, 200, { ticket });
        } catch (error) {
          return json(res, 400, { error: (error as Error).message || "could not create that ticket" });
        }
      }
      // The composer's @file and /skill pickers, resolved against the chat's
      // own directory rather than a tmux pane's.
      if (req.method === "GET" && parts[2] === "files") {
        try {
          return json(res, 200, { files: await findProjectFiles(chatCwd(id), url.searchParams.get("q") ?? "") });
        } catch (error) {
          return json(res, 404, { error: (error as Error).message || "no such chat" });
        }
      }
      if (req.method === "GET" && parts[2] === "skills") {
        try {
          return json(res, 200, { skills: await findSkills(chatCwd(id), url.searchParams.get("q") ?? "") });
        } catch (error) {
          return json(res, 404, { error: (error as Error).message || "no such chat" });
        }
      }
    }

    if (url.pathname === "/pull-request-monitoring") {
      const workspaceId = url.searchParams.get("workspaceId") ?? "";
      const repository = url.searchParams.get("repository") ?? "";
      const number = Number(url.searchParams.get("number") ?? "0");
      const isPullRequest = Boolean(repository && Number.isInteger(number) && number > 0);
      try {
        if (req.method === "GET") {
          const policy = isPullRequest
            ? pullRequestMonitoring(workspaceId, repository, number)
            : workspacePullRequestMonitoring(workspaceId);
          return json(res, 200, { policy });
        }
        if (req.method === "PATCH") {
          const body = await readJson(req);
          const value = {
            enabled: body.enabled === true,
            agentId: String(body.agentId ?? "") || null,
            chatId: String(body.chatId ?? "") || null,
          };
          const policy = isPullRequest
            ? setPullRequestMonitoring(workspaceId, repository, number, value)
            : await setWorkspacePullRequestMonitoring(workspaceId, value);
          return json(res, 200, { policy });
        }
        if (req.method === "DELETE") {
          const policy = isPullRequest
            ? resetPullRequestMonitoring(workspaceId, repository, number)
            : await resetWorkspacePullRequestMonitoring(workspaceId);
          return json(res, 200, { policy });
        }
      } catch (error) {
        const message = (error as Error).message || "could not change pull request monitoring";
        return json(res, /not found|no such/.test(message) ? 404 : 400, { error: message });
      }
    }

    if (req.method === "GET" && url.pathname === "/sessions") {
      const sessions = await listSessions();
      return json(res, 200, {
        sessions: await Promise.all(sessions.map(async (s) => {
          let entry = registry.view(s.name);
          const agent = inferAgent(s.paneCommand, entry?.agent);
          if (agent !== entry?.agent || (agent === "claude" && !entry?.transcriptPath)) {
            const discovered = agent === "claude" ? discoverClaudeTranscript(s.panePath) : undefined;
            registry.update(s.name, {
              agent,
              cwd: s.panePath,
              ...(discovered ? {
                transcriptPath: discovered.path,
                claudeSessionId: discovered.sessionId,
                agentSessionId: discovered.sessionId,
              } : {}),
            });
            entry = registry.view(s.name);
          }
          return {
            ...s,
            ...(entry ?? { state: "unknown" }),
            agent,
            // A short pane capture gives the fleet view useful context without
            // streaming every terminal or retaining output anywhere else.
            preview: (await capturePane(s.name, 1).catch(() => "")).trim(),
            // Cached per directory, so the fleet poll stays cheap.
            diffStat: await diffStatFor(s.panePath),
            // Cached on transcript size, so an idle session costs a stat().
            context: readContextUsage(
              entry?.transcriptPath ?? resolveTranscriptPath(entry?.cwd, entry?.claudeSessionId),
              config.contextLimit,
            ),
          };
        })),
      });
    }

    if (req.method === "POST" && url.pathname === "/sessions") {
      const body = await readJson(req);
      // `claude` is retained for older app builds. New clients send the
      // provider-neutral `agent` value.
      const agent = agentKind(body.agent, body.claude === true ? "claude" : "shell");
      const name = await newShellSession({
        name: typeof body.name === "string" ? body.name : undefined,
        path: typeof body.path === "string" ? body.path : undefined,
        agent,
      });
      registry.update(name, { agent, state: agent === "shell" ? "unknown" : "working" });
      pushSessionList();
      return json(res, 200, { name });
    }

    if (req.method === "POST" && url.pathname === "/events") {
      const session = url.searchParams.get("session") ?? "";
      const event = url.searchParams.get("event") ?? "";
      const reportedAgent = agentKind(url.searchParams.get("agent"), "claude");
      assertValidName(session);
      await handleHookEvent(session, event, await readJson(req), reportedAgent);
      return json(res, 200, { ok: true });
    }

    if (url.pathname === "/workspaces" && req.method === "GET") {
      await syncProjectBindings();
      const workspaces = (await listWorkspaces()).map((workspace) => {
        const project = projectForWorkspace(workspace.id);
        return project ? { ...workspace, icon: project.icon, tint: project.tint } : workspace;
      });
      return json(res, 200, { workspaces });
    }

    if (url.pathname === "/paths" && req.method === "GET") {
      return json(res, 200, { paths: suggestWorkspacePaths(url.searchParams.get("q") ?? "") });
    }

    if (url.pathname === "/archives" && req.method === "GET") {
      return json(res, 200, { archives: listArchivedChats() });
    }
    if (parts[0] === "archives" && parts[1] && parts[2] === "restore" && req.method === "POST") {
      const id = decodeURIComponent(parts[1]);
      const archive = getArchivedChat(id);
      if (!archive) return json(res, 404, { error: "archived thread not found" });
      try {
        const group = archive.conversation.parentChatId || !archive.chatId
          ? [archive]
          : [
              archive,
              ...listArchivedChats().filter((entry) => entry.conversation.parentChatId === archive.chatId),
            ];
        const restored = group.map((entry) => restoreArchivedChat({
          chatId: entry.chatId,
          session: entry.session,
          cwd: entry.cwd,
          conversation: entry.conversation,
        }));
        for (const entry of group) deleteArchivedChat(entry.id);
        return json(res, 200, { chat: restored[0], chats: restored });
      } catch (error) {
        return json(res, 409, { error: (error as Error).message || "could not unarchive that thread" });
      }
    }
    if (parts[0] === "archives" && parts[1] && req.method === "DELETE") {
      try {
        const archive = getArchivedChat(decodeURIComponent(parts[1]));
        if (!archive) throw new Error("archived chat not found");
        const group = archive.conversation.parentChatId || !archive.chatId
          ? [archive]
          : [
              archive,
              ...listArchivedChats().filter((entry) => entry.conversation.parentChatId === archive.chatId),
            ];
        for (const entry of group) deleteArchivedChat(entry.id);
        return json(res, 200, { ok: true });
      } catch (error) {
        return json(res, 404, { error: (error as Error).message || "archived chat not found" });
      }
    }
    if (url.pathname === "/workspaces" && req.method === "POST") {
      const body = await readJson(req);
      try {
        const workspace = await addWorkspace(String(body.name ?? ""), String(body.path ?? ""));
        // A Git checkout joins the repository project immediately. Its event
        // can then reach another device before either window happens to open
        // the board, while the local path remains a binding only on this disk.
        adoptWorkspace(workspace);
        return json(res, 200, { workspace });
      } catch (err) {
        return json(res, 400, { error: (err as Error).message || "could not add workspace" });
      }
    }
    if (parts[0] === "workspaces" && parts[1]) {
      const id = decodeURIComponent(parts[1]);
      if (req.method === "DELETE" && parts.length === 2) {
        removeWorkspace(id);
        unbindWorkspace(id);
        return json(res, 200, { ok: true });
      }
      if (req.method === "PATCH" && parts.length === 2) {
        try {
          const body = await readJson(req);
          const workspace = await updateWorkspace(id, {
            name: body.name === undefined ? undefined : String(body.name),
            icon: body.icon === undefined ? undefined : body.icon === null ? null : String(body.icon),
            tint: body.tint === undefined ? undefined : body.tint === null ? null : String(body.tint),
            // Null is how a workspace goes back to following the machine.
            provider: body.provider === undefined ? undefined : body.provider === null ? null : String(body.provider),
            model: body.model === undefined ? undefined : body.model === null ? null : String(body.model),
            effort: body.effort === undefined ? undefined : body.effort === null ? null : String(body.effort),
          });
          let identity = projectForWorkspace(id);
          if (body.icon !== undefined || body.tint !== undefined) {
            identity = updateProject((identity ?? adoptWorkspace(workspace)).id, {
              icon: body.icon,
              tint: body.tint,
            });
            broadcast({ type: "board" });
          }
          return json(res, 200, {
            workspace: identity ? { ...workspace, icon: identity.icon, tint: identity.tint } : workspace,
          });
        } catch (error) {
          return json(res, 400, { error: (error as Error).message || "could not update workspace" });
        }
      }
      if (req.method === "GET" && parts[2] === "icons" && parts.length === 3) {
        try {
          return json(res, 200, { icons: await suggestWorkspaceIcons(id, url.searchParams.get("q") ?? "") });
        } catch (error) {
          return json(res, 400, { error: (error as Error).message || "could not list icons" });
        }
      }
      if (req.method === "GET" && parts[2] === "file" && parts.length === 3) {
        try {
          return json(res, 200, await readWorkspaceImage(id, url.searchParams.get("path") ?? ""));
        } catch (error) {
          return json(res, 404, { error: (error as Error).message || "file not found" });
        }
      }
      if (req.method === "POST" && parts[2] === "session") {
        const name = await openSessionInWorkspace(id);
        pushSessionList();
        return json(res, 200, { name });
      }
      if (req.method === "POST" && parts[2] === "pull-request-session") {
        const body = await readJson(req);
        try {
          const name = await openPullRequestSession(id, String(body.branch ?? ""), Number(body.number));
          pushSessionList();
          return json(res, 200, { name });
        } catch (error) {
          return json(res, 409, { error: (error as Error).message || "could not open pull request shell" });
        }
      }
      if (req.method === "GET" && parts[2] === "dirty") {
        const worktrees = await listWorkspaceWorktrees(id);
        return json(res, 200, { worktrees, dirty: Object.fromEntries(worktrees.map((tree) => [tree.path, tree.dirty])) });
      }
      if (req.method === "GET" && parts[2] === "branches") {
        try {
          return json(res, 200, { branches: await listWorkspaceBranches(id) });
        } catch (error) {
          return json(res, 400, { error: (error as Error).message || "could not list branches" });
        }
      }
      if (req.method === "POST" && parts[2] === "checkout") {
        const body = await readJson(req);
        try {
          return json(res, 200, await checkoutWorkspaceBranch(id, String(body.branch ?? ""), String(body.mode ?? "")));
        } catch (error) {
          const message = (error as Error).message || "could not switch branch";
          const status = /not found/i.test(message) ? 404 : /already|stash|Commit|this checkout/i.test(message) ? 409 : 400;
          return json(res, status, { error: message });
        }
      }
      if (req.method === "POST" && parts[2] === "task") {
        const body = await readJson(req);
        const requested = agentKind(body.agent, "claude");
        const agent: Exclude<AgentKind, "shell"> = requested === "codex"
          ? "codex"
          : requested === "cursor"
            ? "cursor"
            : "claude";
        try {
          const name = await createTaskSession(id, String(body.prompt ?? ""), agent);
          registry.update(name, { agent, state: "working" });
          pushSessionList();
          return json(res, 200, { name });
        } catch (error) {
          if (error instanceof AgentUnavailableError || error instanceof AgentStartupError) {
            pushSessionList();
            return json(res, 409, { error: error.message });
          }
          throw error;
        }
      }
      // Closing a worktree also stops the tmux sessions living inside it.
      if (req.method === "POST" && parts[2] === "worktrees" && parts[3] === "close") {
        const body = await readJson(req);
        try {
          const result = await closeWorkspaceWorktree(id, String(body.path ?? ""), body.force === true);
          broadcast({ type: "workspace-worktrees", workspaceId: id });
          pushSessionList();
          return json(res, 200, result);
        } catch (error) {
          const reason = String(error);
          const message = /locked/i.test(reason) ? "Unlock this worktree in Git before cleaning it up."
            : /uncommitted|modified|untracked/i.test(reason) ? "Commit or stash your changes, or select this worktree again to confirm discarding them."
            : /primary|unregistered/i.test(reason) ? "Only linked worktrees in this workspace can be cleaned up."
            : "Couldn't remove this worktree; check its folder and try again.";
          return json(res, 409, { error: message });
        }
      }
      if (req.method === "POST" && parts[2] === "worktrees" && parts[3] === "close-all") {
        const body = await readJson(req);
        const result = await closeAllWorkspaceWorktrees(id, body.force === true);
        broadcast({ type: "workspace-worktrees", workspaceId: id });
        pushSessionList();
        return json(res, 200, result);
      }
    }

    if (req.method === "POST" && url.pathname === "/worktree/remove") {
      const body = await readJson(req);
      await removeWorktree(String(body.path ?? ""), body.force === true);
      return json(res, 200, { ok: true });
    }

    if (parts[0] === "sessions" && parts.length >= 2) {
      const name = decodeURIComponent(parts[1]);
      assertValidName(name);

      if (req.method === "GET" && parts[2] === "snapshot") {
        const lines = Number(url.searchParams.get("lines") ?? 120);
        return json(res, 200, { text: await capturePane(name, lines) });
      }
      if (req.method === "GET" && parts[2] === "activity") {
        return json(res, 200, { activity: registry.view(name)?.activity ?? [] });
      }
      if (req.method === "GET" && parts[2] === "conversation") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 120), 1), 400);
        const entry = registry.view(name);
        const path = entry?.transcriptPath ?? resolveTranscriptPath(entry?.cwd, entry?.claudeSessionId);
        let conversation = readConversation(path, limit);
        const activeQuestion = questionBroker.view(name);
        // A brand-new session can ask before Claude has created its transcript.
        // The structured hook payload is already enough to render a useful feed,
        // so do not hide it behind the transcript-unavailable empty state.
        if (activeQuestion && !conversation.available) {
          conversation = {
            available: true,
            agent: entry?.agent ?? "claude",
            todos: [],
            entries: [],
            state: "needs_input",
            activeQuestion: {
              requestId: activeQuestion.requestId,
              questions: activeQuestion.questions,
            },
          };
        }
        // Attach the live hook state so the feed can show a processing indicator.
        // Guarded on `available` so we never mutate the shared UNAVAILABLE object.
        if (conversation.available) {
          conversation.agent = entry?.agent ?? conversation.agent ?? "claude";
          if (entry?.state) conversation.state = entry.state;
          if (entry?.currentAction) conversation.action = entry.currentAction;
          conversation.context = readContextUsage(path, config.contextLimit);
          conversation.pending = reconcilePending(name, conversation);
          if (activeQuestion) {
            conversation.state = "needs_input";
            conversation.activeQuestion = {
              requestId: activeQuestion.requestId,
              questions: activeQuestion.questions,
            };
          }
          // An open question dialog is not written to the transcript until it
          // is answered. Normally the hooks identify it, but sessions launched
          // before hooks were installed/trusted can remain `unknown`; inspect
          // those panes too so the visible TUI remains the final source of truth.
          const hasPendingTranscriptTool = conversation.entries.some((e) => e.kind === "tool" && e.status == null);
          const shouldInspectPane = !activeQuestion && !hasPendingTranscriptTool && (
            entry?.state === "needs_input"
            || entry?.state === "unknown"
            || entry?.currentAction === "AskUserQuestion"
          );
          if (shouldInspectPane) {
            const pane = await capturePane(name, 40).catch(() => "");
            const question = parsePanePrompt(pane);
            // Parsed into the same shape a transcript question produces, so the
            // client renders one card either way. Unknown panes only surface
            // when they parse as a real choice; needs_input keeps the raw pane as
            // a fallback for permission dialogs and future Claude UI changes.
            if (question) {
              conversation.state = "needs_input";
              conversation.prompt = trimPane(pane);
              conversation.promptQuestion = question;
            } else if (entry?.state === "needs_input") {
              conversation.prompt = trimPane(pane);
            }
          }
        }
        return json(res, 200, conversation);
      }
      if (req.method === "POST" && parts[2] === "archive") {
        const entry = registry.view(name);
        const path = entry?.transcriptPath ?? resolveTranscriptPath(entry?.cwd, entry?.claudeSessionId);
        const conversation = readConversation(path, 400);
        if (!conversation.available) {
          return json(res, 409, { error: "this session has no conversation to archive" });
        }
        conversation.agent = entry?.agent ?? conversation.agent ?? "claude";
        const archive = archiveChat({
          session: name,
          agent: entry?.agent ?? conversation.agent ?? "claude",
          cwd: entry?.cwd ?? null,
          conversation,
        });
        await killSession(name);
        registry.remove(name);
        pushSessionList();
        return json(res, 200, { archive });
      }
      // The live hook state on its own, so a screen that needs only this (the
      // composer, deciding whether a message will queue) doesn't pull the whole
      // conversation or the whole fleet to find out.
      if (req.method === "GET" && parts[2] === "state") {
        const entry = registry.view(name);
        return json(res, 200, {
          state: entry?.state ?? "unknown",
          agent: entry?.agent,
          detail: entry?.detail,
          currentAction: entry?.currentAction,
          interactionKind: entry?.interactionKind,
          interactionRequestId: entry?.interactionRequestId,
        });
      }
      if (req.method === "GET" && parts[2] === "notifications") {
        return json(res, 200, { muted: registry.view(name)?.notificationsMuted === true });
      }
      if (req.method === "POST" && parts[2] === "notifications") {
        const body = await readJson(req);
        const muted = body.muted === true;
        registry.setNotificationsMuted(name, muted);
        return json(res, 200, { muted });
      }
      if (req.method === "POST" && parts[2] === "text") {
        const body = await readJson(req);
        const text = String(body.text ?? "");
        const submit = body.submit !== false;
        await sendText(name, text, submit);
        // A prompt submitted mid-turn is queued by Claude Code, not run. Record
        // it so every connected client can show it as pending — not just the one
        // that sent it — and nudge them to look.
        if (
          submit &&
          text.trim() &&
          registry.view(name)?.agent === "claude" &&
          registry.view(name)?.state === "working"
        ) {
          registry.addPending(name, text.trim());
          pushSession(name, registry.view(name));
        }
        return json(res, 200, { ok: true });
      }
      if (req.method === "POST" && parts[2] === "question") {
        const body = await readJson(req);
        try {
          questionBroker.respond(name, String(body.requestId ?? ""), body.answers);
          registry.update(name, {
            state: "working",
            detail: undefined,
            currentAction: undefined,
            interactionKind: undefined,
            interactionRequestId: undefined,
          });
          pushSession(name, registry.view(name));
          return json(res, 200, { ok: true });
        } catch (error) {
          return json(res, 409, { error: error instanceof Error ? error.message : "question is no longer waiting" });
        }
      }
      if (req.method === "POST" && parts[2] === "keys") {
        const body = await readJson(req);
        const keys = Array.isArray(body.keys) ? body.keys.map(String) : [];
        await sendKeys(name, keys);
        // Escape interrupts the turn and discards whatever was queued behind it,
        // so our record of that queue is stale the moment it lands.
        if (keys.some((k) => k.toLowerCase() === "escape")) {
          registry.dropPending(name);
          pushSession(name, registry.view(name));
        }
        return json(res, 200, { ok: true });
      }
      // Pick a specific option in an open dialog. The pane says which row is
      // highlighted, so the arrows needed to reach another one are computable —
      // but only from a fresh read, so the highlight is re-derived here rather
      // than trusted from whatever the client last rendered. Refuses rather than
      // guesses if the pane no longer looks like a choice.
      if (req.method === "POST" && parts[2] === "choose") {
        const body = await readJson(req);
        const target = Number(body.index);
        if (!Number.isInteger(target) || target < 0 || target > 20) {
          return json(res, 400, { error: "invalid option index" });
        }
        const current = highlightedIndex(await capturePane(name, 40));
        if (current == null) {
          return json(res, 409, { error: "no selectable prompt on screen" });
        }
        const steps = target - current;
        const keys = Array(Math.abs(steps)).fill(steps > 0 ? "down" : "up");
        await sendKeys(name, [...keys, "enter"]);
        return json(res, 200, { ok: true, from: current, to: target });
      }
      if (req.method === "POST" && parts[2] === "scroll") {
        const body = await readJson(req);
        const lines = Number(body.lines ?? 1);
        const inCopyMode = await scroll(name, String(body.action ?? "") as ScrollAction, lines);
        return json(res, 200, { ok: true, inCopyMode });
      }
      if (req.method === "GET" && parts[2] === "mode") {
        return json(res, 200, { inCopyMode: await paneInCopyMode(name) });
      }
      if (req.method === "GET" && parts[2] === "links") {
        const cwd = (await paneCurrentPath(name)) ?? registry.view(name)?.cwd;
        return json(
          res,
          200,
          await resolveLinks(
            cwd,
            registry.view(name)?.claudeSessionId,
            url.searchParams.get("refresh") === "1",
            url.searchParams.get("pr") !== "0",
          ),
        );
      }
      if (req.method === "GET" && parts[2] === "checks") {
        const cwd = (await paneCurrentPath(name)) ?? registry.view(name)?.cwd;
        return json(res, 200, await resolveChecks(cwd, url.searchParams.get("refresh") === "1"));
      }
      if (req.method === "POST" && parts[2] === "pr" && parts.length === 3) {
        const body = await readJson(req);
        const cwd = (await paneCurrentPath(name)) ?? registry.view(name)?.cwd;
        const title = typeof body.title === "string" ? body.title : undefined;
        const prBody = typeof body.body === "string" ? body.body : undefined;
        return json(res, 200, { url: await createPullRequest(cwd, title, prBody) });
      }
      if (req.method === "POST" && parts[2] === "pr" && parts[3] === "merge") {
        const body = await readJson(req);
        const cwd = (await paneCurrentPath(name)) ?? registry.view(name)?.cwd;
        await mergePullRequest(cwd, body.auto === true);
        return json(res, 200, { ok: true });
      }
      if (req.method === "GET" && parts[2] === "reviews") {
        const cwd = (await paneCurrentPath(name)) ?? registry.view(name)?.cwd;
        return json(res, 200, { comments: await reviewComments(cwd) });
      }
      if (req.method === "GET" && parts[2] === "worktree") {
        const cwd = (await paneCurrentPath(name)) ?? registry.view(name)?.cwd;
        return json(res, 200, await worktreeInfo(cwd));
      }
      if (req.method === "GET" && parts[2] === "cwd") {
        const cwd = (await paneCurrentPath(name)) ?? registry.view(name)?.cwd ?? null;
        return json(res, 200, { path: cwd });
      }
      if (req.method === "GET" && parts[2] === "files") {
        const cwd = (await paneCurrentPath(name)) ?? registry.view(name)?.cwd;
        if (!cwd) throw new Error("could not resolve session directory");
        return json(res, 200, { files: await findProjectFiles(cwd, url.searchParams.get("q") ?? "") });
      }
      if (req.method === "GET" && parts[2] === "skills") {
        const cwd = (await paneCurrentPath(name)) ?? registry.view(name)?.cwd;
        if (!cwd) throw new Error("could not resolve session directory");
        return json(res, 200, { skills: await findSkills(cwd, url.searchParams.get("q") ?? "") });
      }
      if (req.method === "POST" && parts[2] === "rename") {
        const body = await readJson(req);
        const newName = String(body.name ?? "").trim();
        await renameSession(name, newName);
        registry.rename(name, newName);
        pushSessionList();
        return json(res, 200, { ok: true });
      }
      if (req.method === "POST" && parts[2] === "workspace") {
        const body = await readJson(req);
        // The client sends the (possibly edited) path it showed the user;
        // fall back to resolving the session's cwd for older clients.
        const requested = typeof body.path === "string" && body.path.trim() ? body.path.trim() : undefined;
        const cwd = requested ?? (await paneCurrentPath(name)) ?? registry.view(name)?.cwd;
        if (!cwd) throw new Error("could not resolve session directory");
        try {
          return json(res, 200, { workspace: await addWorkspace(String(body.name ?? name), cwd) });
        } catch (err) {
          return json(res, 400, { error: (err as Error).message || "could not add workspace" });
        }
      }
      if (req.method === "POST" && parts[2] === "upload") {
        const filename = String(req.headers["x-filename"] ?? "upload.bin");
        const data = await readRawBody(req, MAX_UPLOAD_BYTES);
        return json(res, 200, { path: saveUpload(name, filename, data) });
      }
      if (req.method === "DELETE" && parts.length === 2) {
        await killSession(name);
        registry.remove(name);
        pushSessionList();
        return json(res, 200, { ok: true });
      }
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    // Log the detail; return a generic message so internal paths/errors don't leak.
    console.error("request error:", err);
    json(res, 500, { error: "internal error" });
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  const isStream = parts.length === 3 && parts[0] === "sessions" && parts[2] === "stream";
  const isNotify = parts.length === 2 && parts[0] === "notify" && parts[1] === "stream";
  if ((!isStream && !isNotify) || !authorized(req)) {
    socket.destroy();
    return;
  }
  if (isNotify) {
    // `notify=0` subscribes to live state without becoming a notification
    // target — the phone's role, since its banners come from Apple Push.
    // Absent means yes, so an older desktop client keeps receiving them.
    const notifies = url.searchParams.get("notify") !== "0";
    wss.handleUpgrade(req, socket, head, (ws) => attachNotifyStream(ws, notifies, url.searchParams));
    return;
  }
  const name = decodeURIComponent(parts[1]);
  wss.handleUpgrade(req, socket, head, (ws) => attachStream(ws, name, url.searchParams));
});

// Loopback-only. External reach comes solely through `tailscale serve`, which
// terminates TLS and restricts access to the tailnet — the process is never
// exposed on the LAN or any public interface.
server.listen(config.port, "127.0.0.1", () => {
  console.log(`remy server listening on 127.0.0.1:${config.port}`);
  startTailnetExposureReconciler();
});
setSleepBusyCheck(() =>
  listAllChats().some((chat) => chat.state === "working" || chat.state === "needs_input"),
);
syncSleepAssertion();
syncRepoUpdateSchedule();

// The built-in agents are ordinary rows once seeded. The seeder also upgrades
// untouched legacy defaults while preserving anything the user edited.
seedPresetAgents();
// Remy's own agent is seeded separately: its name and instructions come from
// this build rather than from the row, so they are re-synced on every boot.
seedRemyAgent();
// GitHub state belongs to registered workspaces. The monitor nudges the thread
// already working on a PR, or lets the default GitHub agent open one there.
startPullRequestMonitor();
// And what GitHub says about a ticket's own pull request: ready for review, or
// merged. Only this machine can ask about the repositories it holds.
startTicketPullRequestSync();
// Then whatever this release gave Remy to say, said once.
deliverAnnouncements();
// An agent deleted while this machine was shut leaves its conversation behind.
pruneOrphanDms();

// Board changes can originate outside an HTTP handler: a thread changes its
// ticket status, a routine runs, or an agent uses a ticket tool. Keep every
// open window live without making each writer remember to send its own frame.
function reconcileBoardEvent(event: LogEvent): void {
  if (event.entity === "ticket") {
    void reconcileTicket(event.entityId);
    // A sub-ticket moving is also its parent moving. Here rather than in the
    // writer so a sub-ticket a paired machine moved rolls its parent up too.
    syncParentTicket(event.entityId);
  }
  if (event.entity === "agent") {
    void reconcileAgentTickets(event.entityId);
    // What an agent thinks with is what its inbox conversation thinks with,
    // including when the change was made on another machine.
    syncAgentDm(event.entityId);
  }
}

onLocalAppend((event) => {
  broadcast({ type: "board" });
  reconcileBoardEvent(event);
});
onRemoteMerge(reconcileBoardEvent);

// Who this machine is signed in as, asked once. It names the branches Remy
// creates and the address on an agent's commits; Remy names itself when `gh`
// cannot say, so a branch always carries a prefix.
if (!config.worktreeBranchPrefix || !config.githubLogin) {
  void githubLogin().then((login) => {
    patchSettings({
      ...(config.worktreeBranchPrefix ? {} : { worktreeBranchPrefix: login ?? "remy" }),
      ...(config.githubLogin || !login ? {} : { githubLogin: login }),
    });
  });
}
// The routine's owning machine keeps its clock in the daemon rather than in a
// window that may be shut.
startRoutines(() => broadcast({ type: "board" }));

// Board events flow between paired machines whether or not a window is open —
// the daemon is what is paired, so the sync runs here rather than in a client.
startPeerSync(() => {
  syncActiveTicketThreads();
  broadcast({ type: "board" });
});
startPeerStreamRelay();
