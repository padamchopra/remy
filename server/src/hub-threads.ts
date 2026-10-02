import { hubThreadBranch } from "./hub-thread-branch.js";
import { prepareHostedBranch } from "./hosted-branch.js";
import { hostedGatewayAvailable } from "./hosted-models.js";
import { setTaskEnvironment } from "./environments.js";
import {
  canReadThread,
  canWriteThread,
  THREAD_MESSAGE_MAX_CHARACTERS,
  threadAccessSchema,
  threadSnapshotSchema,
  type ThreadAccess,
  type ThreadMember,
  type ThreadSnapshot,
} from "@remy/contract";
import {
  archiveConversation,
  chatGroup,
  createChat,
  deleteChat,
  deleteChatGroup,
  getChat,
  getChatWindow,
  getChatHistoryEntries,
  interruptChat,
  respondToApproval,
  respondToQuestion,
  sendChatMessage,
  stopChat,
  stopChatGroup,
  updateChat,
  publishLinearNotice,
} from "./chat.js";
import { setHubLinear } from "./linear-session.js";
import { archiveChat } from "./archives.js";
import { closeBrowser } from "./browser.js";
import { closeTerminal } from "./terminal.js";
import { getKv, setKv } from "./db.js";
import { broadcast } from "./notify.js";
import { hasEntriesBefore } from "./chat-storage.js";
import { checkoutReviewWorktree, checkoutWorkspaceBranch, listWorkspaces } from "./workspaces.js";
import type { ChatCodeReference, ChatImageAttachment, ConvEntry } from "./transcript.js";
import { isActivityHeartbeat } from "./transcript.js";
import { validateChatCodeReferences } from "./chat-references.js";
import { removeWorktree } from "./git.js";
import { forgetThreadReview, movedHeadContext, parseHubReview, setThreadReview, threadReview, updatedRulesContext } from "./review-agent.js";
import type { HubReview } from "@remy/contract";

/// A cloud computer fetches through the hub's read-only Git capability.
function reviewGitOptions() {
  return process.env.REMY_HOSTED_TASK === "1"
    ? { env: { ...process.env, REMY_GIT_READ_ONLY: "1", GIT_TERMINAL_PROMPT: "0" } }
    : {};
}

const KEY = "hubThreadAccess";
const branchStates = new Map<string, string>();
const accessRecords = () => getKv<Record<string, ThreadAccess>>(KEY) ?? {};
const forgetHubThreads = (ids: string[]) => {
  const rows = accessRecords();
  for (const id of ids) delete rows[id];
  setKv(KEY, rows);
};
const fail = (status: number, error: string) =>
  Response.json({ error }, { status });

export function shareHubThread(
  id: string,
  organizationId: string,
  owner: ThreadMember,
  source: "manual" | "external" | "automatic",
  visibility?: "private" | "open",
): void {
  if (!getChat(id)) throw new Error("This thread is no longer available.");
  const rows = accessRecords();
  if (rows[id]) throw new Error("This thread is already shared.");
  rows[id] = threadAccessSchema.parse({
    organizationId,
    owner,
    visibility: visibility ?? (source === "manual" ? "private" : "open"),
    participants: [owner],
  });
  setKv(KEY, rows);
  broadcast({ type: "hub-thread", chatId: id });
}

const HUB_MIRROR_BYTES = 96_000;

function readableEntries(entries: readonly ConvEntry[]): ConvEntry[] {
  return entries.flatMap((entry) => {
    if (isActivityHeartbeat(entry)) return [];
    if (!entry.activity) return [entry];
    const { activity: _activity, ...rest } = entry;
    return [rest];
  });
}

/// The hub keeps a 96 KB mirror of a thread. Activity heartbeats are not drawn
/// in that column; left in the budget, they push the words off the front until
/// the column is shorter than the screen and will not scroll. Thinking goes
/// before a message or a tool call when the mirror still has to shrink.
export function fitHubMirror<T extends { entries: ConvEntry[] }>(detail: T, byteLimit = HUB_MIRROR_BYTES): T {
  detail.entries = readableEntries(detail.entries);
  const over = () => Buffer.byteLength(JSON.stringify(detail)) > byteLimit;
  while (over()) {
    const thinking = detail.entries.findIndex((entry) => entry.kind === "thinking");
    if (thinking < 0) break;
    detail.entries.splice(thinking, 1);
  }
  while (detail.entries.length && over()) detail.entries.shift();
  return detail;
}

