import { assignedAgent, WORKSPACE_AGENT } from "./agents.js";
import { deviceId } from "./board-log.js";
import { createChat, deleteChat, getChat, sendChatMessage } from "./chat.js";
import { config, type CheckoutMode } from "./config.js";
import { callPeer, getPeer } from "./peers.js";
import { workspaceForProject } from "./projects.js";
import {
  getTicket,
  linkThread,
  listTickets,
  prepareTicketStart,
  type TicketThread,
  type TicketView,
} from "./tickets.js";
import { checkoutTicketWorktree } from "./workspaces.js";

const starts = new Map<string, Promise<ReturnType<typeof getChat> | undefined>>();

export function shouldAutoStart(ticket: TicketView, localDeviceId = deviceId): boolean {
  if (ticket.status !== "todo") return false;
  if (ticket.deviceId && ticket.deviceId !== localDeviceId) return false;
  const agent = assignedAgent(ticket.assigneeAgentId);
  return agent?.autoStart === true;
}

function activeRunner(ticket: TicketView, agentId?: string): ReturnType<typeof getChat> | undefined {
  for (const thread of ticket.threads) {
    if (thread.deviceId !== deviceId || thread.linkedBy !== "runner") continue;
    if ((thread.agentId || undefined) !== agentId) continue;
    const chat = getChat(thread.chatId);
    if (chat && chat.state !== "idle") return chat;
  }
  return undefined;
}

export interface TicketStartOptions {
  automatic?: boolean;
  checkout?: CheckoutMode;
  provider?: string;
  model?: string;
  effort?: string;
}

type CommentDelivery = (thread: TicketThread, body: string) => Promise<boolean>;

function runnerThread(ticket: TicketView): TicketThread | undefined {
  for (let index = ticket.threads.length - 1; index >= 0; index -= 1) {
    const thread = ticket.threads[index];
    if (thread.linkedBy === "runner") return thread;
  }
  return undefined;
}

async function deliverComment(thread: TicketThread, body: string): Promise<boolean> {
  if (thread.deviceId === deviceId) {
    if (!getChat(thread.chatId)) return false;
    await sendChatMessage(thread.chatId, body);
    return true;
  }
  const peer = getPeer(thread.deviceId);
  if (!peer) return false;
  await callPeer(peer, `/chats/${encodeURIComponent(thread.chatId)}/message`, {
    method: "POST",
    body: { text: body },
  });
  return true;
}

/// Continues the latest thread Remy started for a ticket with the person's
/// comment. A manually attached thread is context, not permission to run it.
export async function resumeTicketFromComment(
  id: string,
  body: string,
  deliver: CommentDelivery = deliverComment,
): Promise<boolean> {
  const ticket = getTicket(id);
  const thread = ticket ? runnerThread(ticket) : undefined;
  if (!thread) return false;
  return deliver(thread, body);
}

async function start(id: string, options: TicketStartOptions): Promise<ReturnType<typeof getChat> | undefined> {
  const automatic = options.automatic === true;
  const current = getTicket(id);
  if (!current) {
    if (automatic) return undefined;
    throw new Error("no such ticket");
  }
  if (current.deviceId && current.deviceId !== deviceId) {
    if (automatic) return undefined;
    throw new Error("This ticket runs on another device.");
  }

  let ticket: TicketView;
  let agentId: string | undefined;
  if (automatic) {
    if (!shouldAutoStart(current)) return undefined;
    ticket = current;
    agentId = ticket.assigneeAgentId === WORKSPACE_AGENT ? undefined : ticket.assigneeAgentId;
  } else {
    ({ ticket, agentId } = prepareTicketStart(id));
  }

  const running = activeRunner(ticket, agentId);
  if (running) return running;

  const workspace = await workspaceForProject(ticket.projectId);
  if (!workspace) {
    if (automatic) return undefined;
    throw new Error("This workspace is not on this device.");
  }
  const checkout = options.checkout ?? (automatic ? "worktree" : config.defaultCheckout);
  const cwd = checkout === "worktree"
    ? await checkoutTicketWorktree(workspace, ticket.key)
    : workspace.path;
  const chat = createChat({
    cwd,
    title: ticket.title,
    ...(agentId ? { agentId } : {}),
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.effort !== undefined ? { effort: options.effort } : {}),
    workspaceDefault: { provider: workspace.provider, model: workspace.model, effort: workspace.effort },
  });
  try {
    linkThread(ticket.id, { chatId: chat.id, agentId, linkedBy: "runner" });
    await sendChatMessage(chat.id, `Work on ${ticket.key}`);
    return getChat(chat.id);
  } catch (error) {
    deleteChat(chat.id);
    throw error;
  }
}

/// Starts a board thread once, even when status and assignee events arrive in
/// adjacent microtasks or from two devices in the same sync round.
export function startTicketThread(
  id: string,
  options: TicketStartOptions = {},
): Promise<ReturnType<typeof getChat> | undefined> {
  const existing = starts.get(id);
  if (existing) return existing;
  const pending = start(id, options);
  starts.set(id, pending);
  void pending.finally(() => {
    if (starts.get(id) === pending) starts.delete(id);
  }).catch(() => undefined);
  return pending;
}

export async function reconcileTicket(id: string): Promise<void> {
  try {
    await startTicketThread(id, { automatic: true });
  } catch (error) {
    console.error(`could not start ticket ${id}:`, error);
  }
}

export async function reconcileTickets(): Promise<void> {
  await Promise.all(listTickets().map((ticket) => reconcileTicket(ticket.id)));
}

export async function reconcileAgentTickets(agentId: string): Promise<void> {
  await Promise.all(
    listTickets()
      .filter((ticket) => ticket.assigneeAgentId === agentId)
      .map((ticket) => reconcileTicket(ticket.id)),
  );
}
