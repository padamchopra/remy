import { canWriteThread, type HubThread, type ThreadMember } from "@remy/contract";
import { z } from "zod";

export const startAgentThreadSchema = z.object({
  prompt: z.string().trim().min(1).max(20000), title: z.string().trim().min(1).max(120).optional(),
  workspace: z.string().min(1).optional(), provider: z.enum(["claude", "codex", "cursor"]).optional(),
  model: z.string().min(1).max(512).optional(), effort: z.string().max(64).optional(),
  permissionMode: z.enum(["default", "auto", "acceptEdits", "plan", "bypassPermissions"]).optional(),
  visibility: z.enum(["private", "open"]).optional(), request_id: z.string().uuid().optional(),
}).strict();
const targetSchema = z.object({ thread_id: z.string().uuid(), message: z.string().trim().min(1).max(20000).optional(), message_id: z.string().uuid().optional() }).strict();
export const orchestrationActions = ["list_threads", "read_thread", "start_thread", "send_to_thread", "stop_thread"] as const;

export function agentThreadMember(source: HubThread, member: ThreadMember): ThreadMember {
  const provider = source.detail.provider;
  if (provider !== "claude" && provider !== "codex" && provider !== "cursor") throw Error("This thread's provider is unavailable.");
  return { id: member.id, label: member.label, agent: { organizationId: source.access.organizationId, computerId: source.computerId, threadId: source.id, title: source.detail.title.slice(0, 200), provider } };
}

export async function orchestrateThread(action: string, input: unknown, context: {
  source: HubThread; member: ThreadMember; threads: HubThread[];
  workspace(reference?: string): Promise<string>;
  request(path: string, method: string, input?: Record<string, unknown>): Promise<Response>;
}) {
  const fail = (error: string, status = 400) => Response.json({ error }, { status });
  const summary = (thread: HubThread) => ({ id: thread.id, computerId: thread.computerId, title: thread.detail.title, state: thread.detail.state, provider: thread.detail.provider, model: thread.detail.model, cwd: thread.detail.cwd, visibility: thread.access.visibility, stale: thread.stale, canMessage: canWriteThread(thread.access, context.member.id) });
  if (action === "list_threads") return Response.json({ threads: context.threads.filter(t => !t.detail.archived && !t.detail.parentChatId).slice(0, 100).map(summary) });
  if (action === "start_thread") {
    const parsed = startAgentThreadSchema.safeParse(input);
    if (!parsed.success) return fail("Choose valid settings and a task for your new thread.");
    const { prompt, workspace, request_id, ...overrides } = parsed.data;
    const source = context.source;
    const permission = source.detail.permissionMode ?? "default";
    if (overrides.permissionMode && overrides.permissionMode !== permission && permission !== "bypassPermissions" && overrides.permissionMode !== "plan" && !(overrides.permissionMode === "default" && permission !== "plan")) return fail("Change permissions in the sending thread before delegating with broader permissions.",403);
    const id = request_id ?? crypto.randomUUID();
    let workspaceId: string;
    try { workspaceId = await context.workspace(workspace); }
    catch { return fail("Choose an available workspace on this computer.",404); }
    const created = await context.request(`/computers/${encodeURIComponent(source.computerId)}/threads`, "POST", {
      workspaceId, threadId: id, hubTaskId: `agent:${source.id}:${id}`,
      provider: source.detail.provider, model: source.detail.model, effort: source.detail.effort,
      permissionMode: source.detail.permissionMode ?? "default", visibility: source.access.visibility,
      title: prompt.split("\n")[0].slice(0, 120), ...overrides,
      ...(overrides.provider && overrides.provider !== source.detail.provider && !overrides.model ? { model: undefined, effort: overrides.effort } : {}),
    });
    if (!created.ok) return created;
    const thread = await created.json() as HubThread;
    const sent = await context.request(`/computers/${encodeURIComponent(source.computerId)}/threads/${thread.id}/message`, "POST", { text: prompt, messageId: `u-${id}` });
    if (!sent.ok) return sent;
    return Response.json({ id: thread.id, computerId: source.computerId, title: thread.detail.title, artifact: { kind: "thread", id: thread.id, computerId: source.computerId, organizationId: source.access.organizationId, title: thread.detail.title } }, { status: 201 });
  }
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return fail("Choose a thread and a valid message.");
  const target = context.threads.find(t => t.id === parsed.data.thread_id);
  if (!target) return fail("This thread is no longer available.", 404);
  if (action === "read_thread") return Response.json({ ...summary(target), entries: target.detail.entries.slice(-30) });
  if (action !== "send_to_thread" && action !== "stop_thread") return fail("This thread action is unavailable.", 403);
  if (target.id === context.source.id) return fail("Reply normally in your current thread.");
  if (!canWriteThread(target.access, context.member.id)) return fail("You cannot send messages to this thread.", 403);
  if (action === "stop_thread") return context.request(`/computers/${encodeURIComponent(target.computerId)}/threads/${target.id}/stop`, "POST", {});
  if (!parsed.data.message) return fail("Write a message for the thread.");
  return context.request(`/computers/${encodeURIComponent(target.computerId)}/threads/${target.id}/message`, "POST", { text: parsed.data.message, messageId: `u-${parsed.data.message_id ?? crypto.randomUUID()}` });
}
