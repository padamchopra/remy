import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { basename } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { agentByHandle, getAgent, listAgents } from "./agents.js";
import { forgetMemory, listMemories, projectIdForCwd, saveMemory } from "./agent-memories.js";
import { listProjects, projectForWorkspace } from "./projects.js";
import { artifactMarker, type ConvArtifact } from "./remy-artifacts.js";
import {
  explicitlyRequestedTicketStatus,
  REMY_TOOL_INSTRUCTIONS,
  THREAD_TICKET_STATUSES,
} from "./ticket-tool-contract.js";
import { addWorkspace, listWorkspaces } from "./workspaces.js";
import {
  browserSnapshotText,
  clickBrowser,
  openBrowser,
  pressBrowser,
  scrollBrowser,
  setBrowserViewport,
  typeBrowser,
  waitInBrowser,
} from "./browser.js";
import {
  commentOnTicket,
  createTicket,
  getTicket,
  handoffTicket,
  linkThread,
  listTickets,
  setTicketStatus,
  syncTicketFromThread,
  ticketActivity,
  ticketByKey,
  ticketForChat,
  updateTicket,
  type TicketView,
} from "./tickets.js";

interface ThreadSummary {
  id: string;
  title: string;
  cwd: string;
  state: string;
  provider: string;
  model?: string;
  agentId?: string;
  preview?: string;
}

interface ThreadDetail extends ThreadSummary {
  entries: {
    kind: string;
    text?: string;
    tool?: string;
    verb?: string;
    arg?: string;
    status?: string;
  }[];
}

export interface RemyThreadControl {
  currentCwd: string;
  list(): ThreadSummary[];
  read(id: string): ThreadDetail | undefined;
  start(input: {
    cwd: string;
    prompt: string;
    title?: string;
    agentId?: string;
    provider?: string;
    model?: string;
  }): Promise<ThreadSummary>;
  send(id: string, message: string): Promise<void>;
  stop(id: string): void;
  runEnvironment(input: { program: string; args?: string[]; timeoutSeconds?: number }): Promise<{
    command: string;
    output: string;
    exitCode: number;
    environment: string;
  }>;
}

function ticketFor(key: string | undefined, chatId: string): TicketView {
  const ticket = key ? ticketByKey(key) : ticketForChat(chatId);
  if (!ticket) throw new Error(key ? `No ticket called ${key}.` : "This thread is not linked to a ticket.");
  return ticket;
}

function describe(ticket: TicketView): string {
  const project = listProjects().find((entry) => entry.id === ticket.projectId);
  const children = listTickets(ticket.projectId).filter((entry) => entry.parentId === ticket.id);
  const activity = ticketActivity(ticket.id).slice(-20);
  return [
    `${ticket.key}: ${ticket.title}`,
    `Workspace: ${project?.name ?? "Unknown"}`,
    `Status: ${ticket.status}`,
    `Priority: ${ticket.priority}`,
    ticket.assigneeAgentId ? `Assignee: ${getAgent(ticket.assigneeAgentId)?.name ?? ticket.assigneeAgentId}` : "Assignee: Nobody",
    ticket.branch ? `Branch: ${ticket.branch}` : "",
    ticket.body ? `\nDescription:\n${ticket.body}` : "\nNo description.",
    children.length
      ? `\nSub-tickets:\n${children.map((child) => `- ${child.key} [${child.status}] ${child.title}`).join("\n")}`
      : "",
    activity.length
      ? `\nRecent activity:\n${activity.map((entry) => `- ${entry.actor} ${entry.kind}${entry.body ? `: ${entry.body}` : ""}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n");
}

export function ticketPromptContext(chatId: string): string | undefined {
  const ticket = ticketForChat(chatId);
  if (!ticket) return undefined;
  return `<remy_ticket_context>\n${describe(ticket)}\n\nThis thread is linked to this ticket. Use the Remy ticket tools to keep its scope and activity accurate. Change its status only when the person explicitly asks for a particular status; never infer Done from finishing your work.\n</remy_ticket_context>`;
}

/// A tool's answer, and the card the feed draws under it. The marker rides in
/// the text because that is the one thing every provider's transcript keeps.
function ok(text: string, artifact?: ConvArtifact) {
  return { content: [{ type: "text" as const, text: artifact ? text + artifactMarker(artifact) : text }] };
}

function ticketCard(ticket: TicketView): ConvArtifact {
  return { kind: "ticket", key: ticket.key, title: ticket.title, detail: ticket.status };
}

function workspaceName(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, "");
  return basename(trimmed === "~" ? homedir() : trimmed) || "Workspace";
}

