import { hubThreadBranch } from "./hub-thread-branch.js";
import { prepareHostedBranch } from "./hosted-branch.js";
import { hostedGatewayAvailable } from "./hosted-models.js";
import { setTaskEnvironment } from "./environments.js";
import {
  canReadThread,
  canWriteThread,
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
  interruptChat,
  respondToApproval,
  respondToQuestion,
  sendChatMessage,
  stopChat,
  stopChatGroup,
  updateChat,
} from "./chat.js";
import { archiveChat } from "./archives.js";
import { closeBrowser } from "./browser.js";
import { clearThreadPullRequestMonitoring } from "./pull-request-monitoring.js";
import { closeTerminal } from "./terminal.js";
import { getKv, setKv } from "./db.js";
import { broadcast } from "./notify.js";
import { checkoutWorkspaceBranch, listWorkspaces } from "./workspaces.js";
import type { ChatImageAttachment } from "./transcript.js";

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

export function hubThreadSnapshot(
  id: string,
  organizationId: string,
): ThreadSnapshot | undefined {
  const access = accessRecords()[id];
  const detail = getChatWindow(id, 8);
  if (!access || access.organizationId !== organizationId || !detail)
    return undefined;
  const revisionKey = `hubThreadRevision:${id}`;
  const revision = (getKv<number>(revisionKey) ?? 0) + 1;
  setKv(revisionKey, revision);
  while (
    detail.entries.length &&
    Buffer.byteLength(JSON.stringify(detail)) > 96_000
  )
    detail.entries.shift();
  const branchState = `${detail.cwd}:${detail.state}`;
  const refreshBranch = branchStates.get(id) !== branchState;
  branchStates.set(id, branchState);
  const branch = hubThreadBranch(detail.cwd, () => broadcast({type: "hub-thread", chatId: id}), refreshBranch);
  return threadSnapshotSchema.parse({ id, revision, access, detail: {...detail, ...(branch ? {branch} : {})} });
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
    /^\/hub\/threads(?:\/([0-9a-f-]{36})(?:\/(join|message|approval|question|interrupt|stop|visibility|options|archive))?)?$/.exec(
      path,
    );
  if (!match) return fail(404, "This thread is no longer available.");
  const [, id, action] = match;
  try {
    if (!id && method === "POST") {
      const taskKey=typeof input.hubTaskId==="string"?`hubTask:${organizationId}:${actor.id}:${input.hubTaskId}`:undefined;
      const prior=taskKey?getKv<string>(taskKey):undefined;
      if(prior){const snapshot=hubThreadSnapshot(prior,organizationId);if(snapshot)return Response.json(snapshot,{status:201});}
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
      if (input.branch !== undefined) {
        if (typeof input.branch !== "string" || !input.branch || input.branch.length > 255) return fail(400, "Choose a branch.");
        if (process.env.REMY_HOSTED_TASK === "1") await prepareHostedBranch(workspace.path, input.branch);
        else await checkoutWorkspaceBranch(workspace.id, input.branch, "main");
      }
      if (input.permissionMode !== undefined && !["default", "auto", "acceptEdits", "plan", "bypassPermissions"].includes(String(input.permissionMode))) return fail(400, "Choose a permission level.");
      const chat = createChat({
        permissionMode: input.permissionMode,
        cwd: workspace.path,
        title: typeof input.title === "string" ? input.title : undefined,
        provider: input.provider,
        model: typeof input.model === "string" ? input.model : undefined,
        workspaceDefault: {
          provider: workspace.provider,
          model: workspace.model,
          effort: workspace.effort,
        },
      });
      if(taskKey)setKv(taskKey,chat.id);
      if(input.hubEnvironment!==undefined)setTaskEnvironment(chat.id,input.hubEnvironment);
      if(input.hubInbox===true)setKv(`hubInbox:${chat.id}`,true);
      if(typeof input.hubInstructions==="string")setKv(`hubPersona:${chat.id}`,input.hubInstructions.slice(0,64000));
      shareHubThread(
        chat.id,
        organizationId,
        actor,
        "manual",
        input.visibility as "private" | "open" | undefined,
      );
      return Response.json(hubThreadSnapshot(chat.id, organizationId), {
        status: 201,
      });
    }
    if (!id) return fail(404, "This thread is no longer available.");
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
      if (
        typeof input.text !== "string" ||
        !input.text.trim() ||
        input.text.length > 64_000
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
      const attachments = await Promise.all(
        ((input.attachmentIds ?? []) as string[]).map((attachment) =>
          importAttachment(id, attachment),
        ),
      );
      await sendChatMessage(
        id,
        input.text,
        attachments,
        [],
        undefined,
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
        clearThreadPullRequestMonitoring(id);
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
          clearThreadPullRequestMonitoring(member.id);
        }
        deleteChatGroup(id);
      }
    } else if (chat.parentChatId) {
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
    forgetHubThreads(ids);
    broadcast({ type: "hub-thread", chatId: id });
    return Response.json({ ok: true });
  } catch (error) {
    return fail(
      409,
      error instanceof Error ? error.message : "This action failed; try again.",
    );
  }
}
