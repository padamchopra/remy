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

function activeRunner(ticket: TicketView): ReturnType<typeof getChat> | undefined {
  for (const thread of ticket.threads) {
    if (thread.deviceId !== deviceId || thread.linkedBy !== "runner") continue;
    const chat = getChat(thread.chatId);
    if (chat && chat.state !== "idle") return chat;
  }
  return undefined;
}

export interface TicketStartOptions {
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
  const current = getTicket(id);
  if (!current) throw new Error("no such ticket");
  if (current.deviceId && current.deviceId !== deviceId) {
    throw new Error("This ticket runs on another device.");
  }

  const ticket = prepareTicketStart(id);
  const running = activeRunner(ticket);
  if (running) return running;

  const workspace = await workspaceForProject(ticket.projectId);
  if (!workspace) throw new Error("This workspace is not on this device.");
  const checkout = options.checkout ?? config.defaultCheckout;
  const cwd = checkout === "worktree"
    ? await checkoutTicketWorktree(workspace, ticket.key)
    : workspace.path;
  const chat = createChat({
    cwd,
    title: ticket.title,
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.effort !== undefined ? { effort: options.effort } : {}),
    workspaceDefault: { provider: workspace.provider, model: workspace.model, effort: workspace.effort },
  });
  try {
    linkThread(ticket.id, { chatId: chat.id, linkedBy: "runner" });
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
