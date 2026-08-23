import { assignedAgent, WORKSPACE_AGENT } from "./agents.js";
import { deviceId } from "./board-log.js";
import { createChat, deleteChat, getChat, sendChatMessage } from "./chat.js";
import { workspaceForProject } from "./projects.js";
import { getTicket, linkThread, listTickets, prepareTicketStart, type TicketView } from "./tickets.js";
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

async function start(id: string, automatic: boolean): Promise<ReturnType<typeof getChat> | undefined> {
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
  const cwd = await checkoutTicketWorktree(workspace, ticket.key);
  const chat = createChat({
    cwd,
    title: ticket.title,
    ...(agentId ? { agentId } : {}),
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
  options: { automatic?: boolean } = {},
): Promise<ReturnType<typeof getChat> | undefined> {
  const existing = starts.get(id);
  if (existing) return existing;
  const pending = start(id, options.automatic === true);
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