/// One page of the transcript the mirror did not keep. Pages move backward
/// from `before` and stop on any entry, so one long turn can still be read.
export function transcriptPage(entries: readonly ConvEntry[], before?: string, byteLimit = HUB_MIRROR_BYTES): {
  entries: ConvEntry[];
  history: { hasEarlier: boolean; before?: string };
} {
  const readable = readableEntries(entries);
  let end = readable.length;
  if (before !== undefined) {
    end = readable.findIndex((entry) => entry.id === before);
    if (end < 0) throw new Error("That part of the thread is no longer available.");
  }
  const page: ConvEntry[] = [];
  let start = end;
  while (start > 0) {
    const candidate = readable[start - 1];
    if (page.length > 0 && Buffer.byteLength(JSON.stringify([candidate, ...page])) > byteLimit) break;
    page.unshift(candidate);
    start -= 1;
  }
  return {
    entries: page,
    history: start > 0 && page[0]?.id ? { hasEarlier: true, before: page[0].id } : { hasEarlier: false },
  };
}

function rememberEarlier(detail: { id: string; entries: ConvEntry[]; history?: { hasEarlier: boolean; before?: string } }, stored: readonly ConvEntry[]): void {
  const readable = readableEntries(stored);
  const first = detail.entries[0]?.id;
  const index = first ? readable.findIndex((entry) => entry.id === first) : -1;
  // Heartbeats before the first kept row are not readable, so they are not
  // another page. Anything else in front of that row still is.
  if (first && (index > 0 || hasEntriesBefore(detail.id, first))) detail.history = { hasEarlier: true, before: first };
  else detail.history = undefined;
}

export function hubThreadAccess(id: string): ThreadAccess | undefined { return accessRecords()[id]; }

export function hubThreadSnapshot(
  id: string,
  organizationId: string,
): ThreadSnapshot | undefined {
  const access = accessRecords()[id];
  const detail = getChatWindow(id, 8);
  if (!access || access.organizationId !== organizationId || !detail)
    return undefined;
  // A tool-heavy turn whose opening message has already rolled out of storage
  // has no user row, so the eight-turn window keeps only a short tail. That
  // tail fits on screen and the thread cannot scroll. Read the stored turn.
  const stored = detail.history?.hasEarlier && !detail.entries.some((entry) => entry.kind === "user")
    ? getChat(id)
    : undefined;
  if (stored) {
    detail.entries = stored.entries.slice();
    detail.history = undefined;
  }
  const revisionKey = `hubThreadRevision:${id}`;
  const revision = (getKv<number>(revisionKey) ?? 0) + 1;
  setKv(revisionKey, revision);
  fitHubMirror(detail);
  const full = getChat(id);
  if (!detail.entries.length && full?.entries[0]) {
    detail.entries = getChatHistoryEntries(id, full.entries[0].id) ?? [];
    fitHubMirror(detail);
  }
  if (full) rememberEarlier(detail, full.entries);
  const branchState = `${detail.cwd}:${detail.state}`;
  const refreshBranch = branchStates.get(id) !== branchState;
  branchStates.set(id, branchState);
  const review = threadReview(id);
  // A review's checkout is detached at the pull request's head; its branch is
  // the pull request's, not one of its own.
  const branch = review ? undefined : hubThreadBranch(detail.cwd, () => broadcast({type: "hub-thread", chatId: id}), refreshBranch);
  return threadSnapshotSchema.parse({ id, revision, access, detail: {...detail, ...(branch ? {branch} : {}), ...(review ? { review: { repository: review.repository, number: review.number, baseRef: review.baseRef, headRef: review.headRef, headSha: review.headSha } } : {})} });
}

export function hubThreadIds(organizationId: string): string[] {
  return Object.entries(accessRecords())
    .filter(
      ([id, access]) => access.organizationId === organizationId && getChat(id),
    )
    .map(([id]) => id);
}