async function workspacePath(reference: string | undefined, currentCwd: string): Promise<string> {
  if (!reference?.trim()) return currentCwd;
  const asked = reference.trim();
  const workspaces = await listWorkspaces();
  const matches = workspaces.filter((workspace) =>
    workspace.id === asked
    || workspace.path === asked
    || workspace.origin === asked
    || workspace.name.toLowerCase() === asked.toLowerCase());
  if (matches.length === 0) throw new Error(`No workspace called ${asked}. Register it first if this is a new folder.`);
  if (matches.length > 1) throw new Error(`More than one workspace is called ${asked}. Use its id or path.`);
  return matches[0].path;
}

function describeThread(thread: ThreadDetail): string {
  const agent = thread.agentId ? getAgent(thread.agentId) : undefined;
  const recent = thread.entries.slice(-20).map((entry) => {
    if (entry.text) return `- ${entry.kind}: ${entry.text}`;
    return `- ${entry.kind}: ${[entry.verb, entry.arg, entry.status].filter(Boolean).join(" ")}`;
  });
  return [
    `${thread.title} (${thread.id})`,
    `State: ${thread.state}`,
    `Workspace folder: ${thread.cwd}`,
    `Provider: ${thread.provider}${thread.model ? ` / ${thread.model}` : ""}`,
    agent ? `Agent: @${agent.handle}` : "Agent: Workspace agent",
    thread.preview ? `Latest: ${thread.preview}` : "",
    recent.length ? `\nRecent thread activity:\n${recent.join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

export function claudeTicketMcpServer(chatId: string, agentId: string | undefined, threads: RemyThreadControl) {
  const key = z.string().optional().describe("Ticket key. Omit it for this thread's linked ticket.");
  return createSdkMcpServer({
    name: "remy",
    version: "1",
    instructions: REMY_TOOL_INSTRUCTIONS,
    tools: [
      tool(
        "list_workspaces",
        "List the workspace folders registered on this machine.",
        {},
        async () => {
          const workspaces = await listWorkspaces();
          return ok(workspaces.length
            ? workspaces.map((workspace) => `${workspace.name} (${workspace.id})\n${workspace.path}${workspace.origin ? `\n${workspace.origin}` : ""}`).join("\n\n")
            : "No workspaces are registered on this machine.");
        },
        { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
      ),
      tool(
        "register_workspace",
        "Register an existing Git repository folder as a Remy workspace.",
        {
          path: z.string().describe("Absolute or home-relative path to the repository folder"),
          name: z.string().max(80).optional().describe("Workspace name. Defaults to the folder name."),
        },
        async ({ path, name }) => {
          const workspace = await addWorkspace(name?.trim() || workspaceName(path), path);
          return ok(`Registered ${workspace.name} at ${workspace.path}.`, {
            kind: "workspace",
            id: workspace.id,
            title: workspace.name,
            detail: workspace.path,
          });
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
      ),
      tool(
        "run_with_environment",
        "Run a program in this thread's workspace with its active environment. Values stay in Remy and exact matches are removed from output.",
        {
          program: z.string().min(1).max(500).describe("Executable name or absolute path"),
          args: z.array(z.string().max(20000)).max(200).optional().describe("Arguments passed directly to the executable"),
          timeout_seconds: z.number().int().min(1).max(300).optional(),
        },
        async ({ program, args, timeout_seconds }) => {
          const result = await threads.runEnvironment({ program, args, timeoutSeconds: timeout_seconds });
          return ok([
            `${result.command} (${result.environment}) exited ${result.exitCode}.`,
            result.output || "The command produced no output.",
          ].join("\n\n"));
        },
        { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
      ),
      tool(
        "browser_open",
        "Open a page in this thread's shared browser so the person can watch and take control.",
        { url: z.string().min(1).max(4000) },
        async ({ url }) => {
          await openBrowser(chatId, url, "agent");
          return ok(`Opened ${url} in the shared browser.`);
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
      ),
      tool(
        "browser_viewport",
        "Switch the shared browser between fullscreen, desktop, and mobile responsive layouts.",
        { viewport: z.enum(["fullscreen", "desktop", "mobile"]) },
        async ({ viewport }) => {
          const view = await setBrowserViewport(chatId, viewport, "agent");
          return ok(`Switched the shared browser to ${viewport} (${view.width} × ${view.height}).`);
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
      ),
      tool(
        "browser_snapshot",
        "Read the shared browser's current URL, visible text, interactive elements, console, and failed requests.",
        {},
        async () => ok(await browserSnapshotText(chatId)),
        { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } },
      ),
      tool(
        "browser_click",
        "Click an element or coordinate in the shared browser. Prefer an accessible role and name.",
        {
          role: z.string().max(80).optional(),
          name: z.string().max(500).optional(),
          text: z.string().max(500).optional(),
          selector: z.string().max(1000).optional(),
          x: z.number().min(0).max(2000).optional(),
          y: z.number().min(0).max(2000).optional(),
        },
        async (target) => {
          await clickBrowser(chatId, target, "agent");
          return ok("Clicked in the shared browser.");
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
      ),
      tool(
        "browser_type",
        "Replace the text in a field in the shared browser. Prefer its accessible role and name.",
        {
          role: z.string().max(80).optional(),
          name: z.string().max(500).optional(),
          text: z.string().max(500).optional(),
          selector: z.string().max(1000).optional(),
          value: z.string().max(20000),
        },
        async ({ value, ...target }) => {
          await typeBrowser(chatId, target, value, "agent");
          return ok("Entered text in the shared browser.");
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
      ),
      tool(
        "browser_press",
        "Press a key or shortcut in the shared browser, such as Enter, Escape, or Meta+R.",
        { key: z.string().min(1).max(100) },
        async ({ key }) => {
          await pressBrowser(chatId, key, "agent");
          return ok(`Pressed ${key} in the shared browser.`);
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
      ),
      tool(
        "browser_scroll",
        "Scroll the shared browser by pixels.",
        {
          delta_x: z.number().min(-10000).max(10000).optional(),
          delta_y: z.number().min(-10000).max(10000),
        },
        async ({ delta_x, delta_y }) => {
          await scrollBrowser(chatId, delta_x ?? 0, delta_y, "agent");
          return ok("Scrolled the shared browser.");
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
      ),
      tool(
        "browser_wait",
        "Wait briefly for the shared page to update before reading it again.",
        { milliseconds: z.number().int().min(0).max(10000).optional() },
        async ({ milliseconds }) => {
          await waitInBrowser(chatId, milliseconds ?? 500, "agent");
          return ok("The shared browser finished waiting.");
        },
        { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } },
      ),
      tool(
        "list_agents",
        "List the agents available when starting a thread.",
        {},
        async () => {
          const agents = listAgents();
          return ok(agents.length
            ? agents.map((agent) => `@${agent.handle}: ${agent.role || agent.name}`).join("\n")
            : "No custom agents are available. Use the workspace agent.");
        },
        { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
      ),
      tool(
        "list_memories",
        "Read this agent's durable memories for the current workspace.",
        { query: z.string().max(500).optional() },
        async ({ query }) => {
          if (!agentId) throw new Error("This thread has no agent memory.");
          const memories = listMemories(agentId, {
            projectId: await projectIdForCwd(threads.currentCwd),
            query,
          });
          return ok(memories.length
            ? memories.map((memory) => `${memory.id} [${memory.scope}]\n${memory.content}`).join("\n\n")
            : "You have no matching memories.");
        },
        { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
      ),
      tool(
        "save_memory",
        "Save or replace a durable fact that should follow this agent between devices.",
        {
          content: z.string().min(1).max(4000),
          scope: z.enum(["global", "workspace"]).optional(),
          workspace: z.string().optional().describe("Registered workspace name, id, path, or origin. Required only when this thread is not already in that workspace."),
          memory_id: z.string().optional().describe("Existing memory id to replace."),
        },
        async ({ content, scope, workspace, memory_id }) => {
          if (!agentId) throw new Error("This thread has no agent memory.");
          let projectId: string | undefined;
          if (scope === "workspace") {
            const path = await workspacePath(workspace, threads.currentCwd);
            const held = (await listWorkspaces()).find((entry) =>
              entry.path === path || entry.worktrees.some((worktree) => worktree.path === path));
            projectId = held ? projectForWorkspace(held.id)?.id : undefined;
          }
          const memory = saveMemory({
            agentId,
            content,
            scope,
            projectId,
            ...(memory_id ? { id: memory_id } : {}),
          });
          return ok(`${memory_id ? "Updated" : "Saved"} memory ${memory.id}.`);
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
      ),
      tool(
        "forget_memory",
        "Forget one of this agent's durable memories.",
        { memory_id: z.string() },
        async ({ memory_id }) => {
          if (!agentId) throw new Error("This thread has no agent memory.");
          forgetMemory(agentId, memory_id);
          return ok(`Forgot memory ${memory_id}.`);
        },
        { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
      ),
      tool(
        "list_threads",
        "List recent Remy threads and their current state.",
        {},
        async () => ok(threads.list().slice(0, 50).map((thread) => {
          const owner = thread.agentId ? getAgent(thread.agentId)?.handle : undefined;
          return `${thread.id} [${thread.state}] ${thread.title}\n${thread.cwd}${owner ? `\n@${owner}` : ""}`;
        }).join("\n\n") || "There are no threads on this machine."),
        { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
      ),
      tool(
        "read_thread",
        "Read a Remy thread's state and recent activity.",
        { thread_id: z.string().describe("The thread id from list_threads or start_thread") },
        async ({ thread_id }) => {
          const thread = threads.read(thread_id);
          if (!thread) throw new Error("No such thread.");
          return ok(describeThread(thread));
        },
        { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
      ),
      tool(
        "start_thread",
        "Start another Remy thread and send it its first message.",
        {
          prompt: z.string().min(1).max(20000).describe("The complete task for the new thread"),
          workspace: z.string().optional().describe("Registered workspace name, id, path, or origin. Omit it to use this thread's folder."),
          agent: z.string().optional().describe("Agent handle. Omit it to use the workspace agent."),
          title: z.string().max(120).optional(),
          provider: z.enum(["claude", "codex", "cursor"]).optional(),
          model: z.string().optional(),
        },
        async ({ prompt, workspace, agent, title, provider, model }) => {
          const selected = agent ? agentByHandle(agent.replace(/^@/, "")) : undefined;
          if (agent && !selected) throw new Error(`No agent called ${agent}.`);
          const thread = await threads.start({
            cwd: await workspacePath(workspace, threads.currentCwd),
            prompt,
            ...(title ? { title } : {}),
            ...(selected ? { agentId: selected.id } : {}),
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
          });
          return ok(`Started ${thread.title} as thread ${thread.id}.`, {
            kind: "thread",
            id: thread.id,
            title: thread.title,
            detail: selected ? `@${selected.handle}` : "Workspace agent",
          });
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
      ),
      tool(
        "send_to_thread",
        "Send another message to an existing Remy thread.",
        {
          thread_id: z.string(),
          message: z.string().min(1).max(20000),
        },
        async ({ thread_id, message }) => {
          if (thread_id === chatId) throw new Error("Reply normally instead of sending a message to this same thread.");
          await threads.send(thread_id, message);
          return ok(`Sent the message to thread ${thread_id}.`);
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
      ),
      tool(
        "stop_thread",
        "Stop an existing Remy thread while keeping its conversation.",
        { thread_id: z.string() },
        async ({ thread_id }) => {
          if (thread_id === chatId) throw new Error("The current thread cannot stop itself through Remy.");
          threads.stop(thread_id);
          return ok(`Stopped thread ${thread_id}.`);
        },
        { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
      ),
      tool(
        "create_ticket",
        "Write a new ticket on a workspace's board.",
        {
          title: z.string().min(1).max(200),
          body: z.string().max(20000).optional().describe("The description in markdown"),
          workspace: z.string().optional().describe("Registered workspace name, id, path, or origin. Omit it to use this thread's folder."),
          status: z.enum(THREAD_TICKET_STATUSES).optional().describe("Defaults to Backlog. Choose another status only when the person explicitly asks."),
        },
        async ({ title, body, workspace, status }) => {
          const path = await workspacePath(workspace, threads.currentCwd);
          const held = (await listWorkspaces()).find((entry) =>
            entry.path === path || entry.worktrees.some((worktree) => worktree.path === path));
          const project = held ? projectForWorkspace(held.id) : undefined;
          if (!project) throw new Error("That folder has no board yet. Register it as a workspace first.");
          const actor = agentId ? getAgent(agentId)?.handle ?? "remy" : "remy";
          const ticket = createTicket({
            projectId: project.id,
            title,
            ...(body ? { body } : {}),
            ...(status ? { status } : {}),
          }, actor);
          return ok(`Created ${ticket.key} in ${project.name}.`, ticketCard(ticket));
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
      ),
      tool(
        "read_ticket",
        "Read a ticket's current scope, status, sub-tickets, and recent activity.",
        { key },
        async ({ key: asked }) => ok(describe(ticketFor(asked, chatId))),
        { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
      ),
      tool(
        "attach_ticket",
        "Link this thread to a ticket before working on it.",
        { key: z.string().describe("The ticket key to work on") },
        async ({ key: asked }) => {
          const ticket = ticketFor(asked, chatId);
          const existing = ticketForChat(chatId);
          if (existing && existing.id !== ticket.id) throw new Error(`This thread is already linked to ${existing.key}.`);
          const linked = existing ?? linkThread(ticket.id, { chatId, agentId, linkedBy: "runner" });
          syncTicketFromThread(chatId, "working");
          return ok(`Linked this thread to ${linked.key}.`, ticketCard(linked));
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
      ),
      tool(
        "update_ticket",
        "Rewrite a ticket's title or product scope.",
        {
          key,
          title: z.string().max(200).optional(),
          body: z.string().max(20000).optional().describe("The complete replacement description in markdown"),
        },
        async ({ key: asked, title, body }) => {
          const ticket = ticketFor(asked, chatId);
          const patch: Record<string, unknown> = {};
          if (title !== undefined) patch.title = title;
          if (body !== undefined) patch.body = body;
          if (Object.keys(patch).length === 0) throw new Error("Give a title or description to update.");
          const updated = updateTicket(ticket.id, patch);
          return ok(`Updated ${updated.key}.`, ticketCard(updated));
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
      ),
      tool(
        "set_ticket_status",
        "Move a ticket only when the person explicitly asks for a particular status. Never infer Done from finishing work.",
        {
          key,
          status: z.enum(THREAD_TICKET_STATUSES),
          note: z.string().max(10000).optional(),
          instruction: z.string().max(1000).describe("The exact words from the person's latest message that request this status"),
        },
        async ({ key: asked, status, note, instruction }) => {
          const latest = [...(threads.read(chatId)?.entries ?? [])]
            .reverse()
            .find((entry) => entry.kind === "user")?.text;
          if (!explicitlyRequestedTicketStatus(latest, instruction, status)) {
            throw new Error("Change a ticket's status only when the person explicitly asks.");
          }
          const ticket = ticketFor(asked, chatId);
          const actor = agentId ? getAgent(agentId)?.handle ?? "remy" : "remy";
          const moved = setTicketStatus(ticket.id, status, { actor, note });
          return ok(`Moved ${moved.key} to ${status}.`, ticketCard(moved));
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
      ),
      tool(
        "comment_on_ticket",
        "Record a concise progress note, QA result, blocker, or decision on a ticket.",
        { key, body: z.string().max(10000) },
        async ({ key: asked, body }) => {
          const ticket = ticketFor(asked, chatId);
          const actor = agentId ? getAgent(agentId)?.handle ?? "remy" : "remy";
          const commented = commentOnTicket(ticket.id, body, actor);
          return ok(`Commented on ${commented.key}.`, ticketCard(commented));
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
      ),
      tool(
        "create_sub_ticket",
        "Create a smaller piece of work beneath a ticket.",
        {
          key,
          title: z.string().max(200),
          body: z.string().max(20000).optional(),
        },
        async ({ key: asked, title, body }) => {
          const parent = ticketFor(asked, chatId);
          const child = createTicket({
            projectId: parent.projectId,
            parentId: parent.id,
            title,
            ...(body ? { body } : {}),
          });
          return ok(`Created ${child.key} under ${parent.key}.`, ticketCard(child));
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
      ),
      tool(
        "handoff_ticket",
        "Assign a ticket to one of this agent's configured handoff targets.",
        { key, handle: z.string().describe("The next agent's handle") },
        async ({ key: asked, handle }) => {
          const ticket = ticketFor(asked, chatId);
          const current = agentId ? getAgent(agentId) : undefined;
          const next = agentByHandle(handle);
          if (!next) throw new Error(`No agent called @${handle}.`);
          if (!current?.handoffTo.includes(next.handle)) throw new Error(`@${current?.handle ?? "workspace"} cannot hand tickets to @${next.handle}.`);
          const handed = handoffTicket(ticket.id, next.id, current.handle);
          return ok(`Handed ${handed.key} to @${next.handle}.`, ticketCard(handed));
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
      ),
    ],
  });
}
