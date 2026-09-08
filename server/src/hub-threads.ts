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
  createChat,
  getChat,
  getChatWindow,
  interruptChat,
  respondToApproval,
  respondToQuestion,
  sendChatMessage,
  stopChat,
  updateChat,
} from "./chat.js";
import { getKv, setKv } from "./db.js";
import { broadcast } from "./notify.js";
import { listWorkspaces } from "./workspaces.js";
import type { ChatImageAttachment } from "./transcript.js";

const KEY = "hubThreadAccess";
const accessRecords = () => getKv<Record<string, ThreadAccess>>(KEY) ?? {};
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
  return threadSnapshotSchema.parse({ id, revision, access, detail });
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
    /^\/hub\/threads(?:\/([0-9a-f-]{36})(?:\/(join|message|approval|question|interrupt|stop|visibility))?)?$/.exec(
      path,
    );
  if (!match) return fail(404, "This thread is no longer available.");
  const [, id, action] = match;
  try {
    if (!id && method === "POST") {
      const workspace = (await listWorkspaces()).find(
        (item) => item.id === input.workspaceId,
      );
      if (!workspace) return fail(404, "Choose a workspace on this computer.");
      if (
        input.visibility !== undefined &&
        input.visibility !== "private" &&
        input.visibility !== "open"
      )
        return fail(400, "Choose who can read this thread.");
      const chat = createChat({
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
    else if (method === "PATCH" && !action) {
      if (
        typeof input.title !== "string" ||
        !input.title.trim() ||
        input.title.length > 200
      )
        return fail(400, "Enter a shorter thread name.");
      updateChat(id, { title: input.title });
    } else return fail(404, "This action is not available.");
    return Response.json(hubThreadSnapshot(id, organizationId));
  } catch (error) {
    return fail(
      409,
      error instanceof Error ? error.message : "This action failed; try again.",
    );
  }
}