export async function handleHubThreadRequest(
  organizationId: string,
  actor: ThreadMember,
  method: string,
  path: string,
  input: Record<string, unknown>,
  importAttachment: (
    chatId: string,
    id: string,
  ) => Promise<ChatImageAttachment>,
): Promise<Response> {
  const match =
    /^\/hub\/threads(?:\/([0-9a-f-]{36})(?:\/(join|message|approval|question|interrupt|stop|visibility|options|archive|transcript))?)?$/.exec(
      path,
    );
  if (!match) return fail(404, "This thread is no longer available.");
  const [, id, action] = match;
  try {
    if (!id && method === "POST") {
      if (input.threadId !== undefined && (typeof input.threadId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.threadId)))
        return fail(400, "Start this thread again.");
      const taskKey=typeof input.hubTaskId==="string"?`hubTask:${organizationId}:${actor.id}:${input.hubTaskId}`:undefined;
      const prior=taskKey?getKv<string>(taskKey):undefined;
      if(prior){const snapshot=hubThreadSnapshot(prior,organizationId);if(snapshot)return Response.json(snapshot,{status:201});}
      if (typeof input.threadId === "string" && getChat(input.threadId)) return fail(409, "This thread id is already in use; choose a new request id.");
      const workspace = (await listWorkspaces()).find(
        (item) => item.id === input.workspaceId,
      );
      if (!workspace) return fail(404, "Choose a workspace on this computer.");
      const existing=taskKey?getKv<string>(taskKey):undefined;
      if(existing){const snapshot=hubThreadSnapshot(existing,organizationId);if(snapshot)return Response.json(snapshot,{status:201});}
      if (
        input.visibility !== undefined &&
        input.visibility !== "private" &&
        input.visibility !== "open"
      )
        return fail(400, "Choose who can read this thread.");
      if(typeof input.model === "string" && input.model.startsWith("remy:")) {
        if(input.provider !== "codex" || !hostedGatewayAvailable(input.model)) return fail(400,"This model provider is unavailable on this computer.");
      }
      let review: HubReview | undefined;
      if (input.hubReview !== undefined) {
        review = parseHubReview(input.hubReview);
        if (input.branch !== undefined) return fail(400, "A review starts at the pull request's head; leave the branch out.");
      }
      if (input.branch !== undefined) {
        if (typeof input.branch !== "string" || !input.branch || input.branch.length > 255) return fail(400, "Choose a branch.");
        if (process.env.REMY_HOSTED_TASK === "1") await prepareHostedBranch(workspace.path, input.branch);
        else await checkoutWorkspaceBranch(workspace.id, input.branch, "main");
      }
      if (input.permissionMode !== undefined && !["default", "auto", "acceptEdits", "plan", "bypassPermissions"].includes(String(input.permissionMode))) return fail(400, "Choose a permission level.");
      if (input.effort !== undefined && (typeof input.effort !== "string" || input.effort.length > 64)) return fail(400, "Choose a reasoning level.");
      let cwd = workspace.path;
      if (actor.agent?.computerId && actor.agent.organizationId === organizationId) {
        const source = hubThreadSnapshot(actor.agent.threadId, organizationId);
        if (!source || !canWriteThread(source.access, actor.id)) return fail(403, "This sending thread is no longer available.");
        const sourceWorkspace = (await listWorkspaces()).filter(w => source.detail.cwd === w.path || w.worktrees.some(tree => tree.path === source.detail.cwd) || String(source.detail.cwd).startsWith(w.path.replace(/\/$/, "") + "/")).sort((a,b) => b.path.length-a.path.length)[0];
        if (sourceWorkspace?.id === workspace.id) cwd = String(source.detail.cwd);
      }
      if (review) {
        try { cwd = await checkoutReviewWorktree(workspace.path, review, reviewGitOptions()); }
        catch { return fail(409, `This computer could not check out pull request #${review.number}. Check that ${workspace.name} can fetch from origin, then try again.`); }
      }
      const chat = createChat({
        ...(typeof input.threadId === "string" ? { id: input.threadId } : {}),
        permissionMode: input.permissionMode,
        cwd,
        title: typeof input.title === "string" ? input.title : undefined,
        provider: input.provider,
        model: typeof input.model === "string" ? input.model : undefined,
        effort: typeof input.effort === "string" ? input.effort : undefined,
      });
      if(actor.agent) {
        setKv(`hubAgentParent:${chat.id}`,actor.agent.threadId);
        if(threadReview(actor.agent.threadId) || getKv(`hubReviewDelegation:${actor.agent.threadId}`)) setKv(`hubReviewDelegation:${chat.id}`,true);
      }
      if(review)setThreadReview(chat.id,{...review,worktree:cwd});
      if(taskKey)setKv(taskKey,chat.id);
      if(input.hubEnvironment!==undefined)setTaskEnvironment(chat.id,input.hubEnvironment);
      if(input.hubLinear!==undefined){setHubLinear(chat.id,input.hubLinear);publishLinearNotice(chat.id);}
      if(input.hubInbox===true)setKv(`hubInbox:${chat.id}`,true);
      if(typeof input.hubInstructions==="string")setKv(`hubPersona:${chat.id}`,input.hubInstructions.slice(0,64000));
      shareHubThread(
        chat.id,
        organizationId,
        { id: actor.id, label: actor.label },
        "manual",
        input.visibility as "private" | "open" | undefined,
      );
      return Response.json(hubThreadSnapshot(chat.id, organizationId), {
        status: 201,
      });
    }
    if (!id) return fail(404, "This thread is no longer available.");
    // Reading a page must not publish a new snapshot. That bumps the revision
    // the open thread is already following.
    if (method === "GET" && action === "transcript") {
      const access = accessRecords()[id];
      if (!access || access.organizationId !== organizationId || !canReadThread(access, actor.id))
        return fail(404, "This thread is no longer available.");
      const chat = getChat(id);
      if (!chat) return fail(404, "This thread is no longer available.");
      const before = typeof input.before === "string" ? input.before : undefined;
      try {
        const page = transcriptPage(getChatHistoryEntries(id, before)!);
        const first = page.entries[0]?.id;
        if (first && hasEntriesBefore(id, first)) page.history = { hasEarlier: true, before: first };
        return Response.json(page);
      } catch (error) {
        return fail(409, error instanceof Error ? error.message : "That part of the thread is no longer available.");
      }
    }
    const snapshot = hubThreadSnapshot(id, organizationId);
    if (!snapshot || !canReadThread(snapshot.access, actor.id))
      return fail(404, "This thread is no longer available.");
    if (method === "GET" && !action) return Response.json(snapshot);
    if (method === "POST" && action === "join") {
      if (!canWriteThread(snapshot.access, actor.id)) {
        const rows = accessRecords();
        rows[id] = threadAccessSchema.parse({
          ...snapshot.access,
          participants: [...snapshot.access.participants, actor],
        });
        setKv(KEY, rows);
        broadcast({ type: "hub-thread", chatId: id });
      }
      return Response.json(hubThreadSnapshot(id, organizationId));
    }
    if (!canWriteThread(snapshot.access, actor.id))
      return fail(403, "Join this thread before replying.");
    if (method === "POST" && action === "visibility") {
      if (snapshot.access.owner.id !== actor.id)
        return fail(
          403,
          "Only the person who started this thread can change its visibility.",
        );
      if (input.visibility !== "private" && input.visibility !== "open")
        return fail(400, "Choose who can read this thread.");
      const rows = accessRecords();
      rows[id] = { ...snapshot.access, visibility: input.visibility };
      setKv(KEY, rows);
      broadcast({ type: "hub-thread", chatId: id });
    } else if (method === "POST" && action === "message") {
      if(input.hubEnvironment!==undefined)setTaskEnvironment(id,input.hubEnvironment);
      if(input.hubLinear!==undefined){setHubLinear(id,input.hubLinear);publishLinearNotice(id);}
      if (
        typeof input.text !== "string" ||
        !input.text.trim() ||
        input.text.length > THREAD_MESSAGE_MAX_CHARACTERS
      )
        return fail(400, "Write a message of up to 64,000 characters.");
      if (
        typeof input.messageId !== "string" ||
        !/^u-[0-9a-f-]{36}$/i.test(input.messageId)
      )
        return fail(400, "Send this message again.");
      if (
        input.attachmentIds !== undefined &&
        (!Array.isArray(input.attachmentIds) ||
          input.attachmentIds.length > 8 ||
          input.attachmentIds.some(
            (value) =>
              typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value),
          ))
      )
        return fail(400, "Choose up to eight images.");
      // Lines chosen in a pull request's diff: the provider reads them as
      // review context, and the thread shows them on the message.
      let codeReferences: ChatCodeReference[];
      try { codeReferences = validateChatCodeReferences(input.codeReferences); }
      catch { return fail(400, "Choose up to 200 lines for each code reference."); }
      // A review's message carries its owner's rules and the commit it is
      // about. What changed since the provider last saw them rides along.
      let reviewContext: string | undefined;
      const stored = input.hubReview !== undefined ? threadReview(id) : undefined;
      if (stored) {
        const next = parseHubReview(input.hubReview);
        const context: string[] = [];
        if (next.headSha !== stored.headSha) {
          try { await checkoutReviewWorktree(stored.worktree, next, { ...reviewGitOptions(), existing: stored.worktree }); }
          catch { return fail(409, "This computer could not fetch the pull request's new commits; try again."); }
          context.push(movedHeadContext(stored.headSha, next.headSha));
        }
        const rules = updatedRulesContext(stored.rules, next.rules);
        if (rules) context.push(rules);
        setThreadReview(id, { ...stored, headSha: next.headSha, rules: next.rules });
        reviewContext = context.join("\n\n") || undefined;
      }
      const attachments = await Promise.all(
        ((input.attachmentIds ?? []) as string[]).map((attachment) =>
          importAttachment(id, attachment),
        ),
      );
      await sendChatMessage(
        id,
        input.text,
        attachments,
        codeReferences,
        reviewContext,
        input.messageId,
        actor,
      );
    } else if (method === "POST" && action === "options") {
      if (Object.keys(input).some(key => !["model", "effort", "permissionMode"].includes(key))) return fail(400, "Choose a thread setting.");
      if (input.model !== undefined && input.model !== null && (typeof input.model !== "string" || input.model.length > 512)) return fail(400, "Choose a model.");
      if (input.effort !== undefined && input.effort !== null && (typeof input.effort !== "string" || input.effort.length > 64)) return fail(400, "Choose a reasoning level.");
      if (input.permissionMode !== undefined && !["default", "auto", "acceptEdits", "plan", "bypassPermissions"].includes(String(input.permissionMode))) return fail(400, "Choose a permission level.");
      updateChat(id, { model: input.model as string | null | undefined, effort: input.effort as string | null | undefined, permissionMode: input.permissionMode });
    } else if (method === "POST" && action === "approval") {
      if (
        input.decision !== "allow" &&
        input.decision !== "allowAlways" &&
        input.decision !== "deny"
      )
        return fail(400, "Choose whether to allow this request.");
      respondToApproval(
        id,
        String(input.requestId ?? ""),
        input.decision,
        actor,
      );
    } else if (method === "POST" && action === "question") {
      if (
        !input.answers ||
        typeof input.answers !== "object" ||
        Array.isArray(input.answers)
      )
        return fail(400, "Answer the question before sending.");
      respondToQuestion(
        id,
        String(input.requestId ?? ""),
        input.answers as Record<string, unknown>,
        actor,
      );
    } else if (method === "POST" && action === "interrupt")
      await interruptChat(id);
    else if (method === "POST" && action === "stop") stopChat(id);
    else if (method === "POST" && action === "archive") {
      return retireHubThread(id, "archive");
    } else if (method === "DELETE" && !action) {
      return retireHubThread(id, "delete");
    } else if (method === "PATCH" && !action) {
      const title = typeof input.title === "string" ? input.title : undefined;
      const pinned = typeof input.pinned === "boolean" ? input.pinned : undefined;
      if (title !== undefined && (!title.trim() || title.length > 120))
        return fail(400, "Enter a shorter thread name.");
      if (title === undefined && pinned === undefined)
        return fail(400, "Choose a thread setting.");
      updateChat(id, { title, pinned });
    } else return fail(404, "This action is not available.");
    return Response.json(hubThreadSnapshot(id, organizationId));
  } catch (error) {
    return fail(
      409,
      error instanceof Error ? error.message : "This action failed; try again.",
    );
  }
}

async function retireHubThread(id: string, mode: "archive" | "delete"): Promise<Response> {
  const chat = getChat(id);
  if (!chat) return fail(404, "This thread is no longer available.");
  if (mode === "archive" && chat.parentChatId && (chat.state === "working" || chat.state === "needs_input")) {
    return fail(409, "this thread is still running");
  }
  const ids = chat.parentChatId ? [id] : chatGroup(id).map((member) => member.id);
  try {
    if (mode === "archive") {
      if (chat.parentChatId) {
        archiveChat({
          chatId: chat.id,
          session: chat.title,
          agent: chat.provider,
          cwd: chat.cwd,
          conversation: archiveConversation(chat.id),
        });
        void closeBrowser(id);
        closeTerminal(`thread-${id}`);
        deleteChat(id);
      } else {
        const group = await stopChatGroup(id);
        await Promise.all(group.map((member) => closeBrowser(member.id).catch(() => undefined)));
        for (const member of group) {
          archiveChat({
            chatId: member.id,
            session: member.title,
            agent: member.provider,
            cwd: member.cwd,
            conversation: archiveConversation(member.id),
          });
          closeTerminal(`thread-${member.id}`);
        }
        deleteChatGroup(id);
      }
    } else if (chat.parentChatId) {
      void closeBrowser(id);
      closeTerminal(`thread-${id}`);
      deleteChat(id);
    } else {
      const group = await stopChatGroup(id);
      await Promise.all(group.map((member) => closeBrowser(member.id).catch(() => undefined)));
      for (const member of group) {
        closeTerminal(`thread-${member.id}`);
      }
      deleteChatGroup(id);
    }
    forgetHubThreads(ids);
    // A review's checkout is Remy's own and goes with its thread.
    for (const member of ids) {
      const review = threadReview(member);
      if (!review) continue;
      await removeWorktree(review.worktree, true).catch(() => undefined);
      forgetThreadReview(member);
    }
    broadcast({ type: "hub-thread", chatId: id });
    return Response.json({ ok: true });
  } catch (error) {
    return fail(
      409,
      error instanceof Error ? error.message : "This action failed; try again.",
    );
  }
}
